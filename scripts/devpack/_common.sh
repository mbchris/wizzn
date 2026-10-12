# Shared by build.sh / load.sh (sourced; must run on macOS bash 3.2).
# shellcheck disable=SC2034
# Content tables in FK order; users, sessions and progress are never part of a pack.
DEVPACK_TABLES=(field theme content_brief unit source asset check_report unit_link)
DEVPACK_BUCKET="${DEVPACK_BUCKET:-wizzn-devpack}"
DEVPACK_DIR="$ROOT/devpacks"
MIGRATION_SQL="SELECT coalesce(max(created_at), 0) FROM drizzle.__drizzle_migrations"

# Local .env value (dev settings; DEVPACK_S3_* live there)
dev_env() { if [ -f "$ROOT/.env" ]; then sed -nE "s/^[[:space:]]*(export[[:space:]]+)?$1=['\"]?([^'\"]*)['\"]?[[:space:]]*\$/\2/p" "$ROOT/.env" | tail -1; fi; }

# rclone remote `devpack:` = the wizzn-devpack bucket (devpack key, read/write)
use_devpack_s3() {
  command -v rclone >/dev/null || { echo "✗ rclone not installed (brew install rclone)"; exit 1; }
  local ep id secret
  ep="${DEVPACK_S3_ENDPOINT:-$(dev_env DEVPACK_S3_ENDPOINT)}"
  id="${DEVPACK_S3_ACCESS_KEY_ID:-$(dev_env DEVPACK_S3_ACCESS_KEY_ID)}"
  secret="${DEVPACK_S3_SECRET_ACCESS_KEY:-$(dev_env DEVPACK_S3_SECRET_ACCESS_KEY)}"
  [ -n "$ep" ] && [ -n "$id" ] && [ -n "$secret" ] || { echo "✗ DEVPACK_S3_ENDPOINT / DEVPACK_S3_ACCESS_KEY_ID / DEVPACK_S3_SECRET_ACCESS_KEY missing in .env"; exit 1; }
  export RCLONE_CONFIG_DEVPACK_TYPE=s3 RCLONE_CONFIG_DEVPACK_PROVIDER=Other RCLONE_CONFIG_DEVPACK_FORCE_PATH_STYLE=true RCLONE_CONFIG_DEVPACK_REGION="${DEVPACK_S3_REGION:-garage}"
  export RCLONE_CONFIG_DEVPACK_ENDPOINT="$ep" RCLONE_CONFIG_DEVPACK_ACCESS_KEY_ID="$id" RCLONE_CONFIG_DEVPACK_SECRET_ACCESS_KEY="$secret"
}
