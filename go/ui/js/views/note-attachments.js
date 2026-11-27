import { Vue } from '../vue.js'
import { S } from '../statebox.js'
import { Ico } from '../components/leaf.js'
import { attachmentKind, attachmentRoleLabel, delAttach, fmtSize, noteAttachmentsId,
         openAttach } from '../filesflow.js'

export const NoteAttachmentsView = {
  name: 'NoteAttachmentsView',
  components: { Ico },
  setup(){
    const { inject } = Vue;
    const H = inject('H');
    const note = Vue.computed(() => (S.notes || []).find(n => n.id === noteAttachmentsId.value));
    const kinds = { image: '图片', audio: '音频', pdf: 'PDF', doc: '文档', sheet: '表格',
      slides: '演示文稿', text: '文本', video: '视频', archive: '压缩包' };
    const typeLabel = a => kinds[attachmentKind(a)] || a.mime || '文件';
    return { H, note, typeLabel, attachmentRoleLabel, delAttach, fmtSize, openAttach };
  },
  template: `
<div v-if="note">
  <div v-for="a in note.attachments || []" :key="a.id" class="card note-attachment-row">
    <div class="aname">{{ a.name || '附件' }}</div>
    <div class="meta">
      <span>{{ typeLabel(a) }}</span><span>{{ fmtSize(a.size) }}</span>
      <span v-if="a.role === 'original'" class="chip">{{ attachmentRoleLabel(a) }}</span>
    </div>
    <div class="acts">
      <button type="button" class="btn sm" @click="openAttach(a, note.id)"><ico n="eye"/>打开</button>
      <button type="button" class="btn sm dg" @click="delAttach(a.id, a.name)"><ico n="trash"/>移除</button>
    </div>
  </div>
  <div v-if="!note.attachments || !note.attachments.length" class="empty">这条笔记没有附件</div>
  <div class="acts"><button type="button" class="btn pri" @click="H.pickNoteAttachments(note.id)"><ico n="plus"/>添加附件</button></div>
</div>
<div v-else class="empty">这条笔记已不存在</div>`
};
