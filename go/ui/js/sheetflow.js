// go/ui/js/sheetflow.js — 弹层开合那一簇从 app.js 搬出来（P14 S6 步骤 38）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块顶层不碰 app.js 的任何东西，
// 从 app.js 拿的（$ / VUE_SHEETS）全部只在函数体里读，求值期谁都不碰谁。
// sheetGen 是模块自己的私有状态（只有这两个开启入口 bump 它），不导出。
// cssMs 是 closeSheet 的私有工具（收场时长只从样式表读），也不导出。
import { nextTick, mountSheet, unmountAllSheets } from './vue.js'
import { shell } from './shell.js'
import { $, VUE_SHEETS } from './app.js'
/* 弹层开启序号（步骤 8）。两个开启入口（pageSheetVue / sheetVue）都是「先改 shell.sheet 状态，
   再 nextTick 往 #sheetBody 里挂 app」；连点两下、开 A 立刻改开 B 时，迟到的 nextTick 回调会
   把上一个弹层的组件挂进新面板里：DOM 在 .panel 里但 app 已死，弹层空白且点了没反应。
   入口 bump，回调发现序号变了就直接放弃。
   步骤 17i：closeSheet 不再参与 —— 收场交给 <Transition>，leave 被取消时 Vue 不会调
   after-leave，所以上面这条只剩「开」这一侧要防。 */
var sheetGen = 0;
/* 弹层开合（步骤 15 之后只有一条路径）：状态写进 shell.sheet，SheetHost 渲染外壳，
   内容交给 VUE_SHEETS 里的组件挂载。两种形态：
   - pageSheetVue(name, title, kind)：全屏页（.phead + .pbody#sheetBody）
   - sheetVue(name, full)：底部卡片（.grip + .pclose + #sheetBody）
   两者都返回 nextTick 的 Promise（D13：调用方 await 完才能断到新 DOM），并在挂载后把
   面板滚回顶部。步骤 16c：字符串内容那条路（pageSheet / sheet + mode:'html'）删掉了，
   六个字符串弹层全成了组件，内联 onclick 也一起没了（app.js 里从 21 处降到 0）。 */
function pageSheetVue(name, title, kind){
  sheetGen++;
  var gen = sheetGen;
  /* 步骤 13：先把所有旧 sheet 拆干。以前只拆同名（mountSheet 里那句 unmountSheet(name)），
     于是「开过剪贴板页再开设置页」会把剪贴板那个 app 连同 effect 一起泄漏在面板里：
     innerHTML 已经把它的根节点换成游离节点，它自己不知道，渲染永远到不了它。
     步骤 17j：进度层不再需要列为例外 —— 它不在 .panel 里，也不在这张表里（见 shotOverlay）。 */
  unmountAllSheets();
  shell.sheet.page = true;
  shell.sheet.kind = kind || '';
  shell.sheet.full = false;
  shell.sheet.title = title;
  shell.sheet.mounted = true;
  shell.sheet.on = true;
  return nextTick(function(){
    if(gen !== sheetGen) return;
    var el = $('#sheetBody');
    if(!el) return;
    mountSheet(name, el, VUE_SHEETS[name]);
    var p = $('#panel');
    if(p) p.scrollTop = 0;
  });
}
/* 卡片形态（底部弹出）：外壳（.grip + .pclose）由 SheetHost 渲染，内容挂在 #sheetBody。
   迁移前是 `p.innerHTML = '<div class="grip"></div><button class="pclose" …>' + html`，
   现在 html 那一层包在 #sheetBody 里（唯一的结构差别，CSS 已跟上）。 */
function sheetVue(name, full){
  sheetGen++;
  var gen = sheetGen;
  unmountAllSheets();
  shell.sheet.page = false;
  shell.sheet.kind = '';
  shell.sheet.full = !!full;
  shell.sheet.title = '';
  shell.sheet.mounted = true;
  shell.sheet.on = true;
  return nextTick(function(){
    if(gen !== sheetGen) return;
    var el = $('#sheetBody');
    if(!el) return;
    mountSheet(name, el, VUE_SHEETS[name]);
    var p = $('#panel');
    if(p) p.scrollTop = 0;
  });
}
/* 样式表是动画时长的唯一来源：这里读 tokens.css 的 --d1（"110ms"）换算成毫秒。
   单位要认：CSS 时长写成 110ms 时 parseFloat 给的就是毫秒数，写成 .2s 才是秒。 */
function cssMs(name){
  var s = '';
  try{ s = String(getComputedStyle(document.documentElement).getPropertyValue(name)).trim() }
  catch(e){ return 0 }
  var v = parseFloat(s);
  if(!isFinite(v) || v <= 0) return 0;
  return /ms$/.test(s) ? Math.round(v) : Math.round(v * 1000);
}
function closeSheet(){
  if(!shell.sheet.on) return;
  /* 步骤 18d：外壳是 van-popup，显隐是 v-if（没有 Vue 的 leave 阶段，理由见 js/shell.js
     的 SheetHost 注释），所以收场动画自己排：on=false 让 SheetHost 挂上 .closing
     （面板下滑 + 遮罩淡出，规则在 css/components.css），动画跑完才摘节点。
     摘掉之后 van-popup 的 @vue:unmounted → sheetLeft() 拆弹层内容的 app。
     「关掉立刻重开」由状态守卫：定时器只在仍然 on=false 时才摘，重开就不摘。
     定时器在后台标签页会被节流到 1s，但它会跑 —— 17i 的教训是 rAF 在不可见窗口上
     永不跑，Vue 的 <Transition> 因此不可用（CSS 动画走合成器，不受影响）。
     进度层不在这里收，也不在这张表里：它是外壳树里的 <teleport> 子组件（步骤 17j），
     shotsImported 先 closeSheet 再等 AI 解析完，进度层自己管自己的生死（SHOTPROG.on）。 */
  shell.sheet.on = false;
  var ms = cssMs('--d1');
  if(!ms){ shell.sheet.mounted = false; return }
  setTimeout(function(){ if(!shell.sheet.on) shell.sheet.mounted = false }, ms + 20);
}
/** van-popup 的 @vue:unmounted：节点真摘掉了，才拆 sheet 的 app */
function sheetLeft(){
  /* 步骤 13：以前这里手写四个名字（shots/folders/clip/settings），新增 sheet 忘了加
     就是静默泄漏。名单现在只有一份：sheetApps 这张表。步骤 17j：进度层从例外名单里
     没掉了（它不在 sheetApps 里，见 shotOverlay 的注释）。 */
  unmountAllSheets();
}

/* app.js 把 pageSheetVue / sheetVue 挂进各弹层的入口函数，把 closeSheet / sheetLeft
   挂进 HOST（SheetHost 的 @click-overlay / @vue:unmounted）；clipflow / missedflow /
   settingsflow / shotflow 都从 app.js 拿 pageSheetVue，所以 app.js 那边继续再导出。 */
export { pageSheetVue, sheetVue, closeSheet, sheetLeft }
