#!/usr/bin/env bash
# Starts the full local stack: Docker infra, Piper TTS (if TTS_PROVIDER=piper), DB migrations + seed, Ollama, API, worker, admin.
# Usage: ./scripts/dev.sh             (Ctrl+C stops api/worker/admin/web/piper; Docker keeps running)
#        ./scripts/dev.sh --android   (app on Android emulator/device via Android Studio instead of the browser)
#        ./scripts/dev.sh --fresh     (force pnpm install + db:generate)
#        ./scripts/dev.sh --no-seed   (skip db:seed + db:seed:samples; migrations still run)
# Self-updating: reinstalls deps when lockfiles/package.json changed, warns about .env keys missing vs .env.template.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MODEL="${LLM_MODEL_OVERRIDE:-}"
FRESH=0
ANDROID=0
NO_SEED=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --android) ANDROID=1 ;;
    --no-seed) NO_SEED=1 ;;
    *) echo "Unknown option: $arg (use --fresh, --android, --no-seed)" >&2; exit 1 ;;
  esac
done

c_info() { printf '\033[1;35m▶ %s\033[0m\n' "$*"; }
c_warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
c_err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

need() { command -v "$1" >/dev/null 2>&1 || { c_err "$1 not found. $2"; exit 1; }; }
need docker "Install Docker Desktop and start it."
need node   "Install Node.js >= 20."
need pnpm   "Run: corepack enable"
docker info >/dev/null 2>&1 || { c_err "Docker is not running. Start Docker Desktop."; exit 1; }

# 1. Env file
ENV_FILE=".env"
if [[ ! -f "$ENV_FILE" ]]; then
  c_info "Creating $ENV_FILE from template"
  cp .env.template "$ENV_FILE"
fi
if ! grep -qE '^ADMIN_EMAILS=.+' "$ENV_FILE"; then
  c_warn "ADMIN_EMAILS is empty in $ENV_FILE — the admin app will answer 'Forbidden'."
fi
# Keys in the template but not in .env (template grew since .env was created)
MISSING_KEYS="$(comm -23 \
  <(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' .env.template | tr -d = | sort -u) \
  <(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | tr -d = | sort -u))"
if [[ -n "$MISSING_KEYS" ]]; then
  c_warn "Keys from .env.template missing in $ENV_FILE (defaults apply): $(echo $MISSING_KEYS)"
  c_warn "  → copy them from .env.template, or ./creds.sh pull if they're in the vault"
fi
[[ -z "$MODEL" ]] && MODEL="$(grep -E '^LLM_MODEL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
MODEL="${MODEL:-qwen3:8b}"

# 2. Dependencies — reinstall whenever a lockfile or package.json changed since the last run
hash_of() { cat "$@" 2>/dev/null | shasum | cut -d' ' -f1; }
STAMP="node_modules/.wizzn-deps-hash"
DEPS_HASH="$(hash_of pnpm-lock.yaml package.json packages/*/package.json)"
if [[ $FRESH -eq 1 || ! -f "$STAMP" || "$(cat "$STAMP" 2>/dev/null)" != "$DEPS_HASH" \
      || ! -d packages/admin/node_modules || ! -d packages/web/node_modules ]]; then
  c_info "Dependencies changed → pnpm install"
  pnpm install
  echo "$DEPS_HASH" >"$STAMP"
fi
# Capacitor native project has its own lockfile (installed with --ignore-workspace)
CAP_DIR="packages/web/src-capacitor"
CAP_STAMP="$CAP_DIR/node_modules/.wizzn-deps-hash"
CAP_HASH="$(hash_of "$CAP_DIR/package.json" "$CAP_DIR/pnpm-lock.yaml")"
if [[ $FRESH -eq 1 || ! -f "$CAP_STAMP" || "$(cat "$CAP_STAMP" 2>/dev/null)" != "$CAP_HASH" ]]; then
  c_info "Capacitor dependencies changed → pnpm install in $CAP_DIR"
  (cd "$CAP_DIR" && pnpm install --ignore-workspace)
  echo "$CAP_HASH" >"$CAP_STAMP"
fi

# 3. Docker infra
c_info "Starting Postgres, SearXNG, media server"
docker compose -f docker-compose.dev.yml up -d
printf 'Waiting for Postgres'
for _ in $(seq 1 30); do
  if docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U wizzn >/dev/null 2>&1; then echo ' ok'; break; fi
  printf '.'; sleep 1
done

# 3b. TTS server (TTS_PROVIDER=piper|chatterbox|qwen) — must run before seeding, sample audio is rendered there
PIPER_PID=""
TTS_PROVIDER="$(grep -E '^TTS_PROVIDER=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
if [[ "$TTS_PROVIDER" == "piper" ]]; then
  need python3 "Install Python 3 (brew install python)."
  TTS_URL="$(grep -E '^TTS_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"; TTS_URL="${TTS_URL:-http://localhost:5100/synthesize}"
  VOICE="$(grep -E '^TTS_VOICE=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  [[ -z "$VOICE" ]] && VOICE="$(grep -E '^TTS_VOICE_1=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"; VOICE="${VOICE:-de_DE-thorsten-high}"
  PIPER_PORT="${TTS_URL##*:}"; PIPER_PORT="${PIPER_PORT%%/*}"
  PIPER_DIR="$ROOT/.piper"; VOICES="$PIPER_DIR/voices"
  if [[ ! -x "$PIPER_DIR/venv/bin/python" ]]; then
    c_info "Installing Piper TTS into .piper/venv (first time only)"
    python3 -m venv "$PIPER_DIR/venv"
    "$PIPER_DIR/venv/bin/pip" install -q --upgrade pip "piper-tts[http]"
  fi
  if [[ ! -f "$VOICES/$VOICE.onnx" ]]; then
    # de_DE-thorsten-high → de/de_DE/thorsten/high (curl uses the macOS keychain; Python's urllib often lacks root certs)
    LOCALE="${VOICE%%-*}"; REST="${VOICE#*-}"; NAME="${REST%-*}"; QUALITY="${REST##*-}"
    BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/${LOCALE%%_*}/$LOCALE/$NAME/$QUALITY"
    c_info "Downloading Piper voice $VOICE"
    mkdir -p "$VOICES"
    curl -fsSL -o "$VOICES/$VOICE.onnx" "$BASE/$VOICE.onnx"
    curl -fsSL -o "$VOICES/$VOICE.onnx.json" "$BASE/$VOICE.onnx.json"
  fi
  if [[ "$PIPER_PORT" == "5000" ]]; then
    c_warn "Port 5000 is macOS AirPlay Receiver (answers 403). Set TTS_URL=http://localhost:5100 in $ENV_FILE."
  fi
  # Probe with a real synthesis request: anything else on the port (e.g. AirPlay) must not count as Piper
  piper_ok() { curl -sf -o /dev/null -X POST -H 'content-type: application/json' -d '{"text":"Test"}' "$TTS_URL"; }
  if piper_ok; then
    c_info "Piper already running on :$PIPER_PORT"
  elif curl -s -o /dev/null "http://localhost:$PIPER_PORT"; then
    c_err "Port $PIPER_PORT is used by another program (not Piper). Change TTS_URL in $ENV_FILE."; exit 1
  else
    c_info "Starting Piper on :$PIPER_PORT (log: /tmp/wizzn-piper.log)"
    "$PIPER_DIR/venv/bin/python" -m piper.http_server -m "$VOICES/$VOICE.onnx" --data-dir "$VOICES" --port "$PIPER_PORT" >/tmp/wizzn-piper.log 2>&1 &
    PIPER_PID=$!
    for _ in $(seq 1 60); do piper_ok && break; sleep 1; done
    piper_ok || { c_err "Piper did not start — see /tmp/wizzn-piper.log"; exit 1; }
  fi
elif [[ "$TTS_PROVIDER" == "chatterbox" || "$TTS_PROVIDER" == "qwen" ]]; then
  # Local Python TTS (Chatterbox Multilingual or Qwen3-TTS); install + start via scripts/tts/run-server.sh
  need uv "Install uv (brew install uv)."
  TTS_URL="$(grep -E '^TTS_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"; TTS_URL="${TTS_URL:-http://localhost:5100/synthesize}"
  CB_PORT="${TTS_URL##*:}"; CB_PORT="${CB_PORT%%/*}"; CB_BASE="${TTS_URL%/synthesize}"
  LOG="/tmp/wizzn-$TTS_PROVIDER.log"
  cb_ok() { curl -sf -o /dev/null "$CB_BASE/health"; }
  if cb_ok; then
    c_info "TTS server already running on :$CB_PORT (make sure it is $TTS_PROVIDER)"
  elif curl -s -o /dev/null "http://localhost:$CB_PORT"; then
    c_err "Port $CB_PORT is used by another program (not a TTS server). Change TTS_URL in $ENV_FILE."; exit 1
  else
    c_info "Starting $TTS_PROVIDER on :$CB_PORT (log: $LOG; first start installs + downloads the model)"
    "$ROOT/scripts/tts/run-server.sh" "$TTS_PROVIDER" >"$LOG" 2>&1 &
    PIPER_PID=$!
    for _ in $(seq 1 1200); do cb_ok && break; kill -0 "$PIPER_PID" 2>/dev/null || break; sleep 1; done
    cb_ok || { c_err "$TTS_PROVIDER did not start — see $LOG"; exit 1; }
  fi
else
  c_warn "TTS_PROVIDER=${TTS_PROVIDER:-silent} — audio units are silent. Set TTS_PROVIDER=chatterbox|qwen|piper in $ENV_FILE for real speech."
fi

# 4. Database
c_info "Building shared package"
pnpm build:shared >/dev/null
if [[ $FRESH -eq 1 ]]; then
  c_info "Generating migrations"
  pnpm db:generate
fi
c_info "Migrating database"
pnpm db:migrate
if [[ $NO_SEED -eq 1 ]]; then
  c_warn "--no-seed: skipping db:seed + db:seed:samples"
else
  c_info "Seeding database"
  pnpm db:seed
  c_info "Seeding sample units (skips existing)"
  pnpm db:seed:samples
fi

# 5. LLM: Ollama (default) or gemini-cli
LLM_PROVIDER="$(grep -E '^LLM_PROVIDER=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
LLM_PROVIDER="${LLM_PROVIDER:-openai}"
OLLAMA_PID=""
if [[ "$LLM_PROVIDER" == "gemini-cli" ]]; then
  GEMINI_BIN="$(grep -E '^GEMINI_CLI_BIN=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  if command -v "${GEMINI_BIN:-gemini}" >/dev/null 2>&1; then
    c_info "LLM via gemini-cli (${MODEL:-default model})"
  else
    c_warn "gemini-cli not installed — the worker's AI steps will fail (npm i -g @google/gemini-cli, then run 'gemini' once to log in)."
  fi
elif command -v ollama >/dev/null 2>&1; then
  if ! curl -sf http://localhost:11434/api/tags >/dev/null; then
    c_info "Starting Ollama"
    ollama serve >/tmp/wizzn-ollama.log 2>&1 &
    OLLAMA_PID=$!
    for _ in $(seq 1 20); do curl -sf http://localhost:11434/api/tags >/dev/null && break; sleep 0.5; done
  fi
  if ! ollama list | awk '{print $1}' | grep -qx "$MODEL"; then
    c_info "Pulling model $MODEL (first time only)"
    ollama pull "$MODEL"
  fi
else
  c_warn "ollama not installed — the worker's AI steps will fail (brew install ollama)."
fi

# 6. App processes with prefixed logs
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
PIDS=()
run() {
  local name="$1" color="$2"; shift 2
  ( "$@" 2>&1 | while IFS= read -r line; do printf '\033[%sm[%-6s]\033[0m %s\n' "$color" "$name" "$line"; done ) &
  PIDS+=($!)
}

cleanup() {
  echo
  c_info "Stopping api, worker, admin, web"
  # bash 3.2 (macOS) safe with set -u
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true; done
  [[ -n "$OLLAMA_PID" ]] && kill "$OLLAMA_PID" 2>/dev/null || true
  [[ -n "$PIPER_PID" ]] && kill "$PIPER_PID" 2>/dev/null || true
  c_info "Docker infra still running (stop with: docker compose -f docker-compose.dev.yml down)"
}
trap cleanup EXIT INT TERM

run api    "1;34" pnpm --filter @wizzn/api dev
run worker "1;32" pnpm --filter @wizzn/api dev:worker
run admin  "1;36" pnpm --filter @wizzn/admin dev
if [[ $ANDROID -eq 1 ]]; then
  # Same dev server (:9000) plus live reload into the Android app; opens Android Studio → press Run there
  # --hostname: Quasar otherwise asks "What external IP should Quasar use?" — a background job can't answer → hangs
  [[ -n "$LAN_IP" ]] || { c_err "No LAN IP (en0/en1) — connect to Wi-Fi/Ethernet for --android"; exit 1; }
  c_info "Android: dev server on $LAN_IP:9000, opening Android Studio → press Run there"
  run web  "1;33" pnpm --filter @wizzn/web dev:android --hostname "$LAN_IP"
else
  run web  "1;33" pnpm --filter @wizzn/web dev
fi

printf 'Waiting for API'
for _ in $(seq 1 60); do
  if curl -sf http://localhost:3000/health/ready >/dev/null; then echo ' ok'; break; fi
  printf '.'; sleep 1
done

if [[ -n "$LAN_IP" ]]; then PHONE_LINE="http://$LAN_IP:9000 · API http://$LAN_IP:3000"
else PHONE_LINE="no LAN IP found (API_URL=auto falls back to localhost)"; fi
cat <<INFO

  API     http://localhost:3000   (health: /health/ready)
  App     http://localhost:9000   (mobile app in the browser; use device mode in DevTools)
  Phone   $PHONE_LINE
  Admin   http://localhost:9100   (first time: "Konto anlegen" with an ADMIN_EMAILS address)
  Media   http://localhost:8081
  Model   $MODEL
  TTS     ${TTS_PROVIDER:-silent}${PIPER_PORT:+ (Piper :$PIPER_PORT)}${CB_PORT:+ (:$CB_PORT)}

  Ctrl+C to stop.
INFO

wait
