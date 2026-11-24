#!/usr/bin/env python3
# 步骤 12（B 部分之三）：§9.17 审计第 2 条 —— 截图夹具载荷的 setTimeout(...,1200)。
import io, sys

P = "test.sh"
s = io.open(P, encoding="utf-8").read()

old = '''  __enote.state.tab="notes"; await render(); shotSheet();
  setTimeout(async function(){
    __enote.state.shotSel={};
'''
new = '''  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var poll=async function(f,n,ms){ var i=0; while(i<(n||40)){ if(await f()) return i; await sleep(ms||200); i++; } return -1 };
  __enote.state.tab="notes"; await render(); shotSheet();
  // 固定 1200ms 换成轮询（§9.17 审计第 2 条）：目标状态是「截图列表真的从服务端回来了、
  // 并且弹层里画出了条目」。夹具是刚 share 进去的，最容易慢；固定睡一觉时
  // __enote.state.shotList[0] 还是 undefined，载荷直接抛异常，红得没有信息量。
  var tList=await poll(function(){ return (__enote.state.shotList||[]).length>0 && document.querySelectorAll(".shotitem").length>0 },40,250);
  L("tList="+tList);
  await (async function(){
    __enote.state.shotSel={};
'''
old2 = '''    L("n2_foot="+(q("#shotFoot")?q("#shotFoot").textContent.replace(/\\s+/g," "):"?"));
    L("done=1");
  }, 1200);
'''
new2 = '''    L("n2_foot="+(q("#shotFoot")?q("#shotFoot").textContent.replace(/\\s+/g," "):"?"));
    L("done=1");
  })();
'''
for o in (old, old2):
    if s.count(o) != 1:
        sys.exit("锚点命中 %d 次：\n%s" % (s.count(o), o[:100]))
s = s.replace(old, new).replace(old2, new2)
io.open(P, "w", encoding="utf-8").write(s)
print("ok: 截图夹具载荷的固定 1200ms 换成轮询")
