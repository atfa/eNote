import { Vue } from '../vue.js'
import { shell } from '../shell.js'
import { attachmentPreview } from '../filesflow.js'

export const AttachmentPreviewView = {
  name: 'AttachmentPreviewView',
  setup(){
    const preview = Vue.computed(() => attachmentPreview.value);
    const failed = Vue.ref(false);
    const audio = Vue.ref(null);
    Vue.watch(() => shell.sheet.on, shown => {
      if (!shown && audio.value) audio.value.pause();
    });
    Vue.onBeforeUnmount(() => {
      if (audio.value && !audio.value.paused) audio.value.pause();
    });
    return { preview, failed, audio };
  },
  template: `
<div class="attachment-preview" v-if="preview">
  <p class="amiss" v-if="failed" role="status">{{ preview.kind === 'image' ? '无法显示这张图片' : '无法播放这段音频' }}</p>
  <img v-else-if="preview.kind === 'image'" :src="preview.src" :alt="preview.name || '图片附件'" @error="failed = true">
  <audio v-else ref="audio" :src="preview.src" :aria-label="preview.name || '音频附件'" controls preload="metadata" @error="failed = true"></audio>
  <span v-if="preview.role" class="chip">{{ preview.role }}</span>
</div>`
};
