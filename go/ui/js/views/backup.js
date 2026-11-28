import { Vue } from '../vue.js'
import { shell } from '../shell.js'
import { refreshAfterRestore } from '../settingsflow.js'

const requests = new Map();
const session = Math.random().toString(36).slice(2);
let requestNumber = 0;

window.enoteBackupResult = (id, raw) => {
  const resolve = requests.get(id);
  if (!resolve) return;
  try { resolve(JSON.parse(raw)); }
  catch (_) { resolve({ ok: false, error: '无法读取备份处理结果' }); }
};

function request(action, name = '') {
  const id = `${session}-${++requestNumber}`;
  return new Promise(resolve => {
    const deadline = setTimeout(() => finish({ ok: false, error: '备份操作超时，请稍后重试' }), 130000);
    function finish(result) {
      clearTimeout(deadline);
      requests.delete(id);
      resolve(result);
    }
    requests.set(id, finish);
    try { window.Android.backupRequest(id, action, name); }
    catch (_) { finish({ ok: false, error: '无法访问 Download' }); }
  });
}

function fileInfo(file) {
  let size = `${file.size} B`;
  if (file.size >= 1024 * 1024) size = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  else if (file.size >= 1024) size = `${(file.size / 1024).toFixed(1)} KB`;
  return file.modified ? `${new Date(file.modified).toLocaleString()} · ${size}` : size;
}

export const BackupSheetView = {
  setup() {
    const exporting = shell.sheet.kind === 'backup-export';
    const native = typeof window.Android?.backupRequest === 'function';
    const state = Vue.reactive({
      busy: '', error: '', saved: '', files: [], access: '', legacy: false, result: null
    });
    const busy = Vue.computed(() => state.busy !== '');

    async function scan() {
      if (!native || state.busy) return;
      state.busy = 'list';
      state.error = '';
      const response = await request('list');
      if (response.ok) {
        state.files = response.files;
        state.access = response.access;
        state.legacy = response.legacy;
      } else state.error = response.error;
      state.busy = '';
    }
    async function save() {
      if (!native || state.busy) return;
      state.busy = 'export';
      state.error = '';
      state.saved = '';
      const response = await request('export');
      if (response.ok) state.saved = response.name;
      else {
        state.error = response.error;
        if (response.needsAccess) state.access = 'ask';
      }
      state.busy = '';
    }
    async function restore(file) {
      if (!native || state.busy) return;
      state.busy = file.name;
      state.error = '';
      state.result = null;
      const response = await request('import', file.name);
      if (response.ok) {
        state.result = response;
        if (response.imported) refreshAfterRestore();
      } else state.error = response.error;
      state.busy = '';
    }
    function askAccess() { window.Android.backupAccess(); }
    Vue.onMounted(() => {
      if (!exporting && native) scan();
      window.addEventListener('enoteBackupAccessChanged', scan);
    });
    Vue.onUnmounted(() => window.removeEventListener('enoteBackupAccessChanged', scan));
    return { exporting, native, state, busy, actions: { scan, save, restore, askAccess }, fileInfo };
  },
  template: `
<section class="backup-page">
  <template v-if="exporting">
    <div class="pgroup">保存位置 · Download</div>
    <p>备份包含笔记、待办和附件信息。附件原文件需要另行保存。</p>
    <div class="acts">
      <button v-if="native" class="btn pri" type="button" :disabled="busy" @click="actions.save">
        {{ state.busy === 'export' ? '正在导出…' : '保存 JSON 备份' }}
      </button>
      <a v-else class="btn pri" href="/api/export" download>下载 JSON 备份</a>
      <button v-if="state.access === 'ask'" class="btn gh" type="button" :disabled="busy"
        @click="actions.askAccess">授权访问 Download</button>
    </div>
    <p v-if="state.saved" class="backup-status" role="status">已保存到 Download<br><strong>{{ state.saved }}</strong></p>
  </template>
  <template v-else>
    <div class="pgroup">Download 中的备份</div>
    <p>选择一个备份即可导入。已有的笔记按 ID 跳过。</p>
    <div v-if="native" class="acts">
      <button class="btn gh" type="button" :disabled="busy" @click="actions.scan">
        {{ state.busy === 'list' ? '正在扫描…' : '重新扫描' }}
      </button>
      <button v-if="state.access === 'ask'" class="btn gh" type="button" :disabled="busy"
        @click="actions.askAccess">{{ state.legacy ? '授权访问 Download' : '查找其他来源的备份' }}</button>
    </div>
    <p v-if="state.access === 'ask'">{{ state.legacy ? '授权后可读取 Download 中的备份。' :
      '当前显示本应用保存的备份。查找手动复制或旧安装留下的备份，需要在系统设置中授权访问文件。' }}</p>
    <p v-if="state.access === 'own'">当前系统允许扫描本应用保存的备份。</p>
    <div v-if="!native" class="empty">请在 Android 应用中导入备份</div>
    <div v-else-if="!busy && !state.error && !state.files.length" class="empty">
      没有找到符合命名规则的备份
      <div class="esub">复制备份到 Download 时，请保留导出时的文件名。</div>
    </div>
    <ul v-if="state.files.length" class="backup-files">
      <li v-for="file in state.files" :key="file.name">
        <button class="btn gh backup-file" type="button" :disabled="busy" @click="actions.restore(file)">
          <strong>{{ file.name }}</strong>
          <small>{{ state.busy === file.name ? '正在导入…' : fileInfo(file) }}</small>
        </button>
      </li>
    </ul>
    <p v-if="state.result" class="backup-status" role="status">
      导入完成，新增 {{ state.result.imported }} 条，跳过 {{ state.result.skipped }} 条已存在的笔记。
      <template v-if="state.result.invalid">另有 {{ state.result.invalid }} 条无效记录。</template>
    </p>
  </template>
  <p v-if="state.error" class="backup-error" role="alert">{{ state.error }}</p>
</section>`
};
