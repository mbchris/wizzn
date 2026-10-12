# Sourced by push-data.sh / push-delta.sh / storage scripts. Reads prod S3 settings from .env.production and
# exposes them as the rclone remote `prod:` (no rclone config file needed). Needs rclone (brew install rclone).
# S3_MODE=1 when .env.production has MEDIA_DRIVER=s3; _remote.sh then corrects it to what the prod api container runs.
ENV_PROD="${ENV_PROD:-$ROOT/.env.production}"
prod_env() { if [ -f "$ENV_PROD" ]; then sed -nE "s/^[[:space:]]*(export[[:space:]]+)?$1=['\"]?([^'\"]*)['\"]?[[:space:]]*\$/\2/p" "$ENV_PROD" | tail -1; fi; }

S3_MODE=0
[ "$(prod_env MEDIA_DRIVER)" = s3 ] && S3_MODE=1
S3_BUCKET="$(prod_env S3_BUCKET)"; S3_BUCKET="${S3_BUCKET:-wizzn-media}"

use_prod_s3() {
  command -v rclone >/dev/null || { echo "✗ rclone not installed (brew install rclone)"; exit 1; }
  local ep id secret
  ep="$(prod_env S3_ENDPOINT)"; id="$(prod_env S3_ACCESS_KEY_ID)"; secret="$(prod_env S3_SECRET_ACCESS_KEY)"
  [ -n "$ep" ] && [ -n "$id" ] && [ -n "$secret" ] || { echo "✗ S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY missing in $ENV_PROD"; exit 1; }
  export RCLONE_CONFIG_PROD_TYPE=s3 RCLONE_CONFIG_PROD_PROVIDER=Other RCLONE_CONFIG_PROD_FORCE_PATH_STYLE=true
  export RCLONE_CONFIG_PROD_ENDPOINT="$ep" RCLONE_CONFIG_PROD_ACCESS_KEY_ID="$id" RCLONE_CONFIG_PROD_SECRET_ACCESS_KEY="$secret"
  RCLONE_CONFIG_PROD_REGION="$(prod_env S3_REGION)"; export RCLONE_CONFIG_PROD_REGION="${RCLONE_CONFIG_PROD_REGION:-garage}"
}

# Same header the app sets on upload (paths are content-addressed → immutable).
# no-check-bucket: the app key may not create buckets, and Garage answers the implicit CreateBucket with 403.
RCLONE_UPLOAD_FLAGS=(--transfers 16 --checkers 32 --s3-no-check-bucket --header-upload "Cache-Control: public, max-age=31536000, immutable")
# Whole-directory transfers only; rclone refuses other filters next to --files-from
RCLONE_TREE_FLAGS=(--fast-list --exclude .DS_Store)

# Fails early (before any DB change) when endpoint, key or bucket are wrong
check_prod_s3() {
  rclone lsf "prod:$S3_BUCKET" --max-depth 1 --files-only >/dev/null \
    || { echo "✗ cannot list bucket $S3_BUCKET at $RCLONE_CONFIG_PROD_ENDPOINT (endpoint / key in $ENV_PROD?)"; exit 1; }
}
