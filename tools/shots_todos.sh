#!/bin/sh
# 步骤 6 的视觉验收：Todos 转 Vue 之后截明 / 暗两张，外加 `.cb` 圆圈的放大裁切。
#
# 为什么要有这个脚本：账本里记着「笔记卡片预览里 `.cb` 被左边缘裁一半」，而裁切是**视觉**
# 事实，DOM 逐字一致（VDIFF）比不出来 —— 圆圈完整画出来但被父级 overflow:hidden 裁掉，
# class 和结构可以一模一样。所以这一步的证据是「几何数据 + 放大图」两样：
#   * 几何数据在 test.sh 的 TINT 用例里（真机量 circleL vs 父 padding-box 左边缘，断言不裁）；
#   * 放大图由本脚本产出，肉眼复核圆圈是完整的。
# 复用 tools/shots_vue.sh 的机制（jseval 钩子 + 后台显示截图），不另造一套。
#
#   ./vd.sh create && ./build.sh && ./install.sh && ./tools/shots_todos.sh
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
TLOG="$DATA/testlog.txt"
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
[ -n "$UI_APP" ] || die "读不到 app 属主，无法开 .devmode"
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'" \
  || die "建 .devmode 失败（需要 root）"
VDID=$(sh "$HERE/vd.sh" id 2>/dev/null || true)
[ -n "$VDID" ] || die "没有后台显示（先 ./vd.sh create）"

JSEVAL="$TMPD/shots_todos_jseval.sh"
cat > "$JSEVAL" <<EOS
#!/bin/sh
am start --display $VDID -n $ACTIVITY --es hook jseval --es arg "\$(cat "\$1")" >/dev/null
EOS

# 量第一个 .cb 的位置（CSS px）连同 dpr：裁切要的是设备像素，两者只差这个系数。
# 走日志而不是 stdout：jseval 钩子只把 JS 的 console 输出写进 app 日志。
CBRECT=""
measure() {
  f="$TMPD/vshot_rect.json"
  "$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' \
    '(async function(){ var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
      var cb=document.querySelector(".pane[data-tab=todos] .todo .cb");
      if(!cb){ console.log("CBRECT none"); return }
      var r=cb.getBoundingClientRect(), d=window.devicePixelRatio||1;
      console.log("CBRECT dpr="+d+" x="+r.left.toFixed(1)+" y="+r.top.toFixed(1)
        +" w="+r.width.toFixed(1)+" h="+r.height.toFixed(1)) })()' > "$f"
  n0=$(asroot_global "cat '$TLOG' 2>/dev/null" | wc -l)
  asroot_global "sh '$JSEVAL' '$f'"
  i=0
  while [ "$i" -lt 30 ]; do
    CBRECT=$(asroot_global "cat '$TLOG' 2>/dev/null" | tail -n +$((n0 + 1)) | grep -o 'CBRECT .*' | tail -1)
    [ -n "$CBRECT" ] && break
    i=$((i + 1)); sleep 0.5
  done
  say "  $CBRECT"
}

shoot() {   # shoot <输出名> <额外 JS>
  name="$1"; extra="${2:-}"
  js="(async function(){ var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
      __enote.state.tab='todos'; await render(); ${extra} await sleep(700);
      console.log('SHOT $name ok=1') })()"
  f="$TMPD/vshot_$name.json"
  "$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' "$js" > "$f"
  asroot_global "sh '$JSEVAL' '$f'"
  sleep 1.5
  sh "$HERE/vd.sh" shot "$OUT/$name.png" >/dev/null
  say "  → docs/shots/$name.png"
}

crop_cb() {   # crop_cb <输出名>：把 .cb 连同左边距一起裁出来放大看
  name="$1"
  [ -n "$CBRECT" ] || { say "  (warn) 没量到 .cb 位置，跳过裁切"; return 0; }
  eval "$(printf '%s' "$CBRECT" | "$PY" -c '
import re, sys
kv = dict(re.findall(r"(\w+)=([\d.]+)", sys.stdin.read()))
if "x" not in kv:
    print("CB_OK=0")
else:
    d = float(kv.get("dpr") or 1)
    # 裁切框：圆圈左边再多留一点（要能看见卡片左边缘 = 裁切的边界），行高上下各留 8px
    x = (float(kv["x"]) - 44) * d
    y = (float(kv["y"]) - 8) * d
    w = 260 * d
    h = (float(kv["h"]) + 16) * d
    print("CB_OK=1")
    print("CBX=%d" % max(0, x))
    print("CBY=%d" % max(0, y))
    print("CBW=%d" % w)
    print("CBH=%d" % h)
')"
  [ "${CB_OK:-0}" = "1" ] || { say "  (warn) CBRECT 里没有坐标，跳过裁切"; return 0; }
  "$HERE/tools/crop_png.py" "$OUT/$name.png" "$OUT/$name-cb.png" "$CBX" "$CBY" "$CBW" "$CBH"
  say "  → docs/shots/$name-cb.png（裁切 $CBX,$CBY ${CBW}x${CBH}）"
}

asroot_global "am start --display $VDID -n $ACTIVITY" >/dev/null
sleep 3

shoot vue-todos-light "setTheme('light'); await render();"
measure
crop_cb vue-todos-light
shoot vue-todos-dark "setTheme('dark'); await render();"
measure
crop_cb vue-todos-dark
# 恢复现场：主题回明色，别让下一轮测试接到暗色状态（重置用例会把主题归一到 light，
# 但那是 test.sh 的事，截图脚本自己也要干净）
asroot_global "am start --display $VDID -n $ACTIVITY --es hook jseval --es arg '{\"js\":\"setTheme(\\\"light\\\"); render(); console.log(\\\"SHOT restore ok=1\\\")\"}'" >/dev/null

cd "$OUT"
n=$(md5sum vue-todos-light.png vue-todos-dark.png 2>/dev/null | awk '{print $1}' | sort -u | wc -l)
say "明暗两张唯一图片数：$n / 2"
[ "$n" -ge 2 ] || die "明暗两图相同：注入没生效，别把假图当验收"
