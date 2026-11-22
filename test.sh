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

step "AI 是否可用（没配好 key 就跳过依赖大模型的用例）"
AI_OK=$(api_post llm/test "" | "$PY" -c 'import json,sys
try:
    print("1" if json.load(sys.stdin).get("ok") else "0")
except Exception:
    print("0")' 2>/dev/null) || AI_OK=0
[ -n "$AI_OK" ] || AI_OK=0
# 依赖大模型的断言用 need_ai 包一层：没有 key 时打一行 skip，而不是让整套测试红掉
need_ai() {
  [ "$AI_OK" = 1 ] && return 0
  say "  skip（未配置可用的 AI：$1）"
  return 1
}
say "  llm ok=$AI_OK"

step "selftest hook (store + web + llm + ocr)"
am_start "$ACTIVITY" "--es hook selftest --es arg '{\"mode\":\"all\"}'"
n=0
while [ "$n" -lt 90 ]; do
  newtlog | grep -q 'hook selftest: ' && break
  sleep 1; n=$((n + 1))
done
newtlog | grep 'hook selftest: ' | tail -1 | AI_OK=$AI_OK "$PY" -c '
import json,sys,os
line = sys.stdin.read()
if "hook selftest: " not in line:
    sys.exit("no selftest line in the app log (the hook never finished)")
d = json.loads(line.split("hook selftest: ", 1)[1])
if os.environ.get("AI_OK") != "1":   # 没配 AI 时允许 llm 那一段是失败的
    d["llm"]["ok"] = True
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
if need_ai "这条用例断言的是 AI 解析出的标题和待办"; then
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
else
  # 没有可用 AI 时笔记停在 raw（原文保留），这也是正确行为
  wait_note "n['source']=='share-text' and '$MARK' in n['rawText'] and n['status'] in ('done','raw','error')" 60 \
    || fail "the shared text never got stored"
fi

step "share image -> local ocr -> note"
UID_APP=$(asroot "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
BEFORE_ID=$(api_get state | "$PY" -c 'import json,sys; print(max(n["id"] for n in json.load(sys.stdin)["notes"]))')
asroot_global "mkdir -p '$EXT' && cp '$IMG' '$EXT/ocr-test.png' && chown '$UID_APP:$UID_APP' '$EXT/ocr-test.png' && chmod 644 '$EXT/ocr-test.png'" \
  || fail "cannot stage the test image in $EXT"
am_start "$APP_PACKAGE/.ShareActivity" "-a android.intent.action.SEND -t 'image/*' --eu android.intent.extra.STREAM file://$EXT/ocr-test.png"
sleep 2
if need_ai "这条用例断言的是 OCR 结果再交给 AI 的标题和待办"; then
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
else
  # OCR 是本地跑的，跟 AI 无关：没配 AI 也要能出文字
  wait_note "n['source']=='share-image' and n.get('ocrMs',0)>0 and n['status'] in ('done','raw','error') and n['id']>'$BEFORE_ID'" 150 \
    || fail "local ocr never ran on the shared image"
  printf '%s' "$LAST" | "$PY" -c '
import json,sys
n = json.load(sys.stdin)
assert len(n.get("ocrText","")) >= 10, "ocr text too short"
print("  ocr %d chars in %sms" % (len(n["ocrText"]), n["ocrMs"]))
' || fail "local ocr produced nothing useful"
fi

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
if need_ai "重新解析要等 AI 回来"; then
  wait_note "n['id']=='$NOTE' and n['status']=='done'" 120 || fail "reparse never finished"
  api_post llm/test "" | "$PY" -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"], d; print("  llm test ok in %sms: %s" % (d["ms"], d["reply"][:40]))' \
    || fail "llm connection test failed"
fi
api_get export | "$PY" -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d,list) and d; print("  export: %d notes" % len(d))' \
  || fail "export is not a json array"

step "settings round-trip (masked api key keeps the real one)"
# 界面回传的是打码 key，服务端必须保住真 key。没配 key 时这条只能验其余字段的往返。
api_get state | "$PY" -c '
import json,sys
print(json.dumps(json.load(sys.stdin)["settings"]))
' > "$TMPDIR/set.json" || fail "cannot read the settings"
api_post settings "$(cat "$TMPDIR/set.json")" >/dev/null
api_get state | "$PY" -c '
import json,sys
s = json.load(sys.stdin)["settings"]
assert s["useAI"] is True and s["model"], s
assert s["baseUrl"].startswith("http"), s["baseUrl"]
assert s["temperature"] == 0.2, "部分字段 POST 不该动 temperature: %s" % s["temperature"]
' || fail "settings did not survive the round trip"
if need_ai "打码 key 往返、真 key 不被覆盖，这两条要真有 key 才成立"; then
  api_get state | "$PY" -c '
import json,sys
s = json.load(sys.stdin)["settings"]
assert "…" in s["apiKey"], "the key should come back masked: %r" % s["apiKey"]
print(json.dumps(s))
' > "$TMPDIR/set.json" || fail "the key does not come back masked"
  api_post settings "$(cat "$TMPDIR/set.json")" >/dev/null
  api_post llm/test "" | grep -q '"ok":true' || fail "the masked key broke the llm"
fi
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

step "P8 补看错过的提醒（后台被冻结时唯一有意义的补救）"
# 把「上次打开时间」退到过去，接口就该把这段时间内到点、未完成的待办报出来
asroot_global "echo -n '2020-01-01T00:00:00+08:00' > /data/data/$APP_PACKAGE/files/enote/lastopen.txt"
api_get missed | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d.get("ok"), d
items = d.get("items") or []
assert d.get("count", 0) >= len(items), d
if items:
    first = items[0]
    assert first.get("id") and first.get("noteId"), first   # 点得回原笔记
    assert len(items) <= 20, "清单最多 20 条"
    assert all(i["due"] <= d["now"][:16] for i in items), "只报已经到点的"
else:
    print("  (这台机器没有已到点且未完成的待办，只验证接口形状)")
print("  ok (错过 %d 条，列出 %d 条，最早一条 %s)" % (d["count"], len(items), items[0]["due"] if items else "-"))
' || fail "补看错过的提醒接口不对"
# 看一次就把时间推到现在：紧接着再问一次必须是 0，不能重复打扰
api_get missed | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d.get("count") == 0, "第二次问不该重复报，got %s" % d.get("count")
print("  ok (看过一次就不再重复提醒)")
' || fail "补看提醒没有推进 lastopen，会重复打扰"

step "P11 截图捕获：扫描 → 合并导入 → 各存一条 → 幂等 → 忽略"
SHOTDIR=/sdcard/Pictures/enote-test
# 权限：直接用 root 授掉，跳过系统弹窗（真机上由用户点"去授权"）
asroot_global "pm grant $APP_PACKAGE android.permission.READ_MEDIA_IMAGES" >/dev/null 2>&1 || true
asroot_global "rm -rf $SHOTDIR; mkdir -p $SHOTDIR"
# 造两张内容不同的图（同一屏连续 screencap 得到的是同一份字节，会被 sha1 判重）
"$PY" - <<'PYSHOT'
from PIL import Image, ImageDraw
for i in (1, 2):
    im = Image.new('RGB', (360, 640), (250, 250, 252))
    d = ImageDraw.Draw(im)
    d.rectangle([20, 20, 340, 120], fill=(47, 107, 255))
    d.text((40, 60), 'ENOTE TEST SHOT %d' % i, fill=(255, 255, 255))
    d.text((40, 200), '3月15日 下午三点 产品评审', fill=(30, 40, 60))
    d.text((40, 240), '记得带原型和报价单', fill=(30, 40, 60))
    im.save('/data/data/com.termux/files/home/eNote/.test/shot-t%d.png' % i)
PYSHOT
for i in 1 2; do
  asroot_global "cp /data/data/com.termux/files/home/eNote/.test/shot-t$i.png $SHOTDIR/t$i.png"
  asroot_global "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://$SHOTDIR/t$i.png" >/dev/null 2>&1
done
sleep 3

shot_scan() {  # shot_scan <rangeDays>
  am_start "$ACTIVITY" "--es hook shotscan --es arg '{\"folders\":[\"Pictures/enote-test\"],\"rangeDays\":$1}'"
  sleep 6
  newtlog | grep 'hook shotscan' | tail -1
}

# 1) 第一次扫：两张都该进暂存区
shot_scan 1 | "$PY" -c '
import json,sys
line = sys.stdin.read().strip()
assert "hook shotscan:" in line, "hook 没输出: " + line
d = json.loads(line.split("hook shotscan:",1)[1])
assert d.get("granted"), "媒体权限没授上: %s" % d
assert d.get("added", 0) >= 2, "两张都应该进暂存区: %s" % d
print("  ok (扫描到 %d 张新截图)" % d["added"])
' || fail "截图扫描没有收到新图"

api_get shots/list | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d.get("ok"), d
names = [x["name"] for x in d["shots"]]
assert "t1.png" in names and "t2.png" in names, names
assert d["bytes"] > 0, "占用该是正数"
print("  ok (暂存区 %d 张 / %d 字节)" % (d["total"], d["bytes"]))
' || fail "截图暂存区内容不对"

# 2) 合并成一条笔记：1 条笔记 + 2 个附件（OCR 在 Java 侧，这里走 hook）
SHOTS=$(api_get shots/list | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
print(json.dumps({"mode":"merge","raw":True,
                  "shots":[{"path":x["path"],"name":x["name"],"mime":"image/png"}
                           for x in d["shots"] if x["name"] in ("t1.png","t2.png")]}))
')
am_start "$ACTIVITY" "--es hook shotimport --es arg '$SHOTS'"
sleep 8
newtlog | grep 'hook shotimport' | tail -1 | grep -q '"notes":1' || fail "合并导入没有生成 1 条笔记"
api_get state | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
ns = [n for n in (d.get("notes") or []) if n.get("source") == "shot-merge"]
assert ns, "没找到 shot-merge 笔记"
n = ns[0]
assert len(n.get("attachments") or []) == 2, "合并笔记该有 2 个附件: %s" % n.get("attachments")
print("  ok (合并成 1 条笔记，%d 个附件，标题 %r)" % (len(n["attachments"]), n["title"][:24]))
' || fail "合并导入的附件数不对"

# 3) 各存一条：2 条笔记各 1 个附件
SHOTS=$(api_get shots/list | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
print(json.dumps({"mode":"split","raw":True,
                  "shots":[{"path":x["path"],"name":x["name"],"mime":"image/png"}
                           for x in d["shots"] if x["name"] in ("t1.png","t2.png")]}))
')
am_start "$ACTIVITY" "--es hook shotimport --es arg '$SHOTS'"
sleep 10
newtlog | grep 'hook shotimport' | tail -1 | grep -q '"notes":2' || fail "各存一条没有生成 2 条笔记"
api_get state | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
ns = [n for n in (d.get("notes") or []) if n.get("source") == "shot-single"]
assert len(ns) >= 2, "该有 2 条 shot-single: %d" % len(ns)
assert all(len(n.get("attachments") or []) == 1 for n in ns), "每条只该挂 1 个附件"
print("  ok (各存一条：%d 条笔记，每条 1 个附件)" % len(ns))
' || fail "各存一条的结果不对"

# 4) 幂等：同一区间再扫一次不能重复收
shot_scan 1 | "$PY" -c '
import json,sys
d = json.loads(sys.stdin.read().split("hook shotscan:",1)[1])
assert d.get("added", 0) == 0, "重复扫描不该再收: %s" % d
print("  ok (重复扫描 0 条，sha1 去重在起作用)")
' || fail "截图扫描不幂等"

# 5) 忽略：彻底不再提醒
ID=$(api_get shots/list | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
ids = [x["id"] for x in d["shots"] if x["name"] == "t1.png"]
print(ids[0] if ids else "")
')
if [ -n "$ID" ]; then
  api_post shots/ignore "{\"ids\":[\"$ID\"]}" >/dev/null
  api_get shots/list | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert not [x for x in d["shots"] if x["name"] == "t1.png"], "忽略后还在暂存区里"
print("  ok (忽略后从暂存区消失)")
' || fail "忽略没有生效"
fi

# 6) 清理：测试图、测试笔记、暂存区、文件夹配置
asroot_global "rm -rf $SHOTDIR"
asroot_global "rm -f /sdcard/Pictures/Screenshots/enote-t*.png"
api_get shots/list | "$PY" -c '
import json,sys,urllib.request
d = json.load(sys.stdin)
ids = [x["id"] for x in d["shots"]]
if ids:
    req = urllib.request.Request("http://127.0.0.1:%s/api/shots/remove" % sys.argv[1],
        data = json.dumps({"ids": ids}).encode(), headers={"Content-Type":"application/json"})
    urllib.request.urlopen(req).read()
print("  ok (清空暂存区 %d 张)" % len(ids))
' "$PORT" >/dev/null 2>&1 || true
api_get state | "$PY" -c '
import json,sys,urllib.request
d = json.load(sys.stdin)
bad = [n for n in (d.get("notes") or []) if (n.get("source") or "").startswith("shot-")]
for n in bad:
    req = urllib.request.Request("http://127.0.0.1:%s/api/delete" % sys.argv[1],
        data = json.dumps({"id": n["id"]}).encode(), headers={"Content-Type":"application/json"})
    urllib.request.urlopen(req).read()
print("  ok (删掉 %d 条测试笔记)" % len(bad))
' "$PORT" || true
am_start "$ACTIVITY" "--es hook shotfolders --es arg '{\"enabled\":false,\"folders\":[]}'" >/dev/null 2>&1
sleep 2

step "前端没有运行时报错（未声明的变量会把点击静默吞掉）"
if newtlog | grep -q 'SELFCHECK FAIL'; then
  newtlog | grep 'SELFCHECK FAIL' | tail -2 | sed 's/^/  /'
  fail "前端启动自检失败（上面的函数抛异常了）"
fi
if newtlog | grep -q 'web console: Uncaught'; then
  newtlog | grep 'web console: Uncaught' | tail -3 | sed 's/^/  /'
  fail "前端抛了未捕获异常：对应的按钮点了不会有反应"
fi
say "  ok (自检通过，没有 Uncaught)"

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
