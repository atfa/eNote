#!/usr/bin/env sh
# eNote acceptance test. Builds, installs, then drives the app headlessly and asserts on
# the Go log, the app's own testlog.txt and the local HTTP API (127.0.0.1 is reachable
# from Termux, so the API checks need no root).
#
#   ./test.sh                build + install + full run
#   ./test.sh --skip-build   reuse the current enote.apk
#   ./test.sh --keep         leave the app installed (default: keep, uninstall with --clean)
#   ./test.sh --clean        uninstall the app afterwards
#   ./test.sh --vd           run the UI on the invisible background display (root)
#
# Needs root for: am start (share intents, hooks), reading app data files.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"
load_app_env "$HERE"
APK=$(readlink -f "$APK_NAME")

DATA="/data/data/$APP_PACKAGE/files"
GLOG="$DATA/enote/enote.log"
TLOG="$DATA/testlog.txt"
IMG="$HERE/.test/ocr-test.png"

PY=python3
command -v "$PY" >/dev/null 2>&1 || die "python3 is needed to read the JSON"

for a in "$@"; do
  case "$a" in
    --skip-build) SKIP_BUILD=1 ;;
    --clean) CLEAN=1 ;;
    --vd) VD=1 ;;
  esac
done
SKIP_BUILD=${SKIP_BUILD:-0}
CLEAN=${CLEAN:-0}
VD=${VD:-0}

have_root || {
  say "SKIP: test.sh needs root to start activities and read app data."
  say "      build + install still work: ./build.sh && ./install.sh"
  exit 3
}

[ -f "$IMG" ] || die "missing $IMG (a small PNG with Chinese text; see README)"

VDID=""
if [ "$VD" = 1 ]; then
  [ -n "$(sh "$HERE/vd.sh" id 2>/dev/null)" ] || sh "$HERE/vd.sh" create
  VDID=$(sh "$HERE/vd.sh" id)
  [ -n "$VDID" ] || die "no background display (vd.sh create failed)"
fi

am_start() {   # am_start <component> [am extras...]   (ACTIVITY from app.env is already a component)
  comp=$1; shift
  if [ -n "$VDID" ]; then
    asroot "am start --display $VDID -n '$comp' $*" >/dev/null
  else
    asroot "am start -n '$comp' $*" >/dev/null
  fi
}

# App data is only the real one in the *global* mount namespace: a plain `su -c` can see a
# shadow /data/data whose writes never reach the app.
readlog()  { asroot_global "cat '$GLOG' 2>/dev/null" 2>/dev/null || true; }
readtlog() { asroot_global "cat '$TLOG' 2>/dev/null" 2>/dev/null || true; }

waitfor() {   # waitfor <extended-regex> <seconds>
  n=0
  while [ "$n" -lt "${2:-30}" ]; do
    readlog | grep -Eq "$1" && return 0
    sleep 1; n=$((n + 1))
  done
  return 1
}

fail() {
  say "--- go log ---"; readlog | tail -25 | sed 's/^/  /'
  say "--- app log ---"; readtlog | tail -10 | sed 's/^/  /'
  sh "$HERE/probe.sh" "$APP_PACKAGE" | sed 's/^/  /' || true
  die "$1"
}

api_get()  { curl -s -m "${2:-30}" "http://127.0.0.1:$PORT/api/$1"; }
api_post() { curl -s -m "${3:-120}" -X POST "http://127.0.0.1:$PORT/api/$1" -d "$2"; }

# wait_note <python predicate on the note dict> <seconds> <label>
wait_note() {
  n=0
  while [ "$n" -lt "$2" ]; do
    ok=$(api_get state | "$PY" -c '
import json,sys
for n in json.load(sys.stdin)["notes"]:
    try:
        if bool(eval(sys.argv[1], {"__builtins__": {}}, {"n": n})):
            print(json.dumps(n, ensure_ascii=False)); break
    except Exception:
        pass
' "$1" 2>/dev/null)
    [ -n "$ok" ] && { LAST="$ok"; return 0; }
    sleep 2; n=$((n + 2))
  done
  return 1
}

if [ "$SKIP_BUILD" = 0 ]; then
  step "build (go unit tests + apk)"
  (cd "$HERE" && GO_TEST=1 ./build.sh 2>&1 | tail -3)
fi
[ -f "$APK" ] || die "no apk: $APK (run ./build.sh)"

step "install + start"
asroot "am force-stop '$APP_PACKAGE'" >/dev/null 2>&1 || true
asroot "pm install -g '$APK'" >/dev/null || die "pm install failed"
if [ "$VD" = 1 ]; then
  say "  on background display $VDID"
else
  asroot "input keyevent KEYCODE_WAKEUP" >/dev/null 2>&1 || true
  asroot "svc power stayon true" >/dev/null 2>&1 || true
fi
am_start "$ACTIVITY"
waitfor 'http server on' 40 || fail "the go http server never came up"
BASE=$(readtlog | wc -l)   # judge only what this run appends to the app log
newtlog() { readtlog | tail -n +$((BASE + 1)); }
PORT=$(readlog | grep -o '127.0.0.1:[0-9]*' | tail -1 | cut -d: -f2)
[ -n "$PORT" ] || fail "cannot find the api port in $GLOG"
say "  api: http://127.0.0.1:$PORT/"

step "selftest hook (store + web + llm + ocr)"
am_start "$ACTIVITY" "--es hook selftest --es arg '{\"mode\":\"all\"}'"
n=0
while [ "$n" -lt 90 ]; do
  newtlog | grep -q 'hook selftest: ' && break
  sleep 1; n=$((n + 1))
done
newtlog | grep 'hook selftest: ' | tail -1 | "$PY" -c '
import json,sys
line = sys.stdin.read()
if "hook selftest: " not in line:
    sys.exit("no selftest line in the app log (the hook never finished)")
d = json.loads(line.split("hook selftest: ", 1)[1])
assert d["ok"], d
print("  store ok, web %s in %sms, llm ok in %sms, ocr ready=%s" % (
    d["web"]["httpCode"], d["web"]["ms"], d["llm"].get("ms", -1), d["ocr"]["ready"]))
' || fail "selftest did not report ok"

step "share text -> note with a dated todo"
BEFORE=$(api_get state | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin)["notes"]))')
MARK="测试$$"
am_start "$APP_PACKAGE/.ShareActivity" "-a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '买牛奶和鸡蛋；周五下班后取快递；晚上8点开周会'$MARK"
sleep 2
if [ "$(api_get state | "$PY" -c "import json,sys; print(len(json.load(sys.stdin)['notes']) > $BEFORE)")" != "True" ]; then
  fail "the shared text never reached the store"
fi
wait_note "n['source']=='share-text' and n['status']=='done' and '$MARK' in n['rawText']" 120 \
  || fail "the shared text note was never parsed"
printf '%s' "$LAST" | "$PY" -c '
import json,sys
n = json.load(sys.stdin)
assert n["todos"], "no todos extracted"
assert any(t["due"] for t in n["todos"]), "no todo has a due time"
print("  title: %s | %d todos, first due %s" % (n["title"], len(n["todos"]),
      [t["due"] for t in n["todos"] if t["due"]][0]))
' || fail "the shared text note looks wrong"

step "share image -> local ocr -> note"
UID_APP=$(asroot "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
EXT="/sdcard/Android/data/$APP_PACKAGE/files"
BEFORE_ID=$(api_get state | "$PY" -c 'import json,sys; print(max(n["id"] for n in json.load(sys.stdin)["notes"]))')
asroot_global "mkdir -p '$EXT' && cp '$IMG' '$EXT/ocr-test.png' && chown -R '$UID_APP:$UID_APP' '/sdcard/Android/data/$APP_PACKAGE' && chmod 644 '$EXT/ocr-test.png'" \
  || fail "cannot stage the test image in $EXT"
am_start "$APP_PACKAGE/.ShareActivity" "-a android.intent.action.SEND -t 'image/*' --eu android.intent.extra.STREAM file://$EXT/ocr-test.png"
sleep 2
wait_note "n['source']=='share-image' and n['status']=='done' and n.get('ocrMs',0)>0 and n['id']>'$BEFORE_ID'" 150 \
  || fail "the shared image never came back from ocr + llm"
printf '%s' "$LAST" | "$PY" -c '
import json,sys
n = json.load(sys.stdin)
assert len(n.get("ocrText","")) >= 10, "ocr text too short"
assert n["todos"], "no todos extracted from the image"
print("  ocr %d chars in %sms, llm %sms, title: %s" % (
    len(n["ocrText"]), n["ocrMs"], n.get("aiMs"), n["title"]))
' || fail "the shared image note looks wrong"

step "todo add / toggle / delete"
NOTE=$(api_get state | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["notes"][0]["id"])')
TID=$(api_post todo "{\"action\":\"add\",\"noteId\":\"$NOTE\",\"text\":\"测试待办\",\"due\":\"2026-12-01T09:00\",\"priority\":\"high\"}" \
      | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print(d["id"] if d["ok"] else "")')
[ -n "$TID" ] || fail "todo add failed"
api_post todo "{\"action\":\"toggle\",\"noteId\":\"$NOTE\",\"todoId\":\"$TID\"}" | grep -q '"ok":true' || fail "todo toggle failed"
api_get state | "$PY" -c "
import json,sys
for n in json.load(sys.stdin)['notes']:
    if n['id']=='$NOTE':
        t=[x for x in n['todos'] if x['id']=='$TID'][0]
        assert t['done'] and t['priority']=='high' and t['due']=='2026-12-01T09:00', t
" || fail "the toggled todo is not what we wrote"
api_post todo "{\"action\":\"delete\",\"noteId\":\"$NOTE\",\"todoId\":\"$TID\"}" | grep -q '"ok":true' || fail "todo delete failed"
say "  ok"

step "reparse + llm connection test + export"
api_post reparse "{\"id\":\"$NOTE\"}" | grep -q '"ok":true' || fail "reparse rejected"
wait_note "n['id']=='$NOTE' and n['status']=='done'" 120 || fail "reparse never finished"
api_post llm/test "" | "$PY" -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"], d; print("  llm test ok in %sms: %s" % (d["ms"], d["reply"][:40]))' \
  || fail "llm connection test failed"
api_get export | "$PY" -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d,list) and d; print("  export: %d notes" % len(d))' \
  || fail "export is not a json array"

step "settings round-trip (masked api key keeps the real one)"
api_get state | "$PY" -c '
import json,sys
s = json.load(sys.stdin)["settings"]
assert "…" in s["apiKey"], "the key should come back masked: %r" % s["apiKey"]
s["useAI"] = True
print(json.dumps(s))
' > "$TMPDIR/set.json" || fail "cannot read the settings"
api_post settings "$(cat "$TMPDIR/set.json")" >/dev/null
api_get state | "$PY" -c '
import json,sys
s = json.load(sys.stdin)["settings"]
assert s["useAI"] is True and s["model"], s
assert s["baseUrl"].startswith("http"), s["baseUrl"]
' || fail "settings did not survive the round trip"
api_post llm/test "" | grep -q '"ok":true' || fail "the masked key broke the llm"
say "  ok"

step "app alive"
sh "$HERE/probe.sh" "$APP_PACKAGE" | sed 's/^/  /'

if [ "$CLEAN" = 1 ]; then
  asroot "pm uninstall '$APP_PACKAGE'" >/dev/null 2>&1 || true
fi
say ""
say "PASS"
