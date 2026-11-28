// go/ui/js/tabflow.js — 页签切换 / 底部 fab 那一簇从 app.js 搬出来（P14 S6 步骤 43）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块顶层不读 app.js 的任何东西，
// 从 app.js 拿的（tab / setTabTo / setQ / ST / render / showPane / paneBuilt / paneDirty /
// clearSeen）全部只在函数体里读；顶层只有 FABS 这张表（函数引用不调用）与两个事件监听。
// 写 app.js 的 var tab / var q 走那边的 setter（setTabTo / setQ）——ES module 的 import
// 是只读绑定，直接赋值会在链接期就 SyntaxError（同 SRK 装盒那条教训）。
// lastTab 是「上一个页签」，只有 setTab 读写它，所以它是本模块的私有状态。
import { nextTick } from './vue.js'
import { shell } from './shell.js'
import { P } from './prefsflow.js'
import { pickFile } from './filesflow.js'
import { addSheet } from './addflow.js'
import { voiceClick, voiceHold } from './voiceflow.js'
import { statsNow } from './statsflow.js'
import { searchNow } from './searchflow.js'
import { tab, setTabTo, setQ, ST, render, showPane, paneBuilt, paneDirty,
         clearSeen, tabScroll } from './app.js'

var lastTab = 'notes';

/* reset=true 表示明确要回到顶部（打开某条笔记、返回键回首页），否则恢复上次的位置 */
function setTab(reset){
  setTabTo(tab || 'notes');
  if(lastTab !== tab) tabScroll[lastTab] = window.scrollY;   // 记住离开时看到哪儿
  /* 步骤 15：页签高亮、fab 图标/文案、搜索框占位符、顶栏显隐（我的页无顶栏）以前是
     五处命令式 DOM 写，漏一处就是「切了页签按钮没变」。现在只写 shell 这张表，
     顶栏显隐走 body[data-tab] + CSS（它是「当前在哪个页签」的纯函数）。 */
  document.body.dataset.tab = tab;
  shell.tab = tab;
  var f = FABS[tab] || FABS.notes;
  shell.fab = { icon: f.icon, label: f.label };
  shell.placeholder = tab==='todos' ? '搜索待办' : tab==='files' ? '搜索附件' : '搜索笔记与待办';
  setQ(P().q || '');
  var fresh = !paneBuilt[tab] || paneDirty[tab];
  if(fresh){
    clearSeen();   // 重建这一页：卡片算“新出现”，入场动画重跑一次
    render();
  } else {
    showPane();    // 只是切过去：DOM 原样保留，不重绘
  }
  searchNow();     // 搜索条件可能变了（服务端结果回来后 render 会再走一次）
  lastTab = tab;
  var y = reset ? 0 : (tabScroll[tab] || 0);
  if(reset) tabScroll[tab] = 0;
  requestAnimationFrame(function(){ window.scrollTo(0, y) });
  if(tab==='mine' && !ST.v) statsNow();
  /* 指示条要量活动页签的真实几何，而 .tab.on 这个类是 Vue 在 nextTick 才落到 DOM 上的，
     所以测量也必须排在 nextTick 之后（同步量会量到上一个页签的位置）。 */
  nextTick(moveInd);
}
/* 页签指示条：宽度/位移是从真实布局量出来的（DOM 测量只能读 DOM），量完写进 shell.ind，
   由 TabBar 渲染成内联 style。 */
function moveInd(){
  var el = document.querySelector('.tabbar .tab.on');
  if(!el) return;
  shell.ind = { w: Math.round(el.offsetWidth*0.46), x: el.offsetLeft + el.offsetWidth*0.27 };
}
/* 步骤 16d：ico 存的是 ic('plus','l') 那串 SVG 字符串（shell.fab 的 v-html 直插），
   现在只存图标名，SVG 由 shell.js 的 <ico> 组件渲染 —— v-html 全项目归零。 */
var FABS = {
  notes:{icon:'mic', label:'记一笔', fn:addSheet},
  todos:{icon:'plus', label:'记待办', fn:function(){ addSheet() }},
  files:{icon:'clip', label:'加附件', fn:function(){ pickFile() }},
  mine:{icon:'mic', label:'记一笔', fn:addSheet}
};
/* 涟漪（R10）：只给“真按钮”——它们自带 position:relative + overflow:hidden。
   列表行 .li 不参与：它不是定位容器，水波会跑到 viewport 上，铺满全屏 = 闪屏 */
document.addEventListener('pointerdown', function(e){
  var el = e.target.closest ? e.target.closest('.btn,.iconbtn,.tab,.fab,.seg button') : null;
  if(!el) return;
  var r = el.getBoundingClientRect(), d = Math.max(r.width, r.height);
  var s = document.createElement('span');
  s.className = 'rip';
  s.style.width = s.style.height = d+'px';
  s.style.left = (e.clientX - r.left - d/2)+'px';
  s.style.top  = (e.clientY - r.top  - d/2)+'px';
  el.appendChild(s);
  setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s) }, 320);
});
/* ---------- 外壳的事件（步骤 15）----------
   以前是 querySelector + .onclick / addEventListener 挂在静态标记上；现在顶栏与底栏由
   Vue 渲染，事件写在模板里（@click="H.xxx(...)"），这里只留被调的函数本体。
   这些名字必须同时出现在下面的 setHost 宿主对象里（闸门⑮ 查模板里的 H.xxx ⊆ setHost）。
   剪贴板按钮与排序按钮直接复用 importClip / sortSheet，模板里调的就是它们本名。 */
function tabPick(t){
  if(tab === t){ window.scrollTo({top:0, behavior:'smooth'}); return; }
  setTabTo(t); setTab();
}
function brandGo(){ setTabTo('mine'); setTab(true) }
function fabAct(event){
  if (shell.sheet.mounted) return;
  const action = (FABS[tab] || FABS.notes).fn;
  if (event && action === addSheet) return voiceClick(event, action);
  return action();
}
function fabHold(event){
  const startTab = tab;
  if (shell.sheet.mounted || (FABS[startTab] || FABS.notes).fn !== addSheet) return;
  voiceHold(event, () => startTab === tab && fabAct());
}
window.addEventListener('resize', moveInd);
/* app.js 把 setTab 再导出给 dlgflow / missedflow / openflow / shotflow（它们切页签用），
   tabPick / brandGo / fabAct / moveInd 挂进 HOST（shell.js 的顶栏与底栏模板）。 */
export { setTab, moveInd, tabPick, brandGo, fabAct, fabHold }
