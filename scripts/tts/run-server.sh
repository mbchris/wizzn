#!/usr/bin/env bash
# Installs (first time) and runs a local Python TTS server in the foreground. Used by scripts/dev.sh and `pnpm tts:server`.
#
#   scripts/tts/run-server.sh <chatterbox|qwen> [server args…]   e.g.  … qwen --port 5101 --voice "Serena"
#
# Defaults come from .env: port from TTS_URL, voice from TTS_VOICE, Qwen model size from TTS_QWEN_SIZE.
# Extra args are passed through and win over the defaults. Each engine gets its own venv (.chatterbox/, .qwen-tts/).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENGINE="${1:-}"; shift || true
envval() { grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
command -v uv >/dev/null || { echo "uv not found — brew install uv" >&2; exit 1; }

URL="$(envval TTS_URL)"; URL="${URL:-http://localhost:5100/synthesize}"
PORT="${URL##*:}"; PORT="${PORT%%/*}"
VOICE="$(envval TTS_VOICE)"
# Voice files are given relative to the repo root
[[ -n "$VOICE" && -f "$ROOT/$VOICE" ]] && VOICE="$ROOT/$VOICE"

case "$ENGINE" in
  chatterbox)
    DIR="$ROOT/.chatterbox"
    if [[ ! -x "$DIR/venv/bin/python" ]]; then
      echo "Installing Chatterbox TTS into .chatterbox/venv (first time only)"
      uv venv -q --python 3.11 "$DIR/venv"
      VIRTUAL_ENV="$DIR/venv" uv pip install -q chatterbox-tts "setuptools<81"  # perth needs pkg_resources (removed in setuptools 81)
    fi
    # Self-heal: perth silently disables its watermarker (→ "'NoneType' object is not callable") without pkg_resources
    if ! "$DIR/venv/bin/python" -c 'import perth, sys; sys.exit(perth.PerthImplicitWatermarker is None)' 2>/dev/null; then
      echo "Repairing Chatterbox venv (setuptools<81 for perth)"
      VIRTUAL_ENV="$DIR/venv" uv pip install -q "setuptools<81"
    fi
    ARGS=(--port "$PORT" --cache-dir "$DIR/cache")
    [[ -n "$VOICE" && -f "$VOICE" ]] && ARGS+=(--ref "$VOICE")  # anything else → built-in voice
    exec "$DIR/venv/bin/python" "$ROOT/scripts/tts/chatterbox_server.py" "${ARGS[@]}" "$@"
    ;;
  qwen)
    DIR="$ROOT/.qwen-tts"
    if [[ ! -x "$DIR/venv/bin/python" ]]; then
      echo "Installing Qwen3-TTS into .qwen-tts/venv (first time only)"
      uv venv -q --python 3.12 "$DIR/venv"
      VIRTUAL_ENV="$DIR/venv" uv pip install -q qwen-tts librosa soundfile
    fi
    SIZE="$(envval TTS_QWEN_SIZE)"; SIZE="${SIZE:-1.7B}"
    # Piper voice names (de_DE-…) mean nothing to Qwen → its default speaker
    [[ "$VOICE" == de_DE-* ]] && VOICE=""
    ARGS=(--port "$PORT" --size "$SIZE" --cache-dir "$DIR/cache")
    [[ -n "$VOICE" ]] && ARGS+=(--voice "$VOICE")
    exec "$DIR/venv/bin/python" "$ROOT/scripts/tts/qwen_server.py" "${ARGS[@]}" "$@"
    ;;
  *)
    echo "Usage: scripts/tts/run-server.sh <chatterbox|qwen> [server args…]" >&2; exit 1 ;;
esac
