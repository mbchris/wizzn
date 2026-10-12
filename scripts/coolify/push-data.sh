#!/usr/bin/env bash
# Clone local dev DB + media into the Coolify deployment. OVERWRITES prod data (users, sessions, units, media).
# Usage: pnpm coolify:push-data -- <ssh-host> <coolify-app-uuid>
#   ssh-host: e.g. root@netcup (needs docker access)
#   uuid:     Coolify → app → URL/“Resource UUID”; containers are named <service>-<uuid>
#   PG_CONTAINER=<uuid of the Coolify Postgres resource> (optional if it's the only postgres container on the host)
set -euo pipefail
[ "${1:-}" = "--" ] && shift
HOST="${1:?ssh host}"; UUID_ARG="${2:?coolify app uuid or container name}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MEDIA_DIR="$ROOT/packages/api/media-data"
DUMP="$(mktemp -t wizzn-XXXX).dump"
source "$(dirname "$0")/_s3.sh"
source "$(dirname "$0")/_remote.sh"
DC="docker compose -f $ROOT/docker-compose.dev.yml"


read -rp "Overwrite prod DB + media on $HOST ($UUID)? type 'yes': " ok; [ "$ok" = yes ] || exit 1

echo "→ dumping local DB"
$DC exec -T postgres pg_dump -U wizzn -d wizzn -Fc --no-owner --no-privileges > "$DUMP"
ls -lh "$DUMP"

echo "→ backing up remote DB to ~/wizzn-prod-$(date +%F-%H%M).dump"
r "docker exec $PG pg_dump -U wizzn -d wizzn -Fc > ~/wizzn-prod-$(date +%F-%H%M).dump"

echo "→ stopping api + worker"
r "docker stop $WORKER $API"
trap 'echo "→ starting api + worker"; r "docker start $API $WORKER"; cleanup_ssh' EXIT

echo "→ restoring DB"
r "docker exec $PG psql -U wizzn -d postgres -c 'DROP DATABASE IF EXISTS wizzn WITH (FORCE)' -c 'CREATE DATABASE wizzn OWNER wizzn'"
r "docker exec -i $PG pg_restore -U wizzn -d wizzn --no-owner --no-privileges --exit-on-error" < "$DUMP"

echo "→ copying media ($(du -sh "$MEDIA_DIR" | cut -f1))"
if [ "$S3_MODE" = 1 ]; then
  use_prod_s3
  # sync = exact copy: also deletes bucket files that don't exist locally (backups keep them)
  rclone sync "$MEDIA_DIR" "prod:$S3_BUCKET" "${RCLONE_UPLOAD_FLAGS[@]}"
else
  COPYFILE_DISABLE=1 tar -C "$MEDIA_DIR" -czf - . \
    | r "docker run --rm -i -v $MEDIA_VOL:/media alpine sh -c 'rm -rf /media/* && tar -xzf - -C /media && chown -R 1000:1000 /media'"
fi

rm -f "$DUMP"
echo "✓ done (api restarts → migrations run on top of the restored schema)"
