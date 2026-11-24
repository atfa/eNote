#!/bin/bash
# 步骤 16b 的 DOM 等价性探针：我的页三块卡、附件页 strip/图标/元信息、剪贴板计数条、
# 设置页五张卡，抓真机 Vue 渲染出的 DOM，与迁移前字符串函数（git HEAD 的 app.js）对同一份
# 状态的输出逐字比。比 .test/probe_dom.sh（16a：卡片 / 待办行）多覆盖 16b 那批。
#
# 状态是「读」不是「注入」：这些块读的都是服务端真数据（ST / S.info / FA / clipList），
# 探针把同一份状态原样 dump 出来交给 node 侧的旧函数，两边输入才真的一致。
# 先跑 ./.test/probe_dom2_setup.sh 造一个真实附件，附件页那三项才有东西可比。
# 用法：./.test/probe_dom2.sh
cd "$(dirname "$0")/.." || exit 1
JS='(async function(){
  var H = __enote.vue.host, S = __enote.state.S;
  function out(tag, o){ var r = {}; for (var k in o){ r[k] = o[k] ? o[k].outerHTML : null } console.log(tag + " " + JSON.stringify(r)); }
  function q(sel, root){ return (root || document).querySelector(sel); }
  function byText(sel, txt, root){
    var all = Array.prototype.slice.call((root || document).querySelectorAll(sel));
    return all.filter(function(e){ return e.textContent.indexOf(txt) >= 0 })[0] || null;
  }
  async function settle(fn){ for (var i = 0; i < 40; i++){ if (fn()) return true; await new Promise(function(r){ setTimeout(r, 200) }); } return false }
  // ---- 我的页：等真统计回来再 dump 状态（ST 是 null 时旧侧算的是占位分支）----
  H.tabPick("mine");
  await settle(function(){ return /条笔记/.test((q("#view .pane[data-tab=\"mine\"] .hstats") || {}).textContent || "") });
  console.log("PD2STATE " + JSON.stringify({ ST: H.ST, info: S.info, ocrInfo: S.ocrInfo, settings: S.settings,
    FA: H.FA, clipList: H.clipList, clipSel: H.clipSel }));
  var mp = q("#view .pane[data-tab=\"mine\"]");
  out("PD2", { hero: q(".hero", mp), notesCard: byText(".card", "笔记状态", mp),
               runCard: byText(".card", "Go / 运行时长", mp) });
  // ---- 附件页 ----
  H.tabPick("files"); H.filesNow();
  await settle(function(){ return q("#view .pane[data-tab=\"files\"] .acard .ameta") });
  var fp = q("#view .pane[data-tab=\"files\"]");
  console.log("PD2FA " + JSON.stringify(H.FA));
  out("PD2", { strip: q(".strip", fp), ameta: q(".acard:not(:has(img)) .ameta", fp),
               aglyph: q(".acard:not(:has(img)) .aglyph", fp) });
  // ---- 剪贴板弹层 ----
  H.clipSheet();
  await settle(function(){ return q("#clipFoot") });
  out("PD2", { clipFoot: q("#clipFoot") });
  H.closeSheet();
  // ---- 设置弹层 ----
  H.settingsSheet();
  await settle(function(){ return byText("#panel .card", "解析队列") });
  var sp = q("#panel");
  function deepest(sel, txt){
    var all = Array.prototype.slice.call(sp.querySelectorAll(sel));
    return all.filter(function(e){ return e.textContent.indexOf(txt) >= 0 }).pop() || null;
  }
  out("PD2", { collect: byText(".card", "剪贴板暂存", sp), ocrCard: byText(".card", "引擎状态", sp),
               dataCard: byText(".card", "导出 JSON", sp), setRunCard: byText(".card", "解析队列", sp),
               usage: byText(".card", "在微信", sp), keepNote: deepest("div", "常驻提示") });
  H.closeSheet();
})()'
./.test/probe.sh "$JS" PD2 60 > .test/logs/probe_dom2.txt 2>&1
grep -o 'PD2STATE {.*}' .test/logs/probe_dom2.txt | head -1 | sed 's/^PD2STATE //' > .test/live_state.json
grep -o 'PD2FA {.*}' .test/logs/probe_dom2.txt | head -1 | sed 's/^PD2FA //' > .test/live_fa.json
grep -o 'PD2 {.*}' .test/logs/probe_dom2.txt | sed 's/^PD2 //' > .test/live_dom_blocks.jsonl
wc -c .test/live_state.json .test/live_fa.json; wc -l .test/live_dom_blocks.jsonl
