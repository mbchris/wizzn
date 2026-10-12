# Sourced by all backup scripts. Maps the Coolify env vars onto rclone remotes (no config file needed):
#   gdrive: → Google Drive (OAuth token from `rclone authorize "drive"`)
#   garage: → the media bucket, read-only key
set -euo pipefail

require() {
  local missing=()
  for k in "$@"; do [ -n "${!k:-}" ] || missing+=("$k"); done
  if [ ${#missing[@]} -gt 0 ]; then echo "✗ missing env: ${missing[*]}" >&2; return 1; fi
}

export RCLONE_CONFIG_GDRIVE_TYPE=drive
export RCLONE_CONFIG_GDRIVE_SCOPE=drive
export RCLONE_CONFIG_GDRIVE_CLIENT_ID="${GDRIVE_CLIENT_ID:-}"
export RCLONE_CONFIG_GDRIVE_CLIENT_SECRET="${GDRIVE_CLIENT_SECRET:-}"
export RCLONE_CONFIG_GDRIVE_TOKEN="${GDRIVE_TOKEN:-}"

export RCLONE_CONFIG_GARAGE_TYPE=s3
export RCLONE_CONFIG_GARAGE_PROVIDER=Other
export RCLONE_CONFIG_GARAGE_ENDPOINT="${S3_ENDPOINT:-}"
export RCLONE_CONFIG_GARAGE_REGION="${S3_REGION:-garage}"
export RCLONE_CONFIG_GARAGE_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}"
export RCLONE_CONFIG_GARAGE_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
export RCLONE_CONFIG_GARAGE_FORCE_PATH_STYLE=true

export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-rclone:gdrive:wizzn-backup}"
MIRROR_DIR="${MIRROR_DIR:-/mirror/media}"

ping_health() { # $1 = "" | /fail | /start — healthchecks.io-style URL, optional
  [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 --retry 3 -o /dev/null "${HEALTHCHECK_URL}${1:-}" || true
}
