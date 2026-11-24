#!/usr/bin/env python3
# 步骤 12（B 部分之二）：设置页 / Notes / Todos / 附件页 / 错过的提醒面板里的固定 sleep
# 换成「轮询到目标状态」。原子：全部锚点命中才写文件。
import io, sys

P = "test.sh"
s = io.open(P, encoding="utf-8").read()

R = []
def rep(old, new):
    R.append((old, new))

def helper(tag):
    return ('  var L=function(m){console.log("%s "+m)};\n'
            '  var poll=async function(f,n,ms){ var i=0; while(i<(n||40)){ if(await f()) return i; '
            'await sleep(ms||250); i++; } return -1 };\n' % tag)

# ---------- 给各载荷补 poll 助手（紧跟各自的 L 定义）----------
for tag in ("SET", "NINT", "TINT", "FINT"):
    rep('  var L=function(m){console.log("%s "+m)};\n' % tag, helper(tag))

rep('''  var L=function(m){console.log("JSEVAL "+m)},q=function(s){return document.querySelector(s)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var d=await api("/api/missed");
''',
'''  var L=function(m){console.log("JSEVAL "+m)},q=function(s){return document.querySelector(s)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var poll=async function(f,n,ms){ var i=0; while(i<(n||40)){ if(await f()) return i; await sleep(ms||250); i++; } return -1 };
  var d=await api("/api/missed");
''')

# ---------- 设置页 SET ----------
rep('''    click(row); await sleep(700);
    L("opened="+(q("#sUrl")?1:0));
''',
'''    click(row);
    // 固定 700ms 换成轮询，目标状态：设置弹层真的挂出来（#sUrl 是设置页独有的输入框）。
    var tOpen=await poll(function(){ return !!q("#sUrl") },30,200);
    L("tOpen="+tOpen); L("opened="+(q("#sUrl")?1:0));
''')

rep('''      click(btns[1]); await sleep(800);
      L("themeDark="+document.documentElement.getAttribute("data-theme"));
''',
'''      click(btns[1]);
      // 目标状态：根节点真的切到 dark（CSS 变量跟着换，不是只改了按钮样式）。
      var tDark=await poll(function(){ return document.documentElement.getAttribute("data-theme")==="dark" },30,200);
      L("tDark="+tDark); L("themeDark="+document.documentElement.getAttribute("data-theme"));
''')

rep('''      click(nb[0]); await sleep(800);
      L("themeBack="
''',
'''      click(nb[0]);
      var tThemeBack=await poll(function(){ return document.documentElement.getAttribute("data-theme")!=="dark" },30,200);
      L("tThemeBack="+tThemeBack); L("themeBack="
''')

rep('''    click(swAll[1]); await sleep(900);
    swAll=document.querySelectorAll("#sheet .sw");
    var a1=swAll[1]&&on(swAll[1],"on")?1:0;
''',
'''    click(swAll[1]);
    // 目标状态：设置里的 useAI 真的翻转（toggleAI 会 POST /api/settings 再重绘，
    // 固定 900ms 在机器忙时不够，空闲时白等；轮询到状态翻转才继续）。
    var tFlip=await poll(function(){ return E.state.S.settings.useAI!==(a0===1) },40,250);
    L("tFlip="+tFlip);
    swAll=document.querySelectorAll("#sheet .sw");
    var a1=swAll[1]&&on(swAll[1],"on")?1:0;
''')

rep('''    click(swAll[1]); await sleep(900);
    swAll=document.querySelectorAll("#sheet .sw");
    var a2=
''',
'''    click(swAll[1]);
    var tFlipBack=await poll(function(){ return E.state.S.settings.useAI===(a0===1) },40,250);
    L("tFlipBack="+tFlipBack);
    swAll=document.querySelectorAll("#sheet .sw");
    var a2=
''')

rep('''    click(saveBtn); await sleep(900);
    L("toast="
''',
'''    click(saveBtn);
    // 目标状态：toast 真的弹出并带文案（saveSettings 走 POST，回来才 toast）。
    var tToast=await poll(function(){ return (document.getElementById("toast").textContent||"").trim().length>0 },40,250);
    L("tToast="+tToast); L("toast="
''')

rep('''    click(clearBtn); await sleep(400);
    L("dlgOn="
''',
'''    click(clearBtn);
    var tDlg=await poll(function(){ return on(document.getElementById("dlg"),"on") },30,200);
    L("tDlg="+tDlg); L("dlgOn="
''')

rep('''    click(document.getElementById("dlgNo")); await sleep(400);
    L("dlgClosed="
''',
'''    click(document.getElementById("dlgNo"));
    var tDlgClosed=await poll(function(){ return !on(document.getElementById("dlg"),"on") },30,200);
    L("tDlgClosed="+tDlgClosed); L("dlgClosed="
''')

rep('''    click(closeBtn); await sleep(500);
    L("closed="
''',
'''    click(closeBtn);
    // 目标状态：弹层真的关掉（#sheet 不再带 on）。
    var tClosed=await poll(function(){ return !on(document.getElementById("sheet"),"on") },30,200);
    L("tClosed="+tClosed); L("closed="
''')

# ---------- Notes 页 NINT ----------
rep('''  if(eb){ eb.click(); await sleep(400); }
  L("clampBefore="+before);
''',
'''  if(eb){ eb.click();
    // 固定 400ms 换成轮询，目标状态：展开后带 .clamp 的行数真的变少（open 是模块状态，
    // computed 不依赖 tick 就永远缓存 —— 本用例的主题）。
    var tExp=await poll(function(){ return qa(P+" .body.clamp").length<before },30,200);
    L("tExp="+tExp); }
  L("clampBefore="+before);
''')

rep('''  if(eb2){ eb2.click(); await sleep(400); }
''',
'''  if(eb2){ eb2.click();
    var tCol=await poll(function(){ return qa(P+" .body.clamp").length===before },30,200);
    L("tCol="+tCol); }
''')

rep('''  await A.refresh(true); await sleep(500);
  // 一个 token 一行''',
'''  await A.refresh(true);
  // 目标状态：列表空了并且 .empty 分支真的画出来（Vue 的 v-if 分支）。
  var tEmpty=await poll(function(){ return !!q(P+" .empty") },40,250);
  L("tEmpty="+tEmpty);
  // 一个 token 一行
''')

rep('''  await A.refresh(true); await sleep(1200); await A.refresh(true); await sleep(800);
  L("restored="+cards());
''',
'''  // 目标状态：卡片数回到删除前的条数。以前是 refresh + 睡 1200 + refresh + 睡 800，
  // 机器忙时不够（restored 少几条，红的是测试的等待而不是产品），空闲时白等两秒。
  var tRestore=await poll(async function(){ await A.refresh(true); return cards()>=ids.length },40,250);
  L("tRestore="+tRestore); L("restored="+cards());
''')

rep('''  if(id){ __enote.actions.delNote(id); await sleep(300);
    var yes=q("#dlgYes");
''',
'''  if(id){ __enote.actions.delNote(id);
    // 目标状态：确认框真的弹出来（delNote 走 dialog，按钮在 DOM 里才点得到）。
    var tDlg=await poll(function(){ return !!q("#dlgYes") },30,200);
    L("tDlg="+tDlg);
    var yes=q("#dlgYes");
''')

# ---------- Todos 页 TINT ----------
rep('''      row.querySelector(".cb").click(); await sleep(1700);
      var s1=await api("/api/state"), t1=findTodo(s1,tid);
      var row2=rowOf(t1?t1.t.text:"");
      L("done1="+(t1&&t1.t.done));
      L("rows0="+r0);
      L("rows1="+rows());
      L("moved="+(row2?"still":"gone"));
''',
'''      row.querySelector(".cb").click();
      // 固定 1700ms 换成轮询，目标状态精确到服务端：这条待办的 done 真的翻转了。
      // 上限给到 60 次 ×250ms（15s）：勾选后要过 API + 重绘，机器忙时 1.7s 不够。
      var s1=null,t1=null,tDone=0;
      while(tDone<60){ s1=await api("/api/state"); t1=findTodo(s1,tid); if(t1&&t1.t.done) break;
        await sleep(250); tDone++; }
      var row2=rowOf(t1?t1.t.text:""), tGone=0;
      while(tGone<60){ row2=rowOf(t1?t1.t.text:""); if(!row2) break;
        await sleep(250); tGone++; }
      L("tDone="+tDone); L("tGone="+tGone);
      L("done1="+(t1&&t1.t.done));
      L("rows0="+r0);
      L("rows1="+rows());
      L("moved="+(row2?"still":"gone"));
''')

rep('''      window.toggle(nid, tid, ghost); await sleep(1700);
      var s2=await api("/api/state"), t2=findTodo(s2,tid);
      L("done2="+(t2&&t2.t.done));
''',
'''      window.toggle(nid, tid, ghost);
      // 同上：轮询到服务端的 done 回到 false。
      var s2=null,t2=null,tUndone=0;
      while(tUndone<60){ s2=await api("/api/state"); t2=findTodo(s2,tid); if(t2&&!t2.t.done) break;
        await sleep(250); tUndone++; }
      L("tUndone="+tUndone); L("done2="+(t2&&t2.t.done));
''')

rep('''      __enote.state.SR={notes:[],todoIds:sub,where:{},total:2,scanned:2};
      await render(); await sleep(250);
      L("srRows="+rows());
''',
'''      __enote.state.SR={notes:[],todoIds:sub,where:{},total:2,scanned:2};
      await render();
      // 目标状态：渲染出的行数等于 SR.todoIds 里未完成的条数（搜索态走的是 SR，不是 S）。
      var tSr=await poll(function(){ return rows()===2 },30,200);
      L("tSr="+tSr); L("srRows="+rows());
''')

rep('''      __enote.state.SR={notes:null,todoIds:null,where:{},total:0,scanned:0};
      await render(); await sleep(250);
''',
'''      __enote.state.SR={notes:null,todoIds:null,where:{},total:0,scanned:0};
      await render();
      // 目标状态：搜索态清掉后行数离开搜索态那个 2（回到全量列表）。
      var tSrBack=await poll(function(){ return rows()!==2 },30,200);
      L("tSrBack="+tSrBack);
''')

# ---------- 附件页 FINT ----------
rep('''    L("tries="+ftries);
    await sleep(500);
    L("mounted2="
''',
'''    L("tries="+ftries);
    // 目标状态：卡片真的画进 DOM（FA 有数据不等于画出来了，Vue 的 nextTick 在下一拍）。
    var tCards=await poll(function(){ return qa(P+" .acard").length>0 },30,200);
    L("tCards="+tCards);
    L("mounted2="
''')

rep('''    card.click(); await sleep(400);
    var tst=document.getElementById("toast");
''',
'''    card.click();
    // 目标状态：预览 toast 弹出（openAttach 的 @click 真的绑上了）。
    var tst=document.getElementById("toast");
    var tToast=await poll(function(){ return tst.classList.contains("on") },30,200);
    L("tToast="+tToast);
''')

rep('''    del.click(); await sleep(300);
    L("dlg="
''',
'''    del.click();
    // 目标状态：删除确认框弹出（askDel 走 dialog）。
    var tDlg=await poll(function(){ return document.getElementById("dlg").classList.contains("on") },30,200);
    L("tDlg="+tDlg); L("dlg="
''')

rep('''    await sleep(800);   // delAttach 里 filesNow() 会重绘，给 DOM 一拍
''',
'''    // 目标状态：卡片数真的掉下来（delAttach 里 filesNow() 会重绘，固定 800ms 只是「给一拍」）。
    var tDom=await poll(function(){ return qa(P+" .acard").length<cardsBefore },40,250);
    L("tDom="+tDom);
''')

# ---------- 错过的提醒面板 ----------
rep('''  if(row) row.click();
  await sleep(500);
  L("jumped="
''',
'''  if(row) row.click();
  // 固定 500ms 换成轮询，目标状态：笔记详情真的打开了（open 是模块状态，行数增加才算）。
  var tJump=await poll(function(){ return Object.keys(__enote.state.open).length>n0 },30,200);
  L("tJump="+tJump); L("jumped="
''')

rep('''  if(first) first.click();
  await sleep(120);
  L("anim="
''',
'''  if(first) first.click();
  // 目标状态：划线动画的类真的加上了（用户反馈「点了看不出结果」，动画就是反馈本身）。
  var tAnim=await poll(function(){ return (((q(".msrow")||{}).className)||"").indexOf("justdone")>=0 },20,100);
  L("tAnim="+tAnim); L("anim="
''')

rep('''  await sleep(1600);
  L("n1="+n1);
''',
'''  // 目标状态：动画跑完、这条从清单里消失（行数掉下来）。固定 1600ms 在机器忙时不够。
  var tGone=await poll(function(){ return document.querySelectorAll(".msrow").length<n1 },40,250);
  L("tGone="+tGone);
  L("n1="+n1);
''')

rep('''  missedDismiss();
  await sleep(300);
  L("afterDismiss="
''',
'''  missedDismiss();
  // 目标状态：横幅与顶部条都从 DOM 里消失。
  var tDismiss=await poll(function(){ return document.querySelectorAll(".missedb,.missedtop").length===0 },30,200);
  L("tDismiss="+tDismiss); L("afterDismiss="
''')

def align(old, new):
    # 锚点末行常常是「半行」（例如 L("toast=" 后面还有代码），这种锚点不能带结尾换行。
    if s.count(old) == 0 and old.endswith("\n") and s.count(old[:-1]) == 1:
        return old[:-1], (new[:-1] if new.endswith("\n") else new)
    return old, new

R = [align(o, n) for o, n in R]
for old, new in R:
    n = s.count(old)
    if n != 1:
        sys.exit("锚点命中 %d 次（应为 1）：\n%s" % (n, old[:160]))
for old, new in R:
    s = s.replace(old, new)
io.open(P, "w", encoding="utf-8").write(s)
print("ok: %d 处替换" % len(R))
