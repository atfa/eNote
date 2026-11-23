#!/bin/sh
# 步骤 5 的视觉验收：Notes 转 Vue 之后截四张（明 / 暗 / 空态 / 三横幅）。
#
# 为什么要有这个脚本，而不是只看 test.sh 绿：本步的契约是「行为零变化」，
# VDIFF 夹具比的是 DOM 结构，比不出**视觉**漂移——class 逐字相同但层叠上下文变了、
# 组件根节点多包一层导致 margin 合并消失，这类问题只有眼睛能发现。
# 四张图分别钉住：正常列表、暗色、空态（v-if 分支）、三横幅同时出现。
#
#   ./vd.sh create && ./build.sh && ./install.sh && ./tools/shots_vue.sh
#
# 复用 tools/shots_before.sh 的机制（jseval 钩子 + 后台显示截图），不另造一套。
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
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
[ -n "$UI_APP" ] || die "读不到 app 属主，无法开 .devmode"
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'" \
  || die "建 .devmode 失败（需要 root）"

VDID=$(sh "$HERE/vd.sh" id)
[ -n "$VDID" ] || die "没有后台显示（先 ./vd.sh create）"

JSEVAL="$TMPD/shots_jseval.sh"
cat > "$JSEVAL" <<EOS
#!/bin/sh
am start --display $VDID -n $ACTIVITY --es hook jseval --es arg "\$(cat "\$1")" >/dev/null
EOS

shoot() {   # shoot <输出名> <额外 JS>
  name="$1"; extra="${2:-}"
  # 不能用 setTab()：app.js 是 ES module，setTab 不在导出表（闭合集）里，
  # 载荷里调它会抛 ReferenceError → 四张图全是未注入的同一张。
  # notes 是默认 tab，底部高亮本来就是对的，直接改 state.tab 就够。
  # 同理 sleep：它只是各载荷里自己写的局部 helper，不是全局，不定义就
  # 在末尾抛 ReferenceError（图能截到是因为注入已生效，但日志里一片红）。
  js="(async function(){ var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})}; __enote.state.tab='notes'; await render(); ${extra} await sleep(700); console.log('SHOT $name ok=1') })()"
  f="$TMPD/vshot_$name.json"
  "$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' "$js" > "$f"
  asroot_global "sh '$JSEVAL' '$f'"
  sleep 1.5
  sh "$HERE/vd.sh" shot "$OUT/$name.png" >/dev/null
  say "  → docs/shots/$name.png"
}

asroot_global "am start --display $VDID -n $ACTIVITY" >/dev/null
sleep 3

# ---------- 步骤 8：截图暂存页 / 选文件夹页 / 导入进度层 ----------
# VDIFF 比得出 DOM，比不出「图挂不挂得出来」「遮罩盖不盖全屏」，这两页只能眼睛看。
# 暂存区的图只能从分享意图产生（JS 侧没有建暂存的 API），走 /api/shots/add 造夹具。
PORT=$(asroot_global "cat '$DATA/enote/enote.log' 2>/dev/null" 2>/dev/null \
  | grep -o '127.0.0.1:[0-9]*' | tail -1 | cut -d: -f2)
[ -n "$PORT" ] || die "读不到本地 API 端口（app 没起来？）"
INBOX="/data/user/0/$APP_PACKAGE/files/enote/inbox"
FIX=''
for f in vsh-a.png vsh-b.png vsh-c.png; do
  "$PY" "$HERE/tools/make_test_png.py" "$TMPD/$f" 480 900 >/dev/null 2>&1 \
    || die "造测试图失败：$f"
  asroot_global "rm -f '$INBOX/$f'" >/dev/null 2>&1 || true
  asroot_global "cp '$TMPD/$f' '$INBOX/$f'; chown '$UI_APP:$UI_APP' '$INBOX/$f'; chmod 644 '$INBOX/$f'" \
    || die "推测试图到暂存区失败：$f"
  [ -n "$FIX" ] && FIX="$FIX,"
  FIX="$FIX{\"path\":\"$INBOX/$f\",\"name\":\"$f\",\"mime\":\"image/png\",\"dateAdded\":$(date +%s)}"
done
ADD=$(curl -s -m 60 -X POST "http://127.0.0.1:$PORT/api/shots/add" \
  -d "{\"shots\":[$FIX]}" 2>/dev/null)
echo "$ADD" | grep -q '"added":3' || die "造暂存截图夹具失败（截图页只能截到空态）：$ADD"
say "  暂存夹具已就位（3 张）"

shoot vue-notes-light "setTheme('light'); await render();"
shoot vue-notes-dark "setTheme('dark'); await render();"
# 空态：走真 API 清空（只改 S.notes 被两层遮蔽：SR.notes 优先 + 2s 轮询整体替换 S），截完恢复
shoot vue-notes-empty "var A=__enote.actions; var ids=__enote.state.S.notes.map(function(n){return n.id}); window.__svIds=ids; for(var i=0;i<ids.length;i++){ await A.api('/api/delete',{id:ids[i]}) } await A.refresh(true); await sleep(600);"
# 三横幅同时出现：错过提醒 + 新截图 + 剪贴板。
# shot 计数必须给：ShotBanner 的 kind 在 shot=0 且 SHOTFLAGS 全好时返回 ''（不渲染），
# 只造 MISSED + clip 截出来只有两条，图名与证据对不上。
shoot vue-notes-banners "__enote.state.MISSED={count:2,items:[{id:'t1',nid:'n1',title:'x',at:Date.now()-60000}]}; __enote.state.S.info.shot=5; __enote.state.S.info.clip=3; await render();"
# 步骤 8 的三张：截图暂存页（明/暗）+ 选文件夹页 + 导入进度层。
# 暂存页要看到真缩略图（/shotimg?id= 取不到图就是碎图），所以夹具走真 API 而不是注水数据。
shoot vue-shots-light "setTheme('light'); await render(); shotSheet();"
shoot vue-shots-dark "setTheme('dark'); await render(); shotSheet();"
shoot vue-folders-light "setTheme('light'); await render(); folderSheet();"
# 进度层：组件根带 v-if，未挂载时必须零残留（透明遮罩吃掉点击是用户能直接碰到的 bug）。
shoot vue-progress "setTheme('light'); await render(); shotOverlay(true,3,'AI 正在解析：1 / 3 条完成');"
# ---------- 步骤 9：剪贴板暂存页 ----------
# 暂存条目只能由系统剪贴板产生（Go 侧只暴露 list/remove/parse/clear），所以夹具走
# clipset 钩子：写剪贴板 → app 前台读取收进暂存区。三条文本必须互不相同（按内容去重）。
# 要看的是勾选框、删除图标、底部计数条与主按钮文案在两条主题下都正常。
# 三条之间隔 >5s：Go 侧 clipAdd 有「同来源 5s 内 → 覆盖最新一条」的规则（go/clip.go:124，
# 钩子写进来的 app 都是 "hook"），连发会塌成一条，截图就只有一条可看。6s = 5s 去抖 + 1s 余量。
IFI=0
for t in "标题：周五采购 内容：牛奶、面包、电池" "https://example.com/very/long/path/for/clip/preview/truncation/$(date +%s)" "一键解析演示：这行会被原样存为笔记"; do
  [ "$IFI" -gt 0 ] && sleep 6
  asroot_global "am start --display $VDID -n $ACTIVITY --es hook clipset --es arg '$t'" >/dev/null
  IFI=$((IFI + 1))
done
CN=0
i=0
while [ "$i" -lt 20 ]; do
  CN=$(curl -s -m 30 "http://127.0.0.1:$PORT/api/clip/list" | "$PY" -c 'import json,sys; print(len(json.load(sys.stdin).get("clips") or []))' 2>/dev/null || echo 0)
  [ "$CN" -ge 3 ] && break
  i=$((i + 1)); sleep 1
done
[ "$CN" -ge 3 ] || die "造剪贴板夹具只到 $CN 条（剪贴板页只能截到空态）"
say "  剪贴板夹具已就位（$CN 条）"
shoot vue-clip-light "setTheme('light'); await render(); clipSheet();"
shoot vue-clip-dark "setTheme('dark'); await render(); clipSheet();"
# 收干净：进度层关掉、弹层关掉、暂存夹具删掉，别让下一轮测试接到脏状态
asroot_global "am start --display $VDID -n $ACTIVITY --es hook jseval --es arg '{\"js\":\"(async function(){ shotOverlay(false); closeSheet(); console.log(\\\"SHOT cleanup ok=1\\\") })()\"}'" >/dev/null
curl -s -m 30 -X POST "http://127.0.0.1:$PORT/api/clip/clear" >/dev/null 2>&1 || true
IDS=$(curl -s -m 30 "http://127.0.0.1:$PORT/api/shots/list" | "$PY" -c 'import json,sys; print(json.dumps([x["id"] for x in json.load(sys.stdin).get("shots") or []]))')
[ "$IDS" != "[]" ] && curl -s -m 60 -X POST "http://127.0.0.1:$PORT/api/shots/remove" -d "{\"ids\": $IDS}" >/dev/null
# 恢复现场：补回刚删的笔记、主题回明色，别让下一轮测试接到脏状态。
# 轮询等卡片数回来，不用固定 sleep：实测 3 条 /api/add 到读数要 2.04s，
# 而原来 1200+800=2.0s 的预算只剩 0 秒余量 —— 定时依赖迟早自己变红。
asroot_global "am start --display $VDID -n $ACTIVITY --es hook jseval --es arg '{\"js\":\"(async function(){ var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})}; var A=__enote.actions; var ids=window.__svIds||[]; var n=ids.length; for(var i=0;i<n;i++){ await A.api(\\\"/api/add\\\",{text:\\\"标题 \\\"+i}) } for(var i=0;i<60;i++){ await A.refresh(true); await sleep(250); if(document.querySelectorAll(\\\".pane[data-tab=notes] .card\\\").length>=n) break } setTheme(\\\"light\\\"); await render(); console.log(\\\"SHOT restore ok=1\\\") })()\"}'" >/dev/null

cd "$OUT"
n=$(md5sum vue-notes-*.png | awk '{print $1}' | sort -u | wc -l)
say "唯一图片数：$n / 4"
# 四张必须互不相同：空态和横幅两张尤其关键，相同说明注入没生效（不报错的坑）
[ "$n" -ge 4 ] || die "截图内容重复：注入没生效，别把假图当验收"
m=$(md5sum vue-shots-*.png vue-folders-*.png vue-progress.png 2>/dev/null | awk '{print $1}' | sort -u | wc -l)
say "步骤 8 图片唯一数：$m / 4"
[ "$m" -ge 4 ] || die "步骤 8 截图重复/缺失：弹层注入没生效（shots/folders/progress）"
c=$(md5sum vue-clip-*.png 2>/dev/null | awk '{print $1}' | sort -u | wc -l)
say "步骤 9 图片唯一数：$c / 2"
[ "$c" -ge 2 ] || die "步骤 9 截图重复/缺失：clipSheet 注入没生效或剪贴板夹具没到位"
