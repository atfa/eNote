#!/bin/sh
# 截 7 个视图的「改造前」基线进 docs/shots/before/。
#
# 为什么需要这个脚本：S7 的验收是「改造前后对比」，而 S2 一开始动 CSS 就没有「前」了。
# 基线必须在 S1a 落地后、S2 动手前截，所以写成脚本，谁跑都能重造。
#
#   ./vd.sh create && ./build.sh && ./install.sh && ./tools/shots_before.sh
#
# 复用 test.sh 的 jseval 通道（am start --es hook jseval），不另造机制。
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"
load_app_env "$HERE"

PY=python3
command -v "$PY" >/dev/null 2>&1 || die "python3 is needed"
have_root || die "需要 root 才能 am start 和截图"

OUT="$HERE/docs/shots/before"
mkdir -p "$OUT"
TMPD=${TMPDIR:-/data/data/com.termux/files/usr/tmp}

# jseval 钩子只在开发者模式下响应，开关就是数据目录里一个空文件（与 test.sh:561 同一做法）。
# 少了它 am start 不报错、也不执行，截出来 7 张全是同一页——不报错的坑最难查。
DATA="/data/data/$APP_PACKAGE/files"
UI_APP=$(asroot_global "stat -c%U '/data/data/$APP_PACKAGE'" | tr -d '\r')
[ -n "$UI_APP" ] || die "读不到 app 属主，无法开 .devmode"
asroot_global "touch '$DATA/enote/.devmode'; chown '$UI_APP:$UI_APP' '$DATA/enote/.devmode'" \
  || die "建 .devmode 失败（需要 root）"

# 必须带 --display：不带的话 am start 把意图交给「当前顶层实例」，app 会被拉回主屏，
# 后台显示上只剩壁纸——截图全成功但内容全错，也是不报错的坑。
VDID=$(sh "$HERE/vd.sh" id)
[ -n "$VDID" ] || die "没有后台显示（先 ./vd.sh create）"

JSEVAL="$TMPD/shots_jseval.sh"
cat > "$JSEVAL" <<EOS
#!/bin/sh
am start --display $VDID -n $ACTIVITY --es hook jseval --es arg "\$(cat "\$1")" >/dev/null
EOS

shoot() {   # shoot <输出名> <tab> <额外 JS>
  name="$1"; tabname="$2"; extra="${3:-}"
  # 走 setTab() 而不是直接改 tab：后者不更新底部 tab 高亮，截出来「内容在待办、
  # 高亮在笔记」，这种基线拿去跟改造后对比会骗人。
  js="(async function(){ tab='$tabname'; setTab(); await render(); ${extra} await sleep(700); console.log('SHOT $name ok=1') })()"
  f="$TMPD/shot_$name.json"
  "$PY" -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' "$js" > "$f"
  asroot_global "sh '$JSEVAL' '$f'"
  sleep 1.5
  sh "$HERE/vd.sh" shot "$OUT/$name.png" >/dev/null
  say "  → docs/shots/before/$name.png"
}

asroot_global "am start --display $VDID -n $ACTIVITY" >/dev/null
sleep 3

# 6 个 tab（mine = 我的页/统计）
shoot notes notes
shoot todos todos
shoot files files
shoot clip clip
shoot mine mine
shoot settings settings
# 截图页是面板不是 tab：先进 files 再开截图面板
shoot shots files "shotSheet();"

# 7 张必须互不相同，否则说明切页没生效（这个脚本自己也要被检查）。
cd "$OUT"
n=$(md5sum *.png | awk '{print $1}' | sort -u | wc -l)
say "唯一图片数：$n / 7"
[ "$n" -ge 6 ] || die "截图内容重复：切页没生效，别把假基线当真的"
