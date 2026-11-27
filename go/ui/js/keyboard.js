// go/ui/js/keyboard.js — 软键盘遮挡补偿（P18，「记一笔」面板）。
//
// 背景（用户实测的 bug）：点输入框编辑时键盘弹起来，把弹层最下面那排按钮盖掉一半。
// 原因不在 .sheet 的定位，而在 Android WebView 的默认 interactive-widget 行为：
// 键盘只缩 visual viewport（resizes-visual），**布局视口不变**，于是 position:fixed
// 贴底的东西（#sheet 就是 van-popup 的 fixed 贴底根节点）仍然画在屏幕底部 —— 屏幕底部
// 正是键盘占着的地方。
//
// 这里把遮挡高度写进 --kb（CSS 变量），由 css/components.css 的 .sheet / .panel 消费：
// .sheet 抬起 --kb、.panel 的 max-height 减掉 --kb，面板自己的 overflow:auto 负责滚动。
// index.html 的 viewport 同时声明了 interactive-widget=resizes-content：支持它的 WebView
// 直接缩布局视口，那时 innerHeight == visualViewport.height、--kb 算出来是 0，两条路
// 不会叠加（支持与否都不会多抬一次）。
//
// 本模块只碰 document 与 window，不 import 任何业务模块（契约同 js/domutil.js）。
var KEY = '--kb';

function syncKb(){
  var vv = window.visualViewport, kb = 0;
  /* innerHeight 是布局视口；vv.height + vv.offsetTop 是「屏幕上看得到的那一段」。
     差值就是被键盘（或别的 IME 面板）盖住的像素。offsetTop 非 0 的情况是浏览器把
     visual viewport 往下平移去露光标，那时底边同样对齐屏幕底边。 */
  if (vv) kb = window.innerHeight - vv.height - vv.offsetTop;
  if (!(kb > 0)) kb = 0;
  document.documentElement.style.setProperty(KEY, Math.round(kb) + 'px');
}

/* 挂一次，全程有效：键盘的出现/消失都是 visualViewport 的 resize，浏览器平移时是 scroll */
function watchKeyboard(){
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncKb);
    window.visualViewport.addEventListener('scroll', syncKb);
  }
  window.addEventListener('resize', syncKb);
  syncKb();
}

export { watchKeyboard }
