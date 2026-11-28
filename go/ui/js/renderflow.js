// go/ui/js/renderflow.js — 渲染核心从 app.js 搬出来（P14 S6 步骤 51）。
//
// 这一簇是「数据 → DOM」那条主干：render()（唯一一条渲染路径）、afterPaint()（DOM 落地
// 之后的测量）、syncExpand()（展开详情按钮该不该出现）、strip()/paintStatus()（顶栏指标条
// 与状态点）、markReady()（首屏记号，也是 index.html 看门狗的存活信号）。
//
// 循环依赖契约（见 js/shotflow.js 文件头）：本模块 import app.js 的 S / tab，app.js import
// 本模块的 render / paintStatus / strip / markReady / syncExpand。两边都只在函数体里读，
// 求值期谁都不碰对面。
//
// 唯一的「app.js 写本模块变量」：readyResolve / firstPainted 由模块末尾的 __ready Promise
// 存进来，ESM 的 import 是只读活绑定，所以那边只能走 setReadyResolve() / hasFirstPainted()。
import { S, tab } from './app.js'
import { shell } from './shell.js'
import { apps, mountView, vuePaint } from './vue.js'
import { paneFor, invalidatePanes, showPane, paneBuilt, paneDirty, VUE_VIEWS } from './panes.js'
import { syncReminders } from './remindflow.js'
import { clearEnter } from './noteflow.js'
import { ic } from './domutil.js'

/* DOM 测量类的副作用：必须在 DOM 落地之后跑（遗留路径是同步 innerHTML，Vue 路径是 nextTick 之后） */
function afterPaint(){
  syncReminders();
  syncExpand();
}
function render(){
  var p = paneFor(tab);
  invalidatePanes(tab);
  showPane();
  paintStatus();
  clearEnter();
  /* 步骤 11 起这是唯一一条渲染路径：四个 tab 全在 VUE_VIEWS 里，字符串渲染器（页面级
     *HTML() 与页面级 render*()）整批删掉了。注册表缺 tab 时不静默回退——回退到已经不
     存在的渲染器只会白屏，直接 console.error 报出来（SELFCHECK 与「没有运行时报错」那
     两步会抓到）。 */
  if(!VUE_VIEWS[tab]){
    console.error('VUE_VIEWS 注册表缺 tab：' + tab);
    markReady();
    return Promise.resolve();
  }
  if(!apps[tab]) mountView(tab, p, VUE_VIEWS[tab]);
  paneBuilt[tab] = 1; paneDirty[tab] = 0;
  /* D13/D14：Vue 的 DOM 在 nextTick 之后才落地，所以 DOM 测量与 markReady 都得摄到那一拍。
     done 同时挂在 then 和 catch 两条分支上，done 内部用 try/finally：链上任何一环 reject、
     某个副作用抛了，也要把首屏记号打出去，否则 index.html 的看门狗（D16，12s）会把
     「画完了但某个副作用抛了」误判成白屏，症状从「一处没刷新」升级成「整页重建」。
     D13：render 的契约是 Promise（调用点一律不 await，只有 test.sh 的 jseval 载荷 await
     —— 那里是「点完立刻断言 DOM」的场景），所以返回 nextTick 那条链。 */
  var done = function(){ try { afterPaint() } finally { markReady() } };
  return vuePaint().then(done, done);
}
/* S3（D17）：首屏画完的记号。两个用途：__enote.ready 的兑现点，也是 index.html 里
   看门狗（D16）的存活信号。声明成函数 + 可空回调是因为时序：refresh() 在模块末尾的
   __enote 装配之前就被调用，render() 可能在 Promise 存好之前就跑到，直接引用会拿到 undefined。 */
var readyResolve = null, firstPainted = false;
function markReady(){
  if(firstPainted) return;
  firstPainted = true;
  if(readyResolve) readyResolve();
}
/* 这里不能再有一份同名 render 函数：函数声明提升会让后一份覆盖前一份，Vue 分发会静默失效。
   web_test.go 钉了「全文只有一个 render 定义」。 */

/* 「展开详情」只在正文真的超过三行时才出现：先去掉 clamp 量整段高度，再加上 clamp 量三行高度，
   两者一样就说明没被截断，按钮没意义，直接藏起来（否则每张短笔记都挂一个点了没反应的按钮）。 */
function syncExpand(){
  var cards = document.querySelectorAll('#view .card');
  for(var i=0;i<cards.length;i++){
    var b = cards[i].querySelector('.body'), btn = cards[i].querySelector('.btn.exp');
    if(!b || !btn) continue;
    var was = b.classList.contains('clamp');
    b.classList.remove('clamp');
    var full = Math.round(b.getBoundingClientRect().height);
    b.classList.add('clamp');
    var three = Math.round(b.getBoundingClientRect().height);
    if(!was) b.classList.remove('clamp');
    btn.style.display = (full - three > 1) ? '' : 'none';
  }
}
function strip(){
  var i = S.info;
  return '<div class="metrics">'
    + '<div class="m"><b>' + (i.open || 0) + '</b><span>' + ic('check-square', 's') + '待办</span></div>'
    + '<div class="m' + (i.overdue ? ' hot' : '') + '"><b>' + (i.overdue || 0) + '</b><span>'
      + ic('alert', 's') + '逾期</span></div>'
    + '<div class="m"><b>' + (i.notes || 0) + '</b><span>' + ic('note', 's') + '笔记</span></div>'
    + '</div>';
}
function paintStatus(){
  var i = S.info;
  shell.dot = i.server ? '' : 'bad';
}
/* 首屏记号的两侧：markReady() 在本模块里打记号，app.js 模块末尾的 __ready Promise 存 resolve。
   app.js 写不了本模块的 var（ESM 导入是只读活绑定），所以留一对显式入口。 */
function setReadyResolve(fn){ readyResolve = fn }
function hasFirstPainted(){ return firstPainted }

/* app.js 把 render / paintStatus / strip 再导出（filesflow、searchflow、tabflow 等九个模块
   与 HOST 从 './app.js' 拿它们），markReady 是 __enote.test 测试缝的调用面。 */
export { afterPaint, render, markReady, syncExpand, strip, paintStatus,
         setReadyResolve, hasFirstPainted }
