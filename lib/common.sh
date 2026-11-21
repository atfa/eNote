# shellcheck shell=sh
# Bootstrap shared by every script: defaults + root helpers + log helpers.
# Callers do:
#   HERE=$(cd "$(dirname "$0")" && pwd)
#   LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
#   . "$LIB/common.sh"

. "$LIB/config.sh"
. "$LIB/root.sh"

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need() {   # need <command> [package-name-in-termux]
  command -v "$1" >/dev/null 2>&1 && return 0
  die "$1 not found${2:+ - run: pkg install $2}"
}

# app.env values win over nothing: a project is self-describing.
load_app_env() {   # load_app_env <dir>
  [ -f "$1/app.env" ] || die "no app.env in $1 (run new-project.sh or create one)"
  # shellcheck disable=SC1090
  . "$1/app.env"
  : "${APP_PACKAGE:?app.env: APP_PACKAGE missing}"
  : "${ACTIVITY:=MainActivity}"
  : "${APK_NAME:=app.apk}"
  : "${TAG:=${APP_PACKAGE##*.}}"
  # aapt2 rejects "pkg/MainActivity" on the am command line; accept both spellings
  case $ACTIVITY in
    */*) : ;;
    .*)  ACTIVITY="$APP_PACKAGE/$ACTIVITY" ;;
    *)   ACTIVITY="$APP_PACKAGE/.$ACTIVITY" ;;
  esac
}
