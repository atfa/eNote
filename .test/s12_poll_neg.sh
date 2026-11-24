#!/system/bin/sh
# 步骤 12 反向实验（轮询族）：证明新加的 poll 断言不是恒绿装饰。
#
# 做法：把产品侧 toggleAI 里「翻转 useAI 状态」那半句去掉，DOM 的 on 类照旧变（视觉反馈
# 还在），只有状态桥不再动。设置页用例的 tFlip 轮询必须超时（tries=-1），
# aiFlip 必须为 0，套件必须红在「点启用 AI 开关后 class 与 settings.useAI 没一起翻」。
# 如果套件全绿，说明轮询断言什么都没保证。
#
# app.js 是 go:embed 进二进制的，所以前后各要 build + install 一次。
# 用法：sh .test/s12_poll_neg.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
BK="$TMPDIR/s12pollneg"
mkdir -p "$BK"
cp "$HERE/go/ui/js/app.js" "$BK/app.js.bak"

restore() {
  cp "$BK/app.js.bak" "$HERE/go/ui/js/app.js"
  echo "[neg] app.js 已还原"
}
trap restore EXIT INT TERM

python3 - "$HERE/go/ui/js/app.js" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = "function toggleAI(el){ var s=S.settings; s.useAI=!s.useAI;"
new = "function toggleAI(el){ var s=S.settings; /*neg*/"
assert s.count(old) == 1, "锚点没找到：toggleAI 改过了，反向实验要同步改"
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("[neg] toggleAI 不再翻转 useAI（DOM 的 on 类照旧变，只有状态桥不动）")
PY

cd "$HERE" || exit 2
echo "[neg] build + install（app.js 是 go:embed 进二进制的）"
GO_TEST=1 ./build.sh > "$BK/build.log" 2>&1 || { echo "[neg] build 失败，看 $BK/build.log"; exit 2; }
./install.sh > "$BK/install.log" 2>&1 || { echo "[neg] install 失败"; exit 2; }
sh "$TMPDIR/restart.sh" >/dev/null 2>&1

LOG="$BK/run.log"
./test.sh --skip-build --vd > "$LOG" 2>&1
rc=$?

# 先把产品代码装回去（设备上的 apk 还是被改过的那份），再判定，免得下一轮跑到脏 apk。
restore
GO_TEST=1 ./build.sh > "$BK/build-back.log" 2>&1
./install.sh > "$BK/install-back.log" 2>&1
echo "[neg] 已把干净的 apk 装回去"

echo "[neg] 套件退出码 $rc"
if [ "$rc" = 0 ]; then
  echo "[neg] 没抓到：状态桥被拆了套件还全绿 → 轮询断言是恒绿装饰"
  exit 1
fi
if grep -q '点启用 AI 开关后 class 与 settings.useAI 没一起翻' "$LOG"; then
  echo "[neg] 红得对：套件红在设置页开关那条断言上"
  grep -n 'tFlip=\|tFlipBack=\|FAIL\|ERROR' "$LOG" | head -8
  exit 0
fi
echo "[neg] 红了，但不是红在该红的那一行（看 $LOG）："
grep -n 'FAIL' "$LOG" | head -5
exit 2
