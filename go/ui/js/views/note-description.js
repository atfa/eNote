import { Vue } from '../vue.js'
import { api, toast } from '../netflow.js'
import { refresh } from '../pollflow.js'
import { shell } from '../shell.js'
import { closeSheet, sheetVersion, sheetVue } from '../sheetflow.js'

const descriptionNote = Vue.shallowRef(null);

export function editNoteDescription(note){
  descriptionNote.value = { id: note.id, description: note.description || '' };
  return sheetVue('noteDescription');
}

export const NoteDescriptionView = {
  name: 'NoteDescriptionView',
  setup(){
    const note = descriptionNote.value;
    const description = Vue.ref(note.description);
    const saving = Vue.ref(false);
    const error = Vue.ref('');
    const title = Vue.computed(() => descriptionNote.value.description ? '编辑说明' : '添加说明');
    async function save(){
      if(saving.value) return;
      const version = sheetVersion();
      saving.value = true;
      error.value = '';
      try {
        const result = await api('/api/note/description', { id: note.id, description: description.value });
        if(!result || !result.ok){
          error.value = result?.error || '保存失败，请重试';
          return;
        }
        if(shell.sheet.on && sheetVersion() === version) closeSheet();
        toast('说明已保存');
        refresh();
      } catch (_) {
        error.value = '保存失败，请重试';
      } finally {
        saving.value = false;
      }
    }
    return { description, error, save, saving, title };
  },
  template: `
<form @submit.prevent="save">
  <h2>{{ title }}</h2>
  <textarea v-model="description" aria-label="说明" placeholder="写下与这个文件有关的内容" :disabled="saving"></textarea>
  <div v-if="error" class="errbox" role="status">{{ error }}</div>
  <div class="acts"><button type="submit" class="btn pri" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div>
</form>`
};
