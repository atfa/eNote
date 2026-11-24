#!/system/bin/sh
# 步骤 12 反向实验：证明「OCR 搜索断言收紧」真的会红。
#
# 做法：把 canvas 载荷里画进图的随机串换成一个固定串（断言用的 RS 不变），
# 于是 OCR 读出的文字里没有 RS。收紧后的断言必须红在
# 「OCR 没能在现造的图里读出 …」这一行；如果套件全绿，说明断言是恒绿的装饰。
#
# 用法：sh .test/s12_neg.sh          （跑完自动还原 test.sh）
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
BK="$TMPDIR/s12neg"
mkdir -p "$BK"
cp "$HERE/test.sh" "$BK/test.sh.bak"

restore() {
  cp "$BK/test.sh.bak" "$HERE/test.sh"
  echo "[neg] test.sh 已还原"
}
trap restore EXIT INT TERM

python3 - "$HERE/test.sh" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
old = 'g.fillText("取快递 @RS@", 40, 40);'
new = 'g.fillText("取快递 QQQQ7777", 40, 40);'
assert s.count(old) == 1, "锚点没找到：载荷改过了，反向实验要同步改"
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("[neg] 已把画进图的随机串换成固定串 QQQQ7777（断言仍用本次随机串）")
PY

LOG="$BK/run.log"
"$HERE/test.sh" --skip-build --vd > "$LOG" 2>&1
rc=$?
echo "[neg] 套件退出码 $rc"
if [ "$rc" = 0 ]; then
  echo "[neg] 没抓到：画进图的串和断言的串都不一样，套件还全绿 → 断言是恒绿装饰"
  exit 1
fi
if grep -q 'OCR 没能在现造的图里读出' "$LOG"; then
  echo "[neg] 红得对：套件红在新步骤的 OCR 断言上"
  grep -n 'OCR 没能在现造的图里读出\|FAIL' "$LOG" | head -5
  exit 0
fi
echo "[neg] 红了，但不是红在该红的那一行（看 $LOG）："
grep -n 'FAIL' "$LOG" | head -5
exit 2
