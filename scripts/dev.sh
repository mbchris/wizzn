#!/usr/bin/env bash
# Starts the full local stack: Docker infra, DB migrations + seed, Ollama, API, worker, admin.
# Usage: ./scripts/dev.sh            (Ctrl+C stops api/worker/admin; Docker keeps running)
#        ./scripts/dev.sh --fresh    (also re-runs pnpm install + db:generate)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MODEL="${LLM_MODEL_OVERRIDE:-}"
FRESH=0
[[ "${1:-}" == "--fresh" ]] && FRESH=1

c_info() { printf '\033[1;35m▶ %s\033[0m\n' "$*"; }
c_warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
c_err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

need() { command -v "$1" >/dev/null 2>&1 || { c_err "$1 not found. $2"; exit 1; }; }
need docker "Install Docker Desktop and start it."
need node   "Install Node.js >= 20."
need pnpm   "Run: corepack enable"
docker info >/dev/null 2>&1 || { c_err "Docker is not running. Start Docker Desktop."; exit 1; }

# 1. Env file
ENV_FILE="packages/api/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  c_info "Creating $ENV_FILE from template"
  cp .env.api.template "$ENV_FILE"
fi
if ! grep -qE '^ADMIN_EMAILS=.+' "$ENV_FILE"; then
  c_warn "ADMIN_EMAILS is empty in $ENV_FILE — the admin app will answer 'Forbidden'."
fi
[[ -z "$MODEL" ]] && MODEL="$(grep -E '^LLM_MODEL=' "$ENV_FILE" | cut -d= -f2- || true)"
MODEL="${MODEL:-qwen3:8b}"

# 2. Dependencies
if [[ $FRESH -eq 1 || ! -d node_modules || ! -d packages/admin/node_modules ]]; then
  c_info "Installing dependencies"
  pnpm install
fi

# 3. Docker infra
c_info "Starting Postgres, SearXNG, media server"
docker compose -f docker-compose.dev.yml up -d
printf 'Waiting for Postgres'
for _ in $(seq 1 30); do
  if docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U wizzn >/dev/null 2>&1; then echo ' ok'; break; fi
  printf '.'; sleep 1
done

# 4. Database
c_info "Building shared package"
pnpm build:shared >/dev/null
if [[ $FRESH -eq 1 ]]; then
  c_info "Generating migrations"
  pnpm db:generate
fi
c_info "Migrating + seeding database"
pnpm db:migrate
pnpm db:seed

# 5. Ollama
OLLAMA_PID=""
if command -v ollama >/dev/null 2>&1; then
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
PIDS=()
run() {
  local name="$1" color="$2"; shift 2
  ( "$@" 2>&1 | while IFS= read -r line; do printf '\033[%sm[%-6s]\033[0m %s\n' "$color" "$name" "$line"; done ) &
  PIDS+=($!)
}

cleanup() {
  echo
  c_info "Stopping api, worker, admin"
  # bash 3.2 (macOS) safe with set -u
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do pkill -P "$pid" 2>/dev/null || true; kill "$pid" 2>/dev/null || true; done
  [[ -n "$OLLAMA_PID" ]] && kill "$OLLAMA_PID" 2>/dev/null || true
  c_info "Docker infra still running (stop with: docker compose -f docker-compose.dev.yml down)"
}
trap cleanup EXIT INT TERM

run api    "1;34" pnpm --filter @wizzn/api dev
run worker "1;32" pnpm --filter @wizzn/api dev:worker
run admin  "1;36" pnpm --filter @wizzn/admin dev

printf 'Waiting for API'
for _ in $(seq 1 60); do
  if curl -sf http://localhost:3000/health/ready >/dev/null; then echo ' ok'; break; fi
  printf '.'; sleep 1
done

cat <<INFO

  API     http://localhost:3000   (health: /health/ready)
  Admin   http://localhost:9100   (first time: "Konto anlegen" with an ADMIN_EMAILS address)
  Media   http://localhost:8081
  Model   $MODEL

  Ctrl+C to stop.
INFO

wait
