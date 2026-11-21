#!/usr/bin/env sh
# Smoke test for this skill: scaffold a throwaway project, build it, install it, run its
# acceptance test, remove everything again. Run this after touching any script.
#
#   sh scripts/selfcheck.sh            # setup + build + install + test
#   sh scripts/selfcheck.sh --no-setup # skip setup-toolchain.sh
#   sh scripts/selfcheck.sh --build    # only scaffold + build (works without root)
#   sh scripts/selfcheck.sh --no-vd    # skip the background-display checks
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"

MODE=full
NOVD=0
for a in "$@"; do
  case "$a" in
    --no-setup) MODE=no-setup ;;
    --build)    MODE=build ;;
    --no-vd)    NOVD=1 ;;
  esac
done

PKG="dev.selfcheck.sample"
WORK="${SELFCHECK_DIR:-${TMPDIR:-$HOME}/dev-apk-selfcheck}"
FAILED=0
cleanup() {
  [ -d "$WORK" ] || return 0
  if have_root && [ "$MODE" = full ]; then
    asroot "pm uninstall '$PKG'" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

check() {   # check <label> <command...>
  label=$1; shift
  if "$@" >"$WORK/.out" 2>&1; then
    say "  PASS  $label"
  else
    say "  FAIL  $label"
    sed 's/^/        /' "$WORK/.out" | tail -15
    FAILED=1
  fi
}

no_daemon() { ! asroot "pgrep -f 'dev.apkdbg.Vd [0-9]'" 2>/dev/null | grep -q .; }

rm -rf "$WORK"; mkdir -p "$WORK"

[ "$MODE" = no-setup ] || [ "$MODE" = build ] || \
  { step "setup-toolchain.sh"; sh "$HERE/setup-toolchain.sh" | sed 's/^/  /' || FAILED=1; }

step "verify-vendor.sh"
check "vendor binaries" sh "$HERE/verify-vendor.sh"

step "new-project.sh"
check "scaffold $PKG" sh "$HERE/new-project.sh" "$WORK/app" "$PKG" "Selfcheck"

step "build.sh"
check "aapt2/javac/d8/apksigner" sh -c "cd '$WORK/app' && ./build.sh"

if [ "$MODE" = build ]; then
  step "done (build only)"
  [ "$FAILED" = 0 ] && say "SELFCHECK PASS" || say "SELFCHECK FAIL"
  exit "$FAILED"
fi

if ! have_root; then
  step "install/test skipped"
  say "  no root - build side passed; install needs one tap, test needs root"
  [ "$FAILED" = 0 ] && say "SELFCHECK PASS (build only)" || say "SELFCHECK FAIL"
  exit "$FAILED"
fi

step "install.sh"
check "pm install + am start" sh -c "cd '$WORK/app' && ./install.sh"

step "probe.sh"
check "app is in the foreground" sh -c "cd '$WORK/app' && ./probe.sh '$PKG' | grep -q 'FOREGROUND: yes'"

step "test.sh"
check "intent + file hooks" sh -c "cd '$WORK/app' && ./test.sh"

if [ "$NOVD" = 1 ]; then
  step "background display (vd.sh) skipped (--no-vd)"
elif [ ! -f "$WORK/app/vendor/vd/vd.jar" ]; then
  say "  FAIL  vendor/vd/vd.jar missing from the scaffold"
  FAILED=1
else
  # The invisible display: create it, run the app on it, look at it, drive it, tear it down.
  step "background display (vd.sh)"
  check "vd.sh create"        sh -c "cd '$WORK/app' && ./vd.sh create"
  check "vd.sh id"            sh -c "cd '$WORK/app' && ./vd.sh id | grep -qE '^[0-9]+$'"
  check "install.sh --bg"     sh -c "cd '$WORK/app' && ./install.sh --bg"
  check "vd.sh status"          sh -c "cd '$WORK/app' && ./vd.sh status | grep -A1 'your screen is showing' | grep -q mCurrentFocus"
  check "vd.sh size"          sh -c "cd '$WORK/app' && ./vd.sh size | grep -q 'screenshot: [0-9]*x[0-9]*'"
  check "vd.sh shot"          sh -c "cd '$WORK/app' && ./vd.sh shot '$WORK/vd.png' && test -s '$WORK/vd.png'"
  check "screen.sh --vd"      sh -c "cd '$WORK/app' && ./screen.sh --vd 40 | grep -q ."
  check "probe.sh per-display" sh -c "cd '$WORK/app' && ./probe.sh '$PKG' | grep -q 'per-display focus'"
  check "test.sh --vd"        sh -c "cd '$WORK/app' && ./test.sh --vd"
  check "vd.sh destroy"       sh -c "cd '$WORK/app' && ./vd.sh destroy"
  check "display released"    sh -c "cd '$WORK/app' && [ -z \"\$(./vd.sh id)\" ]"
  check "no daemon left"      no_daemon
  # Releasing the display must not dump the app onto the user's panel (DESTROY_CONTENT_ON_REMOVAL).
  check "app not on the panel" sh -c "cd '$WORK/app' && ./probe.sh '$PKG' | grep -q 'FOREGROUND: no'"
fi

step "result"
if [ "$FAILED" = 0 ]; then say "SELFCHECK PASS"; else say "SELFCHECK FAIL"; fi
exit "$FAILED"
