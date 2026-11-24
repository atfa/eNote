#!/usr/bin/env python3
# 步骤 12（B 部分之一）：把「点完固定睡一觉」换成「轮询到目标状态」。
# 覆盖：文件夹弹层、剪贴板弹层、截图弹层。原子：全部锚点命中才写文件。
import io, sys

P = "test.sh"
s = io.open(P, encoding="utf-8").read()

R = []
def rep(old, new):
    R.append((old, new))

POLL = ('  var poll=async function(f,n,ms){ var i=0; while(i<(n||40)){ if(await f()) return i; '
        'await sleep(ms||200); i++; } return -1 };\n')

# ---------- 文件夹弹层 ----------
rep('''  __enote.state.tab="mine"; await render(); folderSheet();
  // 步骤 8：Vue 弹层的 DOM 在 nextTick 之后才落地（遗留路径是同步 innerHTML）。
  // 不等这一拍，count0 读到的是空容器，q("#folderCount") 直接 null → 载荷抛异常。
  await new Promise(function(r){ setTimeout(r,400) });
''',
'''  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  // 固定 400ms 换成轮询：Vue 弹层的 DOM 在 nextTick 之后才落地（遗留路径是同步 innerHTML），
  // 机器忙时 400ms 不够（count0 读到空容器，q("#folderCount") 直接 null → 载荷抛异常），
  // 空闲时又白等。目标状态精确：#folderList 真画出行来、计数节点已在 DOM 里。
  // tries 打出来：红了能分清「没画出来」和「画得慢」。
''' + POLL + '''  __enote.state.tab="mine"; await render(); folderSheet();
  var tRows=await poll(function(){ return rows().length>0 && !!q("#folderCount") },40,200);
  L("tRows="+tRows);
''')

rep('''  panel.scrollTop=setS;
  setTimeout(async function(){
''',
'''  panel.scrollTop=setS;
  // 固定 260ms 换成轮询，目标状态：固定条已在 DOM 里且行画全（下面 sticky/footVisible 量的就是它）。
  var tPaint=await poll(function(){ return !!q("#sheet .pfoot") && rows().length>0 },30,200);
  L("tPaint="+tPaint);
  await (async function(){
''')

rep('''    setTimeout(probe,400);
  },260);
})()' > "$TMPDIR/js.json"
''',
'''    setTimeout(probe,400);
  })();
})()' > "$TMPDIR/js.json"
''')

rep('''    if(ab){ ab.click(); await new Promise(function(r){ setTimeout(r,300) });
      L("allSel="+document.querySelectorAll("#folderList .frow.on").length); }
''',
'''    if(ab){ ab.click();
      // 目标状态：每一行都带 on（全选真的落到每一行，不是只改了计数文案）。
      var tAll=await poll(function(){ var n=rows().length; return n>0 && document.querySelectorAll("#folderList .frow.on").length===n },30,200);
      L("tAll="+tAll); L("allSel="+document.querySelectorAll("#folderList .frow.on").length); }
''')

rep('''    if(nb){ nb.click(); await new Promise(function(r){ setTimeout(r,300) });
      L("noneSel="+document.querySelectorAll("#folderList .frow.on").length); }
''',
'''    if(nb){ nb.click();
      // 目标状态：一行都不带 on。
      var tNone=await poll(function(){ return document.querySelectorAll("#folderList .frow.on").length===0 },30,200);
      L("tNone="+tNone); L("noneSel="+document.querySelectorAll("#folderList .frow.on").length); }
''')

rep('''    __enote.vue.folderPaint();
    await new Promise(function(r){ setTimeout(r,250) });
    var p2=q("#sheet .panel"), max2=p2.scrollHeight-p2.clientHeight;
''',
'''    __enote.vue.folderPaint();
    // 目标状态：40 条假目录真的画进 DOM（否则滚动位置保持这条是空跑）。
    var tFake=await poll(function(){ return rows().length===40 },30,200);
    L("tFake="+tFake);
    var p2=q("#sheet .panel"), max2=p2.scrollHeight-p2.clientHeight;
''')

rep('''    __enote.vue.folderPaint();
    await new Promise(function(r){ setTimeout(r,200) });
    folderSave();
''',
'''    __enote.vue.folderPaint();
    // 目标状态：真目录列表回来了（行数等于注入前的条数），否则 folderSave 写回的是假数据。
    var tBack=await poll(function(){ return rows().length===keepAll.length },30,200);
    L("tBack="+tBack);
    folderSave();
''')

# ---------- 剪贴板弹层 ----------
rep('''  var pri=function(){ var e=qa("#sheet .pfoot .btn.pri")[0]; return e?e.textContent.replace(/\\s+/g,""):"" };
''',
'''  var pri=function(){ var e=qa("#sheet .pfoot .btn.pri")[0]; return e?e.textContent.replace(/\\s+/g,""):"" };
''' + POLL)

rep('''    L("on0="+on()); L("foot0="+foot()); L("pri0="+pri());
    q()[0].click();                       // 真点击一条：勾选 + 计数 + 按钮文案三处同步动
    await sleep(300);
    L("on1="+on());''',
'''    var on0=on();
    L("on0="+on0); L("foot0="+foot()); L("pri0="+pri());
    q()[0].click();                       // 真点击一条：勾选 + 计数 + 按钮文案三处同步动
    // 目标状态：勾选数真的离开初始值（@click 落到 clipPick 且重绘了）。
    var tPick=await poll(function(){ return on()!==on0 },30,200);
    L("tPick="+tPick); L("on1="+on());
''')

rep('''    top()[1].click();                     // 全不选
    await sleep(300);
    L("on2="+on());''',
'''    top()[1].click();                     // 全不选
    // 目标状态：勾选数归零。
    var tNone=await poll(function(){ return on()===0 },30,200);
    L("tNone="+tNone); L("on2="+on());
''')

rep('''    top()[0].click();                     // 全选
    await sleep(300);
    L("on3="+on());''',
'''    top()[0].click();                     // 全选
    // 目标状态：勾选数等于行数（不是只改了按钮文案）。
    var tAll=await poll(function(){ var n=q().length; return n>0 && on()===n },30,200);
    L("tAll="+tAll); L("on3="+on());
''')

rep('''    top()[0].click();
    await sleep(250);
    var n0=q().length, onb=on();
''',
'''    top()[0].click();
    // 目标状态：全选到位（行数 > 0 且全部勾选），否则「删一条掉两条」那条断言是空跑。
    var tAll2=await poll(function(){ var n=q().length; return n>0 && on()===n },30,200);
    L("tAll2="+tAll2);
    var n0=q().length, onb=on();
''')

rep('''    top()[0].click();
    await sleep(250);
    L("onBeforeDelAll="+on());
''',
'''    top()[0].click();
    var tAll3=await poll(function(){ var n=q().length; return n>0 && on()===n },30,200);
    L("tAll3="+tAll3);
    L("onBeforeDelAll="+on());
''')

rep('''    for(var t3=0;t3<30 && q().length;t3++) await sleep(200);
    await sleep(300);
    L("afterDelAll="+q().length);
''',
'''    for(var t3=0;t3<30 && q().length;t3++) await sleep(200);
    // 目标状态：弹层就地换成空态节点（遗留行为：clipRemove 只重拉列表，空态由 loadClips 画）。
    var tEmpty=await poll(function(){ return !!document.querySelector("#sheet .empty") },20,200);
    L("tEmpty="+tEmpty);
    L("afterDelAll="+q().length);
''')

# ---------- 截图弹层 ----------
rep('''    var foot=function(){ var e=document.querySelector("#sheet #shotFoot"); return e?e.textContent.replace(/\\s+/g,""):"" };
''',
'''    var foot=function(){ var e=document.querySelector("#sheet #shotFoot"); return e?e.textContent.replace(/\\s+/g,""):"" };
    var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
''' + POLL.replace("  var poll", "    var poll"))

rep('''    q()[0].click();                       // 真点击：证明 @click 真的绑上了
    await new Promise(function(r){setTimeout(r,300)});
    L("on1="+on());''',
'''    q()[0].click();                       // 真点击：证明 @click 真的绑上了
    // 目标状态：至少一行带 on（点击真的落到 shotPick 并重绘）。
    var tPick=await poll(function(){ return on()>=1 },30,200);
    L("tPick="+tPick); L("on1="+on());
''')

rep('''    document.querySelector("#sheet #shotSelAll").click();               // 全选
    await new Promise(function(r){setTimeout(r,300)});
    L("on2="+on());''',
'''    document.querySelector("#sheet #shotSelAll").click();               // 全选
    var tAll=await poll(function(){ var n=q().length; return n>0 && on()===n },30,200);
    L("tAll="+tAll); L("on2="+on());
''')

rep('''    document.querySelector("#sheet #shotSelNone").click();              // 全不选
    await new Promise(function(r){setTimeout(r,300)});
    L("on3="+on());''',
'''    document.querySelector("#sheet #shotSelNone").click();              // 全不选
    var tNone=await poll(function(){ return on()===0 },30,200);
    L("tNone="+tNone); L("on3="+on());
''')

rep('''    q()[0].click();                       // 只选 1 张：三个导入按钮塌成
    await new Promise(function(r){setTimeout(r,300)});
''',
'''    q()[0].click();                       // 只选 1 张：三个导入按钮塌成
    // 目标状态：勾选数恰好 1（按钮收敛这条断言的前提）。
    var tOne=await poll(function(){ return on()===1 },30,200);
    L("tOne="+tOne);
''')

rep('''    shotOverlay(true, 2, "OCR 完成，AI 正在解析");
    await new Promise(function(r){setTimeout(r,250)});
    L("ovlMounted="
''',
'''    shotOverlay(true, 2, "OCR 完成，AI 正在解析");
    // 目标状态：body 级的进度层真的挂出来了（它要在弹层关掉之后继续活着）。
    var tOvl=await poll(function(){ return !!document.querySelector("#shotOvlRoot .ovl") },30,200);
    L("tOvl="+tOvl);
    L("ovlMounted="
''')

rep('''    closeSheet();                       // 进度层必须活过弹层关闭
    await new Promise(function(r){setTimeout(r,250)});
    L("ovlAfterClose="
''',
'''    closeSheet();                       // 进度层必须活过弹层关闭
    // 目标状态：关闭弹层之后进度层还在（这一条是「等它没被顺手拆掉」，轮询到出现即可）。
    var tAlive=await poll(function(){ return !!document.querySelector("#shotOvlRoot .ovl") },20,200);
    L("tAlive="+tAlive);
    L("ovlAfterClose="
''')

rep('''    shotOvlSub("AI 正在解析：1 / 2 条完成");
    await new Promise(function(r){setTimeout(r,250)});
    L("ovlSub2="
''',
'''    shotOvlSub("AI 正在解析：1 / 2 条完成");
    // 目标状态：副标题文案真的换成新的那句（不是只改了模块状态）。
    var tSub=await poll(function(){ return ((document.querySelector("#shotOvlSub")||{}).textContent||"").indexOf("1 / 2")>=0 },30,200);
    L("tSub="+tSub);
    L("ovlSub2="
''')

rep('''    shotOverlay(false);
    await new Promise(function(r){setTimeout(r,250)});
    L("ovlLeft="
''',
'''    shotOverlay(false);
    // 目标状态：进度层从 DOM 里消失（卸载干净，不留空壳）。
    var tGone=await poll(function(){ return !document.querySelector("#shotOvl") },30,200);
    L("tGone="+tGone);
    L("ovlLeft="
''')

def align(old, new):
    # 锚点末行常常是「半行」（例如 L("ovlMounted=" 后面还有代码），这种锚点不能带结尾换行。
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
print("ok: %d 处固定 sleep 换成轮询" % len(R))
