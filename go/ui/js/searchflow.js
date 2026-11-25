// go/ui/js/searchflow.js — 服务端搜索那一簇从 app.js 搬出来（P14 S6 步骤 41）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块顶层不读 app.js 的任何东西，
// 从 app.js 拿的（tab / q / SRERR / syncBox / reassign / apiTimeout / errText /
// paintStatus / render / $ / setQ / setQRaw）全部只在函数体里读。
// SR / SRK 是模块自己的状态：SRK 是「上次搜索结果的指纹」盒子，附件页（filesflow.js）
// 也读写它，那边从 app.js 拿（app.js 再导出），写的一律是 SRK.v —— ES module 的 import
// 是只读绑定，直接给导入名赋值会在链接期就 SyntaxError。
// searchSeq 是首页搜索的私有序号（附件页有自己的 filesSeq，一页一序号，闸门⑰ 钉着）。
import { Vue } from './vue.js'
import { shell } from './shell.js'
import { P, prefQS, savePrefs } from './prefsflow.js'
import { filesNow } from './filesflow.js'
import { tab, q, SRERR, syncBox, reassign, apiTimeout, errText, paintStatus, render, $,
         setQ, setQRaw } from './app.js'
var SR = Vue.reactive({notes:null, todoIds:null, where:{}, total:0, scanned:0});
var searchSeq = 0;
/* 上次搜索结果的指纹，内容一样就不重建 DOM。
   步骤 31：附件页那一簇（filesflow.js）也要读写它，而 ES module 的 import 是**只读**绑定
   —— 导入方一写就抛「Assignment to constant variable」（模块永远是严格模式）。所以它从
   字符串改成盒子，两边都写 SRK.v：这是本项目把 var 交给别的模块用的标准做法（同 S / CLIP）。 */
var SRK = { v: '' };
/* 步骤 13：首页搜索也走 apiTimeout —— fetch 没有超时会永久挂起（WebView 进后台
   再回来，在飞的 fetch 永不 resolve），症状是首页永久停在上一份数据上。失败退回
   本地过滤（原有行为）并记 srErr，首页顶部给一条可重试的错误条。 */
async function searchNow(force){
  if(tab==='files'){ filesNow(); return; }
  var my = ++searchSeq;
  try{
    var d = await apiTimeout('/api/search?'+prefQS());
    if(my !== searchSeq) return;
    syncBox(SRERR, '');
    var k = JSON.stringify(d);
    reassign(SR, {notes:d.notes||[], todoIds:d.todoIds||null, where:d.where||{}, total:d.total||0, scanned:d.scanned||0});
    // 顶部横幅（剪贴板暂存 / 新截图 / 错过的提醒）不在搜索结果里：搜索结果没变、
    // 但页面签名变了（条数变了）时必须强制重绘，否则「删光剪贴板」「刚扫到新截图」
    // 回到首页都看不到横幅 —— 这两处的 bug 都是这里短路掉的。
    if(k === SRK.v && !force){ paintStatus(); return }
    SRK.v = k;
  }catch(e){ reassign(SR, {notes:null, todoIds:null, where:{}, total:0, scanned:0}); SRK.v = ''; syncBox(SRERR, errText(e)) }
  render();
}
var searchT = 0;
/* 搜索框：shell.q 是输入框里的原文（v-model 双向绑的就是它），真发给服务端的是 trim
   过的 q。服务端搜索：等用户停手再发，避免每敲一个字就重建一次列表。 */
function searchInput(v){
  setQRaw(v.trim());
  P().q = q;
  shell.has = !!q;
  clearTimeout(searchT);
  searchT = setTimeout(function(){ searchNow(); savePrefs(); }, 260);
}
function searchClear(){
  setQ('');
  var el = $('#q'); if(el) el.blur();
  P().q = '';
  clearTimeout(searchT); searchNow(); savePrefs();
}
/* app.js 把 searchInput / searchClear 挂进 HOST（shell:topbar 的搜索框），把 searchNow /
   SRK / SR 再导出给 settingsflow.js（偏好改完要重搜）与 filesflow.js（附件页共用 SRK 指纹）。 */
export { SR, SRK, searchNow, searchInput, searchClear }
