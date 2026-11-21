#!/usr/bin/env sh
# Make root `pm install` unattended on OEM Android.
#
# Some OEM ROMs route every install - even a root `pm install` - through a package verifier
# that pops "Play Protect doesn't know this app" and blocks until a human taps it. The old
# escape hatch `pm install --disable-verification` was removed in Android 16. These settings
# turn verification off. Idempotent; re-run after a factory reset.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"

have_root || die "needs root (su/sudo)"

put() {   # put <scope> <key> <value>
  if asroot "settings put $1 $2 $3" >/dev/null 2>&1; then
    say "  $1.$2=$3"
  else
    say "  $1.$2 - not supported on this ROM (ignored)"
  fi
}

step "disabling the package verifier"
put global package_verifier_enable 0
put global package_verifier_user_consent -1
put global upload_apk_enabled 0
put global verification_required 0
put global verifier_verify_adb_installs 0
put secure install_non_market_apps 1
say "root pm install should now be silent"
