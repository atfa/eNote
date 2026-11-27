// go/ui/js/filesflow.js — 附件页（R4）从 app.js 搬出来（P14 S6 步骤 31）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块先被求值，顶层只碰 vue.js 的 Vue 与
// 自己新建的 reactive 盒子；app.js 那边（api / apiTimeout / P / q / SRK / reassign /
// paintStatus / errText / render / enterCls / toast / askDel / refresh）全部只在函数体里读。
// `q` 与 `tab` 一样是会被重新赋值的 var，靠 ES module 的活绑定传过来。
import { Vue } from './vue.js'
import { S, P, q, SRK, reassign, paintStatus, render, enterCls, askDel, refresh } from './app.js'
import { api, apiTimeout, errText, toast } from './netflow.js'
import { pageSheetVue } from './sheetflow.js'

const attachmentPreview = Vue.shallowRef(null)
const noteAttachmentsId = Vue.ref(null)

/* ---------- 附件页（R4）----------
   数据来自 /api/attachments（服务端过滤/排序，含磁盘文件数校验）。 */
var FA = Vue.reactive({items:[], total:0, bytes:0, files:0, missing:0, scanned:0, diskFiles:0, loaded:false, error:''});
/* 步骤 13：附件页的抢占判定以前用**服务端搜索共用的** searchSeq，笔记页搜索一在飞，
   附件页这次请求的结果就被整次丢掉（`if(my !== searchSeq) return`），FA.loaded 永远停在
   false → 用户侧症状是附件页停在骨架屏，只能切走再切回来。真机套件也撞过（步骤 11 的
   「跑一次红一次绿」，当时只在测试侧轮询盖住）。现在：
   ① 用附件页自己的 filesSeq，只有更新的 filesNow 能抢占它；
   ② 请求有超时（apiTimeout），卡死的 fetch 不会把这一页永久钉在骨架屏；
   ③ 失败记 FA.error 并自动退避重试（最多 2 次），骨架屏上同时给「重试」按钮。 */
var filesSeq = 0, filesRetry = 0;
var KIND = {image:'image',pdf:'file-pdf',doc:'file',sheet:'file-sheet',slides:'file-slides',text:'file-text',audio:'music',video:'film',archive:'archive',file:'clipfile'};
function fmtSize(b){
  b = b||0;
  if(b >= 1073741824) return (b/1073741824).toFixed(2)+' GB';
  if(b >= 1048576) return (b/1048576).toFixed(1)+' MB';
  if(b >= 1024) return Math.round(b/1024)+' KB';
  return b+' B';
}
async function filesNow(){
  var my = ++filesSeq, p = P();
  var s = 'q='+encodeURIComponent(q)+'&sort='+encodeURIComponent(p.sort||'new');
  if(p.dir) s += '&dir='+encodeURIComponent(p.dir);
  if(p.kind && p.kind!=='all') s += '&mime='+encodeURIComponent(p.kind);
  try{
    var d = await apiTimeout('/api/attachments?'+s);
    if(my !== filesSeq) return;
    var k = JSON.stringify(d);
    reassign(FA, {items:d.items||[], total:d.total||0, bytes:d.bytes||0, files:d.files||0,
          missing:d.missing||0, scanned:d.scanned||0, diskFiles:d.diskFiles||0,
          loaded:true, error:''});
    filesRetry = 0;
    if(k === SRK.v){ paintStatus(); return }
    SRK.v = k;
  }catch(e){
    if(my !== filesSeq) return;
    reassign(FA, {items:FA.items, total:FA.total, bytes:FA.bytes, files:FA.files,
          missing:FA.missing, scanned:FA.scanned, diskFiles:FA.diskFiles,
          loaded:false, error:errText(e)});
    SRK.v = '';
    if(filesRetry < 2){ filesRetry++; setTimeout(filesNow, 1500*filesRetry) }
  }
  render();
}
/* 步骤 7 拆出的叶子：Vue 的 FilesView 直接画 <div class="strip" v-html=...>，
   两条路径共用一份 inner HTML，VDIFF 才能逐字比（步骤 5/6 定下的模式：结构在模板里，
   叶子片段同源）。 */
function attachCardCls(a){
  return 'acard' + (a.missing ? ' gone' : '') + enterCls('a' + a.id);
}
function attachGlyphName(a){
  return KIND[a.kind] || 'clipfile';
}
function attachmentKind(attachment){
  if (attachment.kind) return attachment.kind;
  const mime = attachment.mime || '';
  const group = mime.split('/')[0];
  if (['image', 'audio', 'video', 'text'].includes(group)) return group;
  if (mime.includes('pdf')) return 'pdf';
  if (/sheet|excel/.test(mime)) return 'sheet';
  if (/presentation|powerpoint/.test(mime)) return 'slides';
  if (/word|document/.test(mime)) return 'doc';
  if (/zip|compressed|tar|7z/.test(mime)) return 'archive';
  return 'file';
}
function attachmentRoleLabel(attachment){
  if (attachment.role !== 'original') return '';
  const kind = attachmentKind(attachment);
  return kind === 'image' ? '原始图片' : kind === 'audio' ? '原始录音' : '原始文件';
}
function openNoteAttachments(noteId){
  noteAttachmentsId.value = noteId;
  return pageSheetVue('noteAttachments', '笔记附件');
}
function pickNoteAttachments(noteId){
  if (!window.Android || !Android.pickNoteAttachments) {
    toast('请在 Android App 中添加附件');
    return;
  }
  Android.pickNoteAttachments(noteId);
}
function noteAttachmentsSaved(ok, message){
  toast(message || (ok ? '附件已添加' : '添加附件失败'));
  if (ok) refresh();
}
function openAttach(attachment, backToNoteId){
  if (attachment.missing) {
    toast('附件文件已不在');
    return;
  }
  const kind = attachmentKind(attachment);
  if (kind === 'image' || kind === 'audio') {
    attachmentPreview.value = {
      kind,
      name: attachment.name,
      role: attachmentRoleLabel(attachment),
      src: '/file?id=' + encodeURIComponent(attachment.id)
    };
    const onBack = backToNoteId ? () => openNoteAttachments(backToNoteId) : null;
    return pageSheetVue('attachmentPreview', attachment.name || (kind === 'image' ? '图片' : '音频'), 'attachment-preview', onBack);
  }
  if (!window.Android || !Android.openAttachment) {
    toast('请在 Android App 中打开附件');
    return;
  }
  Android.openAttachment(attachment.id);
}
function delAttach(id, name){
  var a = FA.items.find(x => x.id === id);
  askDel('附件「' + (name || (a && a.name) || '') + '」？文件会从存储中删除。', function(){
    api('/api/attach/delete', {id:id}).then(function(r){
      toast(r.ok ? '已删除' : ('删除失败: ' + (r.error||'')));
      if (r.ok) refresh();
    }, function(e){ toast('删除失败: '+e) });
  });
}
function pickFile(){
  if(!window.Android){ toast('文件选择只在 app 内可用'); return; }
  Android.pickFile();
  setTimeout(function(){ filesNow() }, 2500);
  setTimeout(function(){ filesNow() }, 8000);
}

/* 步骤 31：app.js 把下面这些名字挂进 HOST / HOST_KEYS，views/files.js 通过 H.xxx 读它们。
   filesSeq / filesRetry 只在簇内用，导出来是为了闸门⑩ 的「定义了没人用」能看见引用侧。 */
export { FA, filesSeq, filesRetry, KIND, fmtSize, filesNow, attachCardCls, attachGlyphName,
  openAttach, delAttach, pickFile, attachmentKind, attachmentRoleLabel, attachmentPreview, noteAttachmentsId,
  openNoteAttachments, pickNoteAttachments, noteAttachmentsSaved }
