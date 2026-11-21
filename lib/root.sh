# shellcheck shell=sh
# One root abstraction for every script in this skill.
#
# Root is optional. It buys: silent `pm install`, `am start`, `logcat`, `dumpsys`,
# `screencap`, and reading the app's private files. Without it everything still builds
# and signs; installing degrades to one tap in the system installer.
#
#   have_root              -> true when some form of root works
#   asroot "cmd"           -> run one command string as root (am, pm, dumpsys, settings...)
#   asroot_global "cmd"    -> same, inside the global mount namespace. Required for anything
#                             that touches /data/data/<pkg>: on KernelSU/Magisk a plain
#                             `su -c` can see a *shadow* /data/data whose writes never reach
#                             the app, and a root-created file that lands in the real dir must
#                             be chmod 644 or the app cannot read it.
#   root_desc              -> short human description for logs
#
# ROOT is cached: su | sudo | self | none

ROOT=

detect_root() {
  [ -n "$ROOT" ] && return 0
  if [ "${APK_NO_ROOT:-0}" = 1 ]; then    # pretend there is no root (for testing the fallback)
    ROOT=none
  elif [ "$(id -u)" = 0 ]; then
    ROOT=self
  elif command -v su >/dev/null 2>&1 && _root_probe "su -c"; then
    ROOT=su
  elif command -v sudo >/dev/null 2>&1 && _root_probe "sudo -n"; then
    ROOT=sudo
  else
    ROOT=none
  fi
}

_root_probe() {   # never hang forever waiting for a prompt nobody sees
  if command -v timeout >/dev/null 2>&1; then
    timeout 15 $1 true >/dev/null 2>&1
  else
    $1 true >/dev/null 2>&1
  fi
}

have_root() { detect_root; [ "$ROOT" != none ]; }

root_desc() {
  detect_root
  case $ROOT in
    su)   echo "su (Magisk/KernelSU)" ;;
    sudo) echo "sudo" ;;
    self) echo "already root" ;;
    *)    echo "none - install needs one tap in the system installer" ;;
  esac
}

asroot() {   # asroot "<command string>"
  detect_root
  case $ROOT in
    su)   su -c "$1" ;;
    sudo) sudo -n sh -c "$1" ;;
    self) sh -c "$1" ;;
    *)    echo "asroot: no root: $1" >&2; return 1 ;;
  esac
}

asroot_global() {   # read app-private data: /data/data/<pkg>/files/...
  detect_root
  case $ROOT in
    su)
      if timeout 15 su --mount-master -c true >/dev/null 2>&1; then
        su --mount-master -c "$1"
      else
        su -c "$1"      # older su: same namespace, usually still readable on Android <= 13
      fi ;;
    sudo) sudo -n sh -c "$1" ;;
    self) sh -c "$1" ;;
    *)    echo "asroot_global: no root: $1" >&2; return 1 ;;
  esac
}
