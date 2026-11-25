// go/ui/js/statsflow.js — 我的页（R5）统计那一簇从 app.js 搬出来（P14 S6 步骤 33）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块先被求值，顶层只碰 vue.js 的 Vue 与
// 自己新建的 reactive 盒子；app.js 那边（REQ_TIMEOUT_MS / apiTimeout / errText / syncBox /
// STERR / tab / render / enterCls）全部只在函数体里读。
// 顶层那句 `stErr = STERR.v` 是这条契约的例外：本模块的顶层跑在 app.js 求值之前，那时
// app.js 的 `var STERR` 还是 undefined，读它的 .v 会抛 TypeError —— 初值改成字面量 ''
// （STERR 的初值本来就是 ''，语义逐字不变）。
import { Vue } from './vue.js'
import { REQ_TIMEOUT_MS, apiTimeout, errText, syncBox, STERR, tab, render, enterCls } from './app.js'

/* ---------- 我的页（R5）：本地数据摘要 + 近 7 天活动 ----------
   数字全部来自 /api/stats（服务端从同一份 store 现算，不会和列表页对不上）。 */
/* 步骤 13：stBusy 以前没有超时 —— 一次永不返回的 /api/stats 把我的页永久钉在骨架屏
   （`if(stBusy) return` 之后再也没有第二次机会）。现在请求带超时，stBusy 带时间戳，
   超过 REQ_TIMEOUT_MS + 宽限期就允许新的请求进入；失败记 stErr，骨架屏上给「重试」按钮。 */
var ST = Vue.reactive({ v: null }), stBusy = false, stSince = 0, stErr = '';
async function statsNow(){
  if(stBusy && (Date.now() - stSince) < REQ_TIMEOUT_MS + 2000) return;
  stBusy = true; stSince = Date.now();
  try{ ST.v = await apiTimeout('/api/stats'); stErr = syncBox(STERR, '') }
  catch(e){ ST.v = null; stErr = syncBox(STERR, errText(e)) }
  stBusy = false;
  if(tab==='mine') render();
}
/* ---------- 我的页 / 设置页的叶子片段 ----------
   这些片段函数是 Vue 模板的渲染帮手（经 setHost 暴露给组件）；步骤 11 删掉遗留字符串
   渲染器之后它们只剩一个调用者，留着是因为模板里拼 HTML 的写法与它们逐字一致；Vue 侧经 setHost
   的 H.xxx 调用。 */
function statCls(hot, label){ return 'stat'+(hot?' hot':'')+enterCls('s'+label) }

/* 步骤 33：app.js 把下面这些名字挂进 HOST / HOST_KEYS / window.__enoteActions；
   settingsflow.js 与 shotflow.js 也从这里 import（app.js 再导出一次给它们）。 */
export { ST, statsNow, statCls }
