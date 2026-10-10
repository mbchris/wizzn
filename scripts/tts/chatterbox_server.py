#!/usr/bin/env python3
"""
Chatterbox Multilingual TTS server for wizzn (German, batch).

  POST /synthesize  JSON {"text": str, "length_scale"?: float}  → audio/wav (16-bit mono)
  GET  /health      200 once the model is loaded
  GET  /info        engine, model, voice, parameters + cumulative stats (requests, cache hits, generation time)

The API sends one short chunk (a few sentences) per request, so no request runs into HTTP timeouts.
Raw renders are cached on disk by text hash; a different length_scale only time-stretches the cached audio,
so the API's duration fitting (re-render at another pace) is cheap.

Usage: python chatterbox_server.py --port 5100 [--ref voice.wav] [--cache-dir .chatterbox/cache]
"""
import argparse
import hashlib
import io
import json
import os
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np  # noqa: E402
import torch  # noqa: E402

# Checkpoints were saved on CUDA: load to CPU first, from_pretrained moves them to the device
_torch_load = torch.load


def _load_cpu(*args, **kwargs):
    kwargs.setdefault("map_location", torch.device("cpu"))
    return _torch_load(*args, **kwargs)


torch.load = _load_cpu

from chatterbox.mtl_tts import ChatterboxMultilingualTTS  # noqa: E402

PAUSE_SEC = 0.35  # silence after each chunk (sentence groups)
SEED = 1234  # fixed seed → the same text renders the same way


def pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class Engine:
    def __init__(self, args):
        self.device = pick_device(args.device)
        print(f"chatterbox: loading model on {self.device} (first run downloads ~3 GB)", flush=True)
        self.model = ChatterboxMultilingualTTS.from_pretrained(device=self.device)
        self.sr = self.model.sr
        self.args = args
        if args.ref:
            self.model.prepare_conditionals(args.ref, exaggeration=args.exaggeration)
        self.cache = Path(args.cache_dir)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.stats = {"requests": 0, "cache_hits": 0, "generated": 0, "gen_sec": 0.0, "audio_sec": 0.0}
        tag = f"{args.ref}|{args.exaggeration}|{args.cfg_weight}|{args.temperature}|{SEED}"
        self.voice_key = hashlib.sha256(tag.encode()).hexdigest()[:12]
        print(f"chatterbox: ready (sr={self.sr}, ref={args.ref or 'built-in voice'})", flush=True)

    def raw(self, text: str) -> np.ndarray:
        key = hashlib.sha256(f"{self.voice_key}|{text}".encode()).hexdigest()
        path = self.cache / f"{key}.npy"
        self.stats["requests"] += 1
        if path.exists():
            self.stats["cache_hits"] += 1
            return np.load(path)
        t0 = time.monotonic()
        with self.lock:
            torch.manual_seed(SEED)
            wav = self.model.generate(
                text,
                language_id="de",
                exaggeration=self.args.exaggeration,
                cfg_weight=self.args.cfg_weight,
                temperature=self.args.temperature,
            )
        audio = wav.squeeze().detach().cpu().numpy().astype(np.float32)
        audio = np.concatenate([audio, np.zeros(int(PAUSE_SEC * self.sr), dtype=np.float32)])
        np.save(path, audio)
        self._count(t0, len(audio) / self.sr, len(text))
        return audio

    def _count(self, t0: float, audio_sec: float, chars: int):
        gen = time.monotonic() - t0
        self.stats["generated"] += 1
        self.stats["gen_sec"] += gen
        self.stats["audio_sec"] += audio_sec
        print(f"chatterbox: generated {chars} chars → {audio_sec:.1f}s audio in {gen:.1f}s (RTF {gen / max(audio_sec, 0.01):.2f})", flush=True)

    def info(self) -> dict:
        a = self.args
        return {
            "engine": "chatterbox-multilingual",
            "model": "ResembleAI/chatterbox (multilingual)",
            "device": self.device,
            "language": "de",
            "voice": a.ref or "built-in",
            "params": {"exaggeration": a.exaggeration, "cfg_weight": a.cfg_weight, "temperature": a.temperature, "seed": SEED, "pause_sec": PAUSE_SEC, "sample_rate": self.sr},
        }

    def synthesize(self, text: str, length_scale: float) -> bytes:
        audio = self.raw(text)
        if abs(length_scale - 1) > 0.01:
            import librosa

            audio = librosa.effects.time_stretch(audio, rate=1 / length_scale)
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.sr)
            w.writeframes(pcm.tobytes())
        return buf.getvalue()


def make_handler(engine: Engine):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, ctype: str):
            self.send_response(status)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self._send(200, b"ok", "text/plain")
            elif self.path == "/info":
                self._send(200, json.dumps({**engine.info(), "stats": engine.stats}).encode(), "application/json")
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self):
            if self.path != "/synthesize":
                return self._send(404, b"not found", "text/plain")
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
                text = str(req.get("text", "")).strip()
                if not text:
                    return self._send(400, b"text is required", "text/plain")
                scale = float(req.get("length_scale") or 1)
                self._send(200, engine.synthesize(text, scale), "audio/wav")
            except Exception as e:  # noqa: BLE001
                print(f"chatterbox: error: {e!r}", flush=True)
                self._send(500, str(e).encode(), "text/plain")

        def log_message(self, fmt, *args):
            print(f"chatterbox: {fmt % args}", flush=True)

    return Handler


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5100)
    p.add_argument("--ref", default="", help="reference WAV (~10 s clean German speech) to clone the voice")
    p.add_argument("--device", default="auto", choices=["auto", "mps", "cuda", "cpu"])
    p.add_argument("--cache-dir", default=".chatterbox/cache")
    p.add_argument("--exaggeration", type=float, default=0.5)
    p.add_argument("--cfg-weight", type=float, default=0.5)
    p.add_argument("--temperature", type=float, default=0.8)
    args = p.parse_args()
    if args.ref and not Path(args.ref).is_file():
        p.error(f"--ref {args.ref} not found")
    engine = Engine(args)
    ThreadingHTTPServer((args.host, args.port), make_handler(engine)).serve_forever()


if __name__ == "__main__":
    main()
