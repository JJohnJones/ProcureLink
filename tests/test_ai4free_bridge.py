"""Exercise the real subprocess protocol without a provider or network."""

import json
import sys

from ai4free_bridge import AI4FreeBridge


def test_worker_process_is_reused_and_restarts_after_close(tmp_path, monkeypatch):
    shim = tmp_path / "worker-python"
    shim.write_text(
        f"#!{sys.executable}\n"
        "import sys, json, os\n"
        "print(json.dumps({'ready': True}), flush=True)\n"
        "for line in sys.stdin:\n"
        "    payload = json.loads(line)\n"
        "    print(json.dumps({'ok': True, 'pid': os.getpid(), 'payload': payload, 'argv': sys.argv}), flush=True)\n"
    )
    shim.chmod(0o755)
    monkeypatch.setenv("AI4FREE_PYTHON", str(shim))
    monkeypatch.setenv("GROQ_API_KEY", "never-in-command-arguments")
    worker = AI4FreeBridge()
    try:
        first = worker.request({"action": "chat", "prompt": "Fictional case one"})
        second = worker.request({"action": "chat", "prompt": "Fictional case two"})
        assert first["pid"] == second["pid"]
        assert second["payload"]["prompt"] == "Fictional case two"
        assert "never-in-command-arguments" not in json.dumps(first)
        process = worker.process
        worker.close()
        assert process.poll() is not None
        restarted = worker.request({"action": "chat", "prompt": "Fictional case three"})
        assert restarted["pid"] != first["pid"]
    finally:
        worker.close()
