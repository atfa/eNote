// go/ui/js/noselect.js — 关掉 WebView 的「网页式」长按行为（P18.2）。
//
// 背景（用户实测的 bug）：长按卡片/按钮能选中一段文字，还弹出「复制 / 全选」浮条；
// 长按图片还会弹「打开图片 / 保存图片」。这些是浏览器的行为，不是这个 app 的行为——
// 用户看到的是自己的笔记，不是一张网页。
//
// css/base.css 第 2 节已经全局 user-select:none，只放行 input/textarea/[contenteditable]。
// 这里补三件 CSS 管不到的事：
//   ① contextmenu：Android WebView 长按 <img>/<a> 的菜单走这个事件；输入控件放行
//      （长按输入框弹的「粘贴」是系统行为，要留着）。
//   ② selectstart：user-select 不是继承属性，vant 组件在 shadow 边界上偶有漏网，
//      再挡一层，保证拖不出选择手柄。
//   ③ dragstart：<img> 默认可拖，拖一下会浮出半透明缩略图。
var KEEP = { INPUT: 1, TEXTAREA: 1 };

function editable(t){
  return !!t && (KEEP[t.tagName] === 1 || t.isContentEditable === true);
}

/* 挂一次，全程有效（监听在 document 捕获阶段，先于任何组件自己的处理） */
function lockSelection(){
  document.addEventListener('contextmenu', function(e){
    if (!editable(e.target)) e.preventDefault();
  }, true);
  document.addEventListener('selectstart', function(e){
    if (!editable(e.target)) e.preventDefault();
  }, true);
  document.addEventListener('dragstart', function(e){ e.preventDefault(); }, true);
}

export { lockSelection }