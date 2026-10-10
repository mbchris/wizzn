#!/usr/bin/env python3
"""
Qwen3-TTS server for wizzn (German, batch). Same contract as chatterbox_server.py:

  POST /synthesize  JSON {"text": str, "length_scale"?: float, "no_cache"?: bool}  → audio/wav (16-bit mono)
  GET  /health      200 once the model is loaded
  GET  /info        engine, model, voice, parameters + cumulative stats (requests, cache hits, generation time)

Voice (--voice, from TTS_VOICE):
  path/to/ref.wav               clone with the Base model; transcript from path/to/ref.txt if present (better),
                                otherwise speaker-embedding only
  design:<description>          VoiceDesign model renders every chunk directly from the description (no reference
                                WAV; fixed seed). Voice may drift slightly between chunks — for a frozen voice,
                                export one with --export-ref and set TTS_VOICE to that .wav
  <Speaker>[|<instruction>]     CustomVoice preset (e.g. "Ryan" or "Serena|ruhig, sachlich, warm")

The API sends short chunks; raw renders are cached on disk by text hash and length_scale only time-stretches
cached audio, so duration fitting is cheap.

  python qwen_server.py --port 5100 --voice "design:Warme, ruhige Frauenstimme, Mitte 30, erklärt sachlich"
  python qwen_server.py --voice "design:…" --export-ref voices/anna.wav   # write the designed reference and exit
"""
import argparse
import gc
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
from qwen_tts import Qwen3TTSModel  # noqa: E402

LANGUAGE = "German"
PAUSE_SEC = 0.35  # silence after each chunk
SEED = 1234
DESIGN_SAMPLE = (
    "Willkommen bei wizzn. Heute schauen wir uns an, wie das eigentlich funktioniert, "
    "und warum es überraschender ist, als man auf den ersten Blick denkt."
)
REPO = "Qwen/Qwen3-TTS-12Hz-{size}-{kind}"


def pick_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda:0"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load(kind: str, size: str, device: str):
    if kind == "VoiceDesign":
        size = "1.7B"  # only size that exists
    repo = REPO.format(size=size, kind=kind)
    load.last = repo
    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
    print(f"qwen-tts: loading {repo} on {device} (first run downloads the weights)", flush=True)
    return Qwen3TTSModel.from_pretrained(repo, device_map=device, dtype=dtype, attn_implementation="sdpa")


def to_mono_f32(wav) -> np.ndarray:
    a = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
    return a.astype(np.float32).reshape(-1)


def write_wav(path_or_buf, audio: np.ndarray, sr: int):
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(path_or_buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


class Engine:
    def __init__(self, args):
        self.args = args
        self.device = pick_device(args.device)
        self.cache = Path(args.cache_dir)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.stats = {"requests": 0, "cache_hits": 0, "generated": 0, "gen_sec": 0.0, "audio_sec": 0.0}
        self.mode = "custom"
        self.model_id = ""
        self.speaker = self.instruct = self.clone_prompt = self.design = None
        voice = args.voice.strip()

        self.designed = voice.startswith("design:")
        if self.designed and args.export_ref:
            # Only --export-ref renders a reference WAV from the description
            self.ref_path, self.ref_text = self.designed_reference(voice[len("design:"):].strip())
        elif self.designed:
            self.design = voice[len("design:"):].strip()
            self.model = load("VoiceDesign", "1.7B", self.device)
            self.model_id = load.last
            self.mode = "design"
        elif voice.lower().endswith(".wav"):
            txt = Path(voice).with_suffix(".txt")
            self.use_clone(voice, txt.read_text(encoding="utf-8").strip() if txt.is_file() else None)
        else:
            self.model = load("CustomVoice", args.size, self.device)
            self.model_id = load.last
            name, _, instruct = voice.partition("|")
            speakers = {s.lower(): s for s in (self.model.get_supported_speakers() or [])}
            self.speaker = speakers.get(name.strip().lower())
            if not self.speaker:
                self.speaker = next(iter(speakers.values()), "Ryan")
                print(f"qwen-tts: unknown speaker '{name}' → using {self.speaker}. Available: {', '.join(speakers.values())}", flush=True)
            self.instruct = instruct.strip() or None
        self.voice_key = hashlib.sha256(f"{voice}|{args.size}|{SEED}".encode()).hexdigest()[:12]
        print(f"qwen-tts: ready (voice={voice or 'default'})", flush=True)

    def designed_reference(self, description: str):
        """--export-ref only: renders the description once with VoiceDesign into a reference WAV."""
        key = hashlib.sha256(f"{description}|{SEED}".encode()).hexdigest()[:16]
        ref = self.cache / f"design-{key}.wav"
        if not ref.exists():
            model = load("VoiceDesign", "1.7B", self.device)
            torch.manual_seed(SEED)
            wavs, sr = model.generate_voice_design(text=DESIGN_SAMPLE, language=LANGUAGE, instruct=description)
            write_wav(str(ref), to_mono_f32(wavs[0]), sr)
            del model
            gc.collect()
            if self.device == "mps":
                torch.mps.empty_cache()
            print(f"qwen-tts: designed reference voice → {ref}", flush=True)
        return str(ref), DESIGN_SAMPLE

    def use_clone(self, ref_path: str, ref_text):
        if not Path(ref_path).is_file():
            raise SystemExit(f"qwen-tts: reference {ref_path} not found")
        self.ref_path, self.ref_text = ref_path, ref_text
        if self.args.export_ref:
            return
        self.model = load("Base", self.args.size, self.device)
        self.mode = "clone"
        self.model_id = load.last
        self.clone_prompt = self.model.create_voice_clone_prompt(
            ref_audio=ref_path, ref_text=ref_text, x_vector_only_mode=ref_text is None
        )

    def request_design(self, voice):
        """Per-request voice (API picks one of TTS_VOICE_1..3). Only `design:` voices can switch per request — they share
        the loaded VoiceDesign model; anything else keeps the server voice."""
        voice = (voice or "").strip()
        if not voice or voice == self.args.voice.strip():
            return None
        if self.design is not None and voice.startswith("design:"):
            return voice[len("design:"):].strip()
        print(f"qwen-tts: per-request voice '{voice[:40]}' needs a design: server voice → using server voice", flush=True)
        return None

    def generate(self, text: str, design=None):
        torch.manual_seed(SEED)
        if self.design is not None:
            return self.model.generate_voice_design(text=text, language=LANGUAGE, instruct=design or self.design)
        if self.clone_prompt is not None:
            return self.model.generate_voice_clone(text=text, language=LANGUAGE, voice_clone_prompt=self.clone_prompt)
        kwargs = {"instruct": self.instruct} if self.instruct else {}
        return self.model.generate_custom_voice(text=text, language=LANGUAGE, speaker=self.speaker, **kwargs)

    def raw(self, text: str, no_cache: bool = False, design=None):
        key = hashlib.sha256(f"{self.voice_key}|{design or ''}|{text}".encode()).hexdigest() if design else hashlib.sha256(f"{self.voice_key}|{text}".encode()).hexdigest()
        path = self.cache / f"{key}.npz"
        self.stats["requests"] += 1
        if path.exists() and not no_cache:
            self.stats["cache_hits"] += 1
            d = np.load(path)
            return d["audio"], int(d["sr"])
        t0 = time.monotonic()
        with self.lock:
            wavs, sr = self.generate(text, design)
        audio = np.concatenate([to_mono_f32(wavs[0]), np.zeros(int(PAUSE_SEC * sr), dtype=np.float32)])
        np.savez(path, audio=audio, sr=sr)
        gen = time.monotonic() - t0
        audio_sec = len(audio) / sr
        self.stats["generated"] += 1
        self.stats["gen_sec"] += gen
        self.stats["audio_sec"] += audio_sec
        print(f"qwen-tts: generated {len(text)} chars → {audio_sec:.1f}s audio in {gen:.1f}s (RTF {gen / max(audio_sec, 0.01):.2f})", flush=True)
        return audio, sr

    def info(self) -> dict:
        return {
            "engine": "qwen3-tts",
            "model": self.model_id,
            "mode": self.mode,
            "device": self.device,
            "dtype": "bfloat16" if self.device.startswith("cuda") else "float32",
            "language": LANGUAGE,
            "voice": self.args.voice,
            "speaker": self.speaker,
            "instruct": self.instruct or self.design,
            "reference": getattr(self, "ref_path", None),
            "ref_transcript": bool(getattr(self, "ref_text", None)),
            "params": {"seed": SEED, "pause_sec": PAUSE_SEC},
        }

    def synthesize(self, text: str, length_scale: float, no_cache: bool = False, voice=None) -> bytes:
        audio, sr = self.raw(text, no_cache, self.request_design(voice))
        if abs(length_scale - 1) > 0.01:
            import librosa

            audio = librosa.effects.time_stretch(audio, rate=1 / length_scale)
        buf = io.BytesIO()
        write_wav(buf, audio, sr)
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
                self._send(200, json.dumps({**engine.info(), "log_file": os.environ.get("TTS_LOG_FILE", ""), "stats": engine.stats}).encode(), "application/json")
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
                self._send(200, engine.synthesize(text, float(req.get("length_scale") or 1), bool(req.get("no_cache")), req.get("voice")), "audio/wav")
            except Exception as e:  # noqa: BLE001
                print(f"qwen-tts: error: {e!r}", flush=True)
                self._send(500, str(e).encode(), "text/plain")

        def log_message(self, fmt, *args):
            print(f"qwen-tts: {fmt % args}", flush=True)

    return Handler


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5100)
    p.add_argument("--voice", default="Ryan", help="ref.wav | design:<description> | Speaker[|instruction]")
    p.add_argument("--size", default="1.7B", choices=["0.6B", "1.7B"])
    p.add_argument("--device", default="auto")
    p.add_argument("--cache-dir", default=".qwen-tts/cache")
    p.add_argument("--export-ref", default="", help="with design:… or a .wav voice: copy the reference WAV (+ .txt) here and exit")
    args = p.parse_args()
    engine = Engine(args)
    if args.export_ref:
        if not getattr(engine, "ref_path", None):
            raise SystemExit("--export-ref needs --voice design:… or a .wav reference")
        out = Path(args.export_ref)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(Path(engine.ref_path).read_bytes())
        if engine.ref_text:
            out.with_suffix(".txt").write_text(engine.ref_text + "\n", encoding="utf-8")
        print(f"qwen-tts: reference written to {out}", flush=True)
        return
    ThreadingHTTPServer((args.host, args.port), make_handler(engine)).serve_forever()


if __name__ == "__main__":
    main()
