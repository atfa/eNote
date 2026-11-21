#!/usr/bin/env sh
# The app's own log lines.   usage: log.sh <tag> [n]
#
# logcat is only a hint on a busy phone: system noise evicts your lines within seconds.
# For real assertions have the app append to files/testlog.txt and read that file as root
# (references/testing.md). This script tries logcat without root first, then with.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"
TAG="${1:?usage: log.sh <tag> [n]}"
N="${2:-40}"

dump() {
  logcat -d -v brief -s "$TAG" 2>/dev/null | grep -v '^---------' | tail -"$N"
  return 0
}

OUT=$(dump)
if [ -z "$OUT" ] && have_root; then
  OUT=$(asroot "logcat -d -v brief -s '$TAG' 2>/dev/null | grep -v '^---------' | tail -$N" 2>/dev/null || true)
fi
if [ -z "$OUT" ]; then
  say "(no '$TAG' lines - logcat may be unreadable or already evicted; use the app's testlog file)"
else
  printf '%s\n' "$OUT" | sed "s/^[A-Z]\/$TAG *([0-9 ]*): /$TAG: /"
fi
