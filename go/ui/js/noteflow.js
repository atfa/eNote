// go/ui/js/noteflow.js — 笔记/待办的操作那一簇从 app.js 搬出来（P14 S6 步骤 44）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块顶层不读 app.js 的任何东西，
// 从 app.js 拿的（S / open / expAnim / busy / api / toast / refresh / render / askDel）
// 全部只在函数体里读。写 app.js 的 var 只有一处：动画锁 animLock 装成盒子 ANIMLOCK
// （ES module 的 import 是只读绑定，直接赋值会在链接期就 SyntaxError，同 SRK 那条教训）。
// seen / justDone 这两张表只有本簇读写（enterCls / clearSeen / toggle / todoEnterCls /
// clearEnter），所以它们跟着搬成模块私有，app.js 那边连 var 都不留。
import { S, open, expAnim, busy, refresh, render, askDel } from './app.js'
import { api, toast } from './netflow.js'
import { saveSettings } from './settingsflow.js'

var seen = {};   // 已经出现过的卡片 id：只有新出现的才带入场动画（P7c）
/* 勾选待办后刚做完的那几条（keyOf(n,t) → 1）：todoEnterCls 靠它给新位置高亮入场。 */
var justDone = {};
/* 勾选待办后的动画窗口：app.js 的 refresh() 在窗口内只刷状态点、不重绘 DOM，
   否则划线动画会被打断。它是本模块与 app.js 之间唯一的共享可变状态，所以是盒子。 */
var ANIMLOCK = { v: 0 };

function expand(id){ open[id]=!open[id]; expAnim[id]=1; render(); setTimeout(function(){ delete expAnim[id] }, 400) }
async function toggle(nid,tid,el){
  // 先就地动画（划线 + 勾选 + 淡出），再提交，再让新位置高亮入场；轮询在动画期间不重绘
  var row = el && el.closest ? el.closest('.todo') : null;
  var done = row ? row.classList.contains('done') : false;
  justDone[nid+'|'+tid] = 1;
  if(row){
    if(!done){
      row.classList.add('justdone');
      var cb = row.querySelector('.cb');
      if(cb){ cb.classList.add('on'); }
      ANIMLOCK.v = Date.now() + 900;
      setTimeout(function(){ row.classList.add('leaving') }, 430);
    }else{
      row.classList.add('undone');
      ANIMLOCK.v = Date.now() + 520;
    }
  }
  api('/api/todo', {action:'toggle', noteId:nid, todoId:tid}).then(function(){
    setTimeout(function(){ ANIMLOCK.v = 0; refresh(true) }, done ? 300 : 780);
  }, function(){ ANIMLOCK.v = 0; refresh(true) });
}
function keyOf(n,t){ return n.id+'|'+t.id }
function todoEnterCls(n,t){ return justDone[keyOf(n,t)] ? ' enter' : '' }
function clearEnter(){ setTimeout(function(){ justDone = {} }, 120) }
/* 入场动画只给“新出现”的元素：tab 切换时清空 seen，轮询重绘就不会反复跳 */
function enterCls(id){
  if(!id) return '';
  if(seen[id]) return '';
  seen[id] = 1;
  return ' enter';
}
function clearSeen(){ seen = {} }
async function delTodo(nid,tid){ await api('/api/todo',{action:'delete',noteId:nid,todoId:tid}); refresh(); }
async function reparse(id){ if(busy[id])return; busy[id]=1; toast('AI 重新解析中…');
  await api('/api/reparse',{id:id}); setTimeout(refresh,600); setTimeout(refresh,4000); }
function delNote(id){
  askDel('这条笔记？删除后不可恢复。', function(){
    api('/api/delete', {id:id}).then(function(){ toast('已删除'); refresh(); });
  });
}
function reocr(id){ if(!window.Android){toast('图片识别只在 app 内可用');return;}
  toast('正在识别图片…'); Android.reocr(id); setTimeout(refresh,1500); setTimeout(refresh,5000); }
function toggleAI(){ var s=S.settings; s.useAI=!s.useAI; saveSettings(); }
/* 设置页保存（saveSettings）搬进 js/settingsflow.js（P14 S6 步骤 42）：它读的就是那边的
   SFORM，formFill 也在那边；toggleAI 翻完 useAI 直接调它。 */
/* app.js 把 expand / toggle / reparse / reocr / delNote / delTodo / toggleAI 挂进 HOST
   （components.js 的笔记卡与待办行）与 __enoteActions；enterCls / clearSeen 是别的模块从
   app.js 转取的（filesflow / statsflow / tabflow），todoEnterCls 给 app.js 的 todoRowCls，
   clearEnter 给 app.js 的 render()，ANIMLOCK 给 app.js 的 refresh()。 */
export { expand, toggle, keyOf, todoEnterCls, clearEnter, enterCls, clearSeen,
  delTodo, reparse, delNote, reocr, toggleAI, ANIMLOCK }
