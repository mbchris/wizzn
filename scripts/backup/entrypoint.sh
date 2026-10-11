#!/usr/bin/env bash
# Validates config, initialises the restic repo on first start, then runs backup.sh on BACKUP_CRON.
source /backup/env.sh
require DATABASE_URL RESTIC_PASSWORD GDRIVE_TOKEN S3_ENDPOINT S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY

mkdir -p "$MIRROR_DIR" "$RESTIC_CACHE_DIR"
if ! restic cat config >/dev/null 2>&1; then
  echo "→ initialising restic repo $RESTIC_REPOSITORY"
  restic init
fi

CRON="${BACKUP_CRON:-15 3 * * *}"
echo "$CRON /backup/backup.sh" > /tmp/crontab
echo "✓ backup scheduled: '$CRON' ($TZ) → $RESTIC_REPOSITORY"
[ "${BACKUP_ON_START:-false}" = true ] && /backup/backup.sh || true
exec supercronic /tmp/crontab
