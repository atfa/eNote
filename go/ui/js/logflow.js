// go/ui/js/logflow.js — 运行日志 / AI 调用记录 / AI 连通测试那一簇从 app.js 搬出来（P14 S6 步骤 42）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块顶层不读 app.js 的任何东西，
// 从 app.js 拿的 api、从 sheetflow.js 拿的 sheetVue 全部只在函数体里读。
// 三个盒子（LLMTEST / LOGDATA / DEBUGDATA）是本模块自己的状态，app.js 的 HOST getter
// 读它们的 .v（整包赋值，所以读的是 getter，同 SFORM 那条规矩）。
import { Vue } from './vue.js'
import { sheetVue } from './sheetflow.js'
import { api, apiTimeout, errText } from './netflow.js'

/* 步骤 19：这是全项目最后一处「拼字符串 + esc() 写 innerHTML」。换成一个 {v:} 盒子，
   #llmOut 里的 DOM 由 settings.js 的模板画 —— 转义交给 Vue 的插值（textContent），
   「连接中」与结果两态都是状态的纯函数。整包赋值，所以读它的是 getter（同 LOGDATA）。 */
var LLMTEST = Vue.reactive({ v: null });
async function testLLM(){
  LLMTEST.v = {busy:true};
  try {
    var r = await api('/api/llm/test', {});
    LLMTEST.v = {busy:false, ok:!!r.ok, ms:r.ms, httpCode:r.httpCode, reply:r.reply, error:r.error};
  } catch(e) {
    LLMTEST.v = {busy:false, ok:false, error:'测试请求失败：' + e.message};
  }
}
var LOGDATA = Vue.reactive({ v: null }), DEBUGDATA = Vue.reactive({ v: null });
var debugRequest = 0;
async function showLog(){
  var r = await api('/api/log?n=150');
  LOGDATA.v = r;
  return sheetVue('log');
}
async function refreshDebug(){
  const request = ++debugRequest;
  DEBUGDATA.v = {loading:true};
  try {
    const result = await apiTimeout('/api/llmlog');
    if (!result?.ok || !Array.isArray(result.calls)) throw new Error('invalid AI history');
    if (request === debugRequest) DEBUGDATA.v = {calls:result.calls};
  } catch (e) {
    if (request === debugRequest) DEBUGDATA.v = {error:errText(e)};
  }
}
function showDebug(){
  refreshDebug();
  return sheetVue('debug');
}
/* app.js 把 testLLM / showLog / showDebug 挂进 HOST（设置页的「测试连接」、我的页与
   设置页的「运行日志」「AI 调用记录」），三个盒子经 HOST 的 llmTest / logData / debugData
   递给组件。 */
export { LLMTEST, testLLM, LOGDATA, DEBUGDATA, showLog, showDebug, refreshDebug }
