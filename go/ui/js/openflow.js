// go/ui/js/openflow.js — 打开一条笔记 / 一条待办 + 交给系统日历 / 闹钟那一簇从 app.js 搬出来
// （P14 S6 步骤 37）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块顶层不碰 app.js 的任何东西，app.js 那边
// （S / open / toast / setTab / setTabTo / refresh）全部只在函数体里读。
// `tab` 是 app.js 的 var，ESM 的 import 绑定只读，切页签走 app.js 的 setTabTo()（同 setQ）；
// `open` 是 OPENB.v 那个 reactive 代理，写属性（open[id]=true）不算写绑定，安全。
// dueMs 由 app.js 再导出（remindflow.js 从 app.js 拿它），搬过来只是换了定义处。
import { S, open, toast, setTab, setTabTo, refresh } from './app.js'

function openNote(id){
  if(!id) return;
  setTabTo('notes'); open[id]=true; setTab(true); refresh();
  setTimeout(function(){var el=document.getElementById('n'+id);
    if(el) el.scrollIntoView({behavior:'smooth',block:'center'});
    else toast('这条笔记已删除');}, 300);
}
/* 通知点进来：展开这条笔记并定位到那一条待办（滚过去 + 亮一下）*/
function openTodo(nid, tid){
  if(!nid) return;
  var n = (S.notes||[]).filter(function(x){return x.id===nid})[0];
  if(n) open[nid] = true;
  setTabTo('notes'); setTab(true); refresh();
  openTodoFocus(nid, tid, 0);
}
function openTodoFocus(nid, tid, tries){
  setTimeout(function(){
    var el = document.getElementById('t'+nid+'_'+tid);
    if(!el){
      if(tries < 6) return openTodoFocus(nid, tid, tries+1);
      toast('这条待办已完成或已删除'); return;
    }
    el.scrollIntoView({behavior:'smooth', block:'center'});
    el.classList.add('flash');
    setTimeout(function(){ el.classList.remove('flash') }, 2600);
  }, 320);
}

function dueMs(iso){ if(!iso) return 0; var d=new Date(iso); return isNaN(d)?0:d.getTime() }
/* R13：把到期时间交给系统日历 / 闹钟（intent，不需要权限）*/
function toCalendar(nid,tid,ev){
  ev.stopPropagation();
  var n=S.notes.filter(function(x){return x.id===nid})[0]; if(!n) return;
  var t=(n.todos||[]).filter(function(x){return x.id===tid})[0]; if(!t||!t.due) return;
  if(!window.Android||!Android.addToCalendar){ toast('日历只在 app 内可用'); return }
  Android.addToCalendar(t.text, dueMs(t.due));
}
function toAlarm(nid,tid,ev){
  ev.stopPropagation();
  var n=S.notes.filter(function(x){return x.id===nid})[0]; if(!n) return;
  var t=(n.todos||[]).filter(function(x){return x.id===tid})[0]; if(!t||!t.due) return;
  if(!window.Android||!Android.setAlarm){ toast('闹钟只在 app 内可用'); return }
  Android.setAlarm(dueMs(t.due), t.text);
}

function jump(id){ setTabTo('notes'); open[id]=true; setTab(true); refresh();
  setTimeout(function(){var el=document.getElementById('n'+id);if(el)el.scrollIntoView({behavior:'smooth',block:'center'})},250); }
/* app.js 把 openNote / openTodo / jump / toCalendar / toAlarm 挂进 HOST 与导出表，
   把 window.openNote / window.openTodo 留给 Java 侧的通知入口（桥在 app.js）。 */
export { openNote, openTodo, openTodoFocus, jump, dueMs, toCalendar, toAlarm }
