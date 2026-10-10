#!/usr/bin/env bash
# Clone local dev DB + media into the Coolify deployment. OVERWRITES prod data (users, sessions, units, media).
# Usage: pnpm coolify:push-data -- <ssh-host> <coolify-app-uuid>
#   ssh-host: e.g. root@netcup (needs docker access)
#   uuid:     Coolify → app → URL/“Resource UUID”; containers are named <service>-<uuid>
set -euo pipefail
HOST="${1:?ssh host}"; UUID="${2:?coolify app uuid}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MEDIA_DIR="$ROOT/packages/api/media-data"
DUMP="$(mktemp -t wizzn-XXXX).dump"
# One authenticated connection (password/key passphrase asked once), reused by every step.
# Optional: SSH_KEY=~/.ssh/netcup_key pnpm coolify:push-data -- ...
SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$HOME/.ssh/cm-wizzn-%r@%h:%p" -o ControlPersist=15m)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY")
echo "→ connecting to $HOST (authenticate once)"
ssh "${SSH_OPTS[@]}" -fN "$HOST"
cleanup_ssh() { ssh "${SSH_OPTS[@]}" -O exit "$HOST" 2>/dev/null || true; }
DC="docker compose -f $ROOT/docker-compose.dev.yml"

echo "→ checking remote containers"
ssh "${SSH_OPTS[@]}" "$HOST" "docker ps --format '{{.Names}}' | grep -E '^(postgres|api|worker)-$UUID\$'" \
  || { echo "✗ no containers for uuid $UUID on $HOST"; exit 1; }
MEDIA_VOL=$(ssh "${SSH_OPTS[@]}" "$HOST" "docker volume ls -q | grep -E '^${UUID}_media\$'") \
  || { echo "✗ media volume ${UUID}_media not found"; exit 1; }

read -rp "Overwrite prod DB + media on $HOST ($UUID)? type 'yes': " ok; [ "$ok" = yes ] || exit 1

echo "→ dumping local DB"
$DC exec -T postgres pg_dump -U wizzn -d wizzn -Fc --no-owner --no-privileges > "$DUMP"
ls -lh "$DUMP"

echo "→ backing up remote DB to /root/wizzn-prod-$(date +%F-%H%M).dump"
ssh "${SSH_OPTS[@]}" "$HOST" "docker exec postgres-$UUID pg_dump -U wizzn -d wizzn -Fc > /root/wizzn-prod-$(date +%F-%H%M).dump"

echo "→ stopping api + worker"
ssh "${SSH_OPTS[@]}" "$HOST" "docker stop worker-$UUID api-$UUID"
trap 'echo "→ starting api + worker"; ssh "${SSH_OPTS[@]}" "$HOST" "docker start api-$UUID worker-$UUID"; cleanup_ssh' EXIT

echo "→ restoring DB"
ssh "${SSH_OPTS[@]}" "$HOST" "docker exec postgres-$UUID psql -U wizzn -d postgres -c 'DROP DATABASE IF EXISTS wizzn WITH (FORCE)' -c 'CREATE DATABASE wizzn OWNER wizzn'"
ssh "${SSH_OPTS[@]}" "$HOST" "docker exec -i postgres-$UUID pg_restore -U wizzn -d wizzn --no-owner --no-privileges --exit-on-error" < "$DUMP"

echo "→ copying media ($(du -sh "$MEDIA_DIR" | cut -f1))"
COPYFILE_DISABLE=1 tar -C "$MEDIA_DIR" -czf - . \
  | ssh "${SSH_OPTS[@]}" "$HOST" "docker run --rm -i -v $MEDIA_VOL:/media alpine sh -c 'rm -rf /media/* && tar -xzf - -C /media && chown -R 1000:1000 /media'"

rm -f "$DUMP"
echo "✓ done (api restarts → migrations run on top of the restored schema)"
