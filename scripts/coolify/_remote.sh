# Shared by push-data.sh / push-delta.sh. Expects HOST + UUID_ARG set.
SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$HOME/.ssh/cm-wizzn-%r@%h:%p" -o ControlPersist=15m)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY")
r() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }
echo "→ connecting to $HOST (authenticate once)"
ssh "${SSH_OPTS[@]}" -fN "$HOST"
cleanup_ssh() { ssh "${SSH_OPTS[@]}" -O exit "$HOST" 2>/dev/null || true; }

# Accept "<uuid>" or a full container name like "postgres-<uuid>-20261010T181721"
case "$UUID_ARG" in postgres-*|api-*|worker-*|media-*|admin-*|searxng-*) UUID="${UUID_ARG#*-}";; *) UUID="$UUID_ARG";; esac
UUID="${UUID%%-*}"
NAMES="$(r "docker ps -a --format '{{.Names}}'")"
cname() { grep -E "^$1-$UUID(-|\$)" <<<"$NAMES" | head -1; }
PG="$(cname postgres)"; API="$(cname api)"; WORKER="$(cname worker)"
[ -n "$PG" ] && [ -n "$API" ] || { echo "✗ no postgres/api container for $UUID on $HOST"; echo "$NAMES"; exit 1; }
MEDIA_VOL="$(r "docker inspect -f '{{range .Mounts}}{{if eq .Destination \"/media\"}}{{.Name}}{{end}}{{end}}' $API")"
[ -n "$MEDIA_VOL" ] || { echo "✗ could not find /media volume on $API"; exit 1; }
echo "  postgres=$PG api=$API worker=${WORKER:-none} media=$MEDIA_VOL"
