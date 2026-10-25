"""JSON stdin/stdout bridge, run only by .venv-ai4free/bin/python."""

from contextlib import redirect_stdout
from importlib.metadata import distribution
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
import sys
from functools import lru_cache

import requests


class ProviderFailure(Exception):
    pass


@lru_cache(maxsize=1)
def groq_provider():
    # ai4free 0.7 eagerly imports every provider in __init__, including unrelated
    # browser providers with undeclared dependencies. Load its Groq module only.
    path = distribution("ai4free").locate_file("ai4free/groq.py")
    spec = spec_from_file_location("opo_ai4free_groq", path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.GROQ


def check_response(response):
    if response.ok:
        return
    try:
        error = response.json().get("error", {})
        detail = error.get("message", "") if isinstance(error, dict) else str(error)
    except (ValueError, AttributeError):
        detail = ""
    if not detail:
        detail = "No JSON error was returned; a proxy or gateway may have rejected the request."
    raise ProviderFailure(f"Groq returned HTTP {response.status_code}: {detail}")


class BriefSession(requests.Session):
    def post(self, url, **kwargs):
        body = kwargs["json"]
        for unused_default in ("frequency_penalty", "presence_penalty", "top_p"):
            body.pop(unused_default, None)
        body["max_completion_tokens"] = 1600
        body["response_format"] = {"type": "json_object"}
        if body["model"].startswith("openai/gpt-oss"):
            body["reasoning_effort"] = "low"
        response = super().post(url, **kwargs)
        check_response(response)
        return response


@lru_cache(maxsize=1)
def client(api_key, model):
    provider = groq_provider()(
        api_key=api_key, model=model, is_conversation=False,
        update_file=False, max_tokens=1600, temperature=0.2, timeout=20,
        intro="Return the requested JSON object only.",
    )
    provider.session.close()
    provider.session = BriefSession()
    provider.session.headers.update(provider.headers)
    return provider


def run(payload):
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise ProviderFailure("GROQ_API_KEY is not configured in the FastAPI process.")
    provider = client(api_key, payload["model"])
    if payload.get("action") == "status":
        response = provider.session.get(
            "https://api.groq.com/openai/v1/models/" + payload["model"], timeout=12,
        )
        check_response(response)
        response.json()
        return {"ok": True, "detail": "AI4Free loaded; the configured key can access this model."}
    # Each handoff is independent, even though the HTTP connection is reused.
    provider.last_response = {}
    completion = provider.chat(payload["prompt"])
    if not isinstance(completion, str) or not completion.strip():
        raise ProviderFailure("AI4Free returned an empty brief.")
    return {"ok": True, "content": completion.strip()}


def failure(error):
    message = str(error)
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if api_key:
        message = message.replace(api_key, "[redacted]")
    return f"AI4Free: {message[:500]}"


def main():
    if "--serve" in sys.argv:
        try:
            with redirect_stdout(sys.stderr):
                groq_provider()
            print(json.dumps({"ready": True}), flush=True)
        except Exception as error:
            print(json.dumps({"ready": False, "error": failure(error)}), flush=True)
            return
        for line in sys.stdin:
            try:
                with redirect_stdout(sys.stderr):
                    result = run(json.loads(line))
            except Exception as error:
                result = {"ok": False, "error": failure(error)}
            print(json.dumps(result), flush=True)
        return
    try:
        with redirect_stdout(sys.stderr):
            result = run(json.load(sys.stdin))
    except Exception as error:
        result = {"ok": False, "error": failure(error)}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
