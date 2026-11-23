#!/bin/sh
# 步骤 7 的视觉验收：附件页转 Vue 之后截明 / 暗两张，外加一张卡片特写。
#
# 为什么要有这个脚本：FilesView 是网格布局，DOM 逐字一致（VDIFF）比不出「缩略图没画出来」
# 「glyph 图标缺了」「卡片底部按钮溢出」这类视觉事实；步骤 6 的教训是「验收项自己空跑」，
# 所以这里把 Tony 那三条硬约束照搬一遍：
#   1) 夹具自己造，且必须断言造成功（附件只能由分享意图产生，JS 侧没有建附件的 API）；
#   2) 走真实用户路径点底部导航（`tab='files'; render()` 不会同步 `.tab.on`），并断言高亮；
#   3) 四张图齐了才算过，量不到卡片直接 die，不 warn+跳过。
# 复用 tools/shots_todos.sh 的机制（jseval 钩子 + 后台显示截图 + 自量自算裁切坐标）。
#
#   ./vd.sh create && ./build.sh && ./install.sh && ./tools/shots_files.sh
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"
load_app_env "$HERE"

PY=python3
command -v "$PY" >/dev/null 2>&1 || die "python3 is needed"
have_root || die "需要 root 才能 am start 和截图"

OUT="$HERE/docs/shots"
TMPD=${TMPDIR:-/data/data/com.termux/files/usr/tmp}
DATA="/data/data/$APP_PACKAGE/files"
EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
TLOG="$DATA/testlog.txt"
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
[ -n "$UI_APP" ] || die "读不到 app 属主，无法开 .devmode"
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'" \
  || die "建 .devmode 失败（需要 root）"
VDID=$(sh "$HERE/vd.sh" id 2>/dev/null || true)
[ -n "$VDID" ] || die "没有后台显示（先 ./vd.sh create）"
mkdir -p "$OUT"

INJECT="$TMPD/shots_files_jseval.sh"
cat > "$INJECT" <<EOS
#!/bin/sh
am start --display $VDID -n $ACTIVITY --es hook jseval --es arg "\$(cat "\$1")" >/dev/null
EOS

run_js() {   # run_js <标签> <js>：注入并等日志里出现 `<标签> done=1`
  tag="$1"; js="$2"
  f="$TMPD/shots_files_$tag.json"
  "$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' "$js" > "$f"
  n0=$(asroot_global "cat '$TLOG' 2>/dev/null" | wc -l)
  asroot_global "sh '$INJECT' '$f'"
  i=0; out=""
  while [ "$i" -lt 90 ]; do
    out=$(asroot_global "cat '$TLOG' 2>/dev/null" | tail -n +$((n0 + 1)) | grep "$tag " || true)
    printf '%s\n' "$out" | grep -q "$tag done=1" && { printf '%s\n' "$out"; return 0; }
    i=$((i + 1)); sleep 0.5
  done
  printf '%s\n' "$out"
  return 1
}

kv() { printf '%s\n' "$1" | "$PY" -c 'import re,sys
m = re.search(r"%s=(\S+)" % sys.argv[1], sys.stdin.read())
print(m.group(1) if m else "")' "$2"; }

FX=视觉附件夹具
PDF="$TMPD/$FX甲.pdf"
PNG="$TMPD/$FX乙.png"
NEWIDS=""        # 本轮新产生的附件 id（cleanup 靠它们收尾，中途 die 也能清）
# 附件只能由分享意图产生（/api/attach 只有 delete），所以夹具从 shell 侧分享进来：
# 一个 PDF（glyph 卡片）+ 一张图片（缩略图卡片）。
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\ntrailer2 %s\n' "$FX" > "$PDF"

# 清理：删掉本轮夹具附件对应的笔记（删笔记会连带删附件文件），主题复原
cleanup() {
  js=$(printf '%s' '(async function(){
    var L=function(m){console.log("CLEAN "+m)};
    var FX="视觉附件夹具", IDS="__IDS__".split(",").filter(Boolean);
    try{
      var all=await api("/api/attachments"), ids={}, n=0;
      (all.items||[]).forEach(function(a){
        if(IDS.indexOf(a.id)>=0 || (a.name||"").indexOf(FX)===0) ids[a.noteId]=1 });
      for(var k in ids){ await api("/api/delete",{id:k}); n++ }
      setTheme("light");
      L("cleaned="+n); L("done=1");
    }catch(e){ L("ERR="+e); L("done=1") }
  })()' | sed "s/__IDS__/$NEWIDS/")
  run_js "CLEAN" "$js" >/dev/null 2>&1 || true
  asroot_global "rm -f '$EXT/$FX甲.pdf' '$EXT/$FX乙.png'" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT

asroot_global "am start --display $VDID -n $ACTIVITY" >/dev/null
sleep 3

# 先清上一轮残留（同名夹具会让「找到夹具卡片」的断言假绿），顺便拿 API 端口和现有 id 快照
FXOUT=$(run_js "FX" '(async function(){
  var L=function(m){console.log("FX "+m)};
  var FX="视觉附件夹具";
  try{
    L("port="+(location.port||""));
    var st=await api("/api/attachments?q="+encodeURIComponent(FX)), ids={};
    (st.items||[]).forEach(function(a){ ids[a.noteId]=1 });
    for(var k in ids) await api("/api/delete",{id:k});
    var all=await api("/api/attachments");
    L("before="+((all.items||[]).map(function(a){return a.id}).join(".")||"-"));
    L("purged="+Object.keys(ids).length); L("done=1");
  }catch(e){ L("ERR="+e); L("done=1") }
})()') || die "夹具准备载荷没跑完（没等到 FX done=1）：$FXOUT"
PORT=$(kv "$FXOUT" port)
IDS0=$(kv "$FXOUT" before | tr '.' ',')
[ -n "$PORT" ] || die "拿不到 API 端口（location.port 为空）：没法轮询夹具是否出现"
say "  $(printf '%s\n' "$FXOUT" | grep -o 'FX purged=.*' | tail -1) port=$PORT"

# 图片夹具用当前屏幕裁一张真图（缩略图卡片要有真像素，纯色块看不出裁切/比例）
sh "$HERE/vd.sh" shot "$TMPD/shots_files_src.png" >/dev/null
"$HERE/tools/crop_png.py" "$TMPD/shots_files_src.png" "$PNG" 0 0 640 420 >/dev/null

share() {   # share <文件名> <mime>
  asroot_global "cp '$1' '$EXT/' && chown '$UI_APP:$UI_APP' '$EXT/$(basename "$1")' \
    && chmod 644 '$EXT/$(basename "$1")'" || die "把夹具放进 $EXT 失败"
  # ShareActivity 不带 --display：root 在虚拟屏上开新任务会被 SafeActivityOptions 拒掉
  asroot_global "am start -n '$APP_PACKAGE/.ShareActivity' -a android.intent.action.SEND \
    -t '$2' --eu android.intent.extra.STREAM 'file://$EXT/$(basename "$1")'" >/dev/null
}
share "$PDF" "application/pdf"
sleep 3
share "$PNG" "image/png"

# 轮询等两个夹具都出现：分享是异步的（OCR/解析要时间），固定 sleep 会 flake。
# 不能按名字查：image/* 的分享走 OCR 通道，落盘文件被改名成 <时间戳>.png，附件名里
# 根本没有「视觉附件夹具」（实测 q=视觉附件夹具 只命中 PDF 那一条）—— 所以比 id 快照。
ATT=0
for i in $(seq 1 60); do
  NEW=$(curl -s -m 10 --noproxy '*' "http://127.0.0.1:$PORT/api/attachments" \
    | "$PY" -c 'import json,sys
old = set(sys.argv[1].split(",")) - {"", "-"}
items = json.load(sys.stdin).get("items") or []
new = [a["id"] for a in items if a["id"] not in old]
print(len(new)); print(",".join(new))' "$IDS0" 2>/dev/null)
  ATT=$(printf '%s\n' "$NEW" | head -1)
  NEWIDS=$(printf '%s\n' "$NEW" | sed -n '2p')
  [ "${ATT:-0}" -ge 2 ] && break
  sleep 1
done
say "  新增夹具附件：$ATT（id=${NEWIDS:-无}）"
[ "${ATT:-0}" -ge 2 ] || die "夹具附件只出现 $ATT 个（要 ≥2）：截图会拍到空列表，验收项空跑"

# 量第一张卡片的位置（裁切特写用）
CARDRECT=""
measure() {
  out=$(run_js "RECT" '(async function(){
    var c=document.querySelector(".pane[data-tab=files] .acard");
    if(!c){ console.log("RECT none"); console.log("RECT done=1"); return }
    var r=c.getBoundingClientRect(), d=window.devicePixelRatio||1;
    console.log("RECT dpr="+d+" x="+r.left.toFixed(1)+" y="+r.top.toFixed(1)
      +" w="+r.width.toFixed(1)+" h="+r.height.toFixed(1));
    console.log("RECT done=1") })()') || die "RECT 载荷没跑完（没等到 RECT done=1）：$out"
  CARDRECT=$(printf '%s\n' "$out" | grep -o 'RECT dpr=.*' | tail -1)
  say "  $CARDRECT"
}

crop_card() {   # crop_card <输出名>：整张卡片连边距裁出来，肉眼复核网格/图标/按钮
  name="$1"
  [ -n "$CARDRECT" ] || die "没量到 .acard 位置：卡片特写出不来"
  eval "$(printf '%s' "$CARDRECT" | "$PY" -c '
import re, sys
kv = dict(re.findall(r"(\w+)=([\d.]+)", sys.stdin.read()))
if "x" not in kv:
    print("CARD_OK=0")
else:
    d = float(kv.get("dpr") or 1)
    print("CARD_OK=1")
    print("CX=%d" % max(0, (float(kv["x"]) - 10) * d))
    print("CY=%d" % max(0, (float(kv["y"]) - 10) * d))
    print("CW=%d" % ((float(kv["w"]) + 20) * d))
    print("CH=%d" % ((float(kv["h"]) + 20) * d))
')"
  [ "${CARD_OK:-0}" = "1" ] || die "RECT 里没有坐标：$CARDRECT"
  "$HERE/tools/crop_png.py" "$OUT/$name.png" "$OUT/$name-card.png" "$CX" "$CY" "$CW" "$CH"
  say "  → docs/shots/$name-card.png（裁切 $CX,$CY ${CW}x${CH}）"
}

shot() {   # shot <输出名> <主题>
  name="$1"; theme="$2"
  js=$(printf '%s' '(async function(){
    var L=function(m){console.log("SHOT "+m)};
    var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
    try{
      setTheme("__THEME__");
      // 先点「笔记」再点「附件」：.tabbar .tab 的 handler 对「点当前 tab」是 early return
      // （app.js:1885），上一轮探针把模块里的 tab 设成过 files，直接点附件什么也不做。
      var n0=document.querySelector(".tabbar .tab[data-tab=notes]");
      if(n0){ n0.click(); await sleep(400) }
      var b=document.querySelector(".tabbar .tab[data-tab=files]");
      if(!b){ L("ERR=no-tab-btn"); L("done=1"); return }
      b.click();
      await sleep(1600);
      var P=".pane[data-tab=files]";
      var on=document.querySelector(".tabbar .tab.on");
      L("theme="+__enote.state.S.settings.theme);
      L("nav="+(on?on.getAttribute("data-tab"):"none"));
      L("cards="+document.querySelectorAll(P+" .acard").length);
      L("thumbs="+document.querySelectorAll(P+" .athumb").length);
      L("strip="+((document.querySelector(P+" .strip")||{}).textContent||"none")
        .replace(/\s+/g," ").trim());
      L("done=1");
    }catch(e){ L("ERR="+e); L("done=1") }
  })()' | sed "s/__THEME__/$theme/g")
  out=$(run_js "SHOT" "$js") || die "SHOT 载荷没跑完（没等到 SHOT done=1）：$out"
  nav=$(kv "$out" nav); cards=$(kv "$out" cards); th=$(kv "$out" theme)
  say "  nav=$nav cards=$cards thumbs=$(kv "$out" thumbs) $(printf '%s\n' "$out" | grep -o 'strip=.*' | tail -1)"
  [ "$nav" = "files" ] || die "底部导航高亮的是「$nav」而画面是附件页：导航和页面不一致的图不能当验收"
  [ "$th" = "$theme" ] || die "主题没切过去（要 $theme，实际 $th）"
  [ "${cards:-0}" -ge 2 ] || die "附件页只有 $cards 张卡片，夹具没进画面：验收项空跑"
  measure
  sh "$HERE/vd.sh" shot "$OUT/$name.png" >/dev/null
  say "  → docs/shots/$name.png"
  crop_card "$name"
}

shot vue-files-light light
shot vue-files-dark dark

cd "$OUT"
for f in vue-files-light.png vue-files-light-card.png vue-files-dark.png vue-files-dark-card.png; do
  [ -s "$f" ] || die "$f 不存在或是空文件：验收证据缺一张"
done
n=$(md5sum vue-files-light.png vue-files-dark.png | awk '{print $1}' | sort -u | wc -l)
say "明暗两张唯一图片数：$n / 2"
[ "$n" -ge 2 ] || die "明暗两图相同：注入没生效，别把假图当验收"
say "四张齐：vue-files-{light,dark}.png + 两张 -card.png（夹具笔记已删，主题已复原）"
