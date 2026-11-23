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

shoot vue-notes-light
shoot vue-notes-dark "setTheme('dark'); await render();"
# 空态：走真 API 清空（只改 S.notes 被两层遮蔽：SR.notes 优先 + 2s 轮询整体替换 S），截完恢复
shoot vue-notes-empty "var A=__enote.actions; var ids=__enote.state.S.notes.map(function(n){return n.id}); window.__svIds=ids; for(var i=0;i<ids.length;i++){ await A.api('/api/delete',{id:ids[i]}) } await A.refresh(true); await sleep(600);"
# 三横幅同时出现：造 MISSED + clip 计数
shoot vue-notes-banners "__enote.state.MISSED={count:2,items:[{id:'t1',nid:'n1',title:'x',at:Date.now()-60000}]}; __enote.state.S.info.clip=3; await render();"
# 恢复现场：补回刚删的笔记、主题回明色，别让下一轮测试接到脏状态
asroot_global "am start --display $VDID -n $ACTIVITY --es hook jseval --es arg '{\"js\":\"(async function(){ var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})}; var A=__enote.actions; var ids=window.__svIds||[]; for(var i=0;i<ids.length;i++){ await A.api(\\\"/api/add\\\",{text:\\\"标题 \\\"+i}) } await A.refresh(true); await sleep(1200); await A.refresh(true); setTheme(\\\"light\\\"); await render(); console.log(\\\"SHOT restore ok=1\\\") })()\"}'" >/dev/null

cd "$OUT"
n=$(md5sum vue-notes-*.png | awk '{print $1}' | sort -u | wc -l)
say "唯一图片数：$n / 4"
# 四张必须互不相同：空态和横幅两张尤其关键，相同说明注入没生效（不报错的坑）
[ "$n" -ge 4 ] || die "截图内容重复：注入没生效，别把假图当验收"
