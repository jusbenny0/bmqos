"""Local speech-to-text (faster-whisper, CPU int8). No paid STT. Audio is only kept in a temp file for the duration of transcription."""
import os, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from faster_whisper import WhisperModel

MAX = 6 * 1024 * 1024  # 2 min webm/opus ≈ 1 MB, with headroom
LOAD = lambda n: WhisperModel(n, device="cpu", compute_type="int8")
try:
    model = LOAD(os.environ.get("STT_MODEL", "small"))
except Exception:  # model failed to download/load: fall back
    model = LOAD("base")


LOCK = threading.Lock()  # one model = one transcription at a time


class H(BaseHTTPRequestHandler):
    def _send(self, code, body=b"ok", ctype="text/plain; charset=utf-8"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        self._send(200)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX:
            return self._send(413, b"size")
        data = self.rfile.read(n)
        with tempfile.NamedTemporaryFile(suffix=".webm") as f:
            f.write(data); f.flush()
            with LOCK:
                segs, _ = model.transcribe(f.name, language="cs", beam_size=1, vad_filter=True)
                text = " ".join(s.text.strip() for s in segs).strip()
        self._send(200, text.encode(), "text/plain; charset=utf-8")

    def log_message(self, *a):
        pass


ThreadingHTTPServer((os.environ.get("STT_HOST", "127.0.0.1"), int(os.environ.get("STT_PORT", "8765"))), H).serve_forever()
