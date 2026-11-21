#!/usr/bin/env sh
# Is the app in the foreground, and did it crash?   usage: probe.sh <package>
# Needs root (dumpsys/logcat are shell-only). Without root it says so instead of failing.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"
PKG="${1:?usage: probe.sh <package>}"

if ! have_root; then
  say "FOREGROUND: unknown (needs root for dumpsys)"
  exit 0
fi

# Under memory pressure `dumpsys window` comes back empty even with the app in front, so ask
# the activity manager as well and accept either answer naming the package.
FOCUS=$(asroot "dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp'" 2>/dev/null || true)
[ -n "$FOCUS" ] || FOCUS=$(asroot "dumpsys activity activities 2>/dev/null | grep -E 'mResumedActivity|topResumedActivity'" 2>/dev/null || true)

if printf '%s\n' "$FOCUS" | grep -q "$PKG"; then
  say "FOREGROUND: yes"
  printf '%s\n' "$FOCUS" | grep "$PKG" | head -2 | sed 's/^/  /'
else
  say "FOREGROUND: no"
  printf '%s\n' "$FOCUS" | head -2 | sed 's/^/  /'
fi

say "--- crashes ---"
CRASH=$(asroot "logcat -d -b crash 2>/dev/null | grep -A14 '$PKG' | tail -16" 2>/dev/null || true)
[ -n "$CRASH" ] && printf '%s\n' "$CRASH" || say "(none)"

# "Foreground" is per display: an app on a background virtual display is foreground on its own
# display while the panel shows something else (see vd.sh / references/virtual-display.md).
say "--- per-display focus ---"
asroot "dumpsys window displays" 2>/dev/null | awk -v pkg="$PKG" '
  /mDisplayId=/ { d=$0; sub(/.*mDisplayId=/, "", d); sub(/[^0-9].*/, "", d) }
  /mCurrentFocus=/ { f=$0; sub(/.*mCurrentFocus=/, "", f)
                      printf "  display %s: %s%s\n", d, f, (index(f, pkg) ? "   <-- target" : "") }' | head -8
