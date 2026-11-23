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
# 三条来自 Tony 审查的硬约束（都是「验收项自己空跑」这一类，写在这里免得又长回去）：
#   1) 量不到 `.cb` 必须 die。第一版是 warn + return 0，脚本 exit 0 而两张 -cb.png 根本
#      没生成 —— 裁切图就是本步「修 .cb 裁切」的证据本体，静默缺席等于验收项空跑。
#   2) 夹具自己造（`视觉夹具` 前缀，截完删）。全量测试跑完数据被重置，不造夹具就拍到
#      空态页，「明暗两档复查」复查的是空态（步骤 1 的 P8.5 隐式依赖设施数据，同一类坑）。
#   3) 走真实用户路径点底部导航。载荷里 `tab='todos'; render()` 只换 pane，导航高亮由
#      setTab() 写 `.tab.on` + moveInd()（app.js:1828-1833），而 setTab 不在导出表
#      （步骤 5 同一个坑）—— 结果是「导航亮笔记、画面是待办」，这正是要复查的高级感问题。
#   4) 「已完成」分组默认被 prefs.todos.done='open' 隐藏，勾选态进不了画面；用导出表里的
#      setPref('done','all')（真实用户路径，会 searchNow + savePrefs），截完复原成 open。
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
mkdir -p "$OUT"

INJECT="$TMPD/shots_todos_jseval.sh"
cat > "$INJECT" <<EOS
#!/bin/sh
am start --display $VDID -n $ACTIVITY --es hook jseval --es arg "\$(cat "\$1")" >/dev/null
EOS

# run_js <标签> <js>：注入并等日志里出现 `<标签> done=1`，回显该次注入的全部日志行。
# 走日志而不是 stdout：jseval 钩子只把 JS 的 console 输出写进 app 日志。
# 约定（test.sh 的 TINT 同款）：载荷日志一行一个 key=value，且 key 必须紧跟 =。
run_js() {
  tag="$1"; js="$2"
  f="$TMPD/shots_todos_$tag.json"
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

# ---------- 夹具：三条待办，覆盖「已逾期 + 高优先级」「今天」「已完成（勾选态）」----------
# 全量测试跑完数据被重置，设备上是空库；不自己造夹具就拍到空态页。
FXJS='(async function(){
  var L=function(m){console.log("FX "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var term=function(n){return ["done","raw","error"].indexOf(n.status)>=0};
  var FX="视觉夹具";
  var collect=function(st){var r=[];(st.notes||[]).forEach(function(n){(n.todos||[]).forEach(function(t){
    if(t.text.indexOf(FX)===0) r.push({n:n.id,t:t.id,text:t.text,done:!!t.done})})});return r};
  try{
    var st=await api("/api/state");
    var old=collect(st), i;
    for(i=0;i<old.length;i++) await api("/api/todo",{action:"delete",noteId:old[i].n,todoId:old[i].t});
    // 等解析终结：llm.go 解析完成时是 n.Todos = nil 整体替换，夹具赶在解析前插进去会被抹掉
    for(i=0;i<80;i++){ var q=await api("/api/state");
      if(!(q.notes||[]).some(function(n){return !term(n)})) break; await sleep(500) }
    st=await api("/api/state");
    var stable=(st.notes||[]).filter(term), nid=stable.length?stable[0].id:null, made=0;
    if(!nid){
      var r=await api("/api/add",{text:"视觉夹具笔记：给界面截图用的占位内容"});
      for(i=0;i<80;i++){ await sleep(500); var q2=await api("/api/state");
        var me=(q2.notes||[]).filter(function(n){return n.id===r.id});
        if(me.length && term(me[0])){ nid=r.id; break } }
    }
    if(!nid){ L("err=no-note"); L("done=1"); return }
    var d=new Date(), p=function(n){return String(n).padStart(2,"0")};
    var day=function(off){ var x=new Date(d.getTime()+off*864e5);
      return x.getFullYear()+"-"+p(x.getMonth()+1)+"-"+p(x.getDate()) };
    var add=function(text,due,pri){ return api("/api/todo",
      {action:"add",noteId:nid,text:text,due:due,priority:pri}) };
    await add(FX+" · 逾期高优先级", day(-2)+"T09:00", "high");
    await add(FX+" · 今天", day(0)+"T18:00", "normal");
    await add(FX+" · 已完成", "", "low");
    st=await api("/api/state");
    var all=collect(st); made=all.length; var dn=null;
    for(i=0;i<all.length;i++) if(all[i].text.indexOf("已完成")>=0) dn=all[i];
    if(dn) await api("/api/todo",{action:"toggle",noteId:dn.n,todoId:dn.t});
    L("nid="+nid); L("made="+made); L("doneSet="+(dn?"1":"0")); L("done=1");
  }catch(e){ L("ERR="+e); L("done=1") }
})()'

# ---------- 切主题 + 走真实导航 + 打开「已完成」分组 ----------
SHOOTJS='(async function(){
  var L=function(m){console.log("SHOT "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    setTheme("__THEME__");
    // 先点「笔记」再点「待办」：.tabbar .tab 的 handler 对「点当前 tab」是 early return
    // （app.js:1885），上一轮探针把模块里的 tab 设成过 todos，直接点 todos 就什么也不做，
    // 导航高亮留在 notes 上 —— 验收图里导航和页面不一致。
    var n0=document.querySelector(".tabbar .tab[data-tab=notes]");
    if(n0){ n0.click(); await sleep(400) }
    var b=document.querySelector(".tabbar .tab[data-tab=todos]");
    if(!b){ L("ERR=no-tab-btn"); L("done=1"); return }
    b.click();                       // 真实用户路径：setTab() 会同步 .tab.on 和 moveInd()
    await sleep(500);
    setPref("done","all");           // 默认 done=open 会隐藏「已完成」，勾选态进不了画面
    await sleep(1600);
    var P=".pane[data-tab=todos]";
    var on=document.querySelector(".tabbar .tab.on");
    L("theme="+__enote.state.S.settings.theme);
    L("nav="+(on?on.getAttribute("data-tab"):"none"));
    L("rows="+document.querySelectorAll(P+" .todo").length);
    L("cb="+document.querySelectorAll(P+" .todo .cb").length);
    L("done=1");
  }catch(e){ L("ERR="+e); L("done=1") }
})()'

# 量第一个 .cb 的位置（CSS px）连同 dpr：裁切要的是设备像素，两者只差这个系数。
CBRECT=""
measure() {   # measure <标签>
  out=$(run_js "RECT" '(async function(){
    var cb=document.querySelector(".pane[data-tab=todos] .todo .cb");
    if(!cb){ console.log("RECT none"); console.log("RECT done=1"); return }
    var r=cb.getBoundingClientRect(), d=window.devicePixelRatio||1;
    console.log("RECT dpr="+d+" x="+r.left.toFixed(1)+" y="+r.top.toFixed(1)
      +" w="+r.width.toFixed(1)+" h="+r.height.toFixed(1));
    console.log("RECT done=1") })()') || die "RECT 载荷没跑完（没等到 RECT done=1）：$out"
  CBRECT=$(printf '%s\n' "$out" | grep -o 'RECT dpr=.*' | tail -1)
  say "  $CBRECT"
}

crop_cb() {   # crop_cb <输出名>：把 .cb 连同左边距一起裁出来放大看
  name="$1"
  [ -n "$CBRECT" ] || die "没量到 .cb 位置，裁切图出不来（问题 1：这里以前是 warn + 跳过，脚本照样 exit 0）"
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
  [ "${CB_OK:-0}" = "1" ] || die "CBRECT 里没有坐标：$CBRECT"
  "$HERE/tools/crop_png.py" "$OUT/$name.png" "$OUT/$name-cb.png" "$CBX" "$CBY" "$CBW" "$CBH"
  say "  → docs/shots/$name-cb.png（裁切 $CBX,$CBY ${CBW}x${CBH}）"
}

cleanup() {
  run_js "CLEAN" '(async function(){
    var L=function(m){console.log("CLEAN "+m)};
    var FX="视觉夹具";
    try{
      var st=await api("/api/state"), n=0;
      var ps=[]; (st.notes||[]).forEach(function(x){ (x.todos||[]).forEach(function(t){
        if(t.text.indexOf(FX)===0) ps.push(api("/api/todo",{action:"delete",noteId:x.id,todoId:t.id})) }) });
      for(var i=0;i<ps.length;i++){ await ps[i]; n++ }
      setPref("done","open"); setTheme("light");
      L("cleaned="+n); L("done=1");
    }catch(e){ L("ERR="+e); L("done=1") }
  })()' >/dev/null
}
trap cleanup EXIT INT

asroot_global "am start --display $VDID -n $ACTIVITY" >/dev/null
sleep 3

FXOUT=$(run_js "FX" "$FXJS") || die "夹具载荷没跑完（没等到 FX done=1）：$FXOUT"
say "  $(printf '%s\n' "$FXOUT" | grep -o 'FX made=.*' | tail -1)"
MADE=$(kv "$FXOUT" made)
[ "${MADE:-0}" -ge 3 ] || die "夹具只造出 ${MADE:-0} 条（要 ≥3）：截图会拍到空列表/缺分组（问题 2）"

shot() {   # shot <输出名> <主题>
  name="$1"; theme="$2"
  js=$(printf '%s' "$SHOOTJS" | sed "s/__THEME__/$theme/g")
  out=$(run_js "SHOT" "$js") || die "SHOT 载荷没跑完（没等到 SHOT done=1）：$out"
  nav=$(kv "$out" nav); rows=$(kv "$out" rows); th=$(kv "$out" theme)
  say "  nav=$nav rows=$rows theme=$th"
  [ "$nav" = "todos" ] || die "底部导航高亮的是「$nav」而画面是待办页（问题 3）：导航和页面不一致的图不能当验收"
  [ "$th" = "$theme" ] || die "主题没切过去（要 $theme，实际 $th）"
  [ "${rows:-0}" -ge 3 ] || die "待办列表只有 ${rows:-0} 行，夹具没进画面（问题 2）"
  measure
  sh "$HERE/vd.sh" shot "$OUT/$name.png" >/dev/null
  say "  → docs/shots/$name.png"
  crop_cb "$name"
}

shot vue-todos-light light
shot vue-todos-dark dark

cd "$OUT"
for f in vue-todos-light.png vue-todos-light-cb.png vue-todos-dark.png vue-todos-dark-cb.png; do
  [ -s "$f" ] || die "$f 不存在或是空文件：验收证据缺一张（问题 1）"
done
n=$(md5sum vue-todos-light.png vue-todos-dark.png | awk '{print $1}' | sort -u | wc -l)
say "明暗两张唯一图片数：$n / 2"
[ "$n" -ge 2 ] || die "明暗两图相同：注入没生效，别把假图当验收"
say "四张齐：vue-todos-{light,dark}.png + 两张 -cb.png（夹具已清理，主题/筛选已复原）"
