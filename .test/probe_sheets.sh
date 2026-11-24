#!/bin/bash
# 步骤 16c 的 DOM 等价性探针：六个刚翻成 Vue 组件的弹层（排序筛选 / 错过的提醒 / 记一笔 /
# 添加待办 / 运行日志 / AI 调用记录），抓真机渲染出的 #sheetBody 与 .panel 形态，
# 交给 .test/dom_equiv3.js 与迁移前的字符串函数（git HEAD 的 app.js）逐字比。
# 注意：JS 里不能用单引号（probe.sh 把载荷塞进单引号包住的 shell 参数里）。
cd "$(dirname "$0")/.." || exit 1
JS='(async function(){
  var out = {};
  function prefsNow(){ return __enote.vue.host.P() }
  async function dump(name, fn){
    try{ await fn(); }catch(e){ out[name+"_err"] = String(e); }
    var sb = document.getElementById("sheetBody");
    out[name] = sb ? sb.innerHTML : "(no sheetBody)";
    var p = document.getElementById("panel");
    out[name+"_cls"] = p ? p.className + "|kind=" + (p.dataset.kind||"") : "-";
    closeSheet();
    await new Promise(function(r){ setTimeout(r, 500) });
  }
  await dump("sort_notes", function(){ return sortSheet() });
  out.prefs_notes = prefsNow();
  __enote.state.tab = "todos"; await render();
  await dump("sort_todos", function(){ return sortSheet() });
  out.prefs_todos = prefsNow();
  __enote.state.tab = "files"; await render();
  await dump("sort_files", function(){ return sortSheet() });
  out.prefs_files = prefsNow();
  __enote.state.tab = "notes"; await render();
  // addSheet 不在导出表里（只被 fab 的闭包调），所以走 fabAct()：笔记页的 fab 就是「记一笔」。
  await dump("add", function(){ __enote.vue.host.fabAct(); return new Promise(function(r){ setTimeout(r, 400) }) });
  await dump("addtodo", function(){ return addTodoSheet("n123") });
  await dump("log", function(){ return showLog() });
  out.logData = __enote.vue.host.logData;
  await dump("debug", function(){ return showDebug() });
  out.debugData = __enote.vue.host.debugData;
  __enote.state.MISSED = {count:2, items:[
    {nid:"n1", id:"t1", text:"错过的甲", due:"2026-01-01T08:00:00+08:00", ntitle:"笔记甲"},
    {nid:"n2", id:"t2", text:"错过的乙", due:""}]};
  await dump("missed", function(){ return missedSheet() });
  out.missedState = __enote.state.MISSED;
  __enote.state.MISSED = {count:0, items:[]};
  await dump("missed_empty", function(){ return missedSheet() });
  out.now = Date.now();
  console.log("PD3 " + JSON.stringify(out));
})()'
./.test/probe.sh "$JS" PD3 30
