// go/ui/js/listflow.js — 笔记列表的过滤/排序与待办分组从 app.js 搬出来（P14 S6 步骤 45）。
//
// 这一簇是纯读：S / q / SR / P 全部只读（清单 (c) 条：写导入绑定才需要盒子），
// 所以它不写 app.js 的任何东西，也没有顶层求值期依赖 —— 从 app.js 拿的 S / q / now
// 只在函数体里读（契约同 js/shotflow.js 文件头）。
// tomorrow() 只有 groupTodos() 用，是模块私有；其余五个名字 app.js 挂进 HOST，
// views/notes.js 与 views/todos.js 通过 H.xxx 读它们。
import { S, q } from './app.js'
import { now } from './timeflow.js'
import { P } from './prefsflow.js'
import { SR } from './searchflow.js'
import { todoEnterCls } from './noteflow.js'

/* .todo 的类名串：done / pri-high / 入场动画。Vue 模板用 :class 算出来的必须和这里一致。 */
function todoRowCls(n, t){
  return (t.done?' done':'')+(t.priority==='high'?' pri-high':'')+todoEnterCls(n,t);
}

function notesFiltered(){
  if(SR.notes) return SR.notes; // 服务端结果（已排序）
  var p = P(), a = S.notes.filter(function(n){
    if(p.src==='image' && !/image$/.test(n.source||'')) return false;
    if(p.src==='text' && /image$/.test(n.source||'')) return false;
    if(p.status!=='all' && n.status!==p.status) return false;
    return hit([n.title, n.content, (n.tags||[]).join(' '),
                (n.todos||[]).map(function(t){return t.text}).join(' ')].join(' '));
  });
  var s = p.sort||'new';
  a.sort(function(x,y){
    if(s==='title') return (x.title||'').localeCompare(y.title||'', 'zh');
    if(s==='old') return (x.createdAt||'').localeCompare(y.createdAt||'');
    return (y.createdAt||'').localeCompare(x.createdAt||'');
  });
  return a;
}
function groupTodos(){
  var g = {'已逾期':[],'今天':[],'明天':[],'本周':[],'以后':[],'无日期':[],'已完成':[]};
  var t = new Date(), p = n=>String(n).padStart(2,'0');
  var today = now().slice(0,10);
  var weekEnd = new Date(t.getTime()+6*864e5);
  var weekEndS = weekEnd.getFullYear()+'-'+p(weekEnd.getMonth()+1)+'-'+p(weekEnd.getDate());
  S.notes.forEach(function(n){(n.todos||[]).forEach(function(x){
    var o = {t:x, n:n};
    if(x.done) g['已完成'].push(o);
    else if(!x.due) g['无日期'].push(o);
    else if(x.due < now()) g['已逾期'].push(o);
    else if(x.due.slice(0,10)===today) g['今天'].push(o);
    else if(x.due.slice(0,10)===tomorrow()) g['明天'].push(o);
    else if(x.due.slice(0,10)<=weekEndS) g['本周'].push(o);
    else g['以后'].push(o);
  })});
  return g;
}
function tomorrow(){var d=new Date(Date.now()+864e5),p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())}
function rank(t){ return ({high:3,normal:2,low:1})[t.priority||'normal'] }
function hit(s){ if(!q) return true; return (s||'').toLowerCase().indexOf(q.toLowerCase())>=0 }
/* app.js 把下面五个名字挂进 HOST（HOST_KEYS 的 view:notes / view:todos 两张表里都有），
   组件模板里 H.notesFiltered() / H.groupTodos() / H.todoRowCls(n,t) / H.hit(...) / H.rank(t)
   调的就是它们。 */
export { todoRowCls, notesFiltered, groupTodos, tomorrow, rank, hit }
