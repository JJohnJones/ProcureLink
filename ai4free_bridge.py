"""Keep the isolated AI4Free interpreter alive between brief requests."""

import json
import os
from pathlib import Path
from queue import Empty, Queue
import subprocess
from threading import RLock, Thread
import time


class AI4FreeBridge:
    def __init__(self):
        self.lock = RLock()
        self.process = None
        self.signature = None
        self.responses = None

    def _receive(self, deadline):
        try:
            line = self.responses.get(timeout=max(0.01, deadline - time.monotonic()))
        except Empty as error:
            raise RuntimeError("AI4Free request timed out. Try again.") from error
        if line is None:
            raise RuntimeError("AI4Free worker stopped unexpectedly. Try again.")
        try:
            result = json.loads(line)
            if not isinstance(result, dict):
                raise ValueError("Expected an object")
            return result
        except (ValueError, TypeError) as error:
            raise RuntimeError("AI4Free worker returned invalid output.") from error

    def _start(self, deadline):
        root = Path(__file__).resolve().parent
        python = Path(os.environ.get("AI4FREE_PYTHON", str(root / ".venv-ai4free/bin/python")))
        signature = (str(python), os.environ.get("GROQ_API_KEY", ""))
        if self.process is not None and self.process.poll() is None and signature == self.signature:
            return
        self.close()
        if not python.is_file():
            raise RuntimeError("AI4Free environment is missing. Install requirements-ai4free.txt into .venv-ai4free.")
        self.process = subprocess.Popen(
            [str(python), "-u", str(root / "ai4free_worker.py"), "--serve"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1,
        )
        self.signature = signature
        self.responses = Queue()

        def read_responses(process, queue):
            try:
                for line in process.stdout:
                    queue.put(line)
            finally:
                queue.put(None)

        Thread(target=read_responses, args=(self.process, self.responses), daemon=True).start()
        ready = self._receive(deadline)
        if not ready.get("ready"):
            raise RuntimeError(ready.get("error", "AI4Free worker could not initialize."))

    def request(self, payload):
        deadline = time.monotonic() + 28
        if not self.lock.acquire(timeout=28):
            raise RuntimeError("AI4Free is busy. Try again shortly.")
        try:
            self._start(deadline)
            if payload.get("action") == "warm":
                return {"ok": True}
            self.process.stdin.write(json.dumps(payload) + "\n")
            self.process.stdin.flush()
            result = self._receive(deadline)
            if not result.get("ok"):
                raise RuntimeError(result.get("error", "AI4Free request failed."))
            return result
        except (OSError, RuntimeError):
            self.close()
            raise
        finally:
            self.lock.release()

    def close(self):
        with self.lock:
            if self.process is not None:
                if self.process.poll() is None:
                    self.process.kill()
                self.process.wait(timeout=3)
                self.process.stdin.close()
                self.process.stdout.close()
                self.process = None
                self.signature = None
