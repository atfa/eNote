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
                 SettingsDataCard, SettingsRunCard, SettingsOcrCard } */
import { H, Vue, live } from '../vue.js'
const { computed } = Vue
import { Ico, KvRow, OcrReady } from './leaf.js'

/* 我的页顶部整块：logo + 四格统计（.hero 这个壳也在组件里，消费方只写一个标签）。
   st 为 null（首屏统计还没回来）时是那句占位文案。 */
export const StatsHero = {
  name: 'StatsHero',
  components: { Ico },
  props: ['i', 'st'],
  setup(){ return { H, } },
  template: `
<div class="hero"><div class="hrow"><div class="hlogo"><img src="/icon.png" alt=""></div><div><h1>懒得记</h1><div class="hver">{{ i.go || '' }} · 本机离线 OCR · BYOK</div></div></div>
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

/* 我的页最底部的运行信息卡内容。设置页「运行状态」卡前三行相同、第四行是解析队列，
   所以那三行由 SettingsRunCard 各自写一遍（原来那是 statsRunRowsHTML 的用途）。 */
export const StatsRunCard = {
  name: 'StatsRunCard',
  components: { KvRow, OcrReady },
  props: ['i'],
  template: `
<kv-row k="Go 服务">{{ i.server || '' }}</kv-row><kv-row k="Go / 运行时长">{{ (i.go || '') + ' / ' + (i.uptimeS || 0) + 's' }}</kv-row><kv-row k="时区">{{ i.tz || '' }}</kv-row><kv-row k="OCR 引擎"><ocr-ready :ready="i.ocrReady"/></kv-row>`
};

/* 设置页「数据」卡：三行 kv（值都是「3 / 2」这种三段拼接）+ 三个按钮 + 一段说明。
   按钮原来是字符串里的 onclick="exportJSON()"，现在走 @click + 导出表。 */
export const SettingsDataCard = {
  name: 'SettingsDataCard',
  components: { KvRow },
  setup(){
    return {
      H,
      st: computed(() => H.ST),
      i: computed(() => ({ ...H.S.info }))
    }
  },
  template: `
<kv-row k="笔记 / 待办">{{ (st ? st.notes.total : i.notes || 0) }} / {{ (st ? st.todos.total : i.todos || 0) }}</kv-row><kv-row k="未完成 / 已逾期">{{ (st ? st.todos.open : i.open || 0) }} / <b style="color:var(--bad)">{{ (st ? st.todos.overdue : i.overdue || 0) }}</b></kv-row><kv-row k="附件 / 占用">{{ (st ? (st.attach.count || 0) : 0) }} 个 / {{ H.fmtSize(st ? st.bytes : 0) }}</kv-row><div class="acts"><button class="btn gh" @click="H.exportJSON()">导出 JSON</button><button class="btn gh" @click="H.importJSON()">导入 JSON</button><button class="btn dg" @click="H.clearAllNotes()">清空全部</button></div><div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)">导出＝全量备份（含待办与附件元数据）；导入按笔记 ID 合并，已存在的笔记不覆盖；清空只删笔记与附件，设置与 API Key 保留。</div>`
};

/* 设置页「运行状态」卡：与我的页那张共用前三行的算法，第四行是解析队列。 */
export const SettingsRunCard = {
  name: 'SettingsRunCard',
  components: { KvRow },
  props: ['i'],
  setup(){ return { H, } },
  template: `
<kv-row k="Go 服务">{{ i.server || '' }}</kv-row><kv-row k="Go / 运行时长">{{ (i.go || '') + ' / ' + (i.uptimeS || 0) + 's' }}</kv-row><kv-row k="时区">{{ i.tz || '' }}</kv-row><kv-row k="解析队列">{{ (i.queue || 0) }} 条待处理</kv-row><div class="acts"><button class="btn gh" @click="H.showLog()">查看日志</button><button class="btn gh" @click="H.showDebug()">AI 调用记录</button></div>`
};

/* 设置页「本地 OCR」卡：引擎状态 + 引擎信息 + 一段说明。 */
export const SettingsOcrCard = {
  name: 'SettingsOcrCard',
  components: { KvRow, OcrReady },
  props: ['i'],
  setup(){ return { H, } },
  template: `
<kv-row k="引擎状态"><ocr-ready :ready="i.ocrReady"/></kv-row><kv-row k="引擎信息">{{ H.S.ocrInfo || 'vivo 离线 OCR' }}</kv-row><div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)">图片只在本机识别成文字，只有识别出的文字（和原文）会发给模型。单条笔记可在笔记卡片上「↻ 重新识别图片」。</div>`
};
