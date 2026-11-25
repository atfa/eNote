// go/ui/js/addflow.js — 「记一笔」与「添加待办」那一簇从 app.js 搬出来（P14 S6 步骤 40）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块顶层不读 app.js 的任何东西，
// 从 app.js 拿的（toast / api / refresh / syncBox / SHEETARGB）全部只在函数体里读。
// 原来那行 `var SHEETARG = SHEETARGB.v` 删掉了两个问题：它在求值期读 app.js 的盒子
// （模块求值顺序是 import 先跑，那时 SHEETARGB 还是 undefined → 整份 app.js 抛
// TypeError、页面全白），而且 SHEETARG 只写不读，是个死变量。写 nid 直接 syncBox。
import { Vue } from './vue.js'
import { sheetVue, closeSheet } from './sheetflow.js'
import { refresh, syncBox, SHEETARGB } from './app.js'
import { api, toast } from './netflow.js'
/* 步骤 21：「记一笔」与「添加待办」的表单值也搬进状态（步骤 20 的同一套做法）。
   这两个弹层是每次新建，所以初值就是空串 / 默认值，不需要从服务端灌。
   与设置页的差别：这里用 :value（DOM property）而不是 :value.attr —— 这些元素今天
   DOM 上没有 value 属性，写属性保持序列化逐字不变（设置页那六个必须写属性，见步骤 20）。 */
var FORMS = Vue.reactive({ v: { add: null, todo: null } });
function formSet(name, k, v){ var f = FORMS.v[name]; if(f) f[k] = v }
function addSheet(){
  FORMS.v.add = { text: '' };
  return sheetVue('add');
}
async function addNote(){
  var t = String((FORMS.v.add || {}).text || '').trim(); if(!t){toast('写点内容吧');return;}
  closeSheet(); toast('已加入队列…');
  var r = await api('/api/add',{text:t});
  if(!r.ok) toast(r.error||'失败');
  setTimeout(refresh,500); setTimeout(refresh,3000); setTimeout(refresh,9000);
}
function pickImage(){
  if(!window.Android){toast('选图只在 app 内可用');return;}
  Android.pickImage(); closeSheet(); toast('已提交，正在识别图片…');
  setTimeout(refresh,1500); setTimeout(refresh,5000); setTimeout(refresh,12000);
}
/* 给哪条笔记加待办：弹层组件不接 props（mountSheet 只挂不传），所以存进模块变量，
   组件挂载时读一次（见 views/sheets.js 的 AddTodoSheetView）。 */
function addTodoSheet(nid){
  syncBox(SHEETARGB, nid);
  FORMS.v.todo = { text:'', date:'', time:'', pri:'normal' };
  return sheetVue('addtodo');
}
async function addTodo(nid){
  var f = FORMS.v.todo || {};
  var t = String(f.text || '').trim(); if(!t){toast('写点内容吧');return;}
  var due = f.date ? f.date+'T'+(f.time||'09:00') : '';
  var r = await api('/api/todo',{action:'add',noteId:nid,text:t,due:due,priority:f.pri||'normal'});
  closeSheet(); toast(r.ok?'已添加':'失败'); refresh();
}
/* app.js 把 addSheet 挂在 fab（FABS 的 fn）、把 addTodoSheet / formSet / FORMS / sheetArg
   挂进 HOST（sheet:add / sheet:addtodo / view:notes 的「待办」按钮）；SHEETARGB 这个盒子
   留在 app.js 的盒子区（声明顺序是硬要求），那边 HOST 的 getter 读 SHEETARGB.v。 */
export { FORMS, formSet, addSheet, addNote, pickImage, addTodoSheet, addTodo }
