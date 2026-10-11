#!/usr/bin/env bash
# Builds a DevPack from prod: N published units (default 100) spread evenly over fields × formats, newest first,
# with their briefs, sources, assets, check reports and links between them, all fields + themes, and their media.
# Read-only on prod. No users/progress. Uploads to the wizzn-devpack bucket and marks it as latest.
# Usage: [SSH_KEY=…] pnpm devpack:build -- <ssh-host> <postgres-container | coolify-app-uuid> [--units 100] [--no-upload]
# Env: DEVPACK_MEDIA_URL (default: MEDIA_PUBLIC_URL from .env.production), DEVPACK_S3_* in .env (for the upload)
# Testing without SSH: DEVPACK_PSQL="psql -qAt -v ON_ERROR_STOP=1 <url>" pnpm devpack:build -- - - --no-upload
set -euo pipefail
[ "${1:-}" = "--" ] && shift
HOST="${1:?ssh host (or - with DEVPACK_PSQL)}"; PG_ARG="${2:?postgres container or app uuid}"; shift 2
UNITS=100; UPLOAD=1
while [ $# -gt 0 ]; do
  case "$1" in --units) UNITS="$2"; shift 2;; --no-upload) UPLOAD=0; shift;; *) echo "✗ unknown arg $1"; exit 1;; esac
done
[[ "$UNITS" =~ ^[0-9]+$ ]] || { echo "✗ --units must be a number"; exit 1; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/devpack/_common.sh"
source "$ROOT/scripts/coolify/_s3.sh"

if [ -n "${DEVPACK_PSQL:-}" ]; then
  q() { $DEVPACK_PSQL; }
else
  SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$HOME/.ssh/cm-wizzn-%r@%h:%p" -o ControlPersist=5m)
  [ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY")
  r() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }
  NAMES="$(r "docker ps --format '{{.Names}}'")"
  PG="$(grep -xF "$PG_ARG" <<<"$NAMES" || grep -E "^postgres-$PG_ARG(-|\$)" <<<"$NAMES" | head -1 || true)"
  [ -n "$PG" ] || { echo "✗ no postgres container '$PG_ARG'. Running containers:"; echo "$NAMES"; exit 1; }
  echo "→ prod DB: $PG on $HOST"
  q() { r "docker exec -i $PG psql -U wizzn -d wizzn -qAt -v ON_ERROR_STOP=1"; }
fi

MEDIA_URL="${DEVPACK_MEDIA_URL:-$(prod_env MEDIA_PUBLIC_URL)}"
[ -n "$MEDIA_URL" ] || { echo "✗ set DEVPACK_MEDIA_URL (e.g. https://media.wizzn.app) or MEDIA_PUBLIC_URL in .env.production"; exit 1; }

NAME="devpack-$(date +%Y%m%d-%H%M)"
WORK="$(mktemp -d -t wizzn-devpack.XXXX)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/$NAME/db" "$WORK/$NAME/media"
OUT="$WORK/$NAME"

echo "→ selecting $UNITS units"
# Round-robin: the newest unit of every field × format first, then the second newest, …
q > "$OUT/units.txt" <<SQL
WITH ranked AS (
  SELECT id, field_id, format,
         row_number() OVER (PARTITION BY field_id, format ORDER BY published_at DESC NULLS LAST, id) AS rn
  FROM unit WHERE status = 'published'
)
SELECT id FROM ranked ORDER BY rn, field_id, format, id LIMIT $UNITS;
SQL
N=$(grep -c . "$OUT/units.txt" || true)
[ "$N" -gt 0 ] || { echo "✗ no published units"; exit 1; }
IDS="$(sed "s/.*/'&'/" "$OUT/units.txt" | paste -sd, -)"

# bash 3.2 (macOS): no associative arrays
where_for() {
  case "$1" in
    field|theme) echo "true" ;;
    content_brief) echo "id IN (SELECT brief_id FROM unit WHERE id IN ($IDS))" ;;
    unit) echo "id IN ($IDS)" ;;
    unit_link) echo "from_unit_id IN ($IDS) AND to_unit_id IN ($IDS)" ;;
    *) echo "unit_id IN ($IDS)" ;;
  esac
}
counts=""
for t in "${DEVPACK_TABLES[@]}"; do
  echo "COPY (SELECT * FROM public.$t WHERE $(where_for "$t")) TO STDOUT WITH (FORMAT csv, HEADER true)" | q > "$OUT/db/$t.csv"
  # wc -l would miscount CSV rows with quoted line breaks
  rows="$(echo "SELECT count(*) FROM public.$t WHERE $(where_for "$t")" | q)"
  printf '  %-14s %s rows\n' "$t" "$rows"
  counts+="\"$t\": $rows, "
done
MIGRATION="$(echo "$MIGRATION_SQL" | q)"
echo "SELECT DISTINCT path FROM asset WHERE unit_id IN ($IDS) ORDER BY 1" | q > "$OUT/media.txt"

echo "→ fetching $(grep -c . "$OUT/media.txt" || true) media files from $MEDIA_URL"
command -v rclone >/dev/null || { echo "✗ rclone not installed (brew install rclone)"; exit 1; }
RCLONE_CONFIG=/dev/null rclone copy --http-url "$MEDIA_URL" :http: "$OUT/media" --files-from "$OUT/media.txt" --transfers 16 --stats-one-line --stats 0
missing=$(( $(grep -c . "$OUT/media.txt" || true) - $(find "$OUT/media" -type f | wc -l) ))
[ "$missing" -eq 0 ] || echo "⚠ $missing media files not found at $MEDIA_URL"

cat > "$OUT/manifest.json" <<JSON
{
  "name": "$NAME",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "units": $N,
  "rows": { ${counts%, } },
  "mediaFiles": $(find "$OUT/media" -type f | wc -l | tr -d ' '),
  "migration": $MIGRATION
}
JSON

mkdir -p "$DEVPACK_DIR"
COPYFILE_DISABLE=1 tar -C "$WORK" -czf "$DEVPACK_DIR/$NAME.tgz" "$NAME"
echo "✓ $DEVPACK_DIR/$NAME.tgz ($(du -h "$DEVPACK_DIR/$NAME.tgz" | cut -f1), $N units)"

if [ "$UPLOAD" = 1 ]; then
  use_devpack_s3
  rclone copyto "$DEVPACK_DIR/$NAME.tgz" "devpack:$DEVPACK_BUCKET/$NAME.tgz"
  echo "$NAME.tgz" | rclone rcat "devpack:$DEVPACK_BUCKET/latest.txt"
  echo "✓ uploaded to $DEVPACK_BUCKET, marked as latest"
fi
