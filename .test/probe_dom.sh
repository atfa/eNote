#!/bin/bash
# 步骤 16 的 DOM 等价性探针：把真机上 Vue 组件渲染出的 DOM 抓回本地，
# 与 git HEAD 里遗留字符串函数（noteCard / todoRow / todoTxHTML）对同一份数据的输出逐字比。
# 数据是注入的（.test/equiv_note.json）：真机 store 里没有「带 facts + 带两个待办 + 带标签」的笔记，
# 注入 S 再 render() 才能一次覆盖 meta / hits / facts / 紧凑待办行 / .ttx 五块叶子 DOM。
#
# 顺序有讲究：app 里有个 2s 的 refresh 轮询，它会把 S 换回服务端数据，注入的笔记活不过两轮。
# 所以先做待办页（tabPick 要等视图挂载，最慢），再做笔记页（SR.notes 在渲染前一刻重新灌）。
# 用法：./.test/probe_dom.sh
cd "$(dirname "$0")/.." || exit 1
NOTE=$(tr -d '\n' < .test/equiv_note.json | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["note"]))')
JS='(async function(){
  var NOTE = '"$NOTE"';
  function inject(){
    var S = __enote.state.S;
    __enote.state.S = {notes:[NOTE], settings:S.settings, info:S.info};
    // 笔记页读的是 SR.notes（服务端搜索结果优先），只灌 S 画不出来
    //（notesFiltered 第一行就是 if(SR.notes) return SR.notes）
    __enote.vue.host.SR.notes = [NOTE];
    __enote.vue.host.SR.where = {eq1: ["标题","来自图片文字"]};
  }
  inject();
  __enote.vue.host.tabPick("todos"); await render();
  // 每个 tab 有自己的 .pane[data-tab]，切页签只切 display，#view 里同时住着四个视图的
  // 上一份渲染 —— 必须限定在待办面板里查，否则抓到的是笔记页卡片那份紧凑 .ttx。
  var pane = document.querySelector("#view .pane[data-tab=\"todos\"]");
  for (var i = 0; i < 20; i++){
    if (pane && pane.querySelector(".ttx small")) break;
    await new Promise(function(r){ setTimeout(r, 150) });
  }
  var tx = pane ? pane.querySelector(".ttx") : null;
  console.log("PROBEDOM2 " + JSON.stringify({ todoTx: tx ? tx.outerHTML : "" }));
  inject();
  __enote.state.tab = "notes"; await render();
  var c = document.querySelector("#view .card");
  var todoEl = c ? c.querySelector(".todo") : null;
  console.log("PROBEDOM " + JSON.stringify({ card: c ? c.outerHTML : "", todoRow: todoEl ? todoEl.outerHTML : "", todoTx: "" }));
})()'
./.test/probe.sh "$JS" PROBEDOM 14 > .test/logs/probe_dom.txt 2>&1
grep -o 'PROBEDOM {.*}' .test/logs/probe_dom.txt | head -1 | sed 's/^PROBEDOM //' > .test/live_dom.json
grep -o 'PROBEDOM2 {.*}' .test/logs/probe_dom.txt | head -1 | sed 's/^PROBEDOM2 //' > .test/live_dom2.json
wc -c .test/live_dom.json .test/live_dom2.json
