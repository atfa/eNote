// go/ui/js/netflow.js — toast 与请求层（api / apiTimeout / errText）从 app.js 搬出来（P14 S6 步骤 47）。
//
// 零循环依赖：本模块只 import js/shell.js（toast 写的是 shell.toast 两个字段），
// 顶层不读 app.js 的任何东西，所以它比 js/shotflow.js 那套契约更松——连「只在函数体里读」
// 都不需要。反过来 import 它的模块（十一个 flow + app.js 自己）也不再因为请求层而依赖 app.js。
// API_FAIL 是测试缝（步骤 14）：app.js 的 __enote.test.failApi 现在调 setApiFail()，
// 因为 ES module 的导入是只读活绑定，app.js 不能替本模块赋值。
import { shell } from './shell.js'

/* toast（步骤 15）：以前是 innerHTML + classList.add('on') + 把定时器挂在 DOM 节点上
   （t._t）。现在只改 shell.toast 两个字段，显隐与文案由 ToastHost 渲染 —— 定时器是行为，
   留在模块里，不再寄生在 DOM 上。 */
var toastT = 0;
function toast(m){
  shell.toast.msg = String(m);
  shell.toast.on = true;
  clearTimeout(toastT);
  toastT = setTimeout(function(){ shell.toast.on = false }, 2200);
}
/* 测试缝（步骤 14）：`__enote.test.failApi = '/api/clip/parse'` 让含该子串的请求在 fetch 前
   直接抛。需要它是因为「加载失败 / 解析失败」这两支在真机上要 Go 侧真报错才进得去，
   而测试侧没有让 Go 报错的通道（步骤 11 记的账，当时写的是「要补得先做注入假 fetch」）。
   默认空串 = 生产路径零影响；只认显式赋值，见文件末尾 __enote.test。 */
var API_FAIL = '';
async function api(path, body){
  if(API_FAIL && String(path).indexOf(API_FAIL) >= 0)
    throw new Error('injected failure: ' + path);
  var o = body ? {method:'POST',headers:{'Content-Type':'application/json'},
                  body:JSON.stringify(body)} : {};
  var r = await fetch(path, o);
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
/* 步骤 13：给「一页的数据源」用的带超时 api。fetch 没有超时时会永久挂起（真机撞过：
   WebView 进后台再回来，在飞的 fetch 永不 resolve），症状是这一页永久停在骨架屏。
   超时只放弃等待，不取消请求（fetch 的 result 被丢弃即可），所以调用方的序号判定照旧有效。 */
var REQ_TIMEOUT_MS = 12000;
function apiTimeout(path, body, ms){
  return new Promise(function(res, rej){
    var to = setTimeout(function(){ rej(new Error('timeout')) }, ms || REQ_TIMEOUT_MS);
    api(path, body).then(function(v){ clearTimeout(to); res(v) },
                         function(e){ clearTimeout(to); rej(e) });
  });
}
function errText(e){
  return (e && e.message === 'timeout') ? '加载超时' : '加载失败';
}
function setApiFail(v){ API_FAIL = v || '' }
function apiFail(){ return API_FAIL }

/* app.js 把 toast / api 挂进 HOST（组件模板里 H.toast(...) 读它），并把 setApiFail 接进
   __enote.test.failApi；apiTimeout / errText / REQ_TIMEOUT_MS 只给 js/statsflow.js 用。 */
export { toast, api, apiTimeout, errText, REQ_TIMEOUT_MS, setApiFail, apiFail }
