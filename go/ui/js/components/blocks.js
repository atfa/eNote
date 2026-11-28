/* 统计页 / 设置页的整块卡片（S3 步骤 16b）：步骤 10 把这些块整块交给 app.js 的
   `*HTML` 字符串函数、模板里一个 v-html 插进去，理由是「两条渲染路径共用同一份字符串，
   零漂移面」。步骤 11 删掉遗留渲染器之后只剩 Vue 一条路径，字符串函数就纯属负担：
   闸门⑮ 编译模板时那块结构是一个字符串（卡片少个 `.kv` 它看不见）、卡里的按钮写成
   字符串里的内联 onclick（绕过闸门① 的导出表核对，P12「点了没反应」那一类）。

   翻译规则同 leaf.js：类名冻结（D15），产出的 DOM 与迁移前逐字一致；元素之间的字面空格
   用 `{{ ' ' }}` 显式写；「三段拼接」的文本（`3 / 2`）写成 `{{ a }} / {{ b }}`，
   中间那个 ` / ` 不是纯空白，Vue 的 whitespace:'condense' 不会吃掉它。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，所以全量名单写在下面
   这行注释里；运行时每个组件仍各自注册自己模板里用到的那些。
   components: { Ico, KvRow, OcrReady, StatsHero, StatsNotesCard, StatsRunCard,
                 SettingsOcrCard, SettingsSttCard } */
import { Vue } from '../vue.js'
const { inject } = Vue
import { Ico, KvRow, OcrReady } from './leaf.js'

/* 我的页顶部整块：logo + 四格统计（.hero 这个壳也在组件里，消费方只写一个标签）。
   st 为 null（首屏统计还没回来）时是那句占位文案。 */
export const StatsHero = {
  name: 'StatsHero',
  components: { Ico },
  props: ['st'],
  setup(){ const H = inject('H'); return { H, } },
  template: `
<div class="hero"><div class="hrow"><div class="hlogo"><img src="/icon.png" alt=""></div><div><h1>懒得记</h1></div></div>
<div class="hstats"><template v-if="st"><span><ico n="note"/>{{ st.notes.total }} 条笔记</span><span><ico n="check-square"/>{{ st.todos.total }} 条待办</span><span><ico n="clip"/>{{ st.attach.count || 0 }} 个附件</span><span><ico n="db"/>{{ H.fmtSize(st.bytes) }}</span></template><span v-else>正在统计本地数据…</span></div></div>`
};

/* 笔记状态卡内容（卡壳由消费方写）：五行 kv，无 handler。 */
export const StatsNotesCard = {
  name: 'StatsNotesCard',
  components: { KvRow },
  props: ['st'],
  template: `
<h2>笔记状态</h2><kv-row k="AI 解析完成" :v="st.notes.done"/><kv-row k="仅存原文" :v="st.notes.raw"/><kv-row k="解析失败" :v="st.notes.error"/><kv-row k="队列中" :v="(st.notes.queued||0)+(st.notes.parsing||0)"/><kv-row k="附件缺失文件" :v="st.attach.missing||0"/>`
};

/* 我的页的运行状态与技术信息。 */
export const StatsRunCard = {
  name: 'StatsRunCard',
  components: { KvRow, OcrReady },
  props: ['i'],
  template: `
<div class="mine-status">
  <kv-row k="本机 OCR"><ocr-ready :ready="i.ocrReady"/></kv-row>
  <details>
    <summary>运行详情</summary>
    <kv-row k="Go 服务" :v="i.server"/>
    <kv-row k="Go / 运行时长">{{ (i.go || '') + ' / ' + (i.uptimeS || 0) + 's' }}</kv-row>
    <kv-row k="时区" :v="i.tz"/>
    <kv-row k="解析队列">{{ (i.queue || 0) + ' 条待处理' }}</kv-row>
  </details>
</div>`
};

/* 设置页「本地 OCR」卡：引擎状态 + 引擎信息 + 一段说明。 */
export const SettingsOcrCard = {
  name: 'SettingsOcrCard',
  components: { KvRow, OcrReady },
  props: ['i'],
  setup(){ const H = inject('H'); return { H, } },
  template: `
<kv-row k="引擎状态"><ocr-ready :ready="i.ocrReady"/></kv-row><kv-row k="引擎信息">{{ H.S.ocrInfo || 'vivo 离线 OCR' }}</kv-row><div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)">图片只在本机识别成文字，只有识别出的文字（和原文）会发给模型。单条笔记可在笔记卡片上「↻ 重新识别图片」。</div>`
};

/* 设置页「离线语音」卡（P18）：与 OCR 卡同构，只是讲的是录音那条链路。
   「记一笔」里点 🎤 就地录（多段识别 → 一次发送），系统分享的音频走同一条入队路径；
   两者都把 16k WAV 留在附件里，所以卡片上能给「↻ 重新识别语音」。 */
export const SettingsSttCard = {
  name: 'SettingsSttCard',
  components: { Ico, KvRow, OcrReady },
  props: ['i'],
  setup(){ const H = inject('H'); return { H, } },
  template: `
<kv-row k="引擎状态"><span class="m wide" :class="{ok: i.sttReady}"><ico :n="i.sttReady ? 'mic' : 'mic-slash'" cls="s"/>{{ i.sttReady ? '本机语音识别就绪' : '语音引擎启动中…' }}</span></kv-row><kv-row k="引擎信息">{{ i.sttInfo || H.S.sttInfo || 'vivo 离线语音识别' }}</kv-row><div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)">语音只在本机识别成文字，只有识别出的文字（和原文）会发给模型。录音在「记一笔」里点 🎤，多段说完再一次性发送；音频原件留在附件里，单条笔记可「↻ 重新识别语音」。</div>`
};
