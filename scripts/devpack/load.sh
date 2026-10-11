#!/usr/bin/env bash
# Replaces the local content (fields, themes, briefs, units + sources/assets/reports/links) with a DevPack
# and copies its media into packages/api/media-data. Local users stay; their progress/interests are cleared (they point at content).
# Usage: pnpm devpack:load [-- latest | <file.tgz>] [--yes] [--force]
#   latest (default): downloads the newest pack from the wizzn-devpack bucket (DEVPACK_S3_* in .env)
#   --force: load even if the pack was built on a different migration than the local DB
# Testing without Docker: DEVPACK_LOCAL_PSQL="psql -qAt -v ON_ERROR_STOP=1 <url>"
set -euo pipefail
[ "${1:-}" = "--" ] && shift
SRC=latest; YES=0; FORCE=0
for a in "$@"; do
  case "$a" in --yes) YES=1;; --force) FORCE=1;; *) SRC="$a";; esac
done
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/devpack/_common.sh"
MEDIA_DIR="${MEDIA_DIR_OVERRIDE:-$ROOT/packages/api/media-data}"

if [ -n "${DEVPACK_LOCAL_PSQL:-}" ]; then
  q() { $DEVPACK_LOCAL_PSQL; }
else
  q() { docker compose -f "$ROOT/docker-compose.dev.yml" exec -T postgres psql -U wizzn -d wizzn -qAt -v ON_ERROR_STOP=1; }
fi

if [ "$SRC" = latest ]; then
  use_devpack_s3
  name="$(rclone cat "devpack:$DEVPACK_BUCKET/latest.txt" | tr -d '[:space:]')"
  [ -n "$name" ] || { echo "✗ no latest.txt in $DEVPACK_BUCKET — build one with pnpm devpack:build"; exit 1; }
  mkdir -p "$DEVPACK_DIR"
  [ -f "$DEVPACK_DIR/$name" ] || { echo "→ downloading $name"; rclone copyto "devpack:$DEVPACK_BUCKET/$name" "$DEVPACK_DIR/$name"; }
  SRC="$DEVPACK_DIR/$name"
fi
[ -f "$SRC" ] || { echo "✗ $SRC not found"; exit 1; }

WORK="$(mktemp -d -t wizzn-devpack.XXXX)"; trap 'rm -rf "$WORK"' EXIT
tar -C "$WORK" -xzf "$SRC"
PACK="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -f "$PACK/manifest.json" ] || { echo "✗ $SRC is not a DevPack (no manifest.json)"; exit 1; }
pack_migration="$(sed -nE 's/.*"migration": *([0-9]+).*/\1/p' "$PACK/manifest.json")"
units="$(sed -nE 's/.*"units": *([0-9]+).*/\1/p' "$PACK/manifest.json")"

local_migration="$(echo "$MIGRATION_SQL" | q)"
if [ "$pack_migration" != "$local_migration" ] && [ "$FORCE" = 0 ]; then
  if [ "$local_migration" -lt "$pack_migration" ]; then echo "✗ local DB is behind the pack's schema → run pnpm db:migrate first"
  else echo "✗ pack is older than the local schema → build a fresh pack (pnpm devpack:build) or pass --force"; fi
  exit 1
fi

echo "DevPack $(basename "$SRC"): $units units, $(find "$PACK/media" -type f | wc -l | tr -d ' ') media files"
if [ "$YES" = 0 ]; then
  read -rp "Replace ALL local content (and local users' progress/interests)? type 'yes': " ok
  [ "$ok" = yes ] || exit 1
fi

echo "→ loading DB"
{
  echo "BEGIN;"
  echo "TRUNCATE $(IFS=,; echo "${DEVPACK_TABLES[*]}"), unit_log CASCADE;"
  for t in "${DEVPACK_TABLES[@]}"; do
    cols="$(head -1 "$PACK/db/$t.csv")"
    echo "COPY public.$t ($cols) FROM STDIN WITH (FORMAT csv, HEADER true);"
    cat "$PACK/db/$t.csv"
    printf '\\.\n'
  done
  echo "COMMIT;"
} | q >/dev/null

echo "→ copying media into $MEDIA_DIR"
mkdir -p "$MEDIA_DIR"
cp -R "$PACK/media/." "$MEDIA_DIR/"
echo "✓ DevPack loaded"
