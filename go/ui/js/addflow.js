// go/ui/js/addflow.js — 「记一笔」与「添加待办」那一簇从 app.js 搬出来（P14 S6 步骤 40）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块顶层不读 app.js 的任何东西，
// 从 app.js 拿的（toast / api / refresh / syncBox / SHEETARGB）全部只在函数体里读。
// 原来那行 `var SHEETARG = SHEETARGB.v` 删掉了两个问题：它在求值期读 app.js 的盒子
// （模块求值顺序是 import 先跑，那时 SHEETARGB 还是 undefined → 整份 app.js 抛
// TypeError、页面全白），而且 SHEETARG 只写不读，是个死变量。写 nid 直接 syncBox。
import { Vue } from './vue.js'
import { sheetVue, closeSheet, sheetVersion } from './sheetflow.js'
import { shell } from './shell.js'
import { refresh, syncBox, SHEETARGB } from './app.js'
import { api, apiTimeout, toast } from './netflow.js'
import { STT, voiceStop, voiceClear } from './voiceflow.js'
/* 记一笔的手输文字与语音草稿一起保留到提交成功。添加待办每次打开使用默认值。 */
var FORMS = Vue.reactive({ v: { add: null, todo: null } });
const DRAFTMEDIA = Vue.reactive({ files: [], picking: false });
let mediaRequest = '';
let pendingDraft = null;

function draftID(){
  const random = crypto.getRandomValues(new Uint8Array(16));
  return 'draft-' + Array.from(random, n => n.toString(16).padStart(2, '0')).join('');
}

function formSet(name, k, v){ var f = FORMS.v[name]; if(f) f[k] = v }
function addSheet(){
  if (!FORMS.v.add) FORMS.v.add = { text: '' };
  /* kind='add' 是 CSS 钩子：面板改成 flex 列，内容滚动、提交按钮固定在底栏
     （见 css/views/voice.css 的 .panel[data-kind="add"]）。 */
  return sheetVue('add', false, 'add');
}
function draftHasContent(){
  return Boolean((FORMS.v.add?.text || '').trim() || STT.v.segs.length || DRAFTMEDIA.files.length);
}

/* 整理结果占用首段语音的文字位。图片、附件、语音原件和手输文字一次入队。 */
async function addNote(){
  if (STT.v.busy || STT.v.organizing || DRAFTMEDIA.picking) return;
  if (STT.v.organizedStale) { toast('语音已变化，请重新整理或使用原文'); return }
  if (STT.v.organized !== null && !STT.v.organized.trim()) {
    toast('整理后的文字为空，请编辑或使用原文'); return;
  }
  const openedSheet = sheetVersion();
  STT.v.busy = true;
  try {
    if (STT.v.listening || STT.v.settling) await voiceStop();
    if (STT.v.organizedStale) { toast('语音已变化，请重新整理或使用原文'); return }
    if (!draftHasContent()) { toast('按住说话'); return }
    const organized = STT.v.organized;
    const body = {
      text: (FORMS.v.add?.text || '').trim(),
      audios: STT.v.segs.map((s, i) => ({
        text: organized === null ? s.text : (i === 0 ? organized : ''),
        path: s.path || '', name: s.name || ''
      })),
      files: DRAFTMEDIA.files.slice()
    };
    const signature = JSON.stringify(body);
    if (pendingDraft?.signature !== signature) pendingDraft = { signature, id: draftID() };
    const result = await apiTimeout('/api/draft', { id: pendingDraft.id, ...body });
    if (!result?.ok) { toast(result?.error || '发送失败，请重试'); return }
    pendingDraft = null;
    voiceClear();
    FORMS.v.add.text = '';
    DRAFTMEDIA.files = [];
    if (shell.sheet.on && sheetVersion() === openedSheet) closeSheet();
    toast('已记录');
    refresh();
  } catch (e) {
    toast('未收到发送结果，可以重试');
  } finally {
    STT.v.busy = false;
  }
}

function pickDraftImage(){ pickDraftMedia(true) }
function pickDraftFile(){ pickDraftMedia(false) }
function pickDraftMedia(imageOnly){
  if (DRAFTMEDIA.picking || STT.v.busy || STT.v.listening) return;
  if (!window.Android?.pickDraftMedia) { toast('请在 Android 应用里选择附件'); return }
  mediaRequest = draftID();
  DRAFTMEDIA.picking = true;
  try {
    window.Android.pickDraftMedia(mediaRequest, imageOnly);
  } catch (e) {
    mediaRequest = '';
    DRAFTMEDIA.picking = false;
    toast('无法打开文件选择器');
  }
}

function discardDraftFile(path){
  if (path) api('/api/draft/discard', { path }).catch(() => {});
}

function removeDraftFile(path){
  if (STT.v.busy) return;
  const i = DRAFTMEDIA.files.findIndex(file => file.path === path);
  if (i === -1) return;
  DRAFTMEDIA.files.splice(i, 1);
  discardDraftFile(path);
}

window.onDraftMedia = (request, result) => {
  if (request !== mediaRequest) {
    if (!DRAFTMEDIA.files.some(file => file.path === result?.file?.path))
      discardDraftFile(result?.file?.path);
    return;
  }
  mediaRequest = '';
  DRAFTMEDIA.picking = false;
  if (result?.file) DRAFTMEDIA.files.push(result.file);
  else if (!result?.cancelled) toast(result?.error || '无法读取所选文件');
};
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
export { FORMS, DRAFTMEDIA, formSet, addSheet, addNote, draftHasContent, pickDraftImage,
  pickDraftFile, removeDraftFile, addTodoSheet, addTodo }
