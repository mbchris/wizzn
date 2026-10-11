#!/usr/bin/env bash
# Run inside the backup container (Coolify → backup → Terminal):
#   /backup/restore.sh snapshots                 list snapshots
#   /backup/restore.sh db [snapshot] > out.dump  write a DB dump (default: latest) to stdout
#   /backup/restore.sh media [snapshot]          restore media files into /restore/media, then upload them to the bucket
#   /backup/restore.sh media-local [snapshot]    restore media files into /restore/media only
# The media upload needs a key with write access: BACKUP_S3_ACCESS_KEY_ID/SECRET can be overridden for the call.
source /backup/env.sh
cmd="${1:-}"; snap="${2:-latest}"
case "$cmd" in
  snapshots) restic snapshots --host wizzn ;;
  db) restic dump --tag db --host wizzn "$snap" "$(restic ls --tag db --host wizzn "$snap" | grep -m1 "wizzn.dump$")" ;;
  media|media-local)
    rm -rf /restore/media && mkdir -p /restore
    restic restore "$snap" --tag media --host wizzn --target /restore --include "$MIRROR_DIR"
    echo "✓ restored to /restore$MIRROR_DIR"
    if [ "$cmd" = media ]; then
      rclone copy "/restore$MIRROR_DIR" "garage:$S3_BUCKET" --transfers 16 --header-upload "Cache-Control: public, max-age=31536000, immutable"
      echo "✓ uploaded to bucket $S3_BUCKET"
    fi ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
