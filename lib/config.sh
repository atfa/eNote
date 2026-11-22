# shellcheck shell=sh
# Every tunable default lives here - nothing else in this skill hard-codes a path.
# Source it through lib/common.sh; all values can be overridden from the environment.
#
# The caller sets $LIB before sourcing (see the 4-line bootstrap at the top of each script).

SKILL_DIR=${SKILL_DIR:-$(cd "$LIB/.." && pwd)}
VENDOR=${VENDOR:-$SKILL_DIR/vendor}
# vendor/ 里装的是 skill 自带的预编译件（vd/vd.jar、android.jar、r8.jar），它在仓库里的
# 真实位置是 .agents/skills/dev-apk-on-android/vendor。非交互 shell（adb shell、CI、 Duo 的
# worktree）里 SKILL_DIR 是空的，上面两行就把 VENDOR 指到仓库根，vd.sh 直接报
# "missing .../vendor/vd/vd.jar - run vd-build.sh"，--vd 整套验收跑不了。
# 找不到就回退到 skill 目录，谁 clone 谁可用。
if [ ! -f "$VENDOR/vd/vd.jar" ]; then
  for _cand in "$SKILL_DIR/.agents/skills/dev-apk-on-android" "$LIB/../.agents/skills/dev-apk-on-android"; do
    if [ -f "$_cand/vendor/vd/vd.jar" ]; then
      SKILL_DIR=$(cd "$_cand" && pwd)
      VENDOR="$SKILL_DIR/vendor"
      break
    fi
  done
fi

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
