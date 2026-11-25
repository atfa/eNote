#!/bin/bash
# 步骤 17b 的响应式证明（clip 页）。
#   注入状态 → 列表渲染出来；点一条 → .clipitem.on 与底部计数自己变；
#   全程 window.__enoteVtick() 必须一动没动 —— 更新来自 Vue 的依赖追踪，不是 V.tick 大锤。
# 两个坑：
#   1) 状态要写 window.__enote.state（有 setter 的状态桥），写 __enoteActions 上的同名键是
#      快照属性，赋值只落在 window 上，模块里的 CLIP 一动不动（步骤 17b 在这里烧了十几轮探针）。
#   2) probe.sh 把 JS 塞进单引号参数，所以这里的 JS 一律用双引号。
cd "$(dirname "$0")/.." || exit 1
./.test/probe.sh '(function(){
  var ST = window.__enote.state, A = window.__enoteActions;
  A.clipSheet();
  setTimeout(function(){
    ST.clipList = [{id:"a1",kind:"text",text:"甲",app:"x",createdAt:Date.now()},
                   {id:"a2",kind:"text",text:"乙",app:"y",createdAt:Date.now()-60000}];
    ST.clipSel = {a1:true,a2:false};
    var t0 = window.__enoteVtick();
    setTimeout(function(){
      var it = document.querySelector("#clipitem-a2");
      var before = document.querySelector("#clipFoot").textContent.trim();
      if (it) it.click();
      setTimeout(function(){
        console.log("PROBE items=" + document.querySelectorAll(".clipitem").length
          + " on=" + document.querySelectorAll(".clipitem.on").length
          + " before=[" + before + "] after=[" + document.querySelector("#clipFoot").textContent.trim()
          + "] tick " + t0 + "→" + window.__enoteVtick());
      }, 400);
    }, 400);
  }, 900);
})()' PROBE 8
