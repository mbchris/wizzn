#!/usr/bin/env bash
# Sync wizzn credentials between local env/key files and Vaultwarden (Bitwarden CLI).
#
# Vault layout — one secure note per entry (name = key, notes = value):
#   app.fourki.wizzn        <-> .env  (the single repo env file, see .env.template)
#   app.fourki.wizzn/files  <-> secrets/*, setup-out/fcm-sender.json, ...  (one note per file)
#
# Works with macOS' stock bash 3.2 (no associative arrays); parsing is done in jq.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
umask 077

CONFIG_FILE=".creds.config"
MODE=""
OVERWRITE_EMPTY=0
TARGETS=()
ENV_FILE=".env"
FOLDER_OVERRIDE=""

ALL_TARGETS="env files"
# Files synced by the "files" target (globs relative to repo root). Pull only writes paths matching FILE_NAME_RE.
SYNC_FILES=(secrets/*.p8 secrets/*.json setup-out/fcm-sender.json setup-out/google-services.json)
FILE_NAME_RE='^(secrets|setup-out)/[A-Za-z0-9._-]+$'
MAX_FILE_BYTES=6000 # Bitwarden notes cap at 10k encrypted chars

STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/wizzn-creds"
BACKUP_DIR="$STATE_DIR/backups"
FOLDERS_JSON="[]"


# ── jq helpers ────────────────────────────────────────────────────────────────
# read -d '' instead of $(cat <<heredoc): bash 3.2 (macOS) misparses quotes/backticks in heredocs inside $(...)
IFS= read -r -d '' JQ_LIB <<'JQ' || true
def keyre: "^(?<p>\\s*(?:export\\s+)?)(?<k>[A-Za-z_][A-Za-z0-9_.]*)\\s*=(?<v>.*)$";
# dotenv value -> raw value, as Node/dotenv read it (quotes removed; unquoted: "#" starts a comment)
def unquote:
  sub("^\\s+"; "")
  | if startswith("\"") then ((capture("^\"(?<x>[^\"]*)\"").x | gsub("\\\\n"; "\n")) // .)
    elif startswith("'") then (capture("^'(?<x>[^']*)'").x // .)
    else sub("#.*$"; "") | sub("\\s+$"; "")
    end;
# raw value -> dotenv value
def fmt:
  if test("\n") then "\"" + gsub("\n"; "\\n") + "\""
  elif test("^\\s|\\s$|#|^[\"'`]") then (if test("\"") then "'" + . + "'" else "\"" + . + "\"" end)
  else . end;
def lines: if . == "" then [] else sub("\n$"; "") | split("\n") | map(sub("\r$"; "")) end;
def parse_line: [capture(keyre)] | first;
def entries: lines | map(parse_line | select(. != null) | {k, v: (.v | unquote)});
# last occurrence wins (dotenv semantics)
def env_object: reduce entries[] as $e ({}; .[$e.k] = $e.v);
def duplicates: entries | group_by(.k) | map(select(length > 1) | .[0].k);
# per-key status: same | differs | local_only | vault_only | empty_local
def env_diff($vault):
  env_object as $local
  | ([$local | to_entries[] | .key as $k | .value as $v
      | if $vault[$k] == null then {k: $k, s: (if $v == "" then "empty_local" else "local_only" end)}
        elif $vault[$k].notes == $v then {k: $k, s: "same"}
        else {k: $k, s: "differs"} end]
    + [$vault | keys[] | select($local[.] == null) | {k: ., s: "vault_only"}]);
JQ

jqx() { jq "$@"; }
jlib() { local prog="$1"; shift; jq "$@" "$JQ_LIB
$prog"; }

# ── logging / utils ───────────────────────────────────────────────────────────
log_step() { echo "[creds] $1" >&2; }
die() { echo "[creds] ERROR: $1" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1${2:+ (install: $2)}"
}

backup_file() {
  local file="$1" name
  [[ -f "$file" ]] || return 0
  mkdir -p "$BACKUP_DIR"
  name="$(echo "$file" | tr '/' '_')"
  cp -p "$file" "$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)-$name"
}

write_atomic() { # write_atomic <file>  (content on stdin)
  local file="$1" tmp
  mkdir -p "$(dirname "$file")"
  tmp="$(mktemp "${file}.XXXXXX")"
  cat >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

# ── Bitwarden CLI wrappers ────────────────────────────────────────────────────
is_transient() {
  [[ "$1" == *"Bitwarden CLI\\data.json"* || "$1" == *"UNKNOWN: unknown error, open"* || "$1" == *"EPIPE: broken pipe"* ]]
}

bw_retry() {
  local attempt=1 delay=1 output rc
  while true; do
    if output="$(bw "$@" 2>&1 </dev/null)"; then
      printf '%s' "$output"
      return 0
    fi
    rc=$?
    if ! is_transient "$output" || [[ "$attempt" -ge 6 ]]; then
      printf '%s\n' "$output" >&2
      return "$rc"
    fi
    log_step "Bitwarden CLI transient error (attempt $attempt/6), retrying in ${delay}s..."
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

bw_noinput() { bw_retry --nointeraction "$@"; }

bw_session() {
  local attempt=1 delay=1 output rc
  while true; do
    if output="$(bw --nointeraction --session "$BW_SESSION" "$@" 2>&1 </dev/null)"; then
      printf '%s' "$output"
      return 0
    fi
    rc=$?
    if [[ "$attempt" -lt 6 && "$output" == *"Vault is locked."* ]]; then
      log_step "Vault session locked (attempt $attempt/6), unlocking again..."
      BW_SESSION="$(bw_noinput unlock --raw --passwordenv CREDS_BW_MASTER_PASSWORD)"
      export BW_SESSION
    elif [[ "$attempt" -lt 6 ]] && is_transient "$output"; then
      log_step "Bitwarden CLI transient error (attempt $attempt/6), retrying in ${delay}s..."
      sleep "$delay"
      delay=$((delay * 2))
    else
      printf '%s\n' "$output" >&2
      return "$rc"
    fi
    attempt=$((attempt + 1))
  done
}

bw_encode() { printf '%s' "$1" | bw encode; }

cleanup() {
  # Keep runs stateless. Uses an isolated CLI data dir, so your personal bw login is untouched.
  bw_noinput logout >/dev/null 2>&1 || true
}

# ── config / auth ─────────────────────────────────────────────────────────────
load_config() {
  [[ -f "$CONFIG_FILE" ]] || die "Config not found: $CONFIG_FILE (cp .creds.config.template .creds.config)"
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"

  VAULTWARDEN_SERVER="${VAULTWARDEN_SERVER:-${VAULTWARDEN_API_BASE:-}}"
  VAULTWARDEN_USER="${VAULTWARDEN_USER:-}"
  VAULTWARDEN_MASTER_PASSWORD="${VAULTWARDEN_MASTER_PASSWORD:-}"
  VAULTWARDEN_CLIENT_ID="${VAULTWARDEN_CLIENT_ID:-}"
  VAULTWARDEN_CLIENT_SECRET="${VAULTWARDEN_CLIENT_SECRET:-}"
  VAULTWARDEN_ORGANIZATION_ID="${VAULTWARDEN_ORGANIZATION_ID:-}"
  VAULTWARDEN_FOLDER="${VAULTWARDEN_FOLDER:-app.fourki.wizzn}"
  BITWARDENCLI_APPDATA_DIR="${BITWARDENCLI_APPDATA_DIR:-$STATE_DIR/bw}"

  [[ -n "$VAULTWARDEN_SERVER" ]] || die "VAULTWARDEN_SERVER missing in $CONFIG_FILE"
  if [[ -z "$VAULTWARDEN_CLIENT_ID" && -z "$VAULTWARDEN_USER" ]]; then
    die "Set VAULTWARDEN_USER (or VAULTWARDEN_CLIENT_ID/SECRET) in $CONFIG_FILE"
  fi
  if [[ -z "$VAULTWARDEN_MASTER_PASSWORD" ]]; then
    [[ -t 0 ]] || die "VAULTWARDEN_MASTER_PASSWORD not set and no terminal to prompt"
    read -r -s -p "Vaultwarden master password: " VAULTWARDEN_MASTER_PASSWORD </dev/tty
    echo >&2
  fi
}

bw_auth() {
  export CREDS_BW_MASTER_PASSWORD="$VAULTWARDEN_MASTER_PASSWORD"
  mkdir -p "$BITWARDENCLI_APPDATA_DIR"
  export BITWARDENCLI_APPDATA_DIR

  bw_noinput logout >/dev/null 2>&1 || true
  log_step "Server: $VAULTWARDEN_SERVER"
  bw_noinput config server "$VAULTWARDEN_SERVER" >/dev/null

  if [[ -n "$VAULTWARDEN_CLIENT_ID" ]]; then
    log_step "Logging in with API key"
    export BW_CLIENTID="$VAULTWARDEN_CLIENT_ID" BW_CLIENTSECRET="$VAULTWARDEN_CLIENT_SECRET"
    bw_noinput login --apikey >/dev/null
    unset BW_CLIENTID BW_CLIENTSECRET
  else
    log_step "Logging in as $VAULTWARDEN_USER"
    bw_noinput login "$VAULTWARDEN_USER" --passwordenv CREDS_BW_MASTER_PASSWORD >/dev/null
  fi

  BW_SESSION="$(bw_noinput unlock --raw --passwordenv CREDS_BW_MASTER_PASSWORD)"
  [[ -n "$BW_SESSION" ]] || die "Failed to unlock vault"
  export BW_SESSION
  FOLDERS_JSON="$(bw_session list folders)"
  log_step "Vault unlocked"
}

# ── vault access ──────────────────────────────────────────────────────────────
folder_id() {
  jqx -r --arg n "$1" 'first(.[] | select(.name == $n) | .id) // ""' <<<"$FOLDERS_JSON"
}

ensure_folder() {
  local name="$1" id
  id="$(folder_id "$name")"
  if [[ -z "$id" ]]; then
    log_step "Creating folder: $name"
    id="$(bw_session create folder "$(bw_encode "$(jqx -n --arg n "$name" '{name: $n}')")" | jqx -r '.id')"
    FOLDERS_JSON="$(jqx --arg n "$name" --arg id "$id" '. + [{name: $n, id: $id}]' <<<"$FOLDERS_JSON")"
  fi
  echo "$id"
}

# {name: {id, notes}} for all notes in a folder
vault_map() {
  bw_session list items --folderid "$1" | jqx --arg org "$VAULTWARDEN_ORGANIZATION_ID" '
    map(select(($org == "") or (.organizationId == $org)))
    | map({key: .name, value: {id, notes: (.notes // "")}}) | from_entries'
}

ITEM_TEMPLATE=""
vault_create() { # vault_create <folder_id> <name> <notes-json-string>
  [[ -n "$ITEM_TEMPLATE" ]] || ITEM_TEMPLATE="$(bw_session get template item)"
  local payload
  payload="$(jqx --arg name "$2" --argjson notes "$3" --arg fid "$1" --arg org "$VAULTWARDEN_ORGANIZATION_ID" '
    .name = $name | .type = 2 | .secureNote.type = 0 | .notes = $notes | .folderId = $fid
    | .login = null | (if $org != "" then .organizationId = $org else . end)' <<<"$ITEM_TEMPLATE")"
  bw_session create item "$(bw_encode "$payload")" >/dev/null
}

vault_update() { # vault_update <item_id> <notes-json-string>
  local payload
  payload="$(bw_session get item "$1" | jqx --argjson notes "$2" '.notes = $notes')"
  bw_session edit item "$1" "$(bw_encode "$payload")" >/dev/null
}

# ── env targets ───────────────────────────────────────────────────────────────
warn_duplicates() {
  local dups
  dups="$(jlib '$src | duplicates | join(", ")' -n -r --rawfile src "$1")"
  [[ -z "$dups" ]] || log_step "Warning: duplicate keys in $1 (last one wins): $dups"
}

push_env() {
  local target="$1" file="$2" folder="$3" fid vault line action key
  local created=0 updated=0 same=0 skipped=0
  warn_duplicates "$file"
  fid="$(ensure_folder "$folder")"
  vault="$(vault_map "$fid")"

  while IFS= read -r line; do
    action="$(jqx -r '.a' <<<"$line")"
    key="$(jqx -r '.k' <<<"$line")"
    case "$action" in
      create) log_step "  + $key"; vault_create "$fid" "$key" "$(jqx '.v' <<<"$line")"; created=$((created + 1)) ;;
      update) log_step "  ~ $key"; vault_update "$(jqx -r '.id' <<<"$line")" "$(jqx '.v' <<<"$line")"; updated=$((updated + 1)) ;;
      same) same=$((same + 1)) ;;
      skip_empty) skipped=$((skipped + 1)) ;;
    esac
  done < <(jlib '
    $src | env_object | to_entries[] | .key as $k | .value as $v
    | if $v == "" and $empty == 0 then {a: "skip_empty", k: $k}
      elif $vault[$k] == null then {a: "create", k: $k, v: $v}
      elif $vault[$k].notes == $v then {a: "same", k: $k}
      else {a: "update", k: $k, v: $v, id: $vault[$k].id} end' \
    -n -c --rawfile src "$file" --argjson vault "$vault" --argjson empty "$OVERWRITE_EMPTY")

  echo "$target: created $created, updated $updated, unchanged $same, skipped empty $skipped"
}

pull_env() {
  local target="$1" file="$2" folder="$3" fid vault src_file new_content stats
  fid="$(folder_id "$folder")"
  if [[ -z "$fid" ]]; then
    echo "$target: no vault folder '$folder', skipped"
    return
  fi
  vault="$(vault_map "$fid")"
  [[ "$OVERWRITE_EMPTY" -eq 1 ]] || vault="$(jqx 'with_entries(select(.value.notes != ""))' <<<"$vault")"

  src_file="$file"
  [[ -f "$file" ]] || src_file=/dev/null

  # Merge: rewrite only lines whose value differs, append vault-only keys; comments/order stay.
  new_content="$(jlib '
    ($src | lines) as $lines
    | [$lines[] | parse_line | if . then .k else null end] as $keys
    | ($vault | keys - $keys) as $missing
    | [ $lines[] | . as $l | (parse_line) as $m
        | if $m != null and $vault[$m.k] != null and ($m.v | unquote) != $vault[$m.k].notes
          then $m.p + $m.k + "=" + ($vault[$m.k].notes | fmt)
          else $l end ]
      + (if ($missing | length) > 0
         then (if ($lines | length) > 0 then ["", "# added by creds.sh pull"] else [] end)
              + [$missing[] | . + "=" + ($vault[.].notes | fmt)]
         else [] end)
    | join("\n") + "\n"' -n -j --rawfile src "$src_file" --argjson vault "$vault"; printf x)"
  new_content="${new_content%x}"

  stats="$(jlib '$src | env_diff($vault) | group_by(.s) | map("\(.[0].s)=\(length)") | join(" ")' \
    -n -r --rawfile src "$src_file" --argjson vault "$vault")"

  if [[ -f "$file" ]] && [[ "$(cat "$file"; printf x)" == "${new_content}x" ]]; then
    echo "$target: $file up to date ($stats)"
    return
  fi
  backup_file "$file"
  printf '%s' "$new_content" | write_atomic "$file"
  echo "$target: wrote $file ($stats)"
}

diff_env() {
  local target="$1" file="$2" folder="$3" fid vault="{}" src_file="$2"
  fid="$(folder_id "$folder")"
  [[ -z "$fid" ]] || vault="$(vault_map "$fid")"
  [[ -f "$file" ]] || src_file=/dev/null
  echo "── $target ($file <-> $folder)"
  jlib '$src | env_diff($vault) | sort_by(.k)[]
    | {same: "  = ", differs: "  ~ ", local_only: "  + ", vault_only: "  - ", empty_local: "  . "}[.s] + .k
      + {same: "", differs: "   (differs)", local_only: "   (local only)", vault_only: "   (vault only)", empty_local: "   (empty, not pushed)"}[.s]' \
    -n -r --rawfile src "$src_file" --argjson vault "$vault"
}

# ── files target ──────────────────────────────────────────────────────────────
local_files() {
  local pattern f
  for pattern in "${SYNC_FILES[@]}"; do
    for f in $pattern; do
      [[ -f "$f" ]] && echo "$f"
    done
  done
  return 0
}

push_files() {
  local folder="$1" fid vault f size action
  local created=0 updated=0 same=0
  fid="$(ensure_folder "$folder")"
  vault="$(vault_map "$fid")"
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    size="$(wc -c <"$f" | tr -d ' ')"
    if [[ "$size" -gt "$MAX_FILE_BYTES" ]]; then
      log_step "  ! $f too large ($size bytes), skipped"
      continue
    fi
    action="$(jqx -n -r --rawfile c "$f" --argjson vault "$vault" --arg k "$f" '
      if $vault[$k] == null then "create" elif $vault[$k].notes == $c then "same" else "update" end')"
    case "$action" in
      create) log_step "  + $f"; vault_create "$fid" "$f" "$(jqx -n --rawfile c "$f" '$c')"; created=$((created + 1)) ;;
      update) log_step "  ~ $f"; vault_update "$(jqx -r --arg k "$f" '.[$k].id' <<<"$vault")" "$(jqx -n --rawfile c "$f" '$c')"; updated=$((updated + 1)) ;;
      same) same=$((same + 1)) ;;
    esac
  done < <(local_files)
  echo "files: created $created, updated $updated, unchanged $same"
}

pull_files() {
  local folder="$1" fid vault name written=0 same=0
  fid="$(folder_id "$folder")"
  if [[ -z "$fid" ]]; then
    echo "files: no vault folder '$folder', skipped"
    return
  fi
  vault="$(vault_map "$fid")"
  while IFS= read -r name; do
    if [[ ! "$name" =~ $FILE_NAME_RE ]]; then
      log_step "  ! ignoring vault item with unexpected name: $name"
      continue
    fi
    if [[ -f "$name" ]] && [[ "$(jqx -n -r --rawfile c "$name" --argjson vault "$vault" --arg k "$name" '$vault[$k].notes == $c')" == "true" ]]; then
      same=$((same + 1))
      continue
    fi
    log_step "  > $name"
    backup_file "$name"
    jqx -n -j --argjson vault "$vault" --arg k "$name" '$vault[$k].notes' | write_atomic "$name"
    written=$((written + 1))
  done < <(jqx -r 'keys[]' <<<"$vault")
  echo "files: wrote $written, unchanged $same"
}

diff_files() {
  local folder="$1" fid vault="{}" f
  fid="$(folder_id "$folder")"
  [[ -z "$fid" ]] || vault="$(vault_map "$fid")"
  echo "── files (<-> $folder)"
  {
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      jqx -n -r --rawfile c "$f" --argjson vault "$vault" --arg k "$f" '
        if $vault[$k] == null then "  + \($k)   (local only)"
        elif $vault[$k].notes == $c then "  = \($k)" else "  ~ \($k)   (differs)" end'
    done < <(local_files)
    jqx -r --argjson local "$(local_files | jqx -R . | jqx -s .)" 'keys - $local | .[] | "  - \(.)   (vault only)"' <<<"$vault"
  } | sort -k2
}

# ── main ──────────────────────────────────────────────────────────────────────
print_help() {
  cat <<'EOF'
Usage: ./creds.sh <push|pull|diff|test> [target...] [options]

Modes:
  push      Local -> Vaultwarden (creates/updates notes, never deletes)
  pull      Vaultwarden -> local (merges into env files, keeps comments/order;
            previous versions are backed up to ~/.config/wizzn-creds/backups)
  diff      Show which keys differ (names only, never values)
  test      Check login and list the wizzn folders

Targets (default: both):
  env       .env <-> app.fourki.wizzn
  files     secrets/*.p8, secrets/*.json, setup-out/fcm-sender.json,
            setup-out/google-services.json <-> app.fourki.wizzn/files

Options:
  --env-file <path>     Env file for the env target (default: .env)
  --folder <name>       Vault folder for the env target (default: app.fourki.wizzn)
                        e.g. --env-file .env.prod --folder app.fourki.wizzn/prod
  --config <path>       Config file (default: .creds.config)
  --overwrite-empty     Also sync empty values (push: empty locals, pull: empty vault notes)
  -h, --help            Show this help

Examples:
  ./creds.sh diff
  ./creds.sh pull                # fresh checkout: .env + key files
  ./creds.sh push env
EOF
}

[[ $# -gt 0 ]] || { print_help; exit 1; }
case "$1" in -h | --help) print_help; exit 0 ;; esac
MODE="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) [[ $# -ge 2 ]] || die "--env-file requires a value"; ENV_FILE="$2"; shift 2 ;;
    --folder) [[ $# -ge 2 ]] || die "--folder requires a value"; FOLDER_OVERRIDE="$2"; shift 2 ;;
    --config) [[ $# -ge 2 ]] || die "--config requires a value"; CONFIG_FILE="$2"; shift 2 ;;
    --overwrite-empty) OVERWRITE_EMPTY=1; shift ;;
    -h | --help) print_help; exit 0 ;;
    all) TARGETS=(); shift ;;
    env | files) TARGETS+=("$1"); shift ;;
    *) echo "Unknown argument: $1" >&2; print_help; exit 1 ;;
  esac
done
[[ ${#TARGETS[@]} -gt 0 ]] || read -r -a TARGETS <<<"$ALL_TARGETS"

case "$MODE" in push | pull | diff | test) ;; *) echo "First argument must be push, pull, diff or test." >&2; print_help; exit 1 ;; esac

require_cmd bw "https://bitwarden.com/help/cli/#download-and-install  (brew install bitwarden-cli)"
require_cmd jq "https://jqlang.org/download/  (brew install jq)"
load_config
trap cleanup EXIT
bw_auth

if [[ "$MODE" == "test" ]]; then
  echo "Connection OK. Folders under $VAULTWARDEN_FOLDER:"
  jqx -r --arg r "$VAULTWARDEN_FOLDER" '.[] | select(.name == $r or (.name | startswith($r + "/"))) | "- \(.name)"' <<<"$FOLDERS_JSON"
  exit 0
fi

[[ "$MODE" != "push" ]] || ensure_folder "$VAULTWARDEN_FOLDER" >/dev/null # parent first, so subfolders nest

for target in "${TARGETS[@]}"; do
  if [[ "$target" == "files" ]]; then
    "${MODE}_files" "$VAULTWARDEN_FOLDER/files"
  elif [[ "$MODE" == "push" && ! -f "$ENV_FILE" ]]; then
    echo "env: $ENV_FILE not found, skipped"
  else
    "${MODE}_env" env "$ENV_FILE" "${FOLDER_OVERRIDE:-$VAULTWARDEN_FOLDER}"
  fi
done
