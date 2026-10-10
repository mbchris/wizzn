#!/usr/bin/env bash
# Runs a command with JAVA_HOME = a JDK 21 (Capacitor 7 / Gradle 8.11 can't run on newer JDKs).
# Order: $WIZZN_JAVA_HOME → Android Studio's bundled JBR → any installed JDK 21 (/usr/libexec/java_home).
# Usage: scripts/with-jdk21.sh <command...>
set -euo pipefail

is_21() { [[ -x "$1/bin/java" ]] && "$1/bin/java" -version 2>&1 | head -1 | grep -qE '"21[."]'; }

pick() {
  local c
  for c in \
    "${WIZZN_JAVA_HOME:-}" \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    "$(/usr/libexec/java_home -v 21 2>/dev/null || true)"; do
    [[ -n "$c" ]] && is_21 "$c" && { echo "$c"; return 0; }
  done
  return 1
}

if JH="$(pick)"; then
  export JAVA_HOME="$JH" PATH="$JH/bin:$PATH"
else
  echo "✗ No JDK 21 found. Install Android Studio, or: brew install --cask temurin@21" >&2
  echo "  (or set WIZZN_JAVA_HOME to a JDK 21 home)" >&2
  exit 1
fi
exec "$@"
