#!/usr/bin/env bash
# Push locally produced units to prod: the media files they reference, then their content rows (insert-only).
# Without --units: every locally published unit. With --units <file>: exactly the listed units (Redaktion → select rows →
# "Push-Liste exportieren"; first column = unit id, lines starting with # are ignored). Unpublished units are skipped.
# Never updates/deletes remote rows; users/auth/progress are not touched. Units already on prod get no new child rows.
# Duplicates are skipped and listed: a unit whose field + format + title is already live on prod under another id, or twice in the push.
# field/theme are matched by slug (ids differ per env because each seeds its own).
# Media go to the Garage bucket when the prod api runs MEDIA_DRIVER=s3 (MEDIA_TARGET=s3|volume overrides), S3 settings from ENV_PROD (default .env.coolify, else .env.production).
# Usage: [SSH_KEY=~/.ssh/key] [PG_CONTAINER=<db-resource-uuid>] [ENV_PROD=<env file>] \
#        pnpm coolify:push-delta -- <ssh-host> <coolify-app-uuid> [--units <file>] [--dry-run]
set -euo pipefail
[ "${1:-}" = "--" ] && shift
usage() {
  cat >&2 <<'TXT'
Usage: [SSH_KEY=<key file>] [PG_CONTAINER=<db-resource-uuid>] [ENV_PROD=<env file>] \
       pnpm coolify:push-delta -- <ssh-user>@<vps-host> <coolify-app-uuid> [--units <file>] [--dry-run]
  e.g. SSH_KEY=~/.ssh/id_ed25519 pnpm coolify:push-delta -- chris@vps.example.com xc9yilrbgjyu4ckrtjlbcrae --dry-run
TXT
  exit 1
}
[ $# -ge 2 ] && [[ "$1" != -* ]] && [[ "$2" != -* ]] || { echo "✗ need <ssh-host> and <coolify-app-uuid>" >&2; usage; }
HOST="$1"; UUID_ARG="$2"; shift 2
DRY=""; UNITS_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=--dry-run ;;
    --units) UNITS_FILE="${2:?--units needs a file}"; shift ;;
    --units=*) UNITS_FILE="${1#*=}" ;;
    *) echo "✗ unknown option: $1" >&2; usage ;;
  esac
  shift
done
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MEDIA_DIR="$ROOT/packages/api/media-data"
DC="docker compose -f $ROOT/docker-compose.dev.yml"
# FK order
TABLES=(field theme content_brief unit source asset check_report unit_link)
MIGRATION_SQL="SELECT coalesce(max(created_at), 0) FROM drizzle.__drizzle_migrations"
TMP="$(mktemp -d -t wizzn-delta)"
trap 'rm -rf "$TMP"' EXIT

lq() { $DC exec -T postgres psql -U wizzn -d wizzn -qAt -v ON_ERROR_STOP=1 "$@"; }
in_list() { sed "s/.*/'&'/" "$1" | paste -sd, -; }
UNIT_COLS="id, status, format, regexp_replace(coalesce(title, ''), '\s+', ' ', 'g')"

# ---------- selection (local) ----------
if [ -n "$UNITS_FILE" ]; then
  [ -f "$UNITS_FILE" ] || { echo "✗ no such file: $UNITS_FILE"; exit 1; }
  tr -d '\r' < "$UNITS_FILE" | awk '!/^[[:space:]]*(#|$)/ { print tolower($1) }' | LC_ALL=C sort -u > "$TMP/wanted.txt"
  [ -s "$TMP/wanted.txt" ] || { echo "✗ no unit ids in $UNITS_FILE"; exit 1; }
  BAD="$(grep -Ev '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' "$TMP/wanted.txt" || true)"
  [ -z "$BAD" ] || { echo "✗ not a unit id in $UNITS_FILE:"; sed 's/^/  /' <<<"$BAD"; exit 1; }
  lq -F $'\t' -c "SELECT $UNIT_COLS FROM unit WHERE id IN ($(in_list "$TMP/wanted.txt")) ORDER BY 4" > "$TMP/found.tsv"
  cut -f1 "$TMP/found.tsv" | LC_ALL=C sort > "$TMP/found.txt"
  LC_ALL=C comm -23 "$TMP/wanted.txt" "$TMP/found.txt" > "$TMP/unknown.txt"
  awk -F'\t' '$2 == "published"' "$TMP/found.tsv" > "$TMP/selected.tsv"
  awk -F'\t' '$2 != "published"' "$TMP/found.tsv" > "$TMP/skipped.tsv"
  if [ -s "$TMP/unknown.txt" ]; then echo "⚠ not in the local DB, skipped:"; sed 's/^/  /' "$TMP/unknown.txt"; fi
  if [ -s "$TMP/skipped.tsv" ]; then echo "⚠ not published, skipped:"; awk -F'\t' '{ printf "  %-16s %s\n", $2, $4 }' "$TMP/skipped.tsv"; fi
else
  lq -F $'\t' -c "SELECT $UNIT_COLS FROM unit WHERE status = 'published' ORDER BY 4" > "$TMP/selected.tsv"
fi
cut -f1 "$TMP/selected.tsv" > "$TMP/ids.txt"
N="$(grep -c . "$TMP/ids.txt" || true)"
[ "$N" -gt 0 ] || { echo "✗ no published units to push"; exit 1; }
IDS="$(in_list "$TMP/ids.txt")"
echo "→ $N published units selected${UNITS_FILE:+ from $UNITS_FILE}"
if [ -n "$UNITS_FILE" ] || [ -n "$DRY" ]; then awk -F'\t' '{ printf "  %-8s %s\n", $3, $4 }' "$TMP/selected.tsv"; fi

lq -c "SELECT DISTINCT path FROM asset WHERE unit_id IN ($IDS) ORDER BY 1" > "$TMP/media.txt"
(cd "$MEDIA_DIR" && while IFS= read -r p; do if [ -f "$p" ]; then echo "$p"; else echo "$p" >&3; fi; done < "$TMP/media.txt" > "$TMP/media-local.txt" 3> "$TMP/media-absent.txt")
M="$(grep -c . "$TMP/media-local.txt" || true)"
if [ -s "$TMP/media-absent.txt" ]; then
  echo "⚠ $(grep -c . "$TMP/media-absent.txt") referenced media files are missing in $MEDIA_DIR:"; sed 's/^/  /' "$TMP/media-absent.txt"
fi

# ---------- prod ----------
source "$(dirname "$0")/_s3.sh"
source "$(dirname "$0")/_remote.sh"
trap 'cleanup_ssh; rm -rf "$TMP"' EXIT
pq() { r "docker exec -i $PG psql -U wizzn -d wizzn -qAt -v ON_ERROR_STOP=1"; }

LOCAL_MIG="$(lq -c "$MIGRATION_SQL")"; PROD_MIG="$(echo "$MIGRATION_SQL" | pq)"
[ "$LOCAL_MIG" = "$PROD_MIG" ] || { echo "✗ schema differs (last migration local $LOCAL_MIG, prod $PROD_MIG): deploy / pnpm db:migrate first"; exit 1; }

if [ -n "$UNITS_FILE" ]; then
  # The feed shows one unit of a written + audio pair; a partner left behind is usually an oversight
  lq -F $'\t' -c "SELECT DISTINCT p.id, p.format, regexp_replace(coalesce(p.title, ''), '\s+', ' ', 'g') FROM unit u JOIN unit p ON p.pair_id = u.pair_id AND p.id <> u.id
                  WHERE u.id IN ($IDS) AND p.id NOT IN ($IDS) AND p.status = 'published'" > "$TMP/partners.tsv"
  if [ -s "$TMP/partners.tsv" ]; then
    cut -f1 "$TMP/partners.tsv" > "$TMP/partner-ids.txt"
    echo "SELECT id FROM unit WHERE id IN ($(in_list "$TMP/partner-ids.txt"))" | pq > "$TMP/partners-on-prod.txt"
    LEFT="$(grep -vFf "$TMP/partners-on-prod.txt" "$TMP/partners.tsv" || true)"
    if [ -n "$LEFT" ]; then echo "⚠ published pair partners neither in the list nor on prod (not pushed):"; awk -F'\t' '{ printf "  %s  %-8s %s\n", $1, $2, $3 }' <<<"$LEFT"; fi
  fi
fi

# ---------- media (before the rows, so prod never serves a unit without its files) ----------
if [ "$S3_MODE" = 1 ]; then
  use_prod_s3
  check_prod_s3
  if [ -n "$DRY" ]; then
    NEW="$(rclone copy "$MEDIA_DIR" "prod:$S3_BUCKET" --files-from "$TMP/media-local.txt" "${RCLONE_UPLOAD_FLAGS[@]}" --dry-run 2>&1 | grep -c 'as --dry-run is set' || true)"
    echo "→ media: $NEW of $M files missing in bucket $S3_BUCKET (dry run)"
  else
    echo "→ copying media to bucket $S3_BUCKET ($M files referenced)"
    # copy never deletes; content-addressed names → only new files transfer
    rclone copy "$MEDIA_DIR" "prod:$S3_BUCKET" --files-from "$TMP/media-local.txt" "${RCLONE_UPLOAD_FLAGS[@]}" --stats-one-line --stats 0
    if ! OUT="$(rclone check "$MEDIA_DIR" "prod:$S3_BUCKET" --files-from "$TMP/media-local.txt" --one-way --size-only --s3-no-check-bucket 2>&1)"; then
      echo "✗ bucket is incomplete after upload, DB not touched:"; tail -20 <<<"$OUT"; exit 1
    fi
    echo "  verified $M files in bucket"
  fi
else
  echo "→ diffing media"
  sed 's|^|./|' "$TMP/media-local.txt" | LC_ALL=C sort > "$TMP/local.txt"
  r "docker run --rm -v $MEDIA_VOL:/m:ro alpine sh -c 'cd /m && find . -type f'" | LC_ALL=C sort > "$TMP/remote.txt"
  LC_ALL=C comm -23 "$TMP/local.txt" "$TMP/remote.txt" > "$TMP/missing.txt"
  NEW=$(wc -l < "$TMP/missing.txt" | tr -d ' ')
  echo "  $NEW of $M files missing on prod${DRY:+ (dry run)}"
  if [ "$NEW" -gt 0 ] && [ -z "$DRY" ]; then
    (cd "$MEDIA_DIR" && COPYFILE_DISABLE=1 tar -czf - -T "$TMP/missing.txt") \
      | r "docker run --rm -i -v $MEDIA_VOL:/media alpine sh -c 'tar -xzf - -C /media && chown -R 1000:1000 /media'"
    echo "  uploaded $NEW files"
  fi
fi

# ---------- DB ----------
where_for() {
  case "$1" in
    field|theme) echo "true" ;;
    content_brief) echo "id IN (SELECT brief_id FROM unit WHERE id IN ($IDS))" ;;
    unit) echo "id IN ($IDS)" ;;
    # either end; the merge keeps only links whose two ends exist on prod
    unit_link) echo "from_unit_id IN ($IDS) OR to_unit_id IN ($IDS)" ;;
    *) echo "unit_id IN ($IDS)" ;;
  esac
}
echo "→ dumping local content rows"
{
  # psql -q still prints NOTICEs (schema does not exist, drop cascades to …)
  echo "SET client_min_messages = warning;"
  echo "BEGIN;"
  echo "DROP SCHEMA IF EXISTS wizzn_sync CASCADE; CREATE SCHEMA wizzn_sync;"
  for t in "${TABLES[@]}"; do
    cols="$(lq -c "SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$t'")"
    echo "CREATE TABLE wizzn_sync.$t (LIKE public.$t);"
    echo "COPY wizzn_sync.$t ($cols) FROM stdin;"
    lq -c "COPY (SELECT $cols FROM public.$t WHERE $(where_for "$t")) TO STDOUT"
    echo '\.'
  done
  cat <<'SQL'
\echo inserted rows:
WITH i AS (INSERT INTO public.field SELECT * FROM wizzn_sync.field ON CONFLICT DO NOTHING RETURNING 1) SELECT 'field' t, count(*) FROM i;
CREATE TEMP TABLE fmap AS SELECT s.id old_id, p.id new_id FROM wizzn_sync.field s JOIN public.field p ON p.slug = s.slug;
UPDATE wizzn_sync.theme x SET field_id = m.new_id FROM fmap m WHERE x.field_id = m.old_id;
WITH i AS (INSERT INTO public.theme SELECT * FROM wizzn_sync.theme ON CONFLICT DO NOTHING RETURNING 1) SELECT 'theme' t, count(*) FROM i;
CREATE TEMP TABLE tmap AS SELECT s.id old_id, p.id new_id FROM wizzn_sync.theme s JOIN public.theme p ON p.slug = s.slug;
UPDATE wizzn_sync.content_brief x SET field_id = m.new_id FROM fmap m WHERE x.field_id = m.old_id;
UPDATE wizzn_sync.content_brief x SET cross_field_id = m.new_id FROM fmap m WHERE x.cross_field_id = m.old_id;
UPDATE wizzn_sync.content_brief x SET theme_id = m.new_id FROM tmap m WHERE x.theme_id = m.old_id;
UPDATE wizzn_sync.unit x SET field_id = m.new_id FROM fmap m WHERE x.field_id = m.old_id;
UPDATE wizzn_sync.unit x SET theme_id = m.new_id FROM tmap m WHERE x.theme_id = m.old_id;
-- Duplicates: same field + format + title under another id (produced twice, or already live on prod). First published wins.
CREATE TEMP TABLE cand AS SELECT id, field_id, format, title, lower(btrim(regexp_replace(title, '\s+', ' ', 'g'))) AS k, published_at, created_at
  FROM wizzn_sync.unit WHERE id NOT IN (SELECT id FROM public.unit);
CREATE TEMP TABLE dup AS
  SELECT c.id, c.format, c.title, 'on prod' AS why FROM cand c
  WHERE c.k <> '' AND EXISTS (SELECT 1 FROM public.unit p WHERE p.status IN ('published', 'locked') AND p.field_id = c.field_id AND p.format = c.format
                              AND lower(btrim(regexp_replace(p.title, '\s+', ' ', 'g'))) = c.k);
INSERT INTO dup
  SELECT id, format, title, 'twice in this push' FROM (
    SELECT c.*, row_number() OVER (PARTITION BY field_id, format, k ORDER BY published_at NULLS LAST, created_at, id) AS n
    FROM cand c WHERE c.k <> '' AND c.id NOT IN (SELECT id FROM dup)) x WHERE n > 1;
CREATE TEMP TABLE new_unit AS SELECT id FROM cand WHERE id NOT IN (SELECT id FROM dup);
DELETE FROM wizzn_sync.unit WHERE id IN (SELECT id FROM dup);
WITH i AS (INSERT INTO public.content_brief SELECT * FROM wizzn_sync.content_brief WHERE id IN (SELECT brief_id FROM wizzn_sync.unit) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'content_brief' t, count(*) FROM i;
WITH i AS (INSERT INTO public.unit SELECT * FROM wizzn_sync.unit WHERE brief_id IN (SELECT id FROM public.content_brief) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'unit' t, count(*) FROM i;
-- Child rows only for units new in this push: a unit already on prod keeps its rows (locally re-rendered ones have new ids and would pile up)
WITH i AS (INSERT INTO public.source SELECT * FROM wizzn_sync.source WHERE unit_id IN (SELECT id FROM new_unit) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'source' t, count(*) FROM i;
WITH i AS (INSERT INTO public.asset SELECT * FROM wizzn_sync.asset WHERE unit_id IN (SELECT id FROM new_unit) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'asset' t, count(*) FROM i;
WITH i AS (INSERT INTO public.check_report SELECT * FROM wizzn_sync.check_report WHERE unit_id IN (SELECT id FROM new_unit) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'check_report' t, count(*) FROM i;
WITH i AS (INSERT INTO public.unit_link SELECT * FROM wizzn_sync.unit_link
           WHERE from_unit_id IN (SELECT id FROM public.unit) AND to_unit_id IN (SELECT id FROM public.unit) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'unit_link' t, count(*) FROM i;
\echo new units:
SELECT '  ' || rpad(u.format::text, 9) || coalesce(u.title, '') FROM public.unit u JOIN new_unit n ON n.id = u.id ORDER BY u.title;
\echo duplicates skipped (same field, format and title):
SELECT '  ' || rpad(format::text, 9) || coalesce(title, '') || '  [' || why || ']' FROM dup ORDER BY title;
DROP SCHEMA wizzn_sync CASCADE;
SQL
  [ -n "$DRY" ] && echo "ROLLBACK;" || echo "COMMIT;"
} > "$TMP/run.sql"
echo "→ merging into prod DB${DRY:+ (dry run, rolled back)}"
r "docker exec -i $PG psql -U wizzn -d wizzn -v ON_ERROR_STOP=1 -q -At -F ': '" < "$TMP/run.sql"
echo "✓ done${DRY:+ (dry run: nothing changed)}"
