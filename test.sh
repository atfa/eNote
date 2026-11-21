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
  # 虚拟屏只在手机醒着时才是 ON；屏一灭它就 OFF（截图全白、hook 也拿不到）
  asroot "input keyevent 224" >/dev/null 2>&1 || true
  asroot "wm dismiss-keyguard" >/dev/null 2>&1 || true
  asroot "echo enote_test > /sys/power/wake_lock" >/dev/null 2>&1 || true
  sh "$HERE/vd.sh" destroy >/dev/null 2>&1 || true
  sh "$HERE/vd.sh" create >/dev/null || die "vd.sh create failed"
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
# raw_get <path>: not every route lives under /api (the attachment viewer is /file).
raw_get()  { curl -s -m "${2:-30}" "http://127.0.0.1:$PORT/$1"; }

# logcat_has <pattern>: the app logs with Log.i("enote", ...); logcat needs root on this ROM.
logcat_has() { asroot "logcat -d -s enote:V" 2>/dev/null | grep -q "$1"; }

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
EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
BEFORE_ID=$(api_get state | "$PY" -c 'import json,sys; print(max(n["id"] for n in json.load(sys.stdin)["notes"]))')
asroot_global "mkdir -p '$EXT' && cp '$IMG' '$EXT/ocr-test.png' && chown '$UID_APP:$UID_APP' '$EXT/ocr-test.png' && chmod 644 '$EXT/ocr-test.png'" \
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

step "theme (light default, switch, java sync)"
api_get state | "$PY" -c '
import json,sys
s = json.load(sys.stdin)["settings"]
assert s.get("theme") in ("light","dark","auto"), "no theme in settings: %r" % s.get("theme")
' || fail "settings.theme missing"
api_post theme '{"mode":"dark"}' | "$PY" -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["theme"]=="dark", d' \
  || fail "cannot switch to dark"
api_get state | "$PY" -c 'import json,sys; assert json.load(sys.stdin)["settings"]["theme"]=="dark"' \
  || fail "dark theme did not stick"
sleep 3   # the UI polls /api/state and calls Android.setTheme
logcat_has "js setTheme" || fail "the webview never told java about the theme"
api_post theme '{"mode":"light"}' >/dev/null
api_get state | "$PY" -c 'import json,sys; assert json.load(sys.stdin)["settings"]["theme"]=="light"' \
  || fail "light theme did not stick"
say "  ok (light is the default, java stays in sync)"

step "search + per-page prefs (server side, R3)"
api_get "search?tab=notes" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["ok"] and d["notes"] and d["scanned"] >= len(d["notes"]), d
' || fail "plain search returns nothing"
api_get "search?tab=notes&q=%E5%91%A8%E4%BC%9A" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["ok"] and d["total"] >= 1, "q=周会 matched nothing"
assert any("来自图片文字" in v for v in (d.get("where") or {}).values()), \
  "no hit came from ocr text: %r" % d.get("where")
' || fail "search must match ocr text and label it 来自图片文字"
api_get "search?tab=notes&src=image&status=done" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert all(n["source"].endswith("image") and n["status"]=="done" for n in d["notes"]), d["notes"][:1]
' || fail "src/status filters are ignored"
api_get "search?tab=notes&sort=title" | "$PY" -c '
import json,sys
t = [n["title"] for n in json.load(sys.stdin)["notes"]]
assert t == sorted(t), "sort=title is not sorted"
' || fail "sort=title broken"
api_get "search?tab=todos" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["total"] >= 1 and d.get("todoIds"), d
assert all(not t["todo"]["done"] for t in d["todos"]), "the todos page must default to open items"
' || fail "todos search broken"
api_get "search?tab=todos&pri=high&done=all" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert all(t["todo"]["priority"]=="high" for t in d["todos"]), d["todos"][:1]
' || fail "priority filter ignored"
api_post prefs '{"tab":"notes","q":"取快递","sort":"title","dir":"asc","filters":{"src":"text"}}' \
  | "$PY" -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["ui"]["notes"]["q"]=="取快递", d' \
  || fail "prefs save failed"
api_get state | "$PY" -c '
import json,sys
u = json.load(sys.stdin)["settings"]["ui"]
assert u["notes"]["sort"]=="title" and u["notes"]["filters"]["src"]=="text", u
' || fail "per-page conditions do not persist"
api_post prefs '{"tab":"notes","q":"","sort":"new","filters":{}}' >/dev/null
api_post prefs '{"tab":"todos","q":"","sort":"due","filters":{"done":"open"}}' >/dev/null
say "  ok (ocr text is searchable, every page keeps its own conditions)"

step "attachments: share a file, list it, delete it (R4)"
EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
UID_APP=$(asroot "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
PDF_MARK="附件测试$$"
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\ntrailer2 %s\n' "$PDF_MARK" > "$TMPDIR/att-test.pdf"
asroot_global "mkdir -p '$EXT' && cp '$TMPDIR/att-test.pdf' '$EXT/att-test.pdf' && chown '$UID_APP:$UID_APP' '$EXT/att-test.pdf' && chmod 644 '$EXT/att-test.pdf'" \
  || fail "cannot stage the test pdf in $EXT"
# leftovers from earlier runs would break the count checks, so clear them first
api_get attachments | "$PY" -c 'import json,sys
for a in json.load(sys.stdin)["items"]:
    if a["name"] == "att-test.pdf": print(a["id"])' | while read -r x; do
  api_post attach/delete "{\"id\":\"$x\"}" >/dev/null; done
BEFORE_ATT=$(api_get attachments | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["total"])')
am_start "$APP_PACKAGE/.ShareActivity" "-a android.intent.action.SEND -t application/pdf --eu android.intent.extra.STREAM file://$EXT/att-test.pdf"
sleep 3
api_get attachments | "$PY" -c "
import json,sys
d = json.load(sys.stdin)
assert d['total'] == $BEFORE_ATT + 1, 'the shared pdf is not listed: %d -> %d' % ($BEFORE_ATT, d['total'])
a = d['items'][0]
assert a['name'] == 'att-test.pdf' and a['kind'] == 'pdf', a
assert not a.get('missing'), a
assert d['files'] + d['missing'] == d['total'], d
assert d['diskFiles'] >= d['files'], 'fewer files on disk than in the list: %s' % d
print('  listed %d attachments, %s on disk, %s' % (d['total'], d['diskFiles'], a['name']))
" || fail "the shared file never became an attachment"
api_get "search?tab=notes&file=yes" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["notes"], "file=yes matched nothing"
assert all(n.get("attachments") for n in d["notes"]), d["notes"][0]
' || fail "the 有无附件 filter is broken"
api_get "search?tab=notes&q=att-test" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["total"] >= 1 and any("附件名" in v for v in (d.get("where") or {}).values()), d.get("where")
' || fail "attachment names must be searchable"
AID=$(api_get "attachments?q=att-test" | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["items"][0]["id"])')
TOPDF=$(api_get "attachments?q=att-test" | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["items"][0]["noteId"])')
raw_get "file?id=$AID" | grep -q "$PDF_MARK" || fail "/file does not serve the attachment bytes"
api_post attach/delete "{\"id\":\"$AID\"}" | grep -q '"ok":true' || fail "attachment delete rejected"
api_get attachments | "$PY" -c "
import json,sys
items = json.load(sys.stdin)['items']
assert all(a['id'] != '$AID' for a in items), 'the deleted attachment is still listed'
" || fail "the deleted attachment is still listed"
api_post delete "{\"id\":\"$TOPDF\"}" | grep -q '"ok":true' || fail "note delete rejected"
api_get attachments | "$PY" -c "
import json,sys
d = json.load(sys.stdin)
assert d['total'] == $BEFORE_ATT, 'attachments left after deleting the note: %s' % d
assert d['missing'] == 0, d
" || fail "deleting a note must delete its attachment files"
say "  ok (pdf share, list counts match the disk, search by name, delete)"

step "ui: 轮询只在数据变化时重绘（不闪）"
if command -v node >/dev/null 2>&1; then
  node "$HERE/tools/ui_sig_test.js" | sed 's/^/  /' || fail "轮询指纹回归失败"
else
  say "  跳过（没有 node）"
fi

step "P6.5 常驻后台（前台服务 + 标准电池优化）"
am_start "$ACTIVITY" "--es hook keepalive --es arg on"
n=0
while [ "$n" -lt 20 ]; do
  newtlog | grep -q 'hook keepalive: ' && break
  sleep 1; n=$((n + 1))
done
newtlog | grep 'hook keepalive: ' | tail -1 | "$PY" -c '
import json,sys
line = sys.stdin.read()
if "hook keepalive: " not in line:
    sys.exit("the keepalive hook never finished")
d = json.loads(line.split("hook keepalive: ", 1)[1])
assert d["keepAlive"], d
print("  switch on, batteryIgnoring=%s, %s reminders armed" % (d["batteryIgnoring"], d["pending"]))
' || fail "keepalive switch did not turn on"
sleep 3
asroot "dumpsys activity services $APP_PACKAGE" | grep -q 'KeepAlive' \
  || fail "the foreground service is not running"
asroot "dumpsys notification --noredact" | grep -q 'keepalive' \
  || fail "the keepalive notification/channel is missing"
say "  ok (前台服务在跑，常驻通知已发布)"

am_start "$ACTIVITY" "--es hook keepalive --es arg off"
n=0
while [ "$n" -lt 20 ]; do
  newtlog | grep -q '"keepAlive":false' && break
  sleep 1; n=$((n + 1))
done
sleep 2
if asroot "dumpsys activity services $APP_PACKAGE" | grep -q 'KeepAlive'; then
  fail "the foreground service was not stopped when the switch went off"
fi
say "  ok (关掉开关后服务停止)"

step "P6 剪贴板：无焦点被拒 → 拿到焦点后重试（从通知点进来的场景）"
api_post clip/clear '' >/dev/null 2>&1 || true
asroot "input keyevent KEYCODE_HOME" >/dev/null 2>&1 || true
sleep 2
# 模拟：在别的 app 里复制 → 点常驻通知回到 app（onResume 比窗口拿焦点早，系统会拒读）
CLIPTEXT="买咖啡 焦点重试 $(date +%H%M%S)"
am_start "$ACTIVITY" "--es hook clipset --es arg '$CLIPTEXT'"
n=0
while [ "$n" -lt 20 ]; do
  api_get clip/list | grep -q '焦点重试' && break
  sleep 1; n=$((n + 1))
done
api_get clip/list | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
hits = [c for c in d.get("clips", []) if "焦点重试" in c.get("text", "")]
assert hits, d
print("  ok (被拒后重试成功，暂存 %d 条：%s)" % (len(hits), hits[0]["text"][:24]))
' || fail "剪贴板在窗口拿到焦点后仍未被暂存（焦点重试没生效）"

step "app alive"
sh "$HERE/probe.sh" "$APP_PACKAGE" | sed 's/^/  /'

if [ "$VD" = 1 ]; then
  asroot "echo enote_test > /sys/power/wake_unlock" >/dev/null 2>&1 || true
fi

if [ "$CLEAN" = 1 ]; then
  asroot "pm uninstall '$APP_PACKAGE'" >/dev/null 2>&1 || true
fi
say ""
say "PASS"
