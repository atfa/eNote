#!/system/bin/sh
# 反向实验：证明「附件页三块用例的 filesNow() 轮询」不是恒绿闸门。
#
# 变异：app.js 的 filesNow() 把 loaded:true 改成 loaded:false —— 服务端拉到了数据但
# FA.loaded 永远是 false（正是真机竞态的表现）。轮询闸门必须红，并且要红在「轮询 12 次
# 没拉到数据」这条消息上（不是红在别处，也不是绿）。
#
# 规矩：脚本开头一次性备份，trap EXIT 恢复，绝不用 git checkout。
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
BAK="$TMPDIR/s11fix"
APP="$HERE/go/ui/js/app.js"
LOG="$BAK/neg.log"
mkdir -p "$BAK"
cp "$APP" "$BAK/app.js.bak" || exit 1
trap 'cp "$BAK/app.js.bak" "$APP"; echo "[neg] app.js 已恢复"; git -C "$HERE" status --short' EXIT

echo "[neg] 变异：filesNow() 的 loaded:true -> loaded:false"
python3 - "$APP" <<'PY' || { echo "[neg] 变异失败"; exit 1; }
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
o = "diskFiles:d.diskFiles||0, loaded:true};"
n = "diskFiles:d.diskFiles||0, loaded:false};"
assert s.count(o) == 1, "锚点不唯一：%d" % s.count(o)
io.open(p, "w", encoding="utf-8").write(s.replace(o, n))
PY
node --check "$APP" || { echo "[neg] 变异后语法就不对"; exit 1; }

cd "$HERE" || exit 1
./test.sh --vd > "$LOG" 2>&1
RC=$?
echo "[neg] test.sh --vd EXIT=$RC"
if [ "$RC" -eq 0 ]; then
  echo "[neg] 没抓到：轮询闸门全绿（FA.loaded 永远是 false 也过）"
  exit 1
fi
if grep -q '轮询 12 次没拉到数据' "$LOG"; then
  echo "[neg] 红得对：红在「filesNow() 轮询 12 次没拉到数据」"
  grep -n '轮询 12 次没拉到数据' "$LOG" | head -2
  exit 0
fi
echo "[neg] 红了，但不是红在这一条上（看 $LOG）："
grep -n 'FAIL' "$LOG" | head -5
exit 1
