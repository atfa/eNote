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
#   ./test.sh --no-reset     keep the data on the device (default: reset to a known baseline)
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
    --no-reset) RESET=0 ;;
  esac
done
SKIP_BUILD=${SKIP_BUILD:-0}
CLEAN=${CLEAN:-0}
VD=${VD:-0}
RESET=${RESET:-1}

have_root || {
  say "SKIP: test.sh needs root to start activities and read app data."
  say "      build + install still work: ./build.sh && ./install.sh"
  exit 3
}

# OCR 用例要一张含中文的图。以前它是某台机器上手工放的文件，没进 git：
# 新设备 / 新 worktree 上 test.sh 直接 die 在第 43 行，1000 行验收一行都跑不到。
# 现在图进仓库（.test/ocr-test.png，由 tools/crop_png.py 从 docs/shots 裁出来），
# 丢了就现场重造，不再依赖某台机器的本地文件。
if [ ! -f "$IMG" ] && [ -f "$HERE/docs/shots/p12-missed-ops.png" ]; then
  say "regenerating $IMG"
  "$PY" "$HERE/tools/crop_png.py" "$HERE/docs/shots/p12-missed-ops.png" "$IMG" 120 280 840 660 \
    || die "cannot regenerate $IMG"
fi
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
  # ShareActivity 不带 --display：它要在目标屏上开新任务，而 root 在虚拟屏上开新任务会被
  # SafeActivityOptions 拒掉（SecurityException: Permission Denial ... with launchDisplayId=N）。
  # MainActivity 能“成功”是因为它已经在屏上，intent 直接投递给现有实例，没走 display 启动。
  # 分享入口是 headless 的（处完就 finish），落哪块屏不影响断言，断言读的是 API 和日志。
  case "$comp" in
    *.ShareActivity) asroot "am start -n '$comp' $*" >/dev/null; return ;;
  esac
  if [ -n "$VDID" ]; then
    # display id 会在跑测途中换号：vd daemon 重启后 id 递增，而 VDID 是开跑时抓的。
    # 旧 id 上 am start 报 Permission Denial 并退 255（症状：整条验收在 P6.5 红）。
    # 拿 dumpsys 里的真 id 重试一次，顺手把 VDID 更新掉，后面所有步骤跟着新 id。
    out=$(asroot "am start --display $VDID -n '$comp' $*" 2>&1) || true
    case "$out" in
      "*ermission*enial*"|"*does not exist*"|"*Invalid display*")
        live=$(sh "$HERE/vd.sh" id 2>/dev/null | tr -dc '0-9')
        if [ -n "$live" ] && [ "$live" != "$VDID" ]; then
          say "  display id $VDID 已失效，改用 $live"
          VDID=$live
          asroot "am start --display $VDID -n '$comp' $*" >/dev/null
        else
          printf '%s\n' "$out"
          die "am start 在 display $VDID 上起不来（sh vd.sh status 看 daemon）"
        fi ;;
    esac
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

# api_state: 带重试的 /api/state。上游大模型卡住时服务端偶尔回空/非 JSON，
# 直接 pipe 给 python 会抛 traceback 把整轮测试打断（踩过）。
api_state() {
  n=0
  while [ "$n" -lt 15 ]; do
    s=$(api_get state 10)
    if printf '%s' "$s" | "$PY" -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
      printf '%s' "$s"
      return 0
    fi
    sleep 1; n=$((n + 1))
  done
  printf '{}'
  return 1
}

# wait_parse_idle：等解析队列排空（笔记全部进 done/raw/error 终态）。
# LLM 解析是异步的：status 从 queued→parsing→done 这条链上，n.Todos 是整体替换。
# 断言「服务端过滤条件生效」时如果还有笔记在解析，返回集里就会出现 status 不是 done 的
# 笔记，红字写成「src/status filters are ignored」，实际是状态在飞（实测 suite 里红过
# 一次，同树第二次绿；探针里全绿，因为探针跑的时候没有解析在飞）。
# 上限 60s：这台机器上图片 OCR + LLM 解析实测过 21.6s。
wait_parse_idle() {
  n=0
  while [ "$n" -lt 60 ]; do
    busy=$(api_state | "$PY" -c 'import json,sys
ns = json.load(sys.stdin).get("notes") or []
print(1 if any(x.get("status") not in ("done", "raw", "error") for x in ns) else 0)' 2>/dev/null || echo 1)
    [ "$busy" = "0" ] && return 0
    n=$((n + 1)); sleep 1
  done
  say "  (warn) 解析队列 60s 没排空，后面的过滤断言可能假红"
  return 0
}

api_get() {   # <path> [timeout]：GET 是幂等的，所以可以多试
  # app 被系统杀掉重启时 Go 服务会换端口、有几秒不可用（实测在 todo 用例里拿到空响应，
  # 然在 python 里变成 JSONDecodeError，看不出是“服务还没起来”）。
  # 每次重试都重读日志里的端口；只重试 GET，POST 有副作用（会重复建笔记）。
  r=""
  i=0
  while [ $i -lt 8 ]; do
    r=$(curl -s -m "${2:-30}" "http://127.0.0.1:$PORT/api/$1")
    [ -n "$r" ] && { printf '%s' "$r"; return 0; }
    np=$(readlog | grep -o '127.0.0.1:[0-9]*' | tail -1 | cut -d: -f2)
    [ -n "$np" ] && [ "$np" != "$PORT" ] && PORT=$np
    i=$((i+1)); sleep 2
  done
  printf '%s' "$r"
  return 1
}
api_post() { curl -s -m "${3:-120}" -X POST "http://127.0.0.1:$PORT/api/$1" -d "$2"; }
# raw_get <path>: not every route lives under /api (the attachment viewer is /file).
raw_get()  { curl -s -m "${2:-30}" "http://127.0.0.1:$PORT/$1"; }

# logcat_has <pattern>: the app logs with Log.i("enote", ...); logcat needs root on this ROM.
logcat_has() { asroot "logcat -d -s enote:V" 2>/dev/null | grep -q "$1"; }

# wait_note <python predicate on the note dict> <seconds> <label>
wait_note() {
  n=0
  while [ "$n" -lt "$2" ]; do
    ok=$(api_state | "$PY" -c '
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
# 设备是共享的（两个 worktree 轮流装），日志里必须能证明「这次跑的是谁的树」：
# 被对方 force-stop / 重装时，事后争「你装的是你那版」没有证据。sha256 + HEAD + 分支三样一起打。
say "  apk sha256=$(sha256sum "$APK" 2>/dev/null | cut -c1-16)  head=$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null)  branch=$(git -C "$HERE" rev-parse --abbrev-ref HEAD 2>/dev/null)  build=$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1]))["sha"]+"@"+json.load(open(sys.argv[1]))["builtAt"])' "$HERE/go/ui/build.json" 2>/dev/null || echo 无)"
asroot "am force-stop '$APP_PACKAGE'" >/dev/null 2>&1 || true
asroot "pm install -g '$APK'" >/dev/null || die "pm install failed"
if [ "$RESET" = 1 ]; then
  # 截图相关的三张表是跨轮状态：shot.json 是暂存记录 +「永远别再提醒」表，shotseen.json 是
  # 「已扫过」表，inbox/ 是暂存图。上一轮忽略过 one-shot.png，这一轮扫描就直接跳过它，
  # P11 的用例必红（plan.md §9.4 记的累积状态）。app 只在启动时读这三样，所以必须赶在
  # am_start 之前删——启动后再删，内存里的旧表会被写回来。
  asroot "rm -rf '$DATA/enote/shot.json' '$DATA/enote/shotseen.json' '$DATA/enote/inbox'" >/dev/null 2>&1 || true
fi
if [ "$VD" = 1 ]; then
  say "  on background display $VDID"
else
  asroot "input keyevent KEYCODE_WAKEUP" >/dev/null 2>&1 || true
  asroot "svc power stayon true" >/dev/null 2>&1 || true
fi
am_start "$ACTIVITY"
waitfor 'http server on' 40 || fail "the go http server never came up"
BASE=$(readtlog | wc -l)   # judge only what this run appends to the app log
BOOTS=$(readlog | grep -c 'appInit')   # app 进程重启过一次就 +1（用它区分环境问题和真回归）
newtlog() { readtlog | tail -n +$((BASE + 1)); }
PORT=$(readlog | grep -o '127.0.0.1:[0-9]*' | tail -1 | cut -d: -f2)
[ -n "$PORT" ] || fail "cannot find the api port in $GLOG"
say "  api: http://127.0.0.1:$PORT/"

# 跑前重置数据（D18）。设备上的累积状态会让计数类断言假红：上轮附件断言就是被
# 「一张截图被 23 条笔记复用」搞红的（plan.md §9.4）。pm clear 不可用——LLM 的
# base URL / key / 目标文件夹存在 app 私有 prefs 里，test.sh 全程不写它们，清了必红，
# 而且这是用户的真机。所以只清数据（notes.json / clip.json / shot.json），不碰 settings.json。
# 变量名注意：BASE 已被上面的日志行偏移占用（newtlog 用它做 tail -n +），这里一律用 BASELINE。
step "跑前重置数据（确定基线）"
if [ "$RESET" = 1 ]; then
  # 先把测试要用的配置抓下来（apiKey 服务端返回的是打码值，回传时服务端会忽略，
  # 所以用户的真 key 不会被覆盖），清完数据再原样写回，顺带把主题归一到 light——
  # 下面的 theme 用例断言默认值就是 light，用户手动调过暗色就会让那一歩假红。
  CFG0=$(api_state | "$PY" -c '
import json, sys
s = json.load(sys.stdin).get("settings") or {}
out = {k: s[k] for k in ("baseUrl", "model", "timeoutS", "maxTokens", "temperature", "useAI") if k in s}
out["theme"] = "light"
print(json.dumps(out))' 2>/dev/null) || CFG0=""
  api_post clear "" >/dev/null 2>&1 || true
  api_post clip/clear "" >/dev/null 2>&1 || true
  SHOTIDS=$(api_get shots/list | "$PY" -c 'import json,sys; print(json.dumps({"ids":[x["id"] for x in json.load(sys.stdin).get("shots") or []]}))' 2>/dev/null) || SHOTIDS=""
  case "$SHOTIDS" in ''|'{"ids":[]}') ;; *) api_post shots/remove "$SHOTIDS" >/dev/null 2>&1 || true ;; esac
  [ -n "$CFG0" ] && api_post settings "$CFG0" >/dev/null 2>&1

  BASELINE=$(api_state | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
notes = d.get("notes") or []
todos = sum(len(n.get("todos") or []) for n in notes)
info = d.get("info") or {}
s = d.get("settings") or {}
print("notes=%d todos=%d clip=%d theme=%s base=%s" % (
    len(notes), todos, info.get("clip", -1), s.get("theme", "?"),
    "yes" if s.get("baseUrl") else "no"))' 2>/dev/null) || BASELINE=""
  ATT=$(api_get attachments | "$PY" -c 'import json,sys; print(json.load(sys.stdin).get("total", -1))' 2>/dev/null) || ATT=-1
  SHOTS=$(api_get shots/list | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin).get("shots") or []))' 2>/dev/null) || SHOTS=-1
  say "  baseline: $BASELINE att=$ATT shots=$SHOTS"
  case "$BASELINE" in
    "notes=0 todos=0 clip=0 theme=light base=yes") ;;
    *) fail "重置后基线不对（应为 notes=0 todos=0 clip=0 theme=light base=yes）：$BASELINE" ;;
  esac
  [ "$ATT" = 0 ] || fail "重置后附件数不是 0：$ATT"
  [ "$SHOTS" = 0 ] || fail "重置后截图暂存不是 0：$SHOTS"
else
  say "  --no-reset：设各数据不重置，计数类断言可能因累积状态假红"
fi

# upstream_down <source>: 该来源最新一条笔记是不是"AI 超时/断连"导致的 raw。
# 上游大模型偶发 500s 级超时是环境问题，不该把整套测试判红（但要吼一声，别静默）。
upstream_down() {
  api_state | "$PY" -c '
import json,sys
src = sys.argv[1]
d = json.load(sys.stdin)
for n in d.get("notes") or []:
    if n.get("source") == src:
        e = (n.get("error") or "").lower()
        bad = any(k in e for k in ("timeout","timed out","connection","abort","eof","tls","deadline"))
        print("1" if (n.get("status") == "raw" and bad) else "0")
        break
else:
    print("0")
' "$1"
}

# ai_step_unhappy <source> <失败信息>：等待 AI 结果没等到时，先分清是环境问题还是真回归。
#   * app 进程中途重启 → 队列丢了，跟解析逻辑无关
#   * 上游代理超时/断连 → 笔记停 raw 且 error 里写着 timeout（实测一次 515s 才报错）
ai_step_unhappy() {
  if [ "$(readlog | grep -c 'appInit')" != "$BOOTS" ]; then
    say "  skip（app 在等待期间重启过，队列丢了；不是解析逻辑的问题）"
    return 0
  fi
  if [ "$(upstream_down "$1")" = "1" ]; then
    say "  skip（上游大模型超时/断连，笔记按原文保留）"
    return 0
  fi
  return 1
}

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
NEWTEXT="";   # 上游超时时置 1，跳过对本条内容的断言
BEFORE=$(api_state | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin)["notes"]))')
MARK="测试$$"
am_start "$APP_PACKAGE/.ShareActivity" "-a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '买牛奶和鸡蛋；周五下班后取快递；晚上8点开周会'$MARK"
sleep 2
if [ "$(api_state | "$PY" -c "import json,sys; print(len(json.load(sys.stdin)['notes']) > $BEFORE)")" != "True" ]; then
  fail "the shared text never reached the store"
fi
if need_ai "这条用例断言的是 AI 解析出的标题和待办"; then
  if ! wait_note "n['source']=='share-text' and n['status']=='done' and '$MARK' in n['rawText']" 120; then
    ai_step_unhappy share-text "the shared text note was never parsed" \
      || fail "the shared text note was never parsed"
    NEWTEXT=1
  fi
  if [ -z "$NEWTEXT" ]; then
  printf '%s' "$LAST" | "$PY" -c '
import json,sys
n = json.load(sys.stdin)
assert n["todos"], "no todos extracted"
assert any(t["due"] for t in n["todos"]), "no todo has a due time"
print("  title: %s | %d todos, first due %s" % (n["title"], len(n["todos"]),
      [t["due"] for t in n["todos"] if t["due"]][0]))
' || fail "the shared text note looks wrong"
  fi
else
  # 没有可用 AI 时笔记停在 raw（原文保留），这也是正确行为
  wait_note "n['source']=='share-text' and '$MARK' in n['rawText'] and n['status'] in ('done','raw','error')" 60 \
    || fail "the shared text never got stored"
fi

step "share image -> local ocr -> note"
NEWTEXT=""
UID_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
BEFORE_ID=$(api_state | "$PY" -c 'import json,sys; print(max(n["id"] for n in json.load(sys.stdin)["notes"]))')
asroot_global "mkdir -p '$EXT' && cp '$IMG' '$EXT/ocr-test.png' && chown '$UID_APP:$UID_APP' '$EXT/ocr-test.png' && chmod 644 '$EXT/ocr-test.png'" \
  || fail "cannot stage the test image in $EXT"
am_start "$APP_PACKAGE/.ShareActivity" "-a android.intent.action.SEND -t 'image/*' --eu android.intent.extra.STREAM file://$EXT/ocr-test.png"
sleep 2
if need_ai "这条用例断言的是 OCR 结果再交给 AI 的标题和待办"; then
  if ! wait_note "n['source']=='share-image' and n['status']=='done' and n.get('ocrMs',0)>0 and n['id']>'$BEFORE_ID'" 150; then
    ai_step_unhappy share-image "the shared image never came back from ocr + llm" \
      || fail "the shared image never came back from ocr + llm"
    NEWTEXT=1
  fi
  if [ -z "$NEWTEXT" ]; then
  printf '%s' "$LAST" | "$PY" -c '
import json,sys
n = json.load(sys.stdin)
assert len(n.get("ocrText","")) >= 10, "ocr text too short"
assert n["todos"], "no todos extracted from the image"
print("  ocr %d chars in %sms, llm %sms, title: %s" % (
    len(n["ocrText"]), n["ocrMs"], n.get("aiMs"), n["title"]))
' || fail "the shared image note looks wrong"
  fi
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
NOTE=$(api_state | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["notes"][0]["id"])')
TID=$(api_post todo "{\"action\":\"add\",\"noteId\":\"$NOTE\",\"text\":\"测试待办\",\"due\":\"2026-12-01T09:00\",\"priority\":\"high\"}" \
      | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print(d["id"] if d["ok"] else "")')
[ -n "$TID" ] || fail "todo add failed"
api_post todo "{\"action\":\"toggle\",\"noteId\":\"$NOTE\",\"todoId\":\"$TID\"}" | grep -q '"ok":true' || fail "todo toggle failed"
api_state | "$PY" -c "
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

step "settings round-trip (api key 明文返回、保存后不丢)"
# key 明文存在 app 私有目录（用户明确说不在意明文），设置页打开就能看到真 key；
# 这条验的是"读回来 == 存进去"，不能再打码（打码会让人以为没存住、反复重填）。
api_state | "$PY" -c '
import json,sys
print(json.dumps(json.load(sys.stdin)["settings"]))
' > "$TMPDIR/set.json" || fail "cannot read the settings"
api_post settings "$(cat "$TMPDIR/set.json")" >/dev/null
api_state | "$PY" -c '
import json,sys
s = json.load(sys.stdin)["settings"]
assert s["useAI"] is True and s["model"], s
assert s["baseUrl"].startswith("http"), s["baseUrl"]
assert s["temperature"] == 0.2, "部分字段 POST 不该动 temperature: %s" % s["temperature"]
' || fail "settings did not survive the round trip"
if need_ai "key 往返这条要真有 key 才成立"; then
  KEY0=$(api_state | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["settings"]["apiKey"])')
  [ -n "$KEY0" ] || fail "server returned no api key"
  api_state | "$PY" -c '
import json,sys
s = json.load(sys.stdin)["settings"]
assert s["apiKey"] and "…" not in s["apiKey"], "设置页应该看到明文 key（不打码）: %r" % s["apiKey"]
print(json.dumps(s))
' > "$TMPDIR/set.json" || fail "the key is still masked"
  api_post settings "$(cat "$TMPDIR/set.json")" >/dev/null
  KEY1=$(api_state | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["settings"]["apiKey"])')
  [ "$KEY1" = "$KEY0" ] || fail "保存设置后 key 变了（$KEY0 -> $KEY1）"
  api_post llm/test "" | grep -q '"ok":true' || fail "保存设置后 llm 不可用了"
fi
say "  ok"

step "theme (light default, switch, java sync)"
api_state | "$PY" -c '
import json,sys
s = json.load(sys.stdin)["settings"]
assert s.get("theme") in ("light","dark","auto"), "no theme in settings: %r" % s.get("theme")
' || fail "settings.theme missing"
api_post theme '{"mode":"dark"}' | "$PY" -c 'import json,sys; d=json.load(sys.stdin); assert d["ok"] and d["theme"]=="dark", d' \
  || fail "cannot switch to dark"
api_state | "$PY" -c 'import json,sys; assert json.load(sys.stdin)["settings"]["theme"]=="dark"' \
  || fail "dark theme did not stick"
sleep 3   # the UI polls /api/state and calls Android.setTheme
logcat_has "js setTheme" || fail "the webview never told java about the theme"
api_post theme '{"mode":"light"}' >/dev/null
api_state | "$PY" -c 'import json,sys; assert json.load(sys.stdin)["settings"]["theme"]=="light"' \
  || fail "light theme did not stick"
say "  ok (light is the default, java stays in sync)"

step "search + per-page prefs (server side, R3)"
# 上面图片 OCR 那步的解析可能还在飞（实测 21.6s），不等排空就是「filters are ignored」假红
wait_parse_idle
api_get "search?tab=notes" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["ok"] and d["notes"] and d["scanned"] >= len(d["notes"]), d
' || fail "plain search returns nothing"
# q 用「取快递」：它同时出现在分享的文本里和 OCR 出来的图片文字里，
# 所以断言"命中来自图片文字"才有意义（图片 fixture 见 .test/ocr-test.png，
# 由 tools/crop_png.py 从 docs/shots 裁出来，换图就要同步这里的关键词）。
api_get "search?tab=notes&q=%E5%8F%96%E5%BF%AB%E9%80%92" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d["ok"] and d["total"] >= 1, "q=取快递 matched nothing"
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
api_state | "$PY" -c '
import json,sys
u = json.load(sys.stdin)["settings"]["ui"]
assert u["notes"]["sort"]=="title" and u["notes"]["filters"]["src"]=="text", u
' || fail "per-page conditions do not persist"
api_post prefs '{"tab":"notes","q":"","sort":"new","filters":{}}' >/dev/null
api_post prefs '{"tab":"todos","q":"","sort":"due","filters":{"done":"open"}}' >/dev/null
say "  ok (ocr text is searchable, every page keeps its own conditions)"

step "attachments: share a file, list it, delete it (R4)"
EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
UID_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
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
# diskFiles 是扫目录得到的**不同文件数**，files 是附件行数。两者可以不相等：
# 一张截图先进过「各存一条」又被合并进另一条笔记，就是两行共用同一个文件。
# 断言写成 rows ≤ 文件数会在数据积累后假红（实测 19 行 / 17 个文件）。
paths = {a['path'] for a in d['items']}
assert d['diskFiles'] >= len(paths), 'files on disk < 附件引用的不同路径: %s < %s' % (d['diskFiles'], len(paths))
print('  listed %d attachments (%d distinct files), %s on disk, %s' % (d['total'], len(paths), d['diskFiles'], a['name']))
" || fail "附件列表断言失败（共享文件的计数见上方 python 输出）"
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

step "ui: 静态闸门（轮询指纹 / 内联 handler 存在性 / 调色板一致性 / hex·px 棘轮）"
# P12 那类「点了没反应」在真机上测不出来：onclick 里调一个不存在的函数，页面不报错、
# 端到端全绿。只能静态抓，所以放在这里，是必跑项。
# 步骤 11：原来分两步跑 ui_sig_test.js（轮询指纹）与 ui_test.js（结构闸门）。步骤 11 把
# 签名那 84 项并进 ui_test.js（它要读的源码文件与结构闸门完全一样），两步合成一步。
if command -v node >/dev/null 2>&1; then
  node "$HERE/tools/ui_test.js" | sed 's/^/  /' || fail "界面静态闸门失败"
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

step "P6.6 删光剪贴板后首页横幅立刻消失（用户反馈：返回主页还提示有暂存）"
# 真因在前端：refresh → searchNow 在「搜索结果没变」时直接 return，而横幅不在搜索结果里，
# 所以条数变了页面也不重绘。删光剪贴板是最容易复现的一条路径。
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
# 先把系统剪贴板清空（clipset ' ' → Go 侧 TrimSpace 后为空 → clipAdd 直接拒），再删暂存。
# 不清的话：/api/clip/clear 之后 app 的前台轮询会立刻把剪贴板上那条旧文本重新暂存，
# 断言 count==0 就变成和轮询赛跑（物理屏上侥幸过，--vd 上真的红）。
# 这条用例测的是“删光后横幅立刻消失”，不是“和剪贴板轮询赛跑”。
am_start "$ACTIVITY" "--es hook clipset --es arg ' '"
sleep 2
cat > "$TMPDIR/jseval.sh" <<'EOS'
#!/bin/sh
am start -n dev.xduo.enote/.MainActivity --es hook jseval --es arg "$(cat "$1")" >/dev/null
EOS

# 记录设备 WebView 版本。go/ui/vendor/VENDOR.md 把语言基线 pin 在 ES2020（Chrome 80），
# 这条日志是唯一能证明“这台机器的 WebView 跑得动我们写的语法”的证据；
# 升级后整页白屏的话先看这里，再看代码。
N0UA=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' \
  'console.log("JSEVAL ua="+navigator.userAgent); console.log("JSEVAL uadone=1")' > "$TMPDIR/jsua.json"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsua.json'"
n=0
while [ "$n" -lt 20 ]; do
  readtlog | tail -n +$((N0UA + 1)) | grep -q 'JSEVAL uadone=1' && break
  sleep 1; n=$((n + 1))
done
readtlog | tail -n +$((N0UA + 1)) | grep 'JSEVAL ua=' | tail -1 | sed 's/.*JSEVAL ua=//' > "$TMPDIR/webview.ua"
if [ -s "$TMPDIR/webview.ua" ]; then
  say "  webview ua: $(cat "$TMPDIR/webview.ua")"
else
  say "  warn: 没拿到 WebView UA（不判红，但 VENDOR.md 的 ES2020 基线就没法核对）"
fi

# 运行时防线（D12/D21）：静态闸门能证明源码里写了导出表，证明不了它在真机 WebView 里活着。
# module 加载失败（MIME / 语法 / 老 WebView 不认 module）时页面白屏，而第一个碰到 app 符号
# 的载荷才炸——症状就是「P6.6 静默 exit 1」（实测：静态 13 闸门 + 签名 84 全绿，载荷输出全空）。
# 三个哨兵（Austin + Tony 各自要求）：
#   1) key 名单与 app.js 里的导出表**逐项相等**（名单从 app.js 现取，不重复钉数字，两边不会漂移）
#   2) typeof window.delNote === "function"：P12 那一类「点了没反应」的直接证据
#   3) module 作用域隔离真的生效：`window.open` 是原生函数（function），而 app 的 `var open = {}`
#      只能从状态桥拿到（`__enote.state.open` 是 object）。这正是 Tony 发现的那个陷阱：非 module
#      树上 `var open` 把原生 `window.open` 盖掉了，载荷里裸 `open` 拿到 app 的对象；module 化后
#      裸 `open` 变成原生函数，`Object.keys(open).length` **恒为 0 不抛异常**，`jumped=` 断言
#      静默变假。所以载荷里一律走 `__enote.state.open`，这里把两边各钉一个断言。
N0B=$(readtlog | wc -l)
EXPECT_KEYS=$(node -e 'const s=require("fs").readFileSync("go/ui/js/app.js","utf8");const m=/window\.__enoteActions = \{([\s\S]*?)\n\};/.exec(s);if(!m)process.exit(1);console.log(m[1].split(",").map(x=>x.trim()).filter(Boolean).sort().join(","))') \
  || fail "导出表扫不出来（app.js 里找不到 window.__enoteActions = { … };）"
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' \
  '(function(){var A=(typeof __enote==="object"&&__enote.actions)?Object.keys(__enote.actions):[];var ST=(typeof __enote==="object"&&__enote.state)?__enote.state:{};console.log("JSEVAL bridge enote="+(typeof __enote)+" n="+A.length+" delNote="+(typeof window.delNote)+" winopen="+(typeof window.open)+" openmap="+(typeof ST.open)+" state="+(typeof (__enote&&__enote.state))+" tabtype="+(typeof (__enote&&__enote.state?__enote.state.tab:"NA")));console.log("JSEVAL bridgekeys "+A.sort().join(",")+" bdone=1")})()' > "$TMPDIR/jsbridge.json"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsbridge.json'"
n=0
while [ "$n" -lt 20 ]; do
  readtlog | tail -n +$((N0B + 1)) | grep -q 'JSEVAL bdone=1' && break
  sleep 1; n=$((n + 1))
done
readtlog | tail -n +$((N0B + 1)) | grep 'JSEVAL bridge' | tail -2 \
  | EXPECT_KEYS="$EXPECT_KEYS" "$PY" -c '
import os, sys
lines = sys.stdin.read().splitlines()
flag = [l for l in lines if "JSEVAL bridge " in l]
keyl = [l for l in lines if "JSEVAL bridgekeys " in l]
if not flag or not keyl:
    sys.exit("运行时桥检查载荷没跑起来（页面没加载？）")
d = dict(kv.split("=", 1) for kv in
         keyl[0].split("JSEVAL bridgekeys ", 1)[1].split() +
         flag[0].split("JSEVAL bridge ", 1)[1].split() if "=" in kv)
assert d.get("enote") == "object", "window.__enote 不存在：app.js 这个 module 没加载（白屏）"
assert d.get("state") == "object" and d.get("tabtype") == "string", "状态桥没接上：%s" % d
assert d.get("delNote") == "function", "window.delNote 不是函数：Object.assign 没跑（70 个 handler 全废）"
assert d.get("winopen") == "function", "window.open 是 %s：module 顶层的 var open 不该往 window 上挂东西" % d.get("winopen")
assert d.get("openmap") == "object", "__enote.state.open 是 %s 不是 object：载荷里裸 open 会拿到原生函数，Object.keys(open) 恒为 0" % d.get("openmap")
got = keyl[0].split("JSEVAL bridgekeys ", 1)[1].split()[0].split(",")
want = os.environ["EXPECT_KEYS"].split(",")
assert got == want, "运行时导出表与 app.js 不一致：缺 %s / 多 %s" % (
    sorted(set(want) - set(got))[:5], sorted(set(got) - set(want))[:5])
print("  ok 运行时导出表 %d key（与 app.js 逐项相等）+ 状态桥活着" % len(got))
' || fail "运行时导出表/状态桥检查失败"

# ---------- D17 测试缝：ready / build / dom / probe ----------
# 为什么单独一条载荷：ready 是 Promise，要 await；上面那条是同步的，不动它最稳。
# build.sha 是整条防线的重点：设备是共享的（两个 worktree 轮流装），光看日志对不上号。
# 拿 build.sh 写进 APK（//go:embed）的那份 sha 和页面里 __enote.build.sha 逐项比，
# 才能断言「WebView 里跑的就是刚装的这版」；no-store 失效 / 装完没重启都会立刻红。
# 这也替掉了以前 `typeof api === "function"` 那个脆弱哨兵：它连 module 没执行都看不出来。
EXPECT_SHA=$("$PY" -c 'import json,sys;print(json.load(open(sys.argv[1]))["sha"])' \
  "$HERE/go/ui/build.json" 2>/dev/null) \
  || fail "读不到 $HERE/go/ui/build.json：build.sh 没生成它？（D17 的凭据）"
N0S=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  var L=function(m){console.log("JSEVAL "+m)};
  var E=window.__enote||{};
  var t=Date.now(), r;
  if(!E.ready||!E.ready.then){ r="no-promise"; } else {
    try{
      await Promise.race([E.ready, new Promise(function(_,rej){setTimeout(function(){rej(new Error("ready-timeout"))},15000)})]);
      r="ok";
    }catch(e){ r="fail:"+((e&&e.message)||e) }
  }
  L("seam ready="+r+" ms="+(Date.now()-t));
  // build 由 app.js 里那个独立 fetch 填，跟 ready 没顺序保证（步骤 4，Tony 提的竞态）：
  // 现在不犯是因为 seam 载荷是在桥载荷轮询完几秒后才注入的。带超时 await 一下，把顺序钉死。
  var br="none";
  if(E.buildReady&&E.buildReady.then){
    try{
      await Promise.race([E.buildReady, new Promise(function(_,rej){setTimeout(function(){rej(new Error("build-timeout"))},5000)})]);
      br="ok";
    }catch(e){ br="timeout" }
  }
  L("seam buildready="+br);
  L("seam build="+(E.build&&E.build.sha||"none")+" builtAt="+(E.build&&E.build.builtAt||"none"));
  var d=E.dom||{};
  L("seam dom main="+(d.main?d.main.id+":"+d.main.tagName:"none")+" sheet="+(d.sheet?d.sheet.id+":"+d.sheet.tagName:"none")+" panel="+(d.panel?1:0)+" toast="+(d.toast?1:0)+" dlg="+(d.dlg?1:0));
  L("seam api="+(typeof E.api)+" markReady="+(typeof E.markReady));
  var pr=E.probe||{};
  L("seam probeok="+(typeof pr.ok==="boolean"?String(pr.ok):"none")+" missing="+(pr.missing&&pr.missing.length?pr.missing.join("|"):"none")+" moduleError="+(pr.moduleError?String(pr.moduleError).replace(/\s+/g,"_"):"none"));
  L("seam done=1");
})()' > "$TMPDIR/jsseam.json"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsseam.json'"
n=0
while [ "$n" -lt 30 ]; do
  readtlog | tail -n +$((N0S + 1)) | grep -q 'JSEVAL seam done=1' && break
  sleep 1; n=$((n + 1))
done
readtlog | tail -n +$((N0S + 1)) | grep 'JSEVAL seam' \
  | EXPECT_SHA="$EXPECT_SHA" "$PY" -c '
import os, sys
lines = [l for l in sys.stdin.read().splitlines() if "JSEVAL seam " in l]
if not lines:
    sys.exit("D17 测试缝载荷没跑起来（页面没加载？）")
want = os.environ["EXPECT_SHA"]
d = dict(kv.split("=", 1) for l in lines for kv in l.split("JSEVAL seam ", 1)[1].split() if "=" in kv)
assert d.get("ready") == "ok", "__enote.ready 没兑现（%s）：首屏没画出来，测试缝就是废的" % d.get("ready")
assert d.get("build") == want, "页面里跑的是 %s，刚装的是 %s：no-store 失效或装完没重启" % (d.get("build"), want)
assert d.get("buildready") == "ok", "__enote.buildReady 是 %s：build.json 的 fetch 没在 5s 内完成，那 E.build 就是上一版的残留" % d.get("buildready")
assert d.get("main") == "view:MAIN", "__enote.dom.main = %s，期望 view:MAIN" % d.get("main")
assert d.get("sheet") == "sheet:DIV", "__enote.dom.sheet = %s，期望 sheet:DIV" % d.get("sheet")
for k in ("panel", "toast", "dlg"):
    assert d.get(k) == "1", "__enote.dom.%s 拿不到" % k
assert d.get("api") == "function", "__enote.api 是 %s：api(path, body) 是测试的入口" % d.get("api")
assert d.get("probeok") == "true", "feature probe 报缺特性：%s" % d.get("missing")
assert d.get("missing") == "none", "feature probe 报缺特性：%s" % d.get("missing")
assert d.get("moduleError") == "none", "页面里有未捕获的解析/加载错误：%s" % d.get("moduleError")
print("  ok D17 测试缝：ready 兑现(%sms) build=%s dom 齐 probe 全绿" % (d.get("ms"), d.get("build")))
' || fail "D17 测试缝检查失败"

N0C=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  var L=function(m){console.log("JSEVAL "+m)},q=function(s){return document.querySelector(s)};
  var bt=function(){var b=q(".clipbanner");return b?b.textContent.replace(/\s+/g,""):"none"};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var wait=async function(want){ // 重绘要等 /api/search 回来（refresh 不 await searchNow），所以轮询
    var i=0;
    while(i<12){ await refresh(true); if(!!q(".clipbanner")===want) return i; await sleep(250); i++; }
    return i;
  };
  __enote.state.tab="notes";
  L("count0="+(await api("/api/state")).info.clip);
  L("tries0="+await wait(true));
  L("before="+bt());
  await api("/api/clip/clear",{});
  L("tries1="+await wait(false));
  L("after="+bt());
  L("count="+(await api("/api/state")).info.clip);
  L("done=1");
})()' > "$TMPDIR/jsclip.json"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsclip.json'"
n=0
while [ "$n" -lt 20 ]; do
  readtlog | tail -n +$((N0C + 1)) | grep -q 'JSEVAL done=1' && break
  sleep 1; n=$((n + 1))
done
readtlog | tail -n +$((N0C + 1)) | grep 'JSEVAL ' > "$TMPDIR/jsclip.out"
grep -q 'done=1' "$TMPDIR/jsclip.out" || fail "jseval 没跑完（剪贴板横幅用例）"
"$PY" - "$TMPDIR/jsclip.out" <<'PYCHK' || fail "删光剪贴板后首页横幅没消失"
import re, sys
txt = open(sys.argv[1], encoding="utf-8").read()
def val(k):
    m = re.search(r"JSEVAL " + k + r"=(.*)", txt)
    return m.group(1).strip() if m else ""
assert val("count0") not in ("", "0"), "删之前服务端就该有暂存条目: %r" % val("count0")
assert "剪贴板暂存" in val("before"), "删之前首页应该有剪贴板横幅: %r" % val("before")
assert "暂存" not in val("after"), "删光之后横幅还在: %r" % val("after")
assert val("count") == "0", "服务端条数没归零: %r" % val("count")
assert int(val("tries0")) < 11, "等了 3 秒横幅都没出现（tries0=%s）" % val("tries0")
assert int(val("tries1")) < 11, "删光之后等了 3 秒横幅还在（tries1=%s）" % val("tries1")
print("  ok (删光前「%s」→ 删光后「%s」)" % (val("before")[:18], val("after")))
PYCHK
asroot_global "rm -f '$DATA/enote/.devmode'"

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

step "P8.5 错过的提醒面板：能勾完成、能跳笔记、能「我知道了」（用户反馈三条）"
su --mount-master -c "echo -n '2020-01-01T00:00:00+08:00' > $DATA/enote/lastopen.txt"
# 面板用例点的是第二行（.msrow[1]）来验证「点整行跳笔记」，所以固定造 2 条已到点的待办。
# 以前它隐式依赖设施上恰好有 ≥2 条逾期项：重置数据后只剩 1 条，row[1] 不存在→没点击→
# jumped=0，用例假红（步骤 1 重置基线暴露出来的）。固定装置自己造，不碰设施历史数据。
MNOTE=$(api_state | "$PY" -c 'import json,sys; ns=json.load(sys.stdin)["notes"]; print(ns[0]["id"] if ns else "")')
[ -n "$MNOTE" ] || fail "P8.5 需要至少一条笔记做固定装置"
api_post todo "{\"action\":\"add\",\"noteId\":\"$MNOTE\",\"text\":\"面板固定装置 A\",\"due\":\"2020-01-02T10:00\"}" >/dev/null
api_post todo "{\"action\":\"add\",\"noteId\":\"$MNOTE\",\"text\":\"面板固定装置 B\",\"due\":\"2020-01-03T10:00\"}" >/dev/null
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
N0C=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  var L=function(m){console.log("JSEVAL "+m)},q=function(s){return document.querySelector(s)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var d=await api("/api/missed"); __enote.state.MISSED=d; __enote.state.S.missed=d; __enote.state.tab="notes"; await render(); missedSheet();
  L("count="+d.count);
  L("rows="+document.querySelectorAll(".msrow").length);
  L("cb="+document.querySelectorAll(".msrow .cb").length);
  L("foot="+((q("#sheet .pfoot")||{}).textContent||"").replace(/\s+/g,"").slice(0,40));
  // 点整行：关掉面板 + 跳到那条笔记（用户反馈：点了没反应，因为调了不存在的 goNote）
  var it1=((__enote.state.MISSED.items)||[])[1]||{}, it0=((__enote.state.MISSED.items)||[])[0]||{};
  var nid=it1.nid||"", tid=it0.id||"";
  var n0=Object.keys(__enote.state.open).length;
  var row=document.querySelectorAll(".msrow")[1];
  if(row) row.click();
  await sleep(500);
  L("jumped="+(Object.keys(__enote.state.open).length>n0?1:0)+" nid="+nid);
  L("sheet="+(q("#sheet")?q("#sheet").classList.contains("on"):false));
  missedSheet();
  // 勾 ✓：先出划线动画，动画跑完这条才从清单里消失（用户反馈：点了看不出结果）
  var first=document.querySelector(".msrow .cb");
  var n1=document.querySelectorAll(".msrow").length;
  if(first) first.click();
  await sleep(120);
  L("anim="+((q(".msrow")||{}).className||"none"));
  await sleep(1600);
  L("n1="+n1);L("rows2="+document.querySelectorAll(".msrow").length);L("tid="+tid);
  if(tid) await api("/api/todo",{action:"toggle",noteId:nid,todoId:tid});   // 还原，不动用户数据
  missedSheet();
  missedDismiss();
  await sleep(300);
  L("afterDismiss="+document.querySelectorAll(".missedb,.missedtop").length);
  L("done=1");
})()' > "$TMPDIR/jsmiss.json"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsmiss.json'"
n=0
while [ "$n" -lt 30 ]; do
  readtlog | tail -n +$((N0C + 1)) | grep -q 'JSEVAL done=1' && break
  sleep 1; n=$((n + 1))
done
readtlog | tail -n +$((N0C + 1)) | grep 'JSEVAL ' > "$TMPDIR/jsmiss.out"
grep -q 'done=1' "$TMPDIR/jsmiss.out" || fail "jseval 没跑完（错过的提醒面板用例）"
"$PY" - "$TMPDIR/jsmiss.out" <<'PYCHK' || fail "错过的提醒面板没修好"
import re, sys
txt = open(sys.argv[1], encoding="utf-8").read()
def val(k):
    m = re.search(r"JSEVAL " + k + r"=(.*)", txt)
    return m.group(1).strip().split(" ")[0] if m else ""
def raw(k):
    m = re.search(r"JSEVAL " + k + r"=(.*)", txt)
    return m.group(1).strip() if m else ""
assert int(val("count")) >= 1, "没有错过的提醒可测: %s" % val("count")
assert int(val("rows")) >= 1, "面板里没有行"
assert int(val("cb")) == int(val("rows")), "有行没有勾选框: cb=%s rows=%s" % (val("cb"), val("rows"))
assert "我知道了" in val("foot"), "底部没有「我知道了」: %r" % val("foot")
assert val("jumped") == "1", "点整行没跳到笔记（用户反馈：点了没反应）"
assert val("sheet") == "false", "跳笔记之后面板没关掉: %s" % val("sheet")
assert "justdone" in raw("anim"), "勾 ✓ 没有划线动画: %s" % raw("anim")
assert int(val("rows2")) == int(val("n1")) - 1, "勾完没从清单里消失: %s -> %s" % (val("n1"), val("rows2"))
assert val("afterDismiss") == "0", "「我知道了」之后横幅还在: %s" % val("afterDismiss")
print("  ok (错过 %s 条、点整行跳笔记、勾 ✓ 有划线动画后消失、「我知道了」清掉横幅)" % val("count"))
PYCHK
asroot_global "rm -f '$DATA/enote/.devmode'"

step "P11 相册监听已注册（截完图切回来就该看到横幅，不用退桌面重进）"
# Java 侧的 Log.i 只进 logcat，不进 Go 的 enote.log
su --mount-master -c "logcat -d -s enote" | grep -q '已监听相册变化' \
  || fail "相册监听没注册：新截图要等下次打开 app 才扫得到"
say "  ok (进程一起来就监听 MediaStore 变化，去抖 1.2s 后扫)"

step "P11 截图捕获：扫描 → 合并导入 → 各存一条 → 幂等 → 忽略"
SHOTDIR=/sdcard/Pictures/enote-test
# 这一步会造笔记，结束时只删自己造的：以前按 source=shot-* 批量删，
# 把用户自己导入的截图笔记也一起删了（真实踩过，删掉的是用户的内容）
NOTES0=$(api_state | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin)["notes"]))')
# 权限：直接用 root 授掉，跳过系统弹窗（真机上由用户点"去授权"）
asroot_global "pm grant $APP_PACKAGE android.permission.READ_MEDIA_IMAGES" >/dev/null 2>&1 || true
asroot_global "rm -rf $SHOTDIR; mkdir -p $SHOTDIR"
# MediaStore 的行不随 root 的 rm 消失（删文件不触发 MediaObserver），旧行的 date_added
# 还是上次跑的时间。扫描按 date_added 过滤（rangeDays=1），所以跑满 24h 之后这两张刚好
# 掉出窗口 → added=0 假红（步骤 10 验收跑第一次踩到，距上次绿跑 24h01m）。
# 删行让扫描重新登记，date_added 就是现在；扫描本身会重建行。
asroot_global "content delete --uri content://media/external/images/media --where \"_data LIKE '%Pictures/enote-test%'\"" >/dev/null 2>&1 || true
# 暂存区也要清：上次跑失败留下的 t1/t2 还躺在里面，「合并 2 张」会拿到 4 张附件（真红过）。
# 这一步必须可重跑，不然每次失败都要先手动清数据。
STALE=$(api_get shots/list | "$PY" -c 'import json,sys; print(json.dumps([x["id"] for x in json.load(sys.stdin)["shots"]]))')
[ "$STALE" != "[]" ] && api_post shots/remove "{\"ids\": $STALE}" >/dev/null
# 造两张内容不同的图。每张都掺一条随机噪点带：sha1 去重表会记住上次跑出来的字节，
# 图一样的话第二次跑就「新增 0 张」，测试会假红（这个坑踩过）。
# 用 tools/make_test_png.py 而不是 PIL：这台设备装不上 Pillow，原来整条用例会
# ModuleNotFoundError 红在最后一步。路径用 $HERE，以前写死主仓绝对路径，
# 在 worktree 里跑会把图写到主仓去。
for i in 1 2; do
  "$PY" "$HERE/tools/make_test_png.py" "$HERE/.test/shot-t$i.png" 360 640 \
    || fail "cannot generate the test shot"
done
for i in 1 2; do
  asroot_global "cp '$HERE/.test/shot-t$i.png' $SHOTDIR/t$i.png"
  asroot_global "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://$SHOTDIR/t$i.png" >/dev/null 2>&1
done
sleep 3

shot_scan() {  # shot_scan <rangeDays>
  # 以前是固定 sleep 6 再 grep。第二次扫（幂等那条）的日志行没在 6s 内落盘时，
  # tail -1 拿到的是第一次那行 added=2，测试就报「不幂等」——假红。
  # 现在轮询等新的 shotscan 行（最多 40s），超时也把它打出来，让断言去报错。
  SHOT_BEFORE=$(newtlog | grep -c 'hook shotscan')
  am_start "$ACTIVITY" "--es hook shotscan --es arg '{\"folders\":[\"Pictures/enote-test\"],\"rangeDays\":$1}'"
  SHOT_N=0
  while [ "$SHOT_N" -lt 40 ]; do
    SHOT_OUT=$(newtlog | grep 'hook shotscan' | tail -1)
    if [ "$(newtlog | grep -c 'hook shotscan')" -gt "$SHOT_BEFORE" ]; then
      printf '%s\n' "$SHOT_OUT"
      return 0
    fi
    sleep 1
    SHOT_N=$((SHOT_N + 1))
  done
  printf '%s\n' "$SHOT_OUT"
  return 1
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
# 2b 会把暂存清空，所以这里先把"要用的那两张"记下来给第 3 步复用
printf '%s' "$SHOTS" | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
print(json.dumps(d["shots"], ensure_ascii=False))
' > "$TMPDIR/shots2.json" 
am_start "$ACTIVITY" "--es hook shotimport --es arg '$SHOTS'"
sleep 8
newtlog | grep 'hook shotimport' | tail -1 | grep -q '"notes":1' || fail "合并导入没有生成 1 条笔记"
MERGE_IDS=$(newtlog | grep 'hook shotimport' | tail -1 | "$PY" -c '
import json,sys
print(" ".join(json.loads(sys.stdin.read().split("hook shotimport:",1)[1]).get("noteIds") or []))')
api_state | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
ns = [n for n in (d.get("notes") or []) if n.get("source") == "shot-merge"]
assert ns, "没找到 shot-merge 笔记"
n = ns[0]
assert len(n.get("attachments") or []) == 2, "合并笔记该有 2 个附件: %s" % n.get("attachments")
print("  ok (合并成 1 条笔记，%d 个附件，标题 %r)" % (len(n["attachments"]), n["title"][:24]))
' || fail "合并导入的附件数不对"

# 2b) 导入完成后界面会清理暂存（/api/shots/remove）——清理绝不能把刚变成附件的文件删掉，
#     否则笔记首页的缩略图全 404（这个 bug 真发生过：文件没了，记录还指着它）
IDS=$(api_get shots/list | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
print(json.dumps([x["id"] for x in d["shots"] if x["name"] in ("t1.png","t2.png")]))
')
api_post shots/remove "{\"ids\": $IDS}" | grep -q '"ok":true' || fail "清理暂存失败"
api_get attachments | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
assert d.get("missing", 0) == 0, "清理暂存把笔记在用的文件删了（缩略图会 404）: %s" % d
print("  ok (清理暂存后 %d 个附件文件都还在盘上)" % d["files"])
' || fail "清理暂存后附件文件不见了"
SID=$(api_state | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
print([n["id"] for n in d["notes"] if n.get("source") == "shot-merge"][0])
')
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 --noproxy '*' "http://127.0.0.1:$PORT/img?id=$SID")
[ "$CODE" = "200" ] || fail "笔记首页的缩略图取不到（/img 返回 $CODE）"
say "  ok (缩略图 /img 能取到字节)"

# 3) 各存一条：2 条笔记各 1 个附件
SHOTS=$(printf '{"mode":"split","raw":true,"shots":%s}' "$(cat "$TMPDIR/shots2.json")")
am_start "$ACTIVITY" "--es hook shotimport --es arg '$SHOTS'"
sleep 10
newtlog | grep 'hook shotimport' | tail -1 | grep -q '"notes":2' || fail "各存一条没有生成 2 条笔记"
SPLIT_IDS=$(newtlog | grep 'hook shotimport' | tail -1 | "$PY" -c '
import json,sys
print(" ".join(json.loads(sys.stdin.read().split("hook shotimport:",1)[1]).get("noteIds") or []))')
api_state | "$PY" -c '
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
# 只删这一步自己造的笔记（按 hook 返回的 noteIds），绝不按 source 批量删
api_state | "$PY" -c '
import json,sys,urllib.request
want = [x for x in sys.argv[2].split() if x]
d = json.load(sys.stdin)
have = {n["id"] for n in (d.get("notes") or [])}
for nid in want:
    if nid not in have:
        continue
    req = urllib.request.Request("http://127.0.0.1:%s/api/delete" % sys.argv[1],
        data = json.dumps({"id": nid}).encode(), headers={"Content-Type":"application/json"})
    urllib.request.urlopen(req).read()
print("  ok (删掉 %d 条本步骤造的测试笔记)" % len([x for x in want if x in have]))
' "$PORT" "$MERGE_IDS $SPLIT_IDS"
api_state | "$PY" -c "
import json,sys
n = len(json.load(sys.stdin)[\"notes\"])
assert n == $NOTES0, '这一步不该动到别的笔记: %d -> %d' % ($NOTES0, n)
" || fail "P11 清理动了用户的笔记（只该删本步骤自己造的）" "$PORT" || true
am_start "$ACTIVITY" "--es hook shotfolders --es arg '{\"enabled\":false,\"folders\":[]}'" >/dev/null 2>&1
sleep 2

step "P11 文件夹页：底部固定条 + 实时计数 + 已选在前 + 返回后刷新"
# 虚拟显示上的 input tap 很不稳，改用 hook jseval 在页面里跑断言脚本（比截图点按可靠）
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
cat > "$TMPDIR/jseval.sh" <<'EOS'
#!/bin/sh
am start -n dev.xduo.enote/.MainActivity --es hook jseval --es arg "$(cat "$1")" >/dev/null
EOS
N0T=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  // D13：render 的契约是 Promise，载荷是「渲染完立刻断言 DOM」，所以必须 await；
  // 包装得是 async function，否则 await 是 SyntaxError（整段载荷解析失败，JSEVAL token 集体消失）。
  var L=function(m){console.log("JSEVAL "+m)},q=function(s){return document.querySelector(s)};
  var rows=function(){return [].slice.call(document.querySelectorAll("#folderList .frow"))};
  var vis=function(){return rows().filter(function(r){return getComputedStyle(r).display!=="none"})};
  __enote.state.tab="mine"; await render(); folderSheet();
  // 步骤 8：Vue 弹层的 DOM 在 nextTick 之后才落地（遗留路径是同步 innerHTML）。
  // 不等这一拍，count0 读到的是空容器，q("#folderCount") 直接 null → 载荷抛异常。
  await new Promise(function(r){ setTimeout(r,400) });
  // 正向断言「真的走了 Vue 路径」：只看 DOM 分不出谁画的（Vue 的产出按设计就和字符串
  // 渲染器逐字一致），只靠 DOM 的话，VUE_SHEETS 注册了但分发没接上也是绿的。
  L("isvue="+(__enote.vue.isVueSheet("folders")?1:0));
  L("mounted="+(__enote.vue.sheets.folders?1:0));
  L("count0="+q("#folderCount").textContent.replace(/\s+/g," "));
  L("rows0="+rows().length);
  var first=rows()[0].getAttribute("data-path");
  L("first="+first);
  // folderPick 在 Vue 路径返回 sheetPaint() 的 Promise（遗留路径返回 undefined，await 两者都安全）
  await folderPick(first);
  var r2=rows(),seenUn=false,ok=true;
  r2.forEach(function(r){var on=r.classList.contains("on");if(!on)seenUn=true;else if(seenUn)ok=false;});
  L("count1="+q("#folderCount").textContent.replace(/\s+/g," "));
  L("firstAfter="+r2[0].getAttribute("data-path"));
  L("orderOK="+(ok?1:0));
  var panel=q("#sheet .panel");
  var maxS=panel.scrollHeight-panel.clientHeight;
  var setS=maxS>40?Math.round(maxS/2):0;
  L("scrollable="+(maxS>40?1:0));
  panel.scrollTop=setS;
  setTimeout(async function(){
    var f=q("#sheet .pfoot"),b=f.getBoundingClientRect();
    L("sticky="+getComputedStyle(f).position);
    L("footVisible="+((b.bottom<=window.innerHeight+2&&b.top>=0&&b.height>20)?1:0));
    // 勾选之后滚动位置不能跳：遗留路径靠「记住 scrollTop 再放回」，Vue 靠 v-for 的 :key
    // 原地移动节点。内容不够高（真机上往往只 3~5 个文件夹）时滚不动，那就只能记
    // scrollable=0：断言退化为「不报假红」，Python 侧会把 scrollable 打出来，空跑一眼可见。
    L("scrollKept="+((maxS<=40||Math.abs(panel.scrollTop-setS)<=4)?1:0));
    await folderPick(first);
    L("count2="+q("#folderCount").textContent.replace(/\s+/g," "));
    // 搜索框过滤：用第一行路径的最后一段当关键词，两条路径都必须只留下包含它的行
    var key=String(first).replace(/\/$/,"").split("/").pop();
    await folderFilter(key);
    var v=vis();
    L("fkey="+key);
    L("fshown="+v.length);
    L("fmatch="+(v.length&&v.every(function(r){return String(r.getAttribute("data-path")).toLowerCase().indexOf(key.toLowerCase())>=0})?1:0));
    await folderFilter("");
    L("funfiltered="+vis().length);
    // 真点一下 全选：上面全是直接调函数，而模板里的 H.xxx 要组件在 setup() 里返回 H 才能
    // 解析（Vue 把模板表达式编成 _ctx.H.xxx(...)），没返回时渲染期不碰它就不报错，
    // 点一下才抛 undefined —— 只有真点击能抓到（步骤 8 实测：截图页 全选 就这么死的）。
    var ab=q("#sheet #folderSelAll");
    L("allBtn="+(ab?ab.textContent:"?"));
    if(ab){ ab.click(); await new Promise(function(r){ setTimeout(r,300) });
      L("allSel="+document.querySelectorAll("#folderList .frow.on").length); }
    var nb=q("#sheet #folderSelNone");
    if(nb){ nb.click(); await new Promise(function(r){ setTimeout(r,300) });
      L("noneSel="+document.querySelectorAll("#folderList .frow.on").length); }
    // 恢复成测试开头那个目录选中，folderSave 写回后「我的」页计数才能对上
    await folderPick(first);
    // 滚动位置保持要真测到：真机上往往只 3~5 个文件夹，页面根本滚不动（上面的 scrollable=0）。
    // 用状态桥注 40 个假目录（folderAll/folderSel 走 setter，否则只写 window —— D21），
    // 滚到中间再勾一个：已选行浮到顶，scrollTop 必须原地不动。Vue 靠 v-for 的 :key 移动
    // 节点，遗留路径靠 folderRender 里的「记住 scrollTop 再放回」。
    var keepAll=__enote.state.folderAll, keepSel=__enote.state.folderSel;
    var fake=[];
    for(var i=0;i<40;i++) fake.push({path:"/sdcard/Fake/Dir"+i, count:i, shot:false, missing:false});
    __enote.state.folderAll=fake; __enote.state.folderSel={};
    __enote.vue.folderPaint();
    await new Promise(function(r){ setTimeout(r,250) });
    var p2=q("#sheet .panel"), max2=p2.scrollHeight-p2.clientHeight;
    L("fakescroll="+(max2>40?1:0));
    if(max2>40){
      p2.scrollTop=Math.round(max2/2);
      var want=p2.scrollTop;
      await folderPick("/sdcard/Fake/Dir7");
      // 容差一行高（~57px）：Chrome 的 scroll anchoring 会在「上方内容被移动」时主动
      // 调 scrollTop 让可见内容保持不动，于是 scrollTop 数值正好移动一行。遗留路径是
      // 「记住 scrollTop 再放回」，数值不动、可见内容跳一行。两者都不该发生的是
      // 「滚回顶部」（innerHTML 重建的旧病），那才是用户能感觉到的 bug。
      var d=Math.abs(p2.scrollTop-want);
      L("fakeDelta="+Math.round(d));
      L("fakeKept="+((d<=90&&p2.scrollTop>100)?1:0));
      L("fakeTop="+(rows()[0].getAttribute("data-path")==="/sdcard/Fake/Dir7"?1:0));
    }
    __enote.state.folderAll=keepAll; __enote.state.folderSel=keepSel;
    __enote.vue.folderPaint();
    await new Promise(function(r){ setTimeout(r,200) });
    folderSave();
    var tries=0,probe=function(){
      var p=document.querySelector(".pane[data-tab=mine]");
      var m=(p?p.textContent:"").match(/监控文件夹\s*\d+\s*个/);
      if(m||tries>10){L("mine="+(m?m[0].replace(/\s+/g,""):"?"));L("done=1");return}
      tries++; setTimeout(probe,400);
    };
    setTimeout(probe,400);
  },260);
})()' > "$TMPDIR/js.json"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/js.json'"
n=0
while [ "$n" -lt 20 ]; do
  readtlog | tail -n +$((N0T + 1)) | grep -q 'JSEVAL done=1' && break
  sleep 1; n=$((n + 1))
done
readtlog | tail -n +$((N0T + 1)) | grep 'JSEVAL ' > "$TMPDIR/js.out"
grep -q 'done=1' "$TMPDIR/js.out" || fail "jseval 没跑完（页面里 console 没有输出）"
"$PY" - "$TMPDIR/js.out" <<'PYCHK' || fail "文件夹页的固定条/计数/排序/刷新有问题"
import re, sys
txt = open(sys.argv[1], encoding="utf-8").read()
def val(k):
    m = re.search(r"JSEVAL " + k + r"=(.*)", txt)
    return m.group(1).strip() if m else ""
c0, c1 = val("count0"), val("count1")
first, after = val("first"), val("firstAfter")
assert re.match(r"^\d+ 个已选 · 共 \d+ 个$", c0), "底部计数格式不对: %r" % c0
assert re.match(r"^\d+ 个已选 · 共 \d+ 个$", c1), "计数没更新: %r" % c1
n0 = int(c0.split(" 个")[0]); n1 = int(c1.split(" 个")[0])
assert n1 == n0 - 1, "勾掉一个之后计数该 -1: %s -> %s" % (n0, n1)
assert after != first, "取消勾选的文件夹应该沉下去，还在第一位说明没重排"
assert val("orderOK") == "1", "已选的文件夹没有全部排在前面"
assert val("sticky") == "sticky", "底部操作条不是固定的: %r" % val("sticky")
assert val("footVisible") == "1", "滚到中间时底部操作条不在视口里"
c2 = val("count2")
n2 = int(c2.split(" 个")[0])
assert n2 == n0, "勾回来之后应该回到 %d: %r" % (n0, c2)
mine = val("mine")
assert re.match(r"^监控文件夹\d+个$", mine), "我的页数量没刷新: %r" % mine
assert int(re.search(r"(\d+)", mine).group(1)) == n2, "我的页数量该跟选择一致: %r vs %s" % (mine, n2)
# 步骤 8：正向断言走的是 Vue 路径。只看 DOM 结构上分不出谁画的（Vue 的产出按设计就和
# 字符串渲染器逐字一致）—— 没有这两行，VUE_SHEETS 注册了但分发没接上也是绿的。
assert val("isvue") == "1", "文件夹页没走 Vue 路径（isVueSheet(folders) 为假）"
assert val("mounted") == "1", "文件夹页的 Vue 应用没挂载（__enote.vue.sheets.folders 为空）"
assert val("scrollKept") == "1", "勾选之后弹层滚动位置跳了"
assert int(val("fshown")) >= 1 and val("fmatch") == "1", \
    "搜索框过滤没生效: key=%r shown=%s match=%s" % (val("fkey"), val("fshown"), val("fmatch"))
assert int(val("funfiltered")) == int(val("rows0")), \
    "清空关键词之后行没全部回来: %s -> %s" % (val("rows0"), val("funfiltered"))
# 真点击：全选 / 全不选 两个按钮的 @click 真的绑上了（直接调函数测不到模板里的 H.xxx）
assert val("allBtn") == "全选", "第一个 .btn.sm 不是「全选」，点击目标选错了: %s" % val("allBtn")
assert int(val("allSel")) == int(val("rows0")), \
    "点 全选 之后只有 %s 行勾上，应等于总行数 %s" % (val("allSel"), val("rows0"))
assert int(val("noneSel")) == 0, "点 全不选 之后还剩 %s 行勾着" % val("noneSel")
# 假夹具必须真的把页面撑高（fakescroll=1），否则「滚动位置保持」是空跑。
assert val("fakescroll") == "1", "注入 40 个假目录后页面还是滚不动，滚动保持根本没测到"
assert val("fakeKept") == "1", \
    "勾选之后弹层滚回顶部了（允许 Chrome 滚动锚定的一行位移，实测 delta=%s）" % val("fakeDelta")
assert val("fakeTop") == "1", "勾选后选中行没浮到最前（假夹具）"
print("  ok (固定条 sticky、计数 %d→%d 实时、已选在前、过滤 %s 命中 %s 行、真点击 全选/全不选 全部 %s 行、"
      "Vue 挂载、40 行假夹具下勾选后滚动不跳（delta=%s px）、返回后我的页同步为 %d)"
      % (n0, n1, val("fkey"), val("fshown"), val("allSel"), val("fakeDelta"), n2))
PYCHK
asroot_global "rm -f '$DATA/enote/.devmode'"

step "P11 只有一张截图时只留一个按钮（用户反馈：两个等价按钮只会让人犹豫）"
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
asroot_global "rm -f '$EXT/one-shot.png'; cp '$IMG' '$EXT/one-shot.png'; chown '$UI_APP:$UI_APP' '$EXT/one-shot.png'; chmod 644 '$EXT/one-shot.png'"
api_post shots/add "{\"shots\":[{\"path\":\"$EXT/one-shot.png\",\"name\":\"one-shot.png\",\"mime\":\"image/png\",\"dateAdded\":$(date +%s)}]}" \
  | grep -q '"added":1' || fail "造一张暂存截图失败"
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
NT=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  // D13：同上，render 返回 Promise，要 await 才能断言刚渲染的 DOM。
  var L=function(m){console.log("JSEVAL "+m)},q=function(s){return document.querySelector(s)};
  __enote.state.tab="notes"; await render(); shotSheet();
  setTimeout(async function(){
    __enote.state.shotSel={};
    // 步骤 8：正向断言截图页真的由 Vue 挂载（同文件夹页：只看 DOM 分不出谁画的）
    L("isvue="+(__enote.vue.isVueSheet("shots")?1:0));
    L("mounted="+(__enote.vue.sheets.shots?1:0));
    L("n1_go="+(q("#shotGo")?q("#shotGo").textContent:"?"));
    L("n1_split="+(q("#shotSplit")?getComputedStyle(q("#shotSplit")).display:"?"));
    L("n1_raw="+(q("#shotRaw")?getComputedStyle(q("#shotRaw")).display:"?"));
    // shotPick 在 Vue 路径返回 sheetPaint() 的 Promise：不 await 就读，读到的是上一帧
    await shotPick(__enote.state.shotList[0].id);
    L("n2_go="+(q("#shotGo")?q("#shotGo").textContent:"?"));
    L("n2_on="+document.querySelectorAll(".shotitem.on").length);
    L("n2_foot="+(q("#shotFoot")?q("#shotFoot").textContent.replace(/\s+/g," "):"?"));
    L("done=1");
  }, 1200);
})()' > "$TMPDIR/js.json"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/js.json'"
n=0
while [ "$n" -lt 20 ]; do
  readtlog | tail -n +$((NT + 1)) | grep -q 'JSEVAL done=1' && break
  sleep 1; n=$((n + 1))
done
readtlog | tail -n +$((NT + 1)) | grep 'JSEVAL ' > "$TMPDIR/one.out"
"$PY" - "$TMPDIR/one.out" <<'PYONE' || fail "只有一张截图时的按钮没收敛成一个"
import re, sys
txt = open(sys.argv[1], encoding="utf-8").read()
def val(k):
    m = re.search(r"JSEVAL " + k + r"=(.*)", txt)
    return m.group(1).strip() if m else ""
assert val("done") == "1", "jseval 没跑完"
assert val("n1_go") == "创建笔记", "一张时主按钮文案该是「创建笔记」, got %r" % val("n1_go")
assert val("n1_split") == "none", "一张时不该出现「各存一条」"
assert val("n1_raw") == "none", "一张时不该出现「原样存」"
# 步骤 8：勾选之后 DOM 真的变了 = tick 链没断。shotPick 只改模块变量 + bump tick，
# 任何一环没接上（忘了 sheetPaint / 组件没用 live()）都是「点了没反应」，
# 而签名测试与静态闸门全绿。
assert val("isvue") == "1", "截图页没走 Vue 路径（isVueSheet(shots) 为假）"
assert val("mounted") == "1", "截图页的 Vue 应用没挂载（__enote.vue.sheets.shots 为空）"
assert val("n2_on") == "1", "勾选之后 .shotitem.on 没变（tick 链断了）"
assert re.match(r"^1 张已选 · 共 \d+ 张$", val("n2_foot")), "勾选后计数条没实时更新: %r" % val("n2_foot")
print("  ok (一张只有「创建笔记」，勾选后文案不变；Vue 挂载、勾选与计数实时生效)")
PYONE
api_post shots/remove "{\"ids\":$(api_get shots/list | "$PY" -c 'import json,sys; print(json.dumps([x["id"] for x in json.load(sys.stdin)["shots"] if x["name"]=="one-shot.png"]))')}" >/dev/null
asroot_global "rm -f '$EXT/one-shot.png' '$DATA/enote/.devmode'"

# 步骤 11：VDIFF（Vue DOM 与遗留字符串渲染器逐字一致，迁移期硬验收）整段删除。
# 它比的是「Vue 产出的 DOM」对「遗留字符串渲染器产出的 HTML」；步骤 10 之后四个 tab +
# 四个弹层全走 Vue，遗留渲染器只剩没人调用的死代码，步骤 11 把它们整批删了，这个命题
# 就没有对象了。删掉之后 Vue 的 DOM 契约由这些用例守着：各页交互用例（真点击 + 真 DOM
# 断言）、tools/ui_test.js 闸门⑮（模板里的 class/id 与 CSS 逐字对）、以及 shots 截图对比。
# 截图页交互夹具要用的暂存目录（原来定义在 VDIFF 段里）。
VDS_EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"

# ---- 步骤 9：剪贴板暂存页（clipSheet）的夹具 + 真点击交互 ----
# 暂存条目只能由系统剪贴板产生：Go 侧只暴露 list/remove/parse/clear，写入走 JNI
# nativeClipAdd（前台轮询 / clipset 钩子）。三条文本必须互不相同：clipAdd 按内容
# 签名去重，重复文本只留一条，夹具就永远凑不到 3 条。
api_post clip/clear '' >/dev/null 2>&1 || true
CLIPFIX=$(date +%s)
# 三条之间必须隔 >5s：Go 侧 clipAdd 有「同来源 5s 内 → 覆盖最新一条」的规则
# （go/clip.go:124，钩子写进来的 app 都是 "hook"），1s 间隔连发三条会塌成一条（实测夹具
# 只到 1 条，网格那一遍没条目可比）。6s = 那 5s 去抖窗口 + 1s 余量；三条夹具给整套
# 增加约 12s（步骤 9 记账）。文本也要互不相同，完全相同的那条会被直接丢弃。
IFI=0
for t in "夹具甲 $CLIPFIX" "夹具乙 $CLIPFIX" "夹具丙 $CLIPFIX"; do
  [ "$IFI" -gt 0 ] && sleep 6
  am_start "$ACTIVITY" "--es hook clipset --es arg '$t'"
  IFI=$((IFI + 1))
done
n=0
while [ "$n" -lt 25 ]; do
  CN=$(api_get clip/list | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin).get("clips") or []))')
  [ "$CN" -ge 3 ] && break
  sleep 1; n=$((n + 1))
done
api_get clip/list | "$PY" -c '
import json,sys
d = json.load(sys.stdin)
clips = d.get("clips") or []
assert len(clips) >= 3, "剪贴板夹具只到 %d 条（需要 ≥3）：clipset 钩子没被前台读取收进暂存区" % len(clips)
print("  ok (剪贴板夹具 %d 条)" % len(clips))
' || fail "造剪贴板暂存夹具失败（剪贴板页交互用例没条目可点）"

step "剪贴板页交互在 Vue 路径上真的生效（勾选/全选/计数/单条删除/删除所选）"
# 同截图页：DOM 夹具比的是「画出来一样」，computed 读普通模块变量时签名与夹具全绿
# 而界面纹丝不动（步骤 6 的 ClipBanner）。这里全部走真点击，包括 .clipdel 的
# stopPropagation（点删除顺手把这条勾上是最容易漏的回归）。
# 未覆盖的一支（步骤 11 记账）：clipError（#clipList 里的「加载失败」）要 /api/clip/list
# 抛错才进得去，测试侧没有让 Go 报错的通道（fetch 在 WebView 里，钩子改不了它）。以前
# 这一支靠「遗留字符串渲染器与 Vue 模板共用一份字符串」间接保证，步骤 11 删掉遗留渲染器
# 之后连这层间接保证都没了 —— 要补得先做「注入假 fetch」。
NCIT=$(readtlog | wc -l)
"$PY" - > "$TMPDIR/js_clip_int.json" <<'PYCIT'
import json
js = r'''(async function(){
  var L=function(m){console.log("CIT "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var qa=function(s){return [].slice.call(document.querySelectorAll(s))};
  var E=window.__enote||{};
  var q=function(){ return qa("#sheet .clipitem") };
  var on=function(){ var n=0; q().forEach(function(x){ if(x.classList.contains("on")) n++ }); return n };
  var foot=function(){ var e=document.querySelector("#clipFoot"); return e?e.textContent.replace(/\s+/g,""):"" };
  var pri=function(){ var e=qa("#sheet .pfoot .btn.pri")[0]; return e?e.textContent.replace(/\s+/g,""):"" };
  var top=function(){ return [document.querySelector("#sheet #clipSelAll"),
      document.querySelector("#sheet #clipSelNone")] };
  // 注册表没注册 clip / 弹层没挂 Vue → 这一遍没东西可点，python 侧判红（不许静默 skip）
  if(!E.vue||!E.vue.isVueSheet||!E.vue.isVueSheet("clip")){ L("skip=no-vue-clip"); L("done=1"); return }
  try{
    clipSheet();
    for(var t=0;t<20 && !q().length;t++) await sleep(200);
    L("isvue=1"); L("mounted="+(E.vue.sheets.clip?1:0));
    L("n="+q().length);
    // 夹具没到位（列表空）→ 断言全空跑，python 侧判红
    if(!q().length){ L("skip=no-items"); L("done=1"); return }
    // 冻结语义：clipSel 首次见到某 id 默认**选中**（keep[id] = clipSel[id] !== undefined
    // ? clipSel[id] : true），所以刚开页是全选，不是全不选。
    L("on0="+on()); L("foot0="+foot()); L("pri0="+pri());
    q()[0].click();                       // 真点击一条：勾选 + 计数 + 按钮文案三处同步动
    await sleep(300);
    L("on1="+on()); L("foot1="+foot()); L("pri1="+pri());
    top()[1].click();                     // 全不选
    await sleep(300);
    L("on2="+on()); L("foot2="+foot()); L("pri2="+pri());
    top()[0].click();                     // 全选
    await sleep(300);
    L("on3="+on()); L("foot3="+foot()); L("pri3="+pri());
    // 单条删除：先全选（勾选数 = 行数），再点第一条的 .clipdel。stopPropagation 失效时
    // 这一次点击会先被 clipPick 收到，症状是「删一条掉两条」（行数 -1、勾选 -2），
    // 所以行数与勾选数都要断言。
    top()[0].click();
    await sleep(250);
    var n0=q().length, onb=on();
    var did=q()[0].querySelector(".clipdel");
    var did0=E.state.clipList[0]&&E.state.clipList[0].id;
    did.click();
    for(var t2=0;t2<25 && q().length>=n0;t2++) await sleep(200);
    L("beforeDel="+n0); L("onBeforeDel="+onb);
    for(var t2b=0;t2b<25 && on()>=onb;t2b++) await sleep(200);
    L("afterDel="+q().length); L("onAfterDel="+on());
    L("selAfterDel="+(E.state.clipSel[did0]?1:0));
    // 删除所选：全选 → 点「删除所选」→ 删完后弹层不关，就地换成空态（遗留行为：
    // clipRemove 只重拉列表，loadClips 的空态分支把 #clipList 换成 emptyState）
    top()[0].click();
    await sleep(250);
    L("onBeforeDelAll="+on());
    document.querySelector("#sheet #clipDelSel").click();
    for(var t3=0;t3<30 && q().length;t3++) await sleep(200);
    await sleep(300);
    L("afterDelAll="+q().length);
    L("emptyAfterDel="+(document.querySelector("#sheet .empty")?1:0));
    L("footAfterDel="+foot());
    L("sheetMounted="+(E.vue.sheets.clip?1:0));
  }catch(e){ L("ERR="+(e&&e.message)+" @ "+String((e&&e.stack)||"").split("\n")[1]) }
  try{ closeSheet() }catch(e){}
  L("done=1");
})()'''
print(json.dumps({"js": js}))
PYCIT
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/js_clip_int.json'"
for i in $(seq 1 40); do
  readtlog | tail -n +$((NCIT + 1)) | grep -q 'CIT done=1' && break
  sleep 0.5
done
readtlog | tail -n +$((NCIT + 1)) | grep 'CIT' | "$PY" -c '
import sys, re
lines = [l.strip() for l in sys.stdin if "CIT" in l]
d = {}
for l in lines:
    m = re.search(r"CIT (\w+)=(.*)", l)
    if m: d[m.group(1)] = m.group(2).strip()
# skip 算红：clip 页没挂 Vue 或夹具没到位，这一遍就是空跑
if d.get("skip"):
    raise AssertionError("剪贴板页交互这一遍没跑成（%s）：Vue 没挂载或夹具没到位" % d["skip"])
assert d.get("done") == "1", "CIT 载荷没跑完（无 done）：前端抛异常了？日志=%s" % lines[:2]
assert d.get("ERR") is None, "剪贴板页交互：前端抛异常：%s" % d.get("ERR")
assert d.get("isvue") == "1" and d.get("mounted") == "1", \
  "剪贴板页没走 Vue（isvue=%s mounted=%s）：这一遍比的是遗留路径" % (d.get("isvue"), d.get("mounted"))
n = int(d.get("n", 0))
assert n >= 2, "剪贴板页没条目（n=%s）：夹具没到位，这一遍是空跑" % d.get("n")
assert int(d.get("on0", 0)) == n, "开页应默认全选中（on0=%s n=%s）：clipSel 的「首次见到默认选中」是冻结语义" % (d.get("on0"), n)
assert d.get("foot0") == "%s条已选·共%s条" % (n, n), "开页计数条不对（实际 %r）" % d.get("foot0")
assert d.get("pri0") == ("一键解析%s条" % n if n > 1 else "一键解析"), \
  "开页主按钮文案不对（实际 %r，n=%s）" % (d.get("pri0"), n)
assert int(d.get("on1", -1)) == n - 1, "点一条应取消那一条（on1=%s n=%s）：tick 链断了" % (d.get("on1"), n)
assert d.get("foot1") == "%s条已选·共%s条" % (n - 1, n), "点一条后计数没动（实际 %r）" % d.get("foot1")
assert d.get("pri1") == ("一键解析%s条" % (n - 1) if n - 1 > 1 else "一键解析"), \
  "选 %s 条时主按钮文案不对（实际 %r）：n>1 才带数字" % (n - 1, d.get("pri1"))
assert d.get("on2") == "0", "全不选后应一个不剩（on2=%s）" % d.get("on2")
assert d.get("foot2") == "0条已选·共%s条" % n, "全不选后计数条不对（实际 %r）" % d.get("foot2")
assert d.get("pri2") == "一键解析", "只选 0 条时主按钮不该带数字（实际 %r）" % d.get("pri2")
assert d.get("on3") == str(n), "全选后应全部勾中（on3=%s n=%s）" % (d.get("on3"), n)
assert d.get("foot3") == "%s条已选·共%s条" % (n, n), "全选后计数不对（实际 %r）" % d.get("foot3")
assert d.get("pri3") == "一键解析%s条" % n, "全选后主按钮应带条数（实际 %r）" % d.get("pri3")
assert int(d.get("beforeDel", n)) == n, "单条删除前行数不对（%s，夹具是 %s 条）" % (d.get("beforeDel"), n)
assert int(d.get("onBeforeDel", 0)) == n, "单条删除前全选没生效（onBeforeDel=%s n=%s）" % (d.get("onBeforeDel"), n)
assert int(d.get("afterDel", n)) == n - 1, "点 .clipdel 后条目数没少 1（%s → %s）" % (n, d.get("afterDel"))
assert int(d.get("onAfterDel", n)) == n - 1, \
  "点 .clipdel 勾选数掉得不止那一条（%s → %s）：stopPropagation 没生效，点击顺手翻了勾选" % (
    d.get("onBeforeDel"), d.get("onAfterDel"))
assert d.get("selAfterDel") == "0", "点 .clipdel 顺手把这条勾上了（stopPropagation 没生效）"
assert int(d.get("onBeforeDelAll", 0)) >= 1, "删除所选前没东西可删（onBeforeDelAll=%s）" % d.get("onBeforeDelAll")
assert d.get("afterDelAll") == "0", "删除所选后条目没清光（afterDelAll=%s）" % d.get("afterDelAll")
assert d.get("emptyAfterDel") == "1", "删完后弹层里没出现空态（空暂存是剪贴板页的主路径之一）"
assert d.get("footAfterDel") == "0条已选", "删完后计数条不对（实际 %r）" % d.get("footAfterDel")
assert d.get("sheetMounted") == "1", "弹层被意外卸载（遗留行为是就地换空态，不关页）"
print("  ok (真点击 %s 条：勾选 %s→%s、计数 %r、全选/全不选、按钮文案收敛、"
      "单条删除不顺手勾选、删除所选后就地换空态)" % (
    n, d.get("on0"), d.get("on1"), d.get("foot1")))
'
asroot_global "rm -f '$DATA/enote/.devmode'"
# 删光之后的空态：先把系统剪贴板清成空白（Go 侧 TrimSpace 后为空 → clipAdd 直接拒），
# 否则前台轮询会立刻把剪贴板上那条旧文本重新暂存，空态那一遍比的是 1 条列表。
am_start "$ACTIVITY" "--es hook clipset --es arg ' '" >/dev/null 2>&1 || true
sleep 2
api_post clip/clear '' >/dev/null 2>&1 || true

step "设置页（弹层）交互在 Vue 路径上真的生效（开页/主题/开关/保存/确认框）"
# 设置页是本次迁移里唯一带表单的页面，也是唯一有「写完要恢复」的页面：主题、AI 开关、
# 保存都是真写盘（/api/theme、/api/settings），用例一律点过去再点回来，不留下改动；
# 清空全部只到确认框就取消（真机上这台机器的笔记不能删）。
# 全部走真点击：从我的页的行点进设置（这条链步骤 2 后断过：settingsSheet 不在导出表，
# 点了只报 ReferenceError），再点主题 seg / AI 开关 / 保存 / 清空全部。
NSET=$(readtlog | wc -l)
"$PY" > "$TMPDIR/jsset.json" <<'PYSET'
import json
js = r'''(async function(){
  var L=function(m){console.log("SET "+m)};
  var E=window.__enote||{};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var S=function(){return document.querySelector("#sheet .pbody")};
  var q=function(s){return S()?S().querySelector(s):null};
  var qa=function(s){return S()?Array.prototype.slice.call(S().querySelectorAll(s)):[]};
  var on=function(el,cls){return new RegExp("(^| )"+cls+"( |$)").test(el&&el.className||"")};
  var click=function(el){ if(!el) return false; el.click(); return true };
  var byText=function(sel,txt){ var hit=null; Array.prototype.forEach.call(document.querySelectorAll(sel), function(b){ if(b.textContent.trim()===txt) hit=b }); return hit };
  try{
    L("isvue="+(E.vue.isVueSheet("settings")?1:0));
    var theme0=(E.state.S.settings||{}).theme||"light";
    var notes0=E.state.S.info.notes||0;
    /* 从我的页点进设置：同时测到「我的页的行 → settingsSheet()」这条链。
       先关掉上一用例留下的弹层（剪贴板页交互那一遍会把剪贴板页开着走），否则 S() 读到的
       .pbody 是那一页的。 */
    if(on(document.getElementById("sheet"),"on")) closeSheet();
    /* 我的页的六行入口在 ST 未加载时不画（renderMine 提前 return），而 statsNow() 有个
       stBusy 互斥标志：套件里前一步刚清过库（clearAllNotes 把 ST 置 null），那个标志卡住时
       tab 点击不会去取统计，症状就是「我的页上没有设置行」。夹具直接取真 /api/stats 注入
       状态桥，不依赖那个标志；tab 仍然真点（这是本用例的主题）。
       闸门② 禁止载荷里出现反引号与单引号（shell 的单引号参数会吃掉它们），注释也一样。 */
    E.state.ST = await api("/api/stats");
    var tabBtn=document.querySelector(".tabbar .tab[data-tab=mine]");
    L("tabBtn="+(tabBtn?1:0));
    click(tabBtn);
    /* 六行入口是 ST 到位、render 之后才有的，所以要等。 */
    await new Promise(function(res){ var t=0;(function probe(){
      var hit=Array.prototype.some.call(document.querySelectorAll("#view .li"), function(x){ return /设置/.test(x.textContent) });
      if(hit||t>25){ res(); return }
      t++; setTimeout(probe,200);
    })(); });
    var row=null;
    Array.prototype.forEach.call(document.querySelectorAll("#view .li"), function(x){ if(/设置/.test(x.textContent)) row=x });
    L("row="+(row?1:0));
    click(row); await sleep(700);
    L("opened="+(q("#sUrl")?1:0));
    L("mounted="+(E.vue.sheets.settings?1:0));
    L("kind="+(((document.getElementById("panel")||{}).dataset||{}).kind||""));
    L("inputs="+qa("#sUrl,#sKey,#sModel,#sTimeout,#sMax,#sTemp").length);
    /* 输入框的 value 属性：遗留路径写字符串属性，Vue 要写 :value.attr 才有（:value 走
       DOM property，序列化出来没有 value 属性）。saveSettings() 读的是 .value，
       新建 input 的 value 从属性来，所以这一条同时钉住「保存不会存空值」。 */
    L("urlAttr="+(q("#sUrl")&&q("#sUrl").getAttribute("value")!==null?1:0));
    L("kv="+qa(".kv").length);
    var seg=q(".seg"); var btns=seg?Array.prototype.slice.call(seg.children):[];
    L("seg="+btns.length);
    if(btns.length===3){
      click(btns[1]); await sleep(800);
      L("themeDark="+document.documentElement.getAttribute("data-theme"));
      var nb=Array.prototype.slice.call((q(".seg")||{children:[]}).children), onIdx=-1;
      for(var i=0;i<nb.length;i++) if(on(nb[i],"on")) onIdx=i;
      L("onIdx="+onIdx);
      click(nb[0]); await sleep(800);
      L("themeBack="+document.documentElement.getAttribute("data-theme"));
    }
    /* AI 开关：toggleAI 翻 useAI + el.classList.toggle + saveSettings（POST /api/settings）
       再 render()。页面上第一个 .sw 是常驻后台（点它会弹确认框），第二个是启用 AI。 */
    var swAll=document.querySelectorAll("#sheet .sw");
    L("sw="+swAll.length);
    var a0=swAll[1]&&on(swAll[1],"on")?1:0;
    click(swAll[1]); await sleep(900);
    swAll=document.querySelectorAll("#sheet .sw");
    var a1=swAll[1]&&on(swAll[1],"on")?1:0;
    var st1=E.state.S.settings.useAI?1:0;
    L("aiFlip="+((a1!==a0&&st1===a1)?1:0));
    click(swAll[1]); await sleep(900);
    swAll=document.querySelectorAll("#sheet .sw");
    var a2=swAll[1]&&on(swAll[1],"on")?1:0;
    L("aiBack="+(a2===a0&&E.state.S.settings.useAI===(a0===1)?1:0));
    var saveBtn=byText("#sheet .btn","保存");
    L("saveBtn="+(saveBtn?1:0));
    click(saveBtn); await sleep(900);
    L("toast="+document.getElementById("toast").textContent.trim());
    /* 清空全部：只测到确认框，点取消（真机数据不能删）。 */
    var clearBtn=byText("#sheet .btn","清空全部");
    L("clearBtn="+(clearBtn?1:0));
    click(clearBtn); await sleep(400);
    L("dlgOn="+(on(document.getElementById("dlg"),"on")?1:0));
    L("dlgYes="+document.getElementById("dlgYes").textContent.trim());
    click(document.getElementById("dlgNo")); await sleep(400);
    L("dlgClosed="+(on(document.getElementById("dlg"),"on")?0:1));
    /* 关闭：弹层头部是 .iconbtn 图标按钮（aria-label=返回），没有「关闭」文字按钮
       —— 第一版按 byText("关闭") 找，找不到就是点了个空，closed 永远 0。 */
    var closeBtn=document.querySelector("#sheet .phead .iconbtn");
    L("closeBtn="+(closeBtn?1:0));
    click(closeBtn); await sleep(500);
    L("closed="+(on(document.getElementById("sheet"),"on")?0:1));
    L("notesKept="+((E.state.S.info.notes||0)===notes0?1:0));
    L("themeRestored="+((E.state.S.settings.theme||"light")===theme0?1:0));
  }catch(e){ L("ERR="+(e&&e.message)+" @ "+String((e&&e.stack)||"").split("\n")[1]) }
  L("done=1");
})()'''
print(json.dumps({"js": js}))
PYSET
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsset.json'"
for i in $(seq 1 40); do
  readtlog | tail -n +$((NSET + 1)) | grep -q 'SET done=1' && break
  sleep 0.5
done
readtlog | tail -n +$((NSET + 1)) | grep 'SET' | "$PY" -c '
import sys, re
lines = [l.strip() for l in sys.stdin if "SET " in l]
d = {}
for l in lines:
    m = re.search(r"SET (\w+)=(.*)", l)
    if m: d[m.group(1)] = m.group(2).strip()
assert d.get("done") == "1", "SET 载荷没跑完（无 done）：前端抛异常了？日志=%s" % lines[:2]
assert d.get("ERR") is None, "SET 前端抛异常：%s" % d.get("ERR")
assert d.get("isvue") == "1", "设置页不在 VUE_SHEETS 注册表里（走的是遗留路径）"
assert d.get("tabBtn") == "1", "底部 tabbar 找不到「我的」按钮（.tabbar .tab[data-tab=mine]）"
assert d.get("row") == "1", "我的页上没有「设置」行"
assert d.get("opened") == "1", "点我的页的「设置」行没打开设置页（handler 链断了）"
assert d.get("mounted") == "1", "设置页没被 Vue 挂载"
assert d.get("kind") == "settings", "#panel dataset.kind 不是 settings（CSS 钩子断了）"
assert d.get("inputs") == "6", "六个输入框没全在（inputs=%s）" % d.get("inputs")
assert d.get("urlAttr") == "1", "#sUrl 没有 value 属性：:value 写的是 DOM property，序列化出来没属性"
assert int(d.get("kv", 0)) >= 10, "设置页的 kv 行少于 10（kv=%s）：采集/OCR/数据/运行状态 卡没画全" % d.get("kv")
assert d.get("seg") == "3", "主题 seg 不是三个按钮（seg=%s）" % d.get("seg")
assert d.get("themeDark") == "dark", "点「暗色」后 data-theme 不是 dark（实际 %r）" % d.get("themeDark")
assert d.get("onIdx") == "1", "点暗色后 seg 的 on 没移到第二个按钮（onIdx=%s）" % d.get("onIdx")
assert d.get("themeBack") == "light", "点回亮色后 data-theme 不是 light（实际 %r）" % d.get("themeBack")
assert int(d.get("sw", 0)) == 2, "常驻后台 / 启用 AI 两个开关没都在（sw=%s）" % d.get("sw")
assert d.get("aiFlip") == "1", "点启用 AI 开关后 class 与 settings.useAI 没一起翻"
assert d.get("aiBack") == "1", "再点一次没回到原状态（测试把真机设置改掉了）"
assert d.get("saveBtn") == "1", "设置页上没有「保存」按钮"
assert "已保存" in (d.get("toast") or ""), "点保存没得到「已保存」（toast=%r）" % d.get("toast")
assert d.get("clearBtn") == "1", "设置页数据卡上没有「清空全部」按钮"
assert d.get("dlgOn") == "1", "点清空全部没弹确认框"
assert d.get("dlgYes") == "删除", "确认框的确定按钮文案不对（实际 %r）" % d.get("dlgYes")
assert d.get("dlgClosed") == "1", "点取消没关掉确认框"
assert d.get("closeBtn") == "1", "弹层头部找不到返回按钮（.phead .iconbtn）"
assert d.get("closed") == "1", "点关闭没关掉设置弹层（unmountSheet 没生效）"
assert d.get("notesKept") == "1", "清空全部取消后笔记数变了（真机数据被动了）"
assert d.get("themeRestored") == "1", "主题没恢复成测试前的值"
print("  ok (真点击：我的页→设置、主题 亮→暗→亮、AI 开关翻回、保存、清空确认框取消、关闭卸载）"
)
'
asroot_global "rm -f '$DATA/enote/.devmode'"

step "截图页交互在 Vue 路径上真的生效（勾选/全选/实时计数/按钮收敛）"
# 上面的夹具只证明「画出来一样」，不证明「点了会动」：computed 读普通模块变量（没响应式
# 依赖）时签名与 DOM 夹具全绿而界面纹丝不动（步骤 6 的 ClipBanner 就踩过）。浮层页多一层
# 风险：tick 链是 sheetPaint 手动 bump 的，忘了 bump 就是「点了没反应」。
NIT=$(readtlog | wc -l)
"$PY" - > "$TMPDIR/js_shots_int.json" <<'PYIT'
import json
js = r'''(async function(){
  var L=function(m){console.log("SIT "+m)};
  var E=window.__enote||{};
  // 同上：注册表没注册 shots 或弹层没挂 Vue → python 侧判红
  if(!E.vue||!E.vue.isVueSheet||!E.vue.isVueSheet("shots")){ L("skip=no-vue-shots"); L("done=1"); return }
  try{
    var q=function(){ return document.querySelectorAll("#sheet .shotitem") };
    var on=function(){ var n=0; q().forEach(function(x){ if(x.classList.contains("on")) n++ }); return n };
    var foot=function(){ var e=document.querySelector("#sheet #shotFoot"); return e?e.textContent.replace(/\s+/g,""):"" };
    shotSheet();
    await new Promise(function(res){ var t=0;(function probe(){
      if(q().length||t>20){res();return} t++; setTimeout(probe,200); })(); });
    L("isvue=1"); L("mounted="+(E.vue.sheets.shots?1:0));
    L("n="+q().length);
    // 夹具没到位（列表空）→ 断言全空跑，python 侧判红
    if(!q().length){ L("skip=no-items"); L("done=1"); return }
    L("on0="+on()); L("foot0="+foot());
    q()[0].click();                       // 真点击：证明 @click 真的绑上了
    await new Promise(function(r){setTimeout(r,300)});
    L("on1="+on()); L("foot1="+foot());
    document.querySelector("#sheet #shotSelAll").click();               // 全选
    await new Promise(function(r){setTimeout(r,300)});
    L("on2="+on()); L("foot2="+foot());
    document.querySelector("#sheet #shotSelNone").click();              // 全不选
    await new Promise(function(r){setTimeout(r,300)});
    L("on3="+on()); L("foot3="+foot());
    q()[0].click();                       // 只选 1 张：三个导入按钮塌成
    await new Promise(function(r){setTimeout(r,300)});
    var vis=function(id){ var e=document.querySelector("#sheet #"+id); return (e&&e.style.display!=="none")?1:0 };
    L("btnGo="+vis("shotGo")); L("btnSplit="+vis("shotSplit")); L("btnRaw="+vis("shotRaw"));
    L("goLabel="+((document.querySelector("#sheet #shotGo")||{}).textContent||""));
    // 导入进度层（步骤 8 的第三块）：状态在 app.js 的 SHOTPROG（reactive），组件
    // ShotProgress 是纯渲染器，挂在 body 级的 #shotOvlRoot 上 —— 进度要在截图弹层
    // 关掉之后继续活着（shotsImported 才收），而 closeSheet() 会换掉 .panel 的 innerHTML。
    shotOverlay(true, 2, "OCR 完成，AI 正在解析");
    await new Promise(function(r){setTimeout(r,250)});
    L("ovlMounted="+(E.vue.sheets.progress?1:0));
    L("ovlBody="+(document.querySelector("#shotOvlRoot .ovl")?1:0));
    L("ovlInSheet="+(document.querySelector("#sheet #shotOvl")?1:0));
    L("ovlSub="+((document.querySelector("#shotOvlSub")||{}).textContent||""));
    closeSheet();                       // 进度层必须活过弹层关闭
    await new Promise(function(r){setTimeout(r,250)});
    L("ovlAfterClose="+(document.querySelector("#shotOvlRoot .ovl")?1:0));
    shotOvlSub("AI 正在解析：1 / 2 条完成");
    await new Promise(function(r){setTimeout(r,250)});
    L("ovlSub2="+((document.querySelector("#shotOvlSub")||{}).textContent||""));
    shotOverlay(false);
    await new Promise(function(r){setTimeout(r,250)});
    L("ovlLeft="+(document.querySelector("#shotOvl")?1:0));
    L("ovlUnmounted="+(E.vue.sheets.progress?1:0));
  }catch(e){ L("ERR="+(e&&e.message)+" @ "+String((e&&e.stack)||"").split("\n")[1]) }
  try{ closeSheet() }catch(e){}
  L("done=1");
})()'''
print(json.dumps({"js": js}))
PYIT
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
# 两张图用 tools/make_test_png.py 现造（各自掺一条随机噪点带 → 字节不同）。
# 以前两张都是 cp 同一个 $IMG，字节完全一样：「两张暂存截图」在像素上不可分，
# 缩略图渲染成同一张、网格去重之类的问题根本看不出来（Tony 审计指出）。
for f in vds-a.png vds-b.png; do
  "$PY" "$HERE/tools/make_test_png.py" "$HERE/.test/$f" 360 640 \
    || fail "造截图夹具失败（make_test_png.py）"
  asroot_global "rm -f '$VDS_EXT/$f'; cp '$HERE/.test/$f' '$VDS_EXT/$f'; chown '$UI_APP:$UI_APP' '$VDS_EXT/$f'; chmod 644 '$VDS_EXT/$f'" || true
done
api_post shots/add "{\"shots\":[{\"path\":\"$VDS_EXT/vds-a.png\",\"name\":\"vds-a.png\",\"mime\":\"image/png\",\"dateAdded\":$(date +%s)},\
{\"path\":\"$VDS_EXT/vds-b.png\",\"name\":\"vds-b.png\",\"mime\":\"image/png\",\"dateAdded\":$(date +%s)}]}" \
  | grep -q '"added":2' || fail "造暂存截图夹具失败（交互用例没卡片可点）"
NIT=$(readtlog | wc -l)
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/js_shots_int.json'"
for i in $(seq 1 40); do
  readtlog | tail -n +$((NIT + 1)) | grep -q 'SIT done=1' && break
  sleep 0.5
done
readtlog | tail -n +$((NIT + 1)) | grep 'SIT' | "$PY" -c '
import sys, re
lines = [l.strip() for l in sys.stdin if "SIT" in l]
d = {}
for l in lines:
    m = re.search(r"SIT (\w+)=(.*)", l)
    if m: d[m.group(1)] = m.group(2).strip()
# skip 算红：shots 页没挂 Vue 或夹具没到位，这一遍就是空跑
if d.get("skip"):
    raise AssertionError("截图页交互这一遍没跑成（%s）：Vue 没挂载或夹具没到位" % d["skip"])
assert d.get("done") == "1", "SIT 载荷没跑完（无 done）：前端抛异常了？日志=%s" % lines[:2]
assert d.get("ERR") is None, "截图页交互：前端抛异常：%s" % d.get("ERR")
assert d.get("isvue") == "1" and d.get("mounted") == "1", \
  "截图页没走 Vue（isvue=%s mounted=%s）：这一遍比的是遗留路径" % (d.get("isvue"), d.get("mounted"))
n = int(d.get("n", 0))
assert n >= 2, "截图页没卡片（n=%s）：夹具没到位，这一遍是空跑" % d.get("n")
assert d.get("on1") != d.get("on0"), "点一张卡片后勾选数没变（%s → %s）：tick 链断了" % (d.get("on0"), d.get("on1"))
assert d.get("foot1") != d.get("foot0"), "点一张卡片后计数文案没变（%s → %s）" % (d.get("foot0"), d.get("foot1"))
assert d.get("on2") == d.get("n"), "全选后应全部勾中（on2=%s n=%s）" % (d.get("on2"), d.get("n"))
assert d.get("on3") == "0", "全不选后应一个不剩（on3=%s）" % d.get("on3")
assert d.get("btnSplit") == "0" and d.get("btnRaw") == "0" and d.get("btnGo") == "1", \
  "只选 1 张时按钮没塌成（go=%s split=%s raw=%s）" % (d.get("btnGo"), d.get("btnSplit"), d.get("btnRaw"))
assert "创建笔记" in d.get("goLabel", ""), "塌成后主按钮文案应变成「创建笔记」（实际 %r）" % d.get("goLabel")
# 导入进度层：SHOTPROG + ShotProgress 组件，body 级容器，要活过 closeSheet()
assert d.get("ovlMounted") == "1", "进度层没挂到 __enote.vue.sheets.progress（mountSheet 没走？）"
assert d.get("ovlBody") == "1", "进度层不在 body 级的 #shotOvlRoot 里（挂弹层里会被 closeSheet 清掉）"
assert d.get("ovlInSheet") == "0", "进度层跑到弹层里了"
assert "AI 正在解析" in d.get("ovlSub", "") and "已用" in d.get("ovlSub", ""), \
    "进度层副标题没渲染（实际 %r）" % d.get("ovlSub")
assert d.get("ovlAfterClose") == "1", "截图弹层一关进度层就没了（导入还在跑，用户看不到进度）"
assert "1 / 2" in d.get("ovlSub2", ""), "shotOvlSub 更新没反映到进度层（实际 %r）" % d.get("ovlSub2")
assert d.get("ovlLeft") == "0", "关掉之后 #shotOvl 还留在 DOM 里（透明遮罩吃掉点击）"
assert d.get("ovlUnmounted") == "0", "关掉之后进度层 app 还在 __enote.vue.sheets 里（unmountSheet 没调）"
print("  ok (真点击 %s 张：勾选 %s→%s、计数跟变、全选/全不选、单张时按钮塌成 %r；"
      "进度层 body 级、活过 closeSheet、shotOvlSub 实时更新、关掉后零残留)" % (
    d.get("n"), d.get("on0"), d.get("on1"), d.get("foot1")))
'
asroot_global "rm -f '$DATA/enote/.devmode'"
VDSIDS=$(api_get shots/list | "$PY" -c 'import json,sys; print(json.dumps([x["id"] for x in json.load(sys.stdin).get("shots") or []]))')
[ "$VDSIDS" != "[]" ] && api_post shots/remove "{\"ids\": $VDSIDS}" >/dev/null

step "Notes 交互在 Vue 路径上真的生效（tick 链断则点了没反应）"
# 上面的夹具只证明「画出来一样」，不证明「点了会动」。Vue 迁移最阴的失效是：computed 读的是
# 普通模块变量（S / open / MISSED），没有响应式依赖 → 永远缓存 → 界面纹丝不动，
# 而签名 84 项和 DOM 夹具都是绿的。Austin 在真机首跑就踩到（ClipBanner 的 computed），
# 这条用真点击把四类交互钉住：展开 / 空态 / 三横幅 / 删除。
# 日志窗口：从本步起算取日志行。两个坑都踩过，都在这行上：
# 1) 不能对 newtlog 再 tail -n +$((NIN+1))：newtlog 内部已经是 readtlog | tail -n +$((BASE+1))，
#    NIN 是整份日志的绝对行号，对切短的流二次切直接切空，症状是「已收到=[]」，
#    看着像载荷没跑（真机首跑先误判成 .devmode，补了 touch 依旧红，根因在这里）。
# 2) 要读未切的 readtlog 并自己记 NIN：从本步起算比从 BASE 起算紧，
#    不会把上一轮残留的同名 token 扫进来。
NIN=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  var L=function(m){console.log("NINT "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)};
  var qa=function(s){return [].slice.call(document.querySelectorAll(s))};
  var P=".pane[data-tab=notes]";
  var cards=function(){return qa(P+" .card").length};
  __enote.state.tab="notes";
  await render();
  L("cards="+cards());
  // 1) 展开详情：open 是模块状态，computed 不依赖 tick 就永远缓存
  var before=qa(P+" .body.clamp").length;
  var eb=q(P+" .exp");
  L("expBtn="+(eb?eb.textContent.trim():"none"));
  if(eb){ eb.click(); await sleep(400); }
  L("clampBefore="+before);
  L("clampAfter="+qa(P+" .body.clamp").length);
  var eb2=q(P+" .exp");
  L("expAfter="+(eb2?eb2.textContent.trim():"none"));
  if(eb2){ eb2.click(); await sleep(400); }
  // 2) 空态：笔记清空后必须出 .empty（Vue 的 v-if 分支）。
  //    不能只改 S.notes=[]：notesFiltered() 第一优先级是服务端搜索结果 SR.notes，
  //    它非空时画的是 SR 那几条，S 改什么都看不出；而且 app 每 ~2s 轮询 /api/state
  //    会整体替换 S，直接赋值活不过下一次轮询。走真 API 删除才是真输入路径。
  var A=__enote.actions;
  var ids=__enote.state.S.notes.map(function(n){return n.id});
  for(var i=0;i<ids.length;i++){ await A.api("/api/delete", {id: ids[i]}) }
  await A.refresh(true); await sleep(500);
  // 一个 token 一行：断言止的 NINT (\w+)=(.*) 是贪婪匹配，两个 token 写一行会被
  // 当成一个值（empty 收到 "true emptyCards=0"），下一条则根本不存在。
  L("empty="+String(!!q(P+" .empty")));
  L("emptyCards="+cards());
  for(var i=0;i<ids.length;i++){ await A.api("/api/add", {text:"标题 "+i}) }
  await A.refresh(true); await sleep(1200); await A.refresh(true); await sleep(800);
  L("restored="+cards());
  // 3) 三横幅同时出现且顺序对
  __enote.state.MISSED={count:2,items:[{id:"t1",nid:"n1",title:"x",at:Date.now()-60000}]};
  __enote.state.S.info.clip=3;
  await render();
  var h=q(P).innerHTML;
  L("missed="+String(!!q(P+" .missed")));
  L("clip="+String(!!q(P+" .clipbanner")));
  L("order="+((h.indexOf("missed")>=0 && h.indexOf("missed")<h.indexOf("clipbanner"))?"ok":"bad"));
  __enote.state.MISSED=null; __enote.state.S.info.clip=0; await render();
  // 4) 删除：delNote → 对话框确认 → 卡片数必须掉（tick 链 + 对话框两条链一起测）
  var n0=cards(), id=(__enote.state.S.notes[0]||{}).id;
  // 走 __enote.actions 而不是裸全局 delNote：闸门② 的闭集只给 10 个函数，
  // 多一个裸全局就要改一次闸门，而桥就在边上，没理由扩它。
  if(id){ __enote.actions.delNote(id); await sleep(300);
    var yes=q("#dlgYes"); L("dlg="+(yes?yes.textContent.trim():"none"));
    if(yes) yes.click();
    for(var i=0;i<40;i++){ await sleep(150); if(cards()<n0) break; }
  }
  L("delBefore="+n0); L("delAfter="+cards());
  L("ndone=1");
})()' > "$TMPDIR/jsnint.json"
# jseval 钩子只在 .devmode 存在时干活，上一块刚把它删了；不重新 touch 就是空跑。
# 不 touch 就是「载荷根本没跑」，症状是「前端抛异常了？已收到=[]」。
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsnint.json'"
for i in $(seq 1 60); do
  readtlog | tail -n +$((NIN + 1)) | grep -q 'NINT ndone=1' && break
  sleep 0.5
done
# 取窗口读未切的 readtlog：对 newtlog 再 tail 一次是双重跳过（见步骤开头那段注释）。
readtlog | tail -n +$((NIN + 1)) | grep 'NINT' | "$PY" -c '
import sys, re
d = {}
for l in sys.stdin:
    m = re.search(r"NINT (\w+)=(.*)", l)
    if m: d[m.group(1)] = m.group(2).strip()
assert d.get("ndone") == "1", "NINT 载荷没跑完（无 ndone）：前端抛异常了？已收到=%s" % sorted(d)
n = int(d["cards"])
assert n > 0, "Notes 页没卡片，本步断言会是空跑"
# 展开：clamp 类必须少一个，按钮文案必须翻成「收起」
assert int(d["clampAfter"]) < int(d["clampBefore"]), \
  "点「展开详情」后正文仍是收起态（clamp %s→%s）：tick 链断了，Vue 没重渲染" % (
    d["clampBefore"], d["clampAfter"])
assert d["expAfter"] == "收起", "展开后按钮文案该是「收起」, got %r" % d["expAfter"]
assert d["empty"] == "true", "笔记清空后没出空态块（.empty）：Vue 的 v-if 分支没生效"
assert int(d["emptyCards"]) == 0, \
  "走 /api/delete 清空后卡片数不是 0（实际 %s）：SR.notes 遮蔽又回来了" % d["emptyCards"]
assert int(d["restored"]) == n, "恢复笔记后卡片数不对（%s→%s）" % (n, d["restored"])
assert d["missed"] == "true", "造了 MISSED 数据但 .missed 横幅没渲染"
assert d["clip"] == "true", "造了 clip 计数但 .clipbanner 横幅没渲染（live() 没包？）"
assert d["order"] == "ok", "首页横幅顺序不对：该是错过提醒 → 新截图 → 剪贴板"
assert d["dlg"] == "删除", "delNote 没弹确认框, got %r" % d["dlg"]
assert int(d["delAfter"]) == int(d["delBefore"]) - 1, \
  "删除后卡片数没掉（%s→%s）：删除走了但视图没重绘" % (d["delBefore"], d["delAfter"])
print("  ok (展开/空态/三横幅/删除四条交互在 Vue 路径上都真生效，卡片 %d→%d)" % (n, int(d["delAfter"])))
'
asroot_global "rm -f '$DATA/enote/.devmode'"

step "Todos 交互在 Vue 路径上真的生效（勾选 → done 翻转 → 再点回来）"
# Notes 那条 NINT 只覆盖笔记页；todos 转 Vue 后如果没人点它，「tick 链断了 → 点了没反应」
# 这一整类失效在待办页是空的（P12 同款）。这条把三件事钉在真机上：
#   1) Vue 路径是活的（__enote.vue.isVue('todos') 且视图真挂载了）—— 只看 DOM 结构上
#      区分不了渲染路径（Vue 的产出按设计就和字符串渲染器逐字一致），这条是补的正向断言；
#   2) 点 .cb 真的提交到服务端（done 翻转），再点回来；
#   3) 搜索态下 Vue 渲染的行数 = 服务端 SR.todoIds 的条数（SR 是模块 var，
#      computed 没依赖就永远缓存 → 搜索后待办列表不动）。
# 顺带把 .cb 的几何量出来：plan.md 记的「.cb 被左边缘裁一半」要靠数据判，不靠描述。
NIT=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  var L=function(m){console.log("TINT "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)};
  var qa=function(s){return [].slice.call(document.querySelectorAll(s))};
  var P=".pane[data-tab=todos]";
  var rows=function(){ return qa(P+" .todo").length };
  var findTodo=function(st,tid){ var r=null; (st.notes||[]).forEach(function(n){
    (n.todos||[]).forEach(function(t){ if(t.id===tid) r={n:n,t:t} }) }); return r };
  var findByText=function(st,txt){ var r=null; (st.notes||[]).forEach(function(n){
    (n.todos||[]).forEach(function(t){ if(t.text===txt) r={n:n,t:t} }) }); return r };
  var fx=[];   // 本步造的测试待办，末尾统一删（设备上是真数据，不能留垃圾）
  var add=function(text){
    return api("/api/todo",{action:"add",noteId:nid,text:text,due:"",priority:"normal"})
      .then(function(){ return api("/api/state") }).then(function(st){
        var f=findByText(st,text); if(f) fx.push({nid:f.n.id,tid:f.t.id}); return f })
  };
  try{
    // 1) Vue 路径必须是活的：装配掉了 / 注册表没 todos 时，本步测的不是 Vue 路径
    L("isVue="+(__enote.vue?__enote.vue.isVue("todos"):"no-vue"));
    L("mounted="+(__enote.vue?!!__enote.vue.apps.todos:"no-vue"));
    // 2) 夹具：至少两条「未完成」待办（一条给勾选测试，两条给搜索态测试）
    var purge=function(st){ var ps=[]; (st.notes||[]).forEach(function(n){
      (n.todos||[]).forEach(function(t){ if(t.text.indexOf("Vue 交互夹具")===0)
        ps.push(api("/api/todo",{action:"delete",noteId:n.id,todoId:t.id})) }) });
      return Promise.all(ps) };
    // 夹具挂在「解析已终结」的笔记上：llm.go 解析完成时是 n.Todos = nil 整体替换，
    // 夹具赶在解析前加进去会被抹掉（实测 suite 里 done1=null rows1=0，探针里全绿 ——
    // 探针跑的时候没有解析在飞）。
    var term=function(n){ return ["done","raw","error"].indexOf(n.status)>=0 };
    for(var w=0;w<80;w++){
      var q=await api("/api/state");
      if(!(q.notes||[]).some(function(n){ return !term(n) })) break;
      await sleep(500);
    }
    var st=await api("/api/state");
    var stable=(st.notes||[]).filter(term);
    var nid=(stable[0]||{}).id;
    if(!nid){ L("skip=no-note"); L("done=1"); return }
    // 先清掉上一轮失败留下的同名夹具：findByText 命中旧的那条（已勾完）时，
    // 症状是 row=none —— 已完成项默认被筛掉，看着像「Vue 没渲染」
    var purged=0;
    if(st.notes.some(function(n){ return (n.todos||[]).some(function(t){
      return t.text.indexOf("Vue 交互夹具")===0 }) })){
      await purge(st); st=await api("/api/state"); purged=1 }
    L("purged="+purged);
    // 夹具一律自建两条，不依赖设备上的真数据：真待办有已勾完的、有同名前缀的，
    // 拿它们当目标时「row=none / done0=true」这类假红查一轮才定位（自建夹具 + 开头 purge
    // 之后，本步的输入完全已知）。
    var f1=await add("Vue 交互夹具甲");
    st=await api("/api/state");
    var f2=await add("Vue 交互夹具乙");
    st=await api("/api/state");
    L("made="+(f1&&f2?"2":"0"));
    // 模块里的 S 由 2s 轮询更新，夹具是刚建的：不把新 state 灌进模块，render() 画的
    // 还是旧数据，症状是「行找不到」（实测 row=none，夹具明明建成功了）
    __enote.state.S = st;
    var t0=f1, tid=f1?f1.t.id:"";
    L("tid="+(tid?"ok":"none"));
    L("done0="+(t0?!!t0.t.done:"-"));
    __enote.state.tab="todos"; await render(); await sleep(300);
    L("mounted2="+(__enote.vue?!!__enote.vue.apps.todos:"no-vue"));
    L("rows0pre="+rows());
    // 2b) .cb 几何：圆圈（.cb::before）左边缘不能跑到父 padding-box 左边（=被裁）。
    // 必须在夹具还在 DOM 里的时候量：suite 跑到这一步时真数据可能已被前面的用例清空，
    // 列表空态下没有 .todo .cb，量不到就是「没量到几何」假红（实测 suite 红、探针绿，
    // 差别就在探针那台设备上有真待办）。
    qa(P+" .todo .cb").slice(0,3).forEach(function(cb,i){
      var td=cb.closest(".todo"), bs=getComputedStyle(cb,"::before");
      var r=cb.getBoundingClientRect(), tr=td.getBoundingClientRect(), tcs=getComputedStyle(td);
      var circleL=r.left+(parseFloat(bs.left)||0);
      // 键名必须紧跟 =：闸门侧的正则是 r"TINT (\w+)=(.*)"，写成
      // "geo0 circleL=..." 时键会被解析成 circleL，geo 前缀一个都收不到（实测红成
      // 「没量到 .cb 几何」，而日志里 geo0/geo1 两行明明白白在）
      L("geo"+i+"=circleL="+circleL.toFixed(2)+" padBoxL="+(tr.left+tr.width).toFixed(2)
        +" padBoxL0="+(tr.left+(parseFloat(tcs.borderLeftWidth)||0)+(parseFloat(tcs.paddingLeft)||0)).toFixed(2)
        +" overflow="+tcs.overflow+" w="+r.width.toFixed(2));
    });
    // 3) 点 .cb → 服务端 done 翻转 → 行从「未完成」列表消失 → 点回来
    var row=null;
    // .ttx 的 textContent 还包含 <small> 里的到期时间和笔记标题，按前缀匹配会撞车
    // （实测点到另一条待办上）：取第一个文本节点，那才是 esc(t.text) 本身。
    var rowOf=function(txt){ var r=null; qa(P+" .todo").forEach(function(x){
      var tx=x.querySelector(".ttx");
      if(!r && tx && tx.firstChild && tx.firstChild.nodeValue===txt) r=x }); return r };
    var row=rowOf(t0?t0.t.text:"");
    L("row="+(row?"found":"none"));
    if(row){
      var r0=rows();
      row.querySelector(".cb").click(); await sleep(1700);
      var s1=await api("/api/state"), t1=findTodo(s1,tid);
      var row2=rowOf(t1?t1.t.text:"");
      L("done1="+(t1&&t1.t.done));
      L("rows0="+r0);
      L("rows1="+rows());
      L("moved="+(row2?"still":"gone"));
      // 复原：勾完的项默认被「已完成」筛掉，行不在 DOM 里，用游离节点直接调 handler 点回来
      var ghost=document.createElement("div"); ghost.className="todo";
      // window. 前缀：闸门② 的闭集只放行 10 个桥函数，toggle 是导出表里的 DOM handler，
      // 裸写会让闸门② 红（导出表是 Object.assign(window, …)，window.toggle 就是它本身）
      window.toggle(nid, tid, ghost); await sleep(1700);
      var s2=await api("/api/state"), t2=findTodo(s2,tid);
      L("done2="+(t2&&t2.t.done));
    }
    // 4) 搜索态：Vue 渲染的行数必须等于 SR.todoIds 里未完成的条数
    var keys=fx.map(function(f){ return f.nid+"|"+f.tid });
    if(keys.length>=2){
      var sub={}; sub[keys[0]]=1; sub[keys[1]]=1;
      __enote.state.SR={notes:[],todoIds:sub,where:{},total:2,scanned:2};
      await render(); await sleep(250);
      L("srRows="+rows());
      L("srWant=2");
      __enote.state.SR={notes:null,todoIds:null,where:{},total:0,scanned:0};
      await render(); await sleep(250);
    }
    L("srSkip="+(keys.length<2?"1":"0"));
  }catch(e){ L("ERR="+(e&&e.message)+" @ "+String((e&&e.stack)||"").split("\n")[1]) }
  var okDel=0;
  for(var i=0;i<fx.length;i++){
    try{ var rr=await api("/api/todo",{action:"delete",noteId:fx[i].nid,todoId:fx[i].tid});
         if(rr&&rr.ok) okDel++ }catch(e){ L("cleanErr="+(e&&e.message)) }
  }
  L("cleaned="+okDel);
  L("done=1");
})()' > "$TMPDIR/jstint.json"
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jstint.json'"
for i in $(seq 1 60); do
  readtlog | tail -n +$((NIT + 1)) | grep -q 'TINT done=1' && break
  sleep 0.5
done
readtlog | tail -n +$((NIT + 1)) | grep 'TINT' | "$PY" -c '
import sys, re
lines = [l.strip() for l in sys.stdin if "TINT" in l]
d = {}
for l in lines:
    m = re.search(r"TINT (\w+)=(.*)", l)
    if m: d[m.group(1)] = m.group(2).strip()
assert d.get("done") == "1", "TINT 载荷没跑完（无 done）：前端抛异常了？日志=%s" % lines[:2]
assert d.get("isVue") == "true", \
  "__enote.vue.isVue(todos) 不是 true：Vue 装配掉了或注册表没 todos，本步测的不是 Vue 路径"
assert d.get("mounted2") == "true", "切到 todos 并 render() 后 TodosView 仍没挂载"
assert d.get("tid") == "ok", "造不出待办夹具数据，本步断言会是空跑"
assert d.get("row") == "found", "待办页找不到夹具项对应的行（.ttx 文本对不上）"
# JS 的 String(true) 是小写 "true"，不是 Python 的 "True"
assert d.get("done1") == "true", \
  "点 .cb 后服务端 done 没翻转（%s→%s）：tick 链断了，Vue 没重渲染或点击没提交" % (
    d.get("done0"), d.get("done1"))
assert d.get("moved") == "gone" and int(d["rows1"]) == int(d["rows0"]) - 1, \
  "勾选后行没从「未完成」列表消失（rows %s→%s，%s）：动画/重绘没跟上" % (
    d.get("rows0"), d.get("rows1"), d.get("moved"))
assert d.get("done2") == d.get("done0"), \
  "再点一次没复原（%s→%s）：夹具会污染真数据" % (d.get("done0"), d.get("done2"))
if d.get("srSkip") != "1":
    assert d.get("srRows") == d.get("srWant"), \
      "搜索态下 Vue 渲染 %s 行，SR.todoIds 里未完成的有 %s 条：SR 遮蔽又回来了（computed 没读 SR）" % (
        d.get("srRows"), d.get("srWant"))
geos = [v for k, v in d.items() if k.startswith("geo")]
assert geos, "夹具渲染后没量到 .cb 几何：Vue 没画出 .todo .cb？"
for g in geos:
    kv = dict(re.findall(r"(\w+)=(-?[\d.]+|\w+)", g))
    assert float(kv["circleL"]) >= float(kv["padBoxL0"]) - 0.5, \
      ".cb 圆圈左边缘 %s 在父 padding-box 左边缘 %s 之外（被裁）：overflow=%s" % (
        kv["circleL"], kv["padBoxL0"], kv["overflow"])
assert d.get("cleaned") == d.get("made"), \
  "夹具待办没删干净（造 %s 删 %s）：会污染下一轮和真数据" % (d.get("made"), d.get("cleaned"))
print("  ok (勾选/复原/SR 搜索态在 Vue 路径上真生效；.cb 圆圈未被裁 %s)" % geos[0])
'
asroot_global "rm -f '$DATA/enote/.devmode'"

step "附件页交互在 Vue 路径上真的生效（预览 toast / 删除确认 / strip 计数）"
# 步骤 7 的 FilesView 转 Vue。这条用真点击钉住四件事：
# Vue 路径是活的、卡片点击能弹预览 toast、删除按钮走确认框并真删到服务端、
# 顶部 strip 的计数读的是实时 FA（不是装配时那份快照）。
# 夹具只能从 shell 侧造：附件由分享意图产生，JS 侧没有建附件的 API（/api/attach 只有 delete）。
EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
FIXNAME="vue-files-fixture.pdf"
UID_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\ntrailer2 %s\n' "Vue 附件夹具$$" > "$TMPDIR/$FIXNAME"
asroot_global "mkdir -p '$EXT' && cp '$TMPDIR/$FIXNAME' '$EXT/$FIXNAME' && chown '$UID_APP:$UID_APP' '$EXT/$FIXNAME' && chmod 644 '$EXT/$FIXNAME'" \
  || fail "cannot stage $FIXNAME in $EXT"
# 上一轮残留会让计数和「找到夹具卡片」的断言假绿，先清干净
api_get attachments | "$PY" -c 'import json,sys
for a in (json.load(sys.stdin).get("items") or []):
    if a["name"] == "vue-files-fixture.pdf": print(a["id"])' | while read -r x; do
  api_post attach/delete "{\"id\":\"$x\"}" >/dev/null; done
FIXNOTE=$(api_get "attachments?q=vue-files-fixture" | "$PY" -c 'import json,sys
items = json.load(sys.stdin).get("items") or []
print(items[0]["noteId"] if items else "")')
am_start "$APP_PACKAGE/.ShareActivity" "-a android.intent.action.SEND -t application/pdf --eu android.intent.extra.STREAM file://$EXT/$FIXNAME"
FIXAID=""
for i in $(seq 1 40); do
  FIXAID=$(api_get "attachments?q=vue-files-fixture" | "$PY" -c 'import json,sys
items = json.load(sys.stdin).get("items") or []
print(items[0]["id"] if items else "")' 2>/dev/null)
  [ -n "$FIXAID" ] && break
  sleep 0.5
done
[ -n "$FIXAID" ] || fail "共享的夹具附件没出现在 /api/attachments：夹具不存在，下面的断言会是空跑"
FIXNOTE=$(api_get "attachments?q=vue-files-fixture" | "$PY" -c 'import json,sys
print((json.load(sys.stdin).get("items") or [{}])[0]["noteId"])')
# 夹具到位之后再刷新一次附件页：render() 不会去拉附件（filesNow() 才会），不先加载好
# FA，下面的交互用例比的是骨架屏，没有真卡片可点。
# jseval 钩子只在 .devmode 存在时干活（上一块刚把它删了），不 touch 就是
# `{"ok":false,"error":"jseval disabled"}`：载荷根本没跑，日志里一条也没有（真机撞过）。
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  var L=function(m){console.log("FLOAD "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    __enote.state.tab="files";
    // filesNow() 的结果会被服务端搜索的 searchSeq 抢占（app.js 里 if(my !== searchSeq) return），
    // 单发一次 await 可能整次被丢掉 → FA.loaded 永远停在 false：真机撞过两次跑一次红一次绿，
    // 套件里前后步骤都在 am start / 切 tab / 写数据，期间一定会有自己的 refresh。照剪贴板横幅
    // 那条的写法轮询（最多 12 次、每次 250ms），轮询不到才让下面的断言红。
    var tries=0;
    while(tries<12){
      tries++;
      await __enote.vue.host.filesNow();
      if(__enote.vue.host.FA.loaded===true) break;
      await sleep(250);
    }
    L("tries="+tries);
    L("fa="+__enote.vue.host.FA.items.length);
    L("loaded="+__enote.vue.host.FA.loaded);
  }catch(e){ L("ERR="+(e&&e.message)) }
  L("done=1");
})()' > "$TMPDIR/jsfload.json"
NFL=$(readtlog | wc -l)
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsfload.json'"
for i in $(seq 1 40); do
  readtlog | tail -n +$((NFL + 1)) | grep -q 'FLOAD done=1' && break
  sleep 0.5
done
readtlog | tail -n +$((NFL + 1)) | grep 'FLOAD' | "$PY" -c '
import sys, re
lines = [l.strip() for l in sys.stdin if "FLOAD" in l]
d = {}
for l in lines:
    m = re.search(r"FLOAD (\w+)=(.*)", l)
    if m: d[m.group(1)] = m.group(2).strip()
assert d.get("done") == "1", "FLOAD 载荷没跑完：日志=%s" % lines[:2]
assert d.get("ERR") is None, "FLOAD 抛异常：%s" % d.get("ERR")
assert d.get("loaded") == "true", \
  "FA.loaded 仍是 %s：filesNow() 轮询 %s 次没拉到数据" % (d.get("loaded"), d.get("tries"))
assert int(d.get("fa", "0")) >= 1, "FA 里只有 %s 条附件，夹具没进去" % d.get("fa")
print("  ok (FA 已加载 %s 条，下面的交互用例有真卡片可点)" % d["fa"])
'
NFT=$(readtlog | wc -l)
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  var L=function(m){console.log("FINT "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var qa=function(s){return [].slice.call(document.querySelectorAll(s))};
  var P=".pane[data-tab=files]";
  var FIX="vue-files-fixture.pdf";
  var cardOf=function(){ var r=null; qa(P+" .acard").forEach(function(c){
    var n=c.querySelector(".aname");
    if(!r && n && n.textContent===FIX) r=c }); return r };
  try{
    // 1) Vue 路径必须是活的：装配掉了 / 注册表没 files 时，本步测的不是 Vue 路径
    L("isVue="+(__enote.vue?__enote.vue.isVue("files"):"no-vue"));
    if(!(__enote.vue && __enote.vue.host && __enote.vue.host.filesNow)){
      L("ERR=no-host"); L("done=1"); return }
    // filesNow 不在导出表（它不是内联 handler），测试刷新走 __enote.vue.host 观测缝
    __enote.state.tab="files";
    // 同 FLOAD：单发 filesNow() 会被 searchSeq 抢占，FA 停在骨架屏 → 下面「找不到夹具卡片」，
    // 红的是测试的竞态而不是产品。轮询到「已加载且有卡片」再看 DOM。
    var ftries=0;
    while(ftries<12){
      ftries++;
      await __enote.vue.host.filesNow();    // 内部会 render()
      if(__enote.vue.host.FA.loaded===true && __enote.vue.host.FA.items.length>0) break;
      await sleep(250);
    }
    L("tries="+ftries);
    await sleep(500);
    L("mounted2="+(__enote.vue?!!__enote.vue.apps.files:"no-vue"));
    // 2) 渲染保真度：FA 里有几条就画几张卡，strip 的计数是实时 FA（不是装配时那份快照）
    var FA=__enote.vue.host.FA;
    L("fa="+FA.items.length);
    L("total="+FA.total);
    L("cards="+qa(P+" .acard").length);
    var st0=document.querySelector(P+" .strip");
    L("strip="+(st0?st0.textContent.replace(/\s+/g," ").trim():"none"));
    // 3) 点卡片 → openAttach 的 toast（Vue 的 @click 绑的 H.openAttach）
    var card=cardOf();
    L("card="+(card?"found":"none"));
    if(!card){ L("done=1"); return }
    card.click(); await sleep(400);
    var tst=document.getElementById("toast");
    L("toastOn="+tst.classList.contains("on"));
    L("toast="+tst.textContent.replace(/\s+/g," ").trim());
    // 4) 点「删除」→ askDel 确认框 → 确认 → 服务端真删了 → 行从 DOM 消失
    var del=card.querySelector(".arow .dg");
    L("delBtn="+(del?"found":"none"));
    if(!del){ L("done=1"); return }
    var cardsBefore=qa(P+" .acard").length;
    del.click(); await sleep(300);
    L("dlg="+document.getElementById("dlg").classList.contains("on"));
    document.getElementById("dlgYes").click();
    var left=-1;
    for(var i=0;i<40;i++){ await sleep(300);
      var r=await api("/api/attachments?q=vue-files-fixture"); left=(r.items||[]).length;
      if(!left) break }
    L("apiLeft="+left);
    await sleep(800);   // delAttach 里 filesNow() 会重绘，给 DOM 一拍
    L("gone="+(cardOf()?"still":"gone"));
    L("cards2="+qa(P+" .acard").length);
    L("cardsBefore="+cardsBefore);
  }catch(e){ L("ERR="+(e&&e.message)+" @ "+String((e&&e.stack)||"").split("\n")[1]) }
  L("done=1");
})()' > "$TMPDIR/jsfint.json"
# 上一块末尾会删 .devmode（jseval 钩子只在它存在时干活），不重新 touch 就是
# 「载荷根本没跑，日志里一条 FINT 也没有」。
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsfint.json'"
for i in $(seq 1 60); do
  readtlog | tail -n +$((NFT + 1)) | grep -q 'FINT done=1' && break
  sleep 0.5
done
readtlog | tail -n +$((NFT + 1)) | grep 'FINT' | "$PY" -c '
import sys, re
lines = [l.strip() for l in sys.stdin if "FINT" in l]
d = {}
for l in lines:
    m = re.search(r"FINT (\w+)=(.*)", l)
    if m: d[m.group(1)] = m.group(2).strip()
assert d.get("done") == "1", "FINT 载荷没跑完（无 done）：前端抛异常了？日志=%s" % lines[:2]
assert d.get("isVue") == "true", \
  "__enote.vue.isVue(files) 不是 true：Vue 装配掉了或注册表没 files，本步测的不是 Vue 路径"
assert d.get("mounted2") == "true", "切到 files 并 filesNow() 后 FilesView 仍没挂载"
assert d.get("ERR") is None, "FINT 载荷抛异常：%s" % d.get("ERR")
assert d.get("card") == "found", \
  "附件页找不到夹具卡片（.aname 对不上）：Vue 没画出附件卡片？filesNow 轮询 %s 次、FA=%s 条" % (
    d.get("tries"), d.get("fa"))
assert d.get("fa") == d.get("cards"), \
  "FA 里 %s 条而页面画了 %s 张卡：渲染保真度对不上（live() 没读 FA？）" % (
    d.get("fa"), d.get("cards"))
assert ("附件 " + d.get("total", "?")) in d.get("strip", ""), \
  "顶部 strip 是 %r，不含「附件 %s」：strip 读的不是实时 FA" % (
    d.get("strip"), d.get("total"))
assert d.get("toastOn") == "true" and "预览即将上线" in d.get("toast", ""), \
  "点卡片没出预览 toast（%r）：Vue 的 @click 没绑上 openAttach" % d.get("toast")
assert d.get("delBtn") == "found", "卡片里没有删除按钮（.arow .dg）"
assert d.get("dlg") == "true", "点删除没弹确认框：delAttach 没绑上"
assert d.get("apiLeft") == "0", "确认后服务端还有 %s 条夹具附件：删除没提交" % d.get("apiLeft")
assert d.get("gone") == "gone", "删除后卡片还在页面上：tick 链断了，Vue 没重渲染"
assert int(d["cards2"]) == int(d["cardsBefore"]) - 1, \
  "删除后卡片数 %s→%s：没少一张" % (d.get("cardsBefore"), d.get("cards2"))
print("  ok (预览 toast / 删除确认 / strip 计数在 Vue 路径上真生效，%s 张卡)" % d.get("cards"))
'
# 空态那一遍（FA.loaded=true 且 items=[]）：步骤 7 的审查在这里抓到过真 DOM 漂移 ——
# <empty-state> 收了 :tick，而 EmptyState 的 props 只有 icon/title/sub，透传成
# <div class="empty" tick="27">。FINT 末尾刚把夹具附件删掉，FA 正好是 loaded + 空；
# 下面先断言页面真的是空态（.empty 在、.skel 不在），免得「断言的是另一种状态」。
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'"
"$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' '(async function(){
  var L=function(m){console.log("FEMPTY "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    __enote.state.tab="files";
    // 同 FLOAD：轮询到「已加载且为空」再看空态 DOM，否则比的可能是骨架屏。
    var tries=0;
    while(tries<12){
      tries++;
      await __enote.vue.host.filesNow();
      if(__enote.vue.host.FA.loaded===true && __enote.vue.host.FA.items.length===0) break;
      await sleep(250);
    }
    L("tries="+tries);
    L("fa="+__enote.vue.host.FA.items.length);
    L("loaded="+__enote.vue.host.FA.loaded);
    await render();
    var P=".pane[data-tab=files]";
    var el=document.querySelector(P+" .empty");
    L("empty="+(el?"yes":"no"));
    L("skel="+(document.querySelector(P+" .skel")?"yes":"no"));
    L("tickAttr="+(el?(el.getAttribute("tick")||"none"):"noel"));
  }catch(e){ L("ERR="+(e&&e.message)) }
  L("done=1");
})()' > "$TMPDIR/jsempty.json"
NFE=$(readtlog | wc -l)
asroot_global "sh '$TMPDIR/jseval.sh' '$TMPDIR/jsempty.json'"
for i in $(seq 1 40); do
  readtlog | tail -n +$((NFE + 1)) | grep -q 'FEMPTY done=1' && break
  sleep 0.5
done
readtlog | tail -n +$((NFE + 1)) | grep 'FEMPTY' | "$PY" -c '
import sys, re
lines = [l.strip() for l in sys.stdin if "FEMPTY" in l]
d = {}
for l in lines:
    m = re.search(r"FEMPTY (\w+)=(.*)", l)
    if m: d[m.group(1)] = m.group(2).strip()
assert d.get("done") == "1", "FEMPTY 载荷没跑完（无 done）：日志=%s" % lines[:2]
assert d.get("ERR") is None, "FEMPTY 载荷抛异常：%s" % d.get("ERR")
assert d.get("loaded") == "true", \
  "FA.loaded 仍是 %s：filesNow() 轮询 %s 次，这一遍比的还是骨架屏" % (d.get("loaded"), d.get("tries"))
assert d.get("fa") == "0", "FA 里还有 %s 条附件：这一遍比的不是空态" % d.get("fa")
assert d.get("empty") == "yes", "页面上没有 .empty：这一遍比的不是空态（空跑）"
assert d.get("skel") == "no", "页面上还有骨架屏 .skel：FA.loaded 与 DOM 不一致"
assert d.get("tickAttr") == "none", \
  "空态根元素上多了 tick 属性（%s）：组件没声明的 prop 透传成 DOM 属性" % d.get("tickAttr")
print("  ok (FA 已加载且为空，空态 DOM 形状正确（无 tick 属性）)")
'
# 夹具清理：附件由分享意图建了一条笔记，删掉笔记（连带附件文件），别污染真数据和后续用例
asroot_global "rm -f '$EXT/$FIXNAME'" >/dev/null 2>&1 || true
if [ -n "$FIXNOTE" ]; then api_post delete "{\"id\":\"$FIXNOTE\"}" >/dev/null 2>&1 || true; fi
api_get attachments | "$PY" -c 'import json,sys
for a in (json.load(sys.stdin).get("items") or []):
    if a["name"] == "vue-files-fixture.pdf": print(a["id"])' | while read -r x; do
  api_post attach/delete "{\"id\":\"$x\"}" >/dev/null; done
asroot_global "rm -f '$DATA/enote/.devmode'"

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
