#!/usr/bin/env bash
# 步骤 11 的反向实验：每条新闸门都要「改坏 → 红 → 恢复」，全绿的闸门是装饰。
# 关键教训（Tony 定的规矩）：备份必须在脚本开头一次性做完，恢复只从备份目录取，
# 绝不用 git checkout（工作区里有未提交的步骤 11 改动，checkout 会把它们冲掉）。
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE" || exit 1
BK=$TMPDIR/s11neg
rm -rf "$BK"; mkdir -p "$BK"
FILES="go/ui/js/app.js test.sh tools/ui_test.js go/web_test.go go/ui/index.html go/ui/css/base.css go/ui/js/views/notes.js go/ui/js/views/clip.js go/ui/js/views/stats.js go/ui/js/components.js"
for f in $FILES; do mkdir -p "$BK/$(dirname "$f")"; cp "$f" "$BK/$f"; done
restore(){ for f in $FILES; do cp "$BK/$f" "$f"; done; }
trap restore EXIT

PASS=0; FAIL=0
# expect_red <名字> <命令...>：命令非 0（或输出里有 FAIL）= 闸门真的抓到了
expect_red(){
  local name=$1; shift
  local out; out=$("$@" 2>&1); local rc=$?
  if [ $rc -ne 0 ] || printf '%s' "$out" | grep -q "^FAIL"; then
    PASS=$((PASS+1)); printf '  红得对  %-34s %s\n' "$name" "$(printf '%s' "$out" | grep -m1 -E "^FAIL|FAIL:|--- FAIL" | cut -c1-110)"
  else
    FAIL=$((FAIL+1)); printf '  没抓到  %-34s（闸门全绿）\n' "$name"
  fi
  restore
}
expect_green(){
  local name=$1; shift
  local out; out=$("$@" 2>&1); local rc=$?
  if [ $rc -eq 0 ] && ! printf '%s' "$out" | grep -q "^FAIL"; then
    PASS=$((PASS+1)); printf '  恢复即绿 %-34s\n' "$name"
  else
    FAIL=$((FAIL+1)); printf '  恢复后仍红 %-32s %s\n' "$name" "$(printf '%s' "$out" | grep -m1 -E "^FAIL|FAIL:" | cut -c1-90)"
  fi
}
U(){ node tools/ui_test.js; }
G(){ (cd go && go test ./... >/dev/null 2>&1); }

echo "== 签名段（步骤 11 新并入的闸门）=="
# N1 排除表里去掉 uptimeS：「uptimeS 变化签名不变」这条必须红
sed -i 's/var SIG_SKIP = { uptimeS:1,/var SIG_SKIP = {/' go/ui/js/app.js
expect_red "SIG_SKIP 去掉 uptimeS" U
# N2 排除表清空：uptimeS / tz 两条都必须红
sed -i 's/var SIG_SKIP = { uptimeS:1, tz:1, go:1, dir:1 };/var SIG_SKIP = {};/' go/ui/js/app.js
expect_red "SIG_SKIP 清空" U
# N3 指纹里去掉 notes：「notes 变化签名必须变」红
sed -i 's/return JSON.stringify(\[d \&\& d.notes, i,/return JSON.stringify([[], i,/' go/ui/js/app.js
expect_red "指纹不含 notes" U
# N4 指纹里去掉 settings：theme 改了不重绘，必须红
sed -i 's/(d \&\& d.settings) || {},/{},/' go/ui/js/app.js
expect_red "指纹不含 settings" U
# N5 指纹里去掉截图开关：首页横幅不更新（踩过），必须红。sed 的 BRE 里 ? | [ 都是字面量，
# 这段表达式全是这些字符 —— 用 python 改，别跟正则较劲。
py() { python3 -c 'import io,sys
p,old,new=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding="utf-8").read()
assert s.count(old)==1, "锚点没命中: "+old
io.open(p,"w",encoding="utf-8").write(s.replace(old,new))' "$@"; }
py go/ui/js/app.js '[sf.enabled?1:0, sf.folders||0, sf.granted?1:0]]);' '[]]);'
expect_red "指纹不含截图开关" U
# N6 指纹里去掉 info：新截图 / 队列数改了不重绘，必须红
sed -i 's/return JSON.stringify(\[d \&\& d.notes, i,/return JSON.stringify([d \&\& d.notes, {},/' go/ui/js/app.js
expect_red "指纹不含 info" U

echo "== go test 的遗留禁令（步骤 11 新增）=="
sed -i 's/^function stateSig(d){/function sigOf(d){ return stateSig(d) }\nfunction stateSig(d){/' go/ui/js/app.js
expect_red "sigOf 回来" G
sed -i 's/^  clearSeen: clearSeen$/  legacy: { notes: 1 },\n  clearSeen: clearSeen/' go/ui/js/app.js
expect_red "legacy 夹具缝回来" G
sed -i 's/return vuePaint().then(done, done);/return vuePaint().then(done, done);\n  if(0) p.innerHTML = buildPage(tab);/' go/ui/js/app.js
expect_red "buildPage(tab) 回来" G

echo "== 结构闸门（步骤 11 改过基线 / 闭集的）=="
# N7 载荷调闭集外的全局名（步骤 11 从闭集里删掉 settingsSheet 之后才有的这条）
sed -i 's/  var qa=function(s){return S()/  settingsSheet();\n  var qa=function(s){return S()/' test.sh
expect_red "载荷调闭集外的 settingsSheet" U
# N8 导出表右值不存在（闸门①e）
sed -i 's/^  addNote, addTodo, addTodoSheet, api, askBattery, askExact,/  addNote, addTodo, addTodoSheet, api, askBattery, askExact, zzNotDefined,/' go/ui/js/app.js
expect_red "导出表右值不存在" U
# N9 内联 handler 调不存在的函数（闸门①）。内联 handler 全在 app.js 的字符串拼接里
# （index.html 里 0 个），所以改 app.js。
sed -i '0,/onclick="addTodo(/s//onclick="zzNope(/' go/ui/js/app.js
expect_red "内联 handler 指向不存在的函数" U
# N10 整段删掉两个模板 handler：总数掉到基线（73）以下才红（当前 74，改而不删是不动的）
py go/ui/js/views/clip.js ' @click="H.clipDelSel()"' ''
py go/ui/js/views/clip.js ' @click="H.clipParse(false)"' ''
expect_red "模板 handler 总数掉到基线下" U
# N11 模板用 setHost 里没有的名字（Vue 渲染抛错 → 静默回退）
sed -i 's/H.clipCountHTML()/H.zzNotAHostLeaf()/' go/ui/js/views/clip.js
expect_red "模板用 setHost 外的名字" U
# N12/N13 棘轮只扫 go/ui/css/**（JS 模板里的内联 style 它看不见，这条记进步骤 13 的账），
# 所以实验要改 CSS 本体。
py go/ui/css/base.css 'overscroll-behavior:none}' 'overscroll-behavior:none;color:#123456}'
expect_red "css 里出现裸 hex" U
py go/ui/css/base.css 'overscroll-behavior:none}' 'overscroll-behavior:none;margin:999px}'
expect_red "css 里出现裸 px" U
# N14 顶部顺序：strip-bar / missed-banner / shot-banner / clip-banner
sed -i 's/<missed-banner/<zz-missed-banner/' go/ui/js/views/notes.js
expect_red "顶部 banner 顺序" U
# N15 组件 setup 不返回 H（模板里的 H.xxx 全抛 ReferenceError）
sed -i '0,/^      H,$/d' go/ui/js/views/clip.js
expect_red "组件没暴露 H" U
# N16 把组件里一个 computed 换成普通函数（computed 永远缓存 → 点了没反应）。
# 静态闸门抓不到（它只查「渲染路径引用了 tick」，一个组件里剩一个 live 就绿），
# 真机那条交互用例抓得到 —— 这条是「静态层的能力边界」证据，记进步骤 13 的账。
py go/ui/js/views/clip.js 'countHtml: live(() => H.clipCountHTML())' 'countHtml: () => H.clipCountHTML()'
expect_green "computed 换成普通函数（静态层盲区）" U

echo
echo "反向实验：红得对 $PASS 条，没抓到 $FAIL 条"
[ "$FAIL" = 0 ]
