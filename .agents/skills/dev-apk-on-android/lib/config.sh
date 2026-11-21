# shellcheck shell=sh
# Every tunable default lives here - nothing else in this skill hard-codes a path.
# Source it through lib/common.sh; all values can be overridden from the environment.
#
# The caller sets $LIB before sourcing (see the 4-line bootstrap at the top of each script).

SKILL_DIR=${SKILL_DIR:-$(cd "$LIB/.." && pwd)}
VENDOR=${VENDOR:-$SKILL_DIR/vendor}

# --- Android platform -------------------------------------------------------------
# PLATFORM_API is both the build api and the toolchain api: it selects
# $ANDROID_HOME/platforms/android-$PLATFORM_API/android.jar. Only API 33 ships in vendor/;
# another API works as soon as its jar is dropped in there (see vendor/MANIFEST.md).
: "${PLATFORM_API:=33}"
: "${MIN_API:=24}"

# --- Where the toolchain is installed (NOT inside this skill: it is 38 MB and shared) ---
: "${ANDROID_HOME:=$HOME/android-sdk}"
: "${ANDROID_TOOLS:=$HOME/android-tools}"
: "${ANDROID_JAR:=$ANDROID_HOME/platforms/android-$PLATFORM_API/android.jar}"
: "${R8_JAR:=$ANDROID_TOOLS/r8.jar}"
: "${PERFETTO_STUB_JAR:=$ANDROID_TOOLS/perfetto-stub.jar}"

# --- Signing ---------------------------------------------------------------------
: "${ANDROID_KEYSTORE:=$HOME/.android/debug.keystore}"
: "${ANDROID_KS_ALIAS:=androiddebugkey}"
: "${ANDROID_KS_PASS:=android}"

# --- On-device plumbing ----------------------------------------------------------
# /data/local/tmp is world-writable and readable by system_server, which is what
# actually opens the apk during `pm install`. Termux cannot write to app dirs.
: "${ANDROID_STAGE_DIR:=/data/local/tmp}"

# --- Interpreter ----------------------------------------------------------------
PY=
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY=$c; break; fi
done
