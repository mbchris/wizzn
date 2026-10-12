#!/usr/bin/env bash
# One-time (repeatable) copy of the prod `media` Docker volume into the Garage bucket. Never deletes anything.
# Runs rclone in a throwaway container on the server, so the GBs never leave the host.
# Credentials: S3_* from .env.production (the app key). Re-run after the cutover to pick up files written in between.
# Usage: [SSH_KEY=~/.ssh/key] pnpm storage:migrate -- <ssh-host> <coolify-app-uuid>
set -euo pipefail
[ "${1:-}" = "--" ] && shift
HOST="${1:?ssh host}"; UUID="${2:?coolify app uuid}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/coolify/_s3.sh"
use_prod_s3

SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$HOME/.ssh/cm-wizzn-%r@%h:%p" -o ControlPersist=5m)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY")
r() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }

API="$(r "docker ps -a --format '{{.Names}}'" | grep -E "^api-$UUID(-|\$)" | head -1)"
[ -n "$API" ] || { echo "✗ no api container for $UUID on $HOST"; exit 1; }
VOL="$(r "docker inspect -f '{{range .Mounts}}{{if eq .Destination \"/media\"}}{{.Name}}{{end}}{{end}}' $API")"
[ -n "$VOL" ] || VOL="$(r "docker volume ls -q" | grep -E "^${UUID}[_-]media\$" | head -1)"
[ -n "$VOL" ] || { echo "✗ no media volume found for $UUID"; exit 1; }
echo "→ $VOL → bucket $S3_BUCKET at $RCLONE_CONFIG_PROD_ENDPOINT"

envs=""
for k in TYPE PROVIDER FORCE_PATH_STYLE ENDPOINT ACCESS_KEY_ID SECRET_ACCESS_KEY REGION; do
  var="RCLONE_CONFIG_PROD_$k"; envs+=" -e $var=$(printf %q "${!var}")"
done
flags="$(printf ' %q' "${RCLONE_UPLOAD_FLAGS[@]}" "${RCLONE_TREE_FLAGS[@]}")"
r "docker run --rm -v $VOL:/media:ro$envs rclone/rclone:1 copy /media prod:$S3_BUCKET$flags --stats 30s --stats-one-line"

echo "→ verifying"
r "docker run --rm -v $VOL:/media:ro alpine sh -c 'find /media -type f ! -name .DS_Store | wc -l'" | xargs echo "  volume files:"
rclone size "prod:$S3_BUCKET" --fast-list | sed 's/^/  bucket /'
echo "✓ done (bucket count ≥ volume count expected)"
