#!/usr/bin/env bash
# One backup run: DB dump + media mirror → restic snapshots, then retention + periodic integrity check.
source /backup/env.sh
trap 'echo "✗ backup failed at line $LINENO"; ping_health /fail' ERR
ping_health /start
started=$(date +%s)

echo "→ [db] pg_dump → restic"
# Dump to a file first: a failed pg_dump must not leave a truncated dump as the newest snapshot
dump_dir="$(mktemp -d /cache/db.XXXX)"; trap 'rm -rf "$dump_dir"' EXIT
pg_dump --format=custom --no-owner --no-privileges --file "$dump_dir/wizzn.dump" "$DATABASE_URL"
(cd "$dump_dir" && restic backup wizzn.dump --tag db --host wizzn)

echo "→ [media] sync bucket $S3_BUCKET → $MIRROR_DIR"
# Paths are content-addressed and immutable: only new files transfer
rclone sync "garage:$S3_BUCKET" "$MIRROR_DIR" --fast-list --transfers 16 --checkers 32 --stats-one-line --stats 0
echo "→ [media] mirror → restic"
restic backup "$MIRROR_DIR" --tag media --host wizzn

echo "→ retention"
restic forget --prune --host wizzn --group-by host,tags \
  --keep-daily "${BACKUP_KEEP_DAILY:-7}" --keep-weekly "${BACKUP_KEEP_WEEKLY:-4}" --keep-monthly "${BACKUP_KEEP_MONTHLY:-6}"

# Sunday: verify repo structure + a sample of the data actually stored on Drive
if [ "$(date +%u)" = 7 ]; then
  echo "→ integrity check"
  restic check --read-data-subset="${BACKUP_CHECK_SUBSET:-5%}"
fi

echo "✓ backup done in $(( $(date +%s) - started ))s"
ping_health
