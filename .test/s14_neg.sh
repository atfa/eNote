#!/system/bin/sh
# 步骤 14 反向实验：证明这一步新加的三条防线不是恒绿装饰。
#
#   a) 闸门⑳（静态，秒级）：把 ClipItem 模板的稳定 id 改成固定串 'clipitem-x'。
#      模板里那句 :id 的模式没了 → 闸门⑳ 必须红；真机侧 CIT 的 getElementById 找不到元素，
#      item0=no，python 判红。
#   b) 260px 裁字（真机）：删掉 .pfoot .btnrow .btn 的 min-width:max-content。
#      内联 flex:1 让按钮可以缩到比自己的文字还窄（.btn 带 overflow:hidden，flex 项的
#      自动最小尺寸在 overflow≠visible 时退化成 0）→ 真机必须红在「260px 面板下底部按钮文字被裁」。
#   c) 解析失败分支（真机）：把 clipParse 的 try/catch 去掉（回到步骤 14 之前的形态：
#      fetch 抛错时没人接，连 toast 都没有）→ 真机必须红在「注入失败后没出「解析失败」的 toast」。
#   d) 加载失败三态（真机）：把 loadClips 的 catch 里的 clipLoading = false 删掉。
#      模板的三态判定是 v-if="loading" 优先，于是加载失败永远停在「加载中…」，
#      「加载失败」那一支是死代码 → 真机必须红在「注入 /api/clip/list 失败后没出加载失败空态」。
#   e) 顶层伪注释（静态，秒级）：把新 step 收尾那段注释改成行首斜杠星的 C 风格。
#      test.sh 是 sh 跑的，行首斜杠星是命令不是注释，set -eu 下 127 退出，而 bash -n 看不出来
#      → 闸门㉑ 必须红。
#   f) 断空被删（静态，秒级）：把「本步收尾后剪贴板暂存区不是 0」那条 fail 改成 || true
#      → 闸门㉑ 必须红（跨轮泄漏会躲过本轮，红在下一轮的硬基线，见 plan.md §9.20 ⑥）。
#
# app.js / css 都是 go:embed 进二进制的，所以 b/c 前后各要 build + install 一次。
# 用法：sh .test/s14_neg.sh [a|b|c|d|e|f|all]
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
WHICH=${1:-all}
BK="$TMPDIR/s14neg"
mkdir -p "$BK"
cp "$HERE/go/ui/js/app.js" "$BK/app.js.bak"
cp "$HERE/go/ui/js/views/clip.js" "$BK/clip.js.bak"
cp "$HERE/go/ui/css/components.css" "$BK/components.css.bak"
cp "$HERE/test.sh" "$BK/test.sh.bak"

restore() {
  cp "$BK/app.js.bak" "$HERE/go/ui/js/app.js"
  cp "$BK/clip.js.bak" "$HERE/go/ui/js/views/clip.js"
  cp "$BK/components.css.bak" "$HERE/go/ui/css/components.css"
  cp "$BK/test.sh.bak" "$HERE/test.sh"
  echo "[neg] 产品文件已还原"
}
trap restore EXIT INT TERM

# run_and_check <期望红话子串> <实验名>
run_and_check() {
  LOG="$BK/run-$2.log"
  echo "[neg] build + install（app.js / css 是 go:embed 进二进制的）"
  GO_TEST=1 ./build.sh > "$BK/build-$2.log" 2>&1 || { echo "[neg] build 失败，看 $BK/build-$2.log"; return 2; }
  ./install.sh > "$BK/install-$2.log" 2>&1 || { echo "[neg] install 失败"; return 2; }
  sh "$TMPDIR/restart.sh" >/dev/null 2>&1
  ./test.sh --skip-build --vd > "$LOG" 2>&1
  RC=$?
  # 先把干净 apk 装回去，再判定，免得下一轮跑到脏 apk
  restore
  GO_TEST=1 ./build.sh > "$BK/build-back-$2.log" 2>&1
  ./install.sh > "$BK/install-back-$2.log" 2>&1
  echo "[neg] 已把干净的 apk 装回去"
  echo "[neg] 套件退出码 $RC"
  if [ "$RC" = 0 ]; then
    echo "[neg] 没抓到：产品被改坏了套件还全绿 → 这条断言是恒绿装饰"
    return 1
  fi
  if grep -q "$1" "$LOG"; then
    echo "[neg] 红得对：套件红在该红的那条断言上"
    grep -n "$1" "$LOG" | head -3
    return 0
  fi
  echo "[neg] 红了，但不是红在该红的那一行（看 $LOG）："
  grep -n 'FAIL\|ERROR' "$LOG" | head -5
  return 2
}

# 静态实验：改 test.sh → 跑闸门 → 还原 → 判定红话
# 注意：e/f 会就地改 test.sh，而 sh 是边跑边读文件的，以 e/f 不要在全量跑测进行中跑（a 只改
# clip.js，安全）。
# static_and_check <期望红话子串> <实验名>
static_and_check() {
  LOG="$BK/static-$2.log"
  node tools/ui_test.js > "$LOG" 2>&1
  rc=$?
  restore
  if [ "$rc" = 0 ]; then echo "[neg $2] 没抓到：test.sh 被改坏了闸门还全绿"; return 1; fi
  grep -q "$1" "$LOG" || { echo "[neg $2] 红了但不是红在闸门㉑（看 $LOG）"; grep -n 'FAIL' "$LOG" | head -3; return 2; }
  echo "[neg $2] 红得对：闸门㉑ 报 test.sh 顶层注释 / 剪贴板收尾断了"
  grep -n "$1" "$LOG" | head -2
  return 0
}

cd "$HERE" || exit 2

if [ "$WHICH" = a ] || [ "$WHICH" = all ]; then
  python3 - "$HERE/go/ui/js/views/clip.js" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = """:id="'clipitem-'+x.id\""""
new = """:id="'clipitem-x'\""""
assert s.count(old) == 1, "锚点没找到：ClipItem 的稳定 id 改过了，反向实验要同步改"
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("[neg a] ClipItem 的稳定 id 改成固定串（DOM 顺序一变就点到别的条目）")
PY
  node tools/ui_test.js > "$BK/static-a.log" 2>&1
  rc=$?
  restore
  if [ "$rc" = 0 ]; then echo "[neg a] 没抓到：稳定 id 被写死了闸门⑳ 还全绿"; exit 1; fi
  grep -q '稳定 id 定位断了' "$BK/static-a.log" || { echo "[neg a] 红了但不是红在闸门⑳"; exit 2; }
  echo "[neg a] 红得对：闸门⑳ 报稳定 id 断了"
  grep -n '稳定 id 定位断了' "$BK/static-a.log" | head -3
fi

if [ "$WHICH" = b ] || [ "$WHICH" = all ]; then
  python3 - "$HERE/go/ui/css/components.css" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = ".pfoot .btnrow .btn{min-width:max-content}"
new = ".pfoot .btnrow .btn{min-width:0}"
assert s.count(old) == 1, "锚点没找到：.pfoot .btnrow 改过了，反向实验要同步改"
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("[neg b] 删掉 min-width:max-content（按钮可以缩到比自己的文字还窄）")
PY
  run_and_check "260px 面板下底部按钮文字被裁" b || exit $?
fi

if [ "$WHICH" = c ] || [ "$WHICH" = all ]; then
  python3 - "$HERE/go/ui/js/app.js" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = """  var r = null, err = '';
  try{ r = await api('/api/clip/parse', {ids:ids, raw:!ai}) }
  catch(e){ err = (e && e.message) ? e.message : String(e) }"""
new = """  var r = await api('/api/clip/parse', {ids:ids, raw:!ai}); var err = '';"""
assert s.count(old) == 1, "锚点没找到：clipParse 的 try/catch 改过了，反向实验要同步改"
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("[neg c] clipParse 的 try/catch 去掉（fetch 抛错时连 toast 都没有）")
PY
  run_and_check "注入失败后没出「解析失败」的 toast" c || exit $?
fi
if [ "$WHICH" = d ] || [ "$WHICH" = all ]; then
  python3 - "$HERE/go/ui/js/app.js" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = "    clipLoading = false; clipError = String(e);"
new = "    clipError = String(e);"
assert s.count(old) == 1, "锚点没找到：loadClips 的 catch 改过了，反向实验要同步改"
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("[neg d] loadClips 的 catch 不落下 clipLoading（加载失败永远停在「加载中…」）")
PY
  run_and_check "没出「加载失败」空态" d || exit $?
fi

if [ "$WHICH" = e ] || [ "$WHICH" = all ]; then
  python3 - "$HERE/test.sh" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = "# 套件最后一次剪贴板写入必须是空"
new = "/* 套件最后一次剪贴板写入必须是空"
assert s.count(old) == 1, "锚点没找到：剪贴板收尾的注释改过了，反向实验要同步改"
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("[neg e] 收尾注释改成行首斜杠星（sh 里这是命令，set -eu 下 127 退出）")
PY
  static_and_check "行首是 /*" e || exit $?
fi
if [ "$WHICH" = f ] || [ "$WHICH" = all ]; then
  python3 - "$HERE/test.sh" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = '[ "${LEAK:-?}" = 0 ] || fail "本步收尾后剪贴板暂存区不是 0'
new = '[ "${LEAK:-?}" = 0 ] || true "本步收尾后剪贴板暂存区不是0'
assert s.count(old) == 1, "锚点没找到：断空那行改过了，反向实验要同步改"
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("[neg f] 收尾断空被删（跨轮泄漏躲过本轮，红在下一轮的硬基线）")
PY
  static_and_check "剪贴板夹具步的收尾没断空" f || exit $?
fi

echo "[neg] 完成"
