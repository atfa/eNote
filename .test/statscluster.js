/* ---------- 我的页（R5）：本地数据摘要 + 近 7 天活动 ----------
   数字全部来自 /api/stats（服务端从同一份 store 现算，不会和列表页对不上）。 */
/* 步骤 13：stBusy 以前没有超时 —— 一次永不返回的 /api/stats 把我的页永久钉在骨架屏
   （`if(stBusy) return` 之后再也没有第二次机会）。现在请求带超时，stBusy 带时间戳，
   超过 REQ_TIMEOUT_MS + 宽限期就允许新的请求进入；失败记 stErr，骨架屏上给「重试」按钮。 */
var ST = Vue.reactive({ v: null }), stBusy = false, stSince = 0, stErr = STERR.v;
async function statsNow(){
  if(stBusy && (Date.now() - stSince) < REQ_TIMEOUT_MS + 2000) return;
  stBusy = true; stSince = Date.now();
  try{ ST.v = await apiTimeout('/api/stats'); stErr = syncBox(STERR, '') }
  catch(e){ ST.v = null; stErr = syncBox(STERR, errText(e)) }
  stBusy = false;
  if(tab==='mine') render();
}
function statCls(hot, label){ return 'stat'+(hot?' hot':'')+enterCls('s'+label) }
