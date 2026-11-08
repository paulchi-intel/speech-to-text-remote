"""
asr_server.py — Speech-to-Text Remote HTTP backend (runs in a container on the GPU server)
Port: 17495 (ASR_PORT)

Starts the HTTP server immediately, then loads Qwen3-ASR 1.7B in the
background (downloading it into HF_HOME on first run), and serves:
  GET  /health     → {"status":"ok","model_loaded":bool,"device":"xpu"}
  POST /transcribe → {"audio_base64", "filename", "language", "script"}
                   ← {"status":"ok","text":"...","raw_text":"...","language":"Chinese","duration_sec":12.3}
  POST /convert    → {"texts": [...], "script"}
                   ← {"status":"ok","texts": [...]}

Any format ffmpeg can read is accepted (mp3, m4a, ogg, webm, flac, wav, …);
it is converted to 16 kHz mono WAV before recognition.

"script" picks the Chinese writing system of the transcript: "zh-TW"
(Traditional, Taiwan phrasing), "zh-CN" (Simplified) or "" (as recognized).
Only Chinese / Cantonese transcripts are converted, so Japanese kanji are left alone.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn

MODEL_ID       = os.environ.get("ASR_MODEL_ID", "Qwen/Qwen3-ASR-1.7B")
HOST           = os.environ.get("ASR_HOST", "0.0.0.0")
PORT           = int(os.environ.get("ASR_PORT", "17495"))
MAX_NEW_TOKENS = int(os.environ.get("ASR_MAX_NEW_TOKENS", "4096"))
MAX_UPLOAD_MB  = int(os.environ.get("ASR_MAX_UPLOAD_MB", "200"))

# UI language code → language name expected by Qwen3-ASR ("auto" = detect)
LANG_MAP: dict[str, str] = {
    "zh":  "Chinese",
    "en":  "English",
    "yue": "Cantonese",
    "ja":  "Japanese",
    "ko":  "Korean",
    "de":  "German",
    "fr":  "French",
    "es":  "Spanish",
    "pt":  "Portuguese",
    "it":  "Italian",
    "ru":  "Russian",
    "vi":  "Vietnamese",
    "th":  "Thai",
    "id":  "Indonesian",
}

# ── Chinese script conversion (OpenCC) ────────────────────────────────────────
SCRIPT_CONFIGS = {"zh-TW": "s2twp", "zh-CN": "t2s"}
CHINESE_LANGS  = {"Chinese", "Cantonese"}
_converters: dict[str, object] = {}


def convert_script(text: str, script: str) -> str:
    config = SCRIPT_CONFIGS.get(script or "")
    if not config or not text:
        return text
    if config not in _converters:
        import opencc
        _converters[config] = opencc.OpenCC(f"{config}.json")
    return _converters[config].convert(text)

# ── Model loading (background thread) ─────────────────────────────────────────
model        = None
MODEL_LOADED = False
MODEL_ERROR  = None
DEVICE       = None
# One recognition at a time on the GPU
infer_lock   = threading.Lock()


def _pick_device(torch) -> str:
    if hasattr(torch, "xpu") and torch.xpu.is_available():
        return "xpu"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model() -> None:
    global model, MODEL_LOADED, MODEL_ERROR, DEVICE
    try:
        import torch
        from huggingface_hub import snapshot_download
        from qwen_asr import Qwen3ASRModel

        DEVICE = _pick_device(torch)
        dtype  = torch.bfloat16 if DEVICE != "cpu" else torch.float32

        print(f"[asr_server] Fetching {MODEL_ID} (cached in {os.environ.get('HF_HOME')})…", flush=True)
        model_path = snapshot_download(MODEL_ID)

        print(f"[asr_server] Loading model on {DEVICE}…", flush=True)
        m = Qwen3ASRModel.from_pretrained(
            model_path,
            dtype=dtype,
            device_map=DEVICE,
            max_inference_batch_size=1,
            max_new_tokens=MAX_NEW_TOKENS,
        )
        model        = m
        MODEL_LOADED = True
        print(f"[asr_server] Model loaded on {DEVICE}.", flush=True)
    except Exception as exc:
        MODEL_ERROR = str(exc)
        print(f"[asr_server] ERROR loading model: {exc}", file=sys.stderr, flush=True)
        traceback.print_exc()


def to_wav16k(src: str, dst: str) -> float:
    """Convert any audio file to 16 kHz mono WAV; return its duration in seconds."""
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
         "-i", src, "-ac", "1", "-ar", "16000", "-f", "wav", dst],
        capture_output=True, text=True, timeout=300,
    )
    if proc.returncode != 0:
        raise ValueError(f"Could not decode audio: {proc.stderr.strip()[:300] or 'ffmpeg failed'}")
    import soundfile as sf
    info = sf.info(dst)
    return info.frames / float(info.samplerate or 16000)


def transcribe(audio_bytes: bytes, filename: str, lang_code: str, script: str) -> dict:
    suffix = Path(filename or "audio").suffix.lower()
    if not suffix or len(suffix) > 6:
        suffix = ".bin"
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "input" + suffix)
        wav = os.path.join(tmp, "input16k.wav")
        with open(src, "wb") as f:
            f.write(audio_bytes)
        duration = to_wav16k(src, wav)
        if duration < 0.1:
            raise ValueError("Audio is empty or too short.")

        language = LANG_MAP.get(lang_code) if lang_code and lang_code != "auto" else None
        with infer_lock:
            t0 = time.time()
            results = model.transcribe(audio=wav, language=language)
            elapsed = time.time() - t0

        r = results[0]
        raw_text      = (getattr(r, "text", "") or "").strip()
        detected_lang = getattr(r, "language", None) or language
        text = convert_script(raw_text, script) if detected_lang in CHINESE_LANGS else raw_text
        return {
            "text":         text,
            "raw_text":     raw_text,
            "language":     detected_lang,
            "duration_sec": round(duration, 2),
            "elapsed_sec":  round(elapsed, 2),
        }


# ── HTTP handler ──────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # noqa: N802
        print(f"[asr_server] {self.client_address[0]} {fmt % args}", flush=True)

    def _send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json({
                "status":       "ok",
                "model":        MODEL_ID,
                "model_loaded": MODEL_LOADED,
                "model_error":  MODEL_ERROR,
                "device":       DEVICE,
                "languages":    sorted(LANG_MAP),
            })
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/convert":
            self._convert()
            return
        if self.path != "/transcribe":
            self._send_json({"error": "Not found"}, 404)
            return

        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_UPLOAD_MB * 1024 * 1024 * 4 // 3 + 4096:
            self._send_json({"status": "error", "error": f"Upload larger than {MAX_UPLOAD_MB} MB"}, 413)
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, 400)
            return

        audio_b64 = payload.get("audio_base64", "")
        filename  = payload.get("filename", "audio")
        lang_code = payload.get("language", "auto")
        script    = payload.get("script", "")
        if not audio_b64:
            self._send_json({"status": "error", "error": "Missing audio"}, 400)
            return
        if lang_code != "auto" and lang_code not in LANG_MAP:
            self._send_json({"status": "error", "error": f"Unsupported language: {lang_code}"}, 400)
            return

        if not MODEL_LOADED or model is None:
            self._send_json({"error": MODEL_ERROR or "Model not loaded yet", "status": "error"}, 503)
            return

        try:
            result = transcribe(base64.b64decode(audio_b64), filename, lang_code, script)
            self._send_json({"status": "ok", **result})
        except ValueError as exc:
            self._send_json({"status": "error", "error": str(exc)}, 400)
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"status": "error", "error": str(exc)}, 500)

    def _convert(self) -> None:
        """Re-render existing transcripts when the UI language changes (no model needed)."""
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length))
            texts   = payload.get("texts", [])
            script  = payload.get("script", "")
            if not isinstance(texts, list) or not all(isinstance(x, str) for x in texts):
                raise ValueError("texts must be a list of strings")
        except (json.JSONDecodeError, ValueError) as exc:
            self._send_json({"status": "error", "error": str(exc)}, 400)
            return
        try:
            self._send_json({"status": "ok", "texts": [convert_script(x, script) for x in texts]})
        except Exception as exc:
            traceback.print_exc()
            self._send_json({"status": "error", "error": str(exc)}, 500)


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Handle each request in its own thread."""
    daemon_threads = True


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    threading.Thread(target=load_model, daemon=True).start()
    server = ThreadedHTTPServer((HOST, PORT), Handler)
    print(f"[asr_server] Listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[asr_server] Stopped.", flush=True)
