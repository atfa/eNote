#!/usr/bin/env sh
# Run the app on an invisible virtual display: the phone stays yours, the app keeps running.
#
#   usage: vd.sh <command> [args]
#     create [WxH[@dpi]]   create the display (default: the panel's own size and density)
#     destroy              stop the daemon and release the display
#     status               daemon, display id, power state, focus
#     id                   print the display id
#     size                 screenshot geometry (the coordinate space tap/swipe use)
#     shot [file]          PNG of the display (default: $ANDROID_STAGE_DIR/vd.png)
#     tap X Y              X,Y are pixels in the screenshot
#     swipe X1 Y1 X2 Y2 [ms]
#     key <keyevent|name>  e.g. 66, KEYCODE_BACK, KEYCODE_HOME
#     power [state]        re-power the display (2 = on) if it fell asleep with the screen
#     text <string>
#     launch [activity]    start the app on the display (default: app.env ACTIVITY)
#     rotate <deg>         override the shot rotation (0 | 90 | 180 | 270)
#     log                  the daemon log
#
# Needs root: the daemon runs as an app_process process that owns the display.
# The jar is prebuilt in vendor/vd/vd.jar; rebuild it with vd-build.sh after editing
# vendor/vd/Vd.java. Without root every command says so and exits 3.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"

STAGE=$ANDROID_STAGE_DIR
JAR_SRC="$VENDOR/vd/vd.jar"
JAR=$STAGE/vd.jar
CMD=$STAGE/vd.cmd
ID=$STAGE/vd.id
LOG=$STAGE/vd.log
CFG=$STAGE/vd.cfg

[ -n "$PY" ] || true

need_root() {
  have_root && return 0
  say "the background display needs root (app_process + DisplayManager) - see references/virtual-display.md"
  exit 3
}

send() {   # send <op> [args...]
  seq=$(date +%s%N 2>/dev/null)
  [ -n "$seq" ] || seq=$(( $(date +%s) * 1000000 ))
  asroot "printf '%s' '$seq $*' > $CMD"
}

display_id() { asroot "cat $ID 2>/dev/null" 2>/dev/null | tr -d ' \n'; }

# 旧 daemon 退出时的 shutdown hook 会把旧 id 写回 $ID，create 的轮询就会拿到一个
# 已经不存在的 display id（症状：am start --display <id> 报 Permission Denial，
# 整条 --vd 验收在第一步就红）。用 dumpsys 确认这个 id 真的存在才算数。
display_live() { asroot "dumpsys display" 2>/dev/null | grep -q "Display Id=$1"; }

# The `[0-9]` keeps the pattern from matching the `su -c "pgrep -f ..."` wrapper itself.
daemon_pid() { asroot "pgrep -f 'dev.apkdbg.Vd [0-9]'" 2>/dev/null | head -1 | tr -d ' \n'; }

# --- commands ---------------------------------------------------------------------

create() {   # create [WxH[@dpi]]
  need_root
  [ -f "$JAR_SRC" ] || die "missing $JAR_SRC - run vd-build.sh"
  destroy >/dev/null 2>&1 || true

  spec=${1:-}
  if [ -n "$spec" ]; then
    WH=${spec%@*}; DPI=${spec#*@}
    [ "$DPI" = "$WH" ] && DPI=$(wm density 2>/dev/null | tr -dc '0-9')
  else
    WH=$(wm size 2>/dev/null | sed -n 's/.*[Pp]hysical size: *\([0-9x]*\).*/\1/p')
    [ -n "$WH" ] || WH=1080x2400
    DPI=$(wm density 2>/dev/null | tr -dc '0-9')
    [ -n "$DPI" ] || DPI=440
  fi
  W=${WH%x*}; H=${WH#*x}
  case "$W$H$DPI" in *[!0-9]*) die "bad display spec: $spec (want WxH[@dpi])" ;; esac

  asroot "cp '$JAR_SRC' '$JAR' && chmod 644 '$JAR'" || die "cannot stage $JAR"
  asroot "rm -f '$LOG' '$ID'; echo 0 > '$CMD'; chmod 666 '$CMD'"
  say "starting daemon: ${W}x${H}@${DPI}"
  asroot "CLASSPATH=$JAR setsid app_process /system/bin dev.apkdbg.Vd $W $H $DPI $CMD $ID >> $LOG 2>&1 &"

  n=0
  id=""
  while [ $n -lt 50 ]; do
    id=$(display_id)
    [ -n "$id" ] && display_live "$id" && break
    sleep 0.2; n=$((n+1))
    id=""
  done
  [ -n "$id" ] || { asroot "tail -20 $LOG" ; die "daemon did not come up (see log above)"; }
  asroot "printf 'W=%s\nH=%s\nDPI=%s\nROT=0\n' $W $H $DPI > $CFG"
  say "background display: $id (${W}x${H}@${DPI})"
  say "launch the app on it: vd.sh launch"
}

destroy() {
  need_root
  pid=$(daemon_pid)
  if [ -n "$pid" ]; then
    send quit >/dev/null 2>&1
    # The daemon releases the display in a shutdown hook, which takes a moment.
    n=0
    while [ $n -lt 20 ]; do
      [ -z "$(daemon_pid)" ] && break
      sleep 0.2; n=$((n+1))
    done
    pid=$(daemon_pid)
    [ -n "$pid" ] && asroot "kill -9 $pid 2>/dev/null" >/dev/null 2>&1 || true
  fi
  asroot "rm -f $CMD $ID $CFG" >/dev/null 2>&1 || true
  say "background display released"
}

status() {
  need_root
  id=$(display_id)
  pid=$(daemon_pid)
  if [ -z "$id" ] || [ -z "$pid" ]; then
    say "no background display (run: vd.sh create)"
    return 0
  fi
  say "display id : $id"
  say "daemon pid : $pid"
  asroot "dumpsys display" 2>/dev/null \
    | grep -A3 "Display Id=$id" | grep -E "Display State|mState" | head -2 | sed 's/^/  /'
  say "focus on it:"
  asroot "dumpsys window displays" 2>/dev/null \
    | awk -v d="mDisplayId=$id" 'index($0,d){f=1} f&&/mCurrentFocus/{print "  "$0; exit}'
  say "your screen is showing:"
  # `mDisplayId=0` is often at the end of the line, so do not require a trailing space -
  # and do not match mDisplayId=0x... style ids either.
  out=$(asroot "dumpsys window displays" 2>/dev/null \
    | awk '/mDisplayId=0([^0-9]|$)/{f=1} f&&/mCurrentFocus/{print "  "$0; exit}')
  [ -n "$out" ] && printf '%s\n' "$out" || say "  (nothing focused on display 0)"
}

log() { need_root; asroot "cat $LOG" 2>/dev/null | tail -n "${1:-20}"; }

# Ask the daemon for the screenshot geometry: "OK size 2400x1080 buffer 1080x2400 rot=-90".
size_line() {
  before=$(asroot "wc -l < $LOG 2>/dev/null" 2>/dev/null | tr -dc '0-9')
  before=${before:-0}
  send size >/dev/null
  n=0
  while [ $n -lt 20 ]; do
    line=$(asroot "tail -n +$((before + 1)) $LOG 2>/dev/null" 2>/dev/null | grep '^OK size' | tail -1)
    [ -n "$line" ] && { printf '%s\n' "$line"; return 0; }
    sleep 0.15; n=$((n+1))
  done
  return 1
}

cmd_size() {
  need_root
  line=$(size_line) || { say "daemon not answering (vd.sh status)"; return 1; }
  printf '%s\n' "$line" | sed 's/^OK size /screenshot: /; s/buffer /display buffer: /'
}

shot() {   # shot [local-file]
  need_root
  dest=${1:-$STAGE/vd.png}
  case $dest in
    "$STAGE"/*) remote=$dest ;;
    *)          remote=$STAGE/vd.png ;;
  esac
  asroot "rm -f '$remote'" >/dev/null 2>&1
  send "shot $remote" >/dev/null
  n=0
  while [ $n -lt 100 ]; do
    asroot "test -s '$remote'" 2>/dev/null && break
    sleep 0.2; n=$((n+1))
  done
  asroot "chmod 644 '$remote'" >/dev/null 2>&1 || true
  if [ ! -s "$remote" ]; then
    say "no frame captured - is the display showing anything? (vd.sh log)"
    return 1
  fi
  if [ "$dest" != "$remote" ]; then
    mkdir -p "$(dirname "$dest")"
    cp "$remote" "$dest" || die "cannot write $dest"
  fi
  say "shot: $dest"
}

# Screenshot pixels -> display coordinates, undoing the shot rotation.
map_xy() {   # map_xy X Y  -> sets TX TY
  ix=$1; iy=$2
  line=$(size_line) || { say "daemon not answering"; return 1; }
  set -- $(printf '%s' "$line" | sed 's/^OK size //; s/buffer//; s/rot=//' | tr 'x' ' ')
  # $1x$2 = screenshot, $3x$4 = display buffer, $5 = rotation
  UW=$1; UH=$2; BW=$3; BH=$4; DEG=$5
  case $DEG in
    0)   TX=$ix; TY=$iy ;;
    -90) TX=$((BW - 1 - $iy)); TY=$ix ;;
    90)  TX=$iy; TY=$((BH - 1 - $ix)) ;;
    180) TX=$((BW - 1 - $ix)); TY=$((BH - 1 - $iy)) ;;
    *)   say "unsupported rotation: $DEG"; return 1 ;;
  esac
}

tap() {
  need_root
  [ $# -ge 2 ] || die "usage: vd.sh tap X Y"
  map_xy "$1" "$2" || return 1
  asroot "input touchscreen -d $(display_id) tap $TX $TY"
}

swipe() {
  need_root
  [ $# -ge 4 ] || die "usage: vd.sh swipe X1 Y1 X2 Y2 [ms]"
  map_xy "$1" "$2" || return 1
  x1=$TX; y1=$TY
  map_xy "$3" "$4" || return 1
  asroot "input touchscreen -d $(display_id) swipe $x1 $y1 $TX $TY ${5:-200}"
}

key() {
  need_root
  [ $# -ge 1 ] || die "usage: vd.sh key <keyevent|name>"
  asroot "input keyevent -d $(display_id) $1"
}

text() {
  need_root
  [ $# -ge 1 ] || die "usage: vd.sh text <string>"
  asroot "input -d $(display_id) text '$*'"
}

# The app window's rotation, from the input dispatcher: ROT_0 / ROT_90 / ROT_180 / ROT_270.
detect_rotation() {   # detect_rotation <package>
  asroot "dumpsys input" 2>/dev/null \
    | grep -A1 "name=.*$1" | grep -o 'ROT_[0-9]*' | head -1 | sed 's/ROT_//;s/^270$/-90/'
}

launch() {   # launch [activity]
  need_root
  act=${1:-}
  if [ -z "$act" ] && [ -f "$HERE/app.env" ]; then
    load_app_env "$HERE"
    act=$ACTIVITY
  fi
  [ -n "$act" ] || die "usage: vd.sh launch <package/.Activity> (or run from a project with app.env)"
  pkg=${act%%/*}
  id=$(display_id)
  [ -n "$id" ] || die "no background display - run vd.sh create"

  asroot "am start --display $id -n '$act'" || die "am start failed: $act"
  sleep 2
  rot=$(detect_rotation "$pkg")
  # Always send it: the daemon keeps the rotation from the last app that ran on this display.
  case "$rot" in
    0|90|180|-90) send "rotate $rot" >/dev/null
                  [ "$rot" = 0 ] || say "app is rotated: shots are rotated $rot (override with: vd.sh rotate <deg>)" ;;
    *) warn "could not detect the app rotation; shots keep the current rotation" ;;
  esac
  say "started $act on display $id"
}

rotate() {
  need_root
  send "rotate ${1:-0}" >/dev/null
  sleep 0.3
  asroot "grep '^OK rotate' $LOG" 2>/dev/null | tail -1
}

case "${1:-}" in
  create)  shift; create "${1:-}" ;;
  destroy) destroy ;;
  status)  status ;;
  id)      display_id; echo ;;
  size)    cmd_size ;;
  shot)    shift; shot "${1:-}" ;;
  tap)     shift; tap "$@" ;;
  swipe)   shift; swipe "$@" ;;
  key)     shift; key "$@" ;;
  text)    shift; text "$@" ;;
  launch)  shift; launch "${1:-}" ;;
  rotate)  shift; rotate "${1:-0}" ;;
  power)   shift; send "power ${1:-2}" >/dev/null; say "display power -> ${1:-2} (2=on)" ;;
  log)     shift; log "${1:-20}" ;;
  *) cat <<'EOF'
usage: vd.sh {create [WxH@dpi] | destroy | status | id | size | shot [file]
             | tap X Y | swipe X1 Y1 X2 Y2 [ms] | key N | text S
             | launch [activity] | rotate <deg> | log}
EOF
       ;;
esac
