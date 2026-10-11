#!/usr/bin/env bash
# Push only what prod doesn't have yet: content rows (insert-only) + missing media files.
# Never updates/deletes remote rows; users/auth/progress are not touched.
# field/theme are matched by slug (ids differ per env because each seeds its own).
# Usage: [SSH_KEY=~/.ssh/key] [PG_CONTAINER=<db-resource-uuid>] pnpm coolify:push-delta -- <ssh-host> <coolify-app-uuid> [--dry-run]
set -euo pipefail
[ "${1:-}" = "--" ] && shift
HOST="${1:?ssh host}"; UUID_ARG="${2:?coolify app uuid or container name}"; DRY="${3:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MEDIA_DIR="$ROOT/packages/api/media-data"
source "$(dirname "$0")/_remote.sh"
DC="docker compose -f $ROOT/docker-compose.dev.yml"
TABLES=(field theme content_brief unit source asset check_report)
TMP="$(mktemp -d -t wizzn-delta)"

trap 'cleanup_ssh; rm -rf "$TMP"' EXIT


# ---------- DB ----------
echo "→ dumping local content tables"
{
  echo "DROP SCHEMA IF EXISTS wizzn_sync CASCADE; CREATE SCHEMA wizzn_sync;"
  for t in "${TABLES[@]}"; do echo "CREATE TABLE wizzn_sync.$t (LIKE public.$t);"; done
  $DC exec -T postgres pg_dump -U wizzn -d wizzn --data-only $(printf -- '-t public.%s ' "${TABLES[@]}") \
    | sed -E 's/^COPY public\./COPY wizzn_sync./' | grep -v 'pg_catalog.setval'
  cat <<'SQL'
\echo inserted rows:
WITH i AS (INSERT INTO public.field SELECT * FROM wizzn_sync.field ON CONFLICT DO NOTHING RETURNING 1) SELECT 'field' t, count(*) FROM i;
CREATE TEMP TABLE fmap AS SELECT s.id old_id, p.id new_id FROM wizzn_sync.field s JOIN public.field p ON p.slug = s.slug;
UPDATE wizzn_sync.theme x SET field_id = m.new_id FROM fmap m WHERE x.field_id = m.old_id;
WITH i AS (INSERT INTO public.theme SELECT * FROM wizzn_sync.theme ON CONFLICT DO NOTHING RETURNING 1) SELECT 'theme' t, count(*) FROM i;
CREATE TEMP TABLE tmap AS SELECT s.id old_id, p.id new_id FROM wizzn_sync.theme s JOIN public.theme p ON p.slug = s.slug;
UPDATE wizzn_sync.content_brief x SET field_id = m.new_id FROM fmap m WHERE x.field_id = m.old_id;
UPDATE wizzn_sync.content_brief x SET theme_id = m.new_id FROM tmap m WHERE x.theme_id = m.old_id;
UPDATE wizzn_sync.unit x SET field_id = m.new_id FROM fmap m WHERE x.field_id = m.old_id;
UPDATE wizzn_sync.unit x SET theme_id = m.new_id FROM tmap m WHERE x.theme_id = m.old_id;
WITH i AS (INSERT INTO public.content_brief SELECT * FROM wizzn_sync.content_brief ON CONFLICT DO NOTHING RETURNING 1) SELECT 'content_brief' t, count(*) FROM i;
WITH i AS (INSERT INTO public.unit SELECT * FROM wizzn_sync.unit WHERE brief_id IN (SELECT id FROM public.content_brief) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'unit' t, count(*) FROM i;
WITH i AS (INSERT INTO public.source SELECT * FROM wizzn_sync.source WHERE unit_id IN (SELECT id FROM public.unit) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'source' t, count(*) FROM i;
WITH i AS (INSERT INTO public.asset SELECT * FROM wizzn_sync.asset WHERE unit_id IN (SELECT id FROM public.unit) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'asset' t, count(*) FROM i;
WITH i AS (INSERT INTO public.check_report SELECT * FROM wizzn_sync.check_report WHERE unit_id IN (SELECT id FROM public.unit) ON CONFLICT DO NOTHING RETURNING 1) SELECT 'check_report' t, count(*) FROM i;
DROP SCHEMA wizzn_sync CASCADE;
SQL
  [ "$DRY" = --dry-run ] && echo "ROLLBACK;" || echo "COMMIT;"
} > "$TMP/delta.sql"
{ echo "BEGIN;"; cat "$TMP/delta.sql"; } > "$TMP/run.sql"
echo "→ merging into prod DB${DRY:+ (dry run, rolled back)}"
r "docker exec -i $PG psql -U wizzn -d wizzn -v ON_ERROR_STOP=1 -q -At -F ': '" < "$TMP/run.sql"

# ---------- media ----------
echo "→ diffing media"
(cd "$MEDIA_DIR" && find . -type f ! -name '.DS_Store' | LC_ALL=C sort) > "$TMP/local.txt"
r "docker run --rm -v $MEDIA_VOL:/m:ro alpine sh -c 'cd /m && find . -type f'" | LC_ALL=C sort > "$TMP/remote.txt"
LC_ALL=C comm -23 "$TMP/local.txt" "$TMP/remote.txt" > "$TMP/missing.txt"
N=$(wc -l < "$TMP/missing.txt" | tr -d ' ')
echo "  $N of $(wc -l < "$TMP/local.txt" | tr -d ' ') files missing on prod"
if [ "$N" -gt 0 ] && [ "$DRY" != --dry-run ]; then
  (cd "$MEDIA_DIR" && COPYFILE_DISABLE=1 tar -czf - -T "$TMP/missing.txt") \
    | r "docker run --rm -i -v $MEDIA_VOL:/media alpine sh -c 'tar -xzf - -C /media && chown -R 1000:1000 /media'"
  echo "  uploaded $N files"
fi
echo "✓ done"
