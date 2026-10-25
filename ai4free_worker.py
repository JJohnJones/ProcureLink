"""JSON stdin/stdout bridge, run only by .venv-ai4free/bin/python."""

from contextlib import redirect_stdout
from importlib.metadata import distribution
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
import sys


class ProviderFailure(Exception):
    pass


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


def run(payload):
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise ProviderFailure("GROQ_API_KEY is not configured in the FastAPI process.")
    import requests

    class BriefSession(requests.Session):
        def post(self, url, **kwargs):
            # The old wrapper ignores max_tokens and has no JSON-mode option.
            body = kwargs["json"]
            for unused_default in ("frequency_penalty", "presence_penalty", "top_p"):
                body.pop(unused_default, None)
            body["max_completion_tokens"] = 1200
            body["response_format"] = {"type": "json_object"}
            if payload["model"].startswith("openai/gpt-oss"):
                body["reasoning_effort"] = "low"
            response = super().post(url, **kwargs)
            check_response(response)
            return response

    provider = groq_provider()(
        api_key=api_key, model=payload["model"], is_conversation=False,
        update_file=False, max_tokens=1200, temperature=0.2, timeout=20,
        intro="Return only a JSON object with string keys case_brief and match_rationale.",
    )
    with BriefSession() as session:
        session.headers.update(provider.headers)
        provider.session.close()
        provider.session = session
        if payload.get("action") == "status":
            response = session.get(
                "https://api.groq.com/openai/v1/models/" + payload["model"], timeout=12,
            )
            check_response(response)
            response.json()
            return {"ok": True, "detail": "AI4Free loaded; the configured key can access this model."}
        completion = provider.chat(payload["prompt"])
        if not isinstance(completion, str) or not completion.strip():
            raise ProviderFailure("AI4Free returned an empty brief.")
        return {"ok": True, "content": completion.strip()}


def main():
    try:
        payload = json.load(sys.stdin)
        # Dependency version notices must not corrupt the JSON protocol.
        with redirect_stdout(sys.stderr):
            result = run(payload)
    except Exception as error:
        message = str(error)
        api_key = os.environ.get("GROQ_API_KEY", "").strip()
        if api_key:
            message = message.replace(api_key, "[redacted]")
        result = {"ok": False, "error": f"AI4Free: {message[:500]}"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
