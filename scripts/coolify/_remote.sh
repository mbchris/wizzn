# Shared by push-data.sh / push-delta.sh. Expects HOST + UUID_ARG set.
SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$HOME/.ssh/cm-wizzn-%r@%h:%p" -o ControlPersist=15m)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY")
r() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }
echo "→ connecting to $HOST (authenticate once)"
ssh "${SSH_OPTS[@]}" -fN "$HOST"
cleanup_ssh() { ssh "${SSH_OPTS[@]}" -O exit "$HOST" 2>/dev/null || true; }

# Accept "<uuid>" or a full container name like "api-<uuid>-20261010T181721"
case "$UUID_ARG" in api-*|worker-*|media-*|admin-*|web-*|searxng-*) UUID="${UUID_ARG#*-}";; *) UUID="$UUID_ARG";; esac
UUID="${UUID%%-*}"
NAMES="$(r "docker ps -a --format '{{.Names}}'")"
cname() { grep -E "^$1-$UUID(-|\$)" <<<"$NAMES" | head -1; }
API="$(cname api)"; WORKER="$(cname worker)"
[ -n "$API" ] || { echo "✗ no api container for $UUID on $HOST"; echo "$NAMES"; exit 1; }
# Postgres is a separate Coolify resource: its container is named after the resource UUID.
# Set PG_CONTAINER=<db-resource-uuid>; if unset, the only running postgres:* container on the host is used.
PG="${PG_CONTAINER:-}"
if [ -z "$PG" ]; then
  PGS="$(r "docker ps --format '{{.Names}} {{.Image}}'" | awk '$2 ~ /^postgres:/ {print $1}')"
  [ "$(grep -c . <<<"$PGS")" = 1 ] || { echo "✗ set PG_CONTAINER=<coolify postgres resource uuid>; postgres containers found:"; echo "${PGS:-  none}"; exit 1; }
  PG="$PGS"
fi
grep -qx "$PG" <<<"$NAMES" || { echo "✗ PG_CONTAINER=$PG not found on $HOST"; exit 1; }
MEDIA_VOL="$(r "docker inspect -f '{{range .Mounts}}{{if eq .Destination \"/media\"}}{{.Name}}{{end}}{{end}}' $API")"
# After the S3 cutover the api has no /media volume; callers in S3 mode don't need it
[ -n "$MEDIA_VOL" ] || [ "${S3_MODE:-0}" = 1 ] || { echo "✗ could not find /media volume on $API"; exit 1; }
echo "  postgres=$PG api=$API worker=${WORKER:-none} media=$MEDIA_VOL"
