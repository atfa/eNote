// go/ui/js/missedflow.js — 错过的提醒那一簇从 app.js 搬出来（P14 S6 步骤 36）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块的顶层跑在 app.js 求值之前，顶层只碰
// vue.js 的 Vue 与自己新建的 reactive 盒子 MISSED；app.js 那边（S / api / toast / render /
// toggle / pageSheetVue / closeSheet / setTab）全部只在函数体里读。
// `tab` 是 app.js 的 var，ESM 的 import 绑定只读，写它要走 app.js 的 setTabTo()（同 setQ）。
// MISSED 是 {v:} 盒子：app.js 的 refresh() 与 __enote.state 桥都写 MISSED.v，写属性不算写绑定。
import { Vue } from './vue.js'
import { S, render, toggle, pageSheetVue, closeSheet, setTab, setTabTo } from './app.js'
import { api, toast } from './netflow.js'

/* 错过的提醒（后台被冻结时到点的那些）：只在有内容时出现，点开看清单 */
var MISSED = Vue.reactive({ v: null });   // 服务端只在启动时算一次，之后 refresh 覆盖 S 时要把它贴回去
async function loadMissed(){
  try{
    var d = await api('/api/missed');
    if(d && d.count){ MISSED.v = d; S.missed = d; render(); }
  }catch(e){}
}
/* 错过的提醒面板的操作逻辑（用户反馈：只能看，没法处理）
   三条路，每条都有明确后果：
     点整行   → 跳到那条笔记看上下文
     勾「完成」→ 真的把待办标完成，从这份清单里去掉
     「这批我知道了」→ 待办一条不动，只是承认"我看过了"，横幅消失
   横幅本身是"上次打开 app 之后到点的未完成待办"，服务端记的水位；点过「我知道了」
   之后水位已推进，同一批不会再来烦你（下一批要等新的到点提醒）。 */
function missedSheet(){
  var m = MISSED.v || S.missed;
  if(!m) return;
  return pageSheetVue('missed', '错过的提醒');
}
function missedDone(ev, nid, tid, el){
  ev.stopPropagation();
  toggle(nid, tid, el);          // 复用待办页：划线 → 原位淡出 → 新位置高亮入场
  setTimeout(function(){         // 动画跑完再把这条从清单里摘掉
    if(!MISSED.v) return;
    var n0 = (MISSED.v.items || []).length;
    MISSED.v.items = (MISSED.v.items || []).filter(function(t){ return t.id !== tid });
    MISSED.v.count = (MISSED.v.items || []).length;
    if(S.missed) S.missed = MISSED.v;
    if((MISSED.v.items || []).length === n0) return;
    render();                 // 背后的横幅条数
    if(MISSED.v.items.length) missedSheet(); else closeSheet();
  }, 900);
}
/* 点清单里的一条：跳到笔记并展开那条待办 */
function missedGoTodos(){ closeSheet(); setTabTo('todos'); setTab(true); }
function missedDismiss(){
  MISSED.v = null;
  if(S) S.missed = null;
  closeSheet();
  render();
  toast('好，这批不再提示');
}
/* app.js 把 MISSED 挂进 HOST / HOST_KEYS / __enote.state，把 loadMissed 挂在启动里，
   把 missedSheet / missedDone / missedGoTodos / missedDismiss 挂进 HOST 与导出表。 */
export { MISSED, loadMissed, missedSheet, missedDone, missedGoTodos, missedDismiss }
