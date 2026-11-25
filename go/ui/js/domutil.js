// go/ui/js/domutil.js — 四个字符串/DOM 小工具从 app.js 搬出来（P14 S6 步骤 48）。
//
// 零 import、零依赖：$ 只碰 document，clip / esc / ic 是纯字符串函数，所以本模块求值期
// 谁都不碰 app.js（契约见 js/shotflow.js 文件头，这里是空满足）。
// esc 的分工（步骤 5 定的契约）：这些函数产出 HTML 字符串（遗留侧用），Vue 模板里用
// 原始值 + {{ }}（Vue 自己转义），所以模板侧不调 esc —— 调了就双重转义。
function $(s){return document.querySelector(s)}
function esc(s){return (s||'').replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function clip(s,n){s=s||'';return s.length>n?s.slice(0,n)+'…':s}
/* 图标：ic('search') → 一个 24dp 线性图标，颜色跟着 currentColor */
function ic(n, cls){ return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="#i-' + n + '"/></svg>' }
/* 谁在用：$ 是 js/sheetflow.js 的弹层挂载与 js/shotflow.js 的进度层；esc 是 js/shotflow.js
   进度层的 what（DOM 文本里就是字面 &amp;，与迁移前逐字一致）；ic 与 clip 由 app.js 挂进
   HOST（组件模板里 H.ic(...) / H.clipText(...) 读它们）。 */
export { $, clip, esc, ic }
