/* 叶子组件（S3 步骤 16）：把「HTML 字符串片段」翻成真组件。

   这些片段原本是 app.js 里的 `*HTML` 前缀函数与 srcChip / statusChip / todoRow 一类函数，Vue 模板用
   v-html 把它们插进去。那是步骤 5~14 混合期的折中：遗留字符串渲染器与 Vue 两条路径要产出
   逐字一致的 DOM，所以叶子 HTML 只能有一份。步骤 11 删掉遗留渲染器之后只剩 Vue 一条路径，
   字符串函数就纯属负担了：模板里看不见真实 DOM（闸门⑮ 编译模板也看不见这块结构）、
   事件写成内联 onclick（绕过导出表闸门，P12 那一类「点了没反应」）、每次重绘整段 innerHTML。

   类名冻结（D15）：产出的 DOM 与迁移前逐字一致。三条翻译规则：
   - `<ico n="x" cls="s"/>` ≡ app.js 的 ic('x','s') → `<svg class="ic s"><use href="#i-x"/></svg>`；
   - 原字符串里元素之间的字面空格用 `{{ ' ' }}` 显式写出来 —— Vue 的 whitespace:'condense'
     会把「两个元素之间的纯空白节点」删掉，不写就少一个空格文本节点（元素与文本之间的那个
     空格会保留成一个空格，所以 `ic('clock','s')+' '+fmtTime(...)` 直接写 `/> {{ … }}` 即可）；
   - 原来返回空串的（statusChip / cdChip / remindBtns）条件不成立时渲染注释节点，
     v-html 时代那里是一段空串 —— 注释节点不产生元素，等价。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单（速记属性是求值期读的，
   最早用到子组件的 CdChip 定义在 RemindBtns / TodoDue 之前，那里写全量会撞 TDZ），
   所以全量名单写在下面这行注释里；运行时每个组件仍各自注册自己模板里用到的那些。
   components: { Ico, SrcChip, StatusChip, CdChip, RemindBtns, TodoDue, TodoPriChips,
                 NoteMeta, NoteHits, NoteAttach, NoteFacts, TodoTx, TodoRowCompact,
                 KvRow, OcrReady, FileStrip, AttachGlyph, AttachMeta } */
import { Vue } from '../vue.js'
const { computed, inject } = Vue

/* 图标：sprite 引用。cls 不传时 class="ic"，传 's' 时 class="ic s"，与 ic(n, cls) 一致。 */
export const Ico = {
  name: 'Ico',
  props: ['n', 'cls'],
  template: `<svg class="ic" :class="cls"><use :href="'#i-'+n"/></svg>`
}

/* 来源小标签（剪贴板 / 分享 / 图片 / 手动） */
export const SrcChip = {
  name: 'SrcChip',
  props: ['n'],
  template: `
<span class="chip" v-if="n.source==='clipboard-text'">剪贴板</span>
<span class="chip img" v-else-if="n.source==='clipboard-image'">剪贴板图片</span>
<span class="chip" v-else-if="n.source==='share-text'">分享文字</span>
<span class="chip img" v-else-if="n.source==='share-image'">分享图片</span>
<span class="chip img" v-else-if="n.source==='manual-image'">图片</span>
<span class="chip" v-else>手动</span>`
}

/* 解析状态小标签；无状态时什么都不渲染（原来返回 ''） */
export const StatusChip = {
  name: 'StatusChip',
  props: ['n'],
  template: `
<span class="chip pend" v-if="n.status==='queued'"><span class="spin"></span> 排队中</span>
<span class="chip pend" v-else-if="n.status==='parsing'"><span class="spin"></span> AI 解析中</span>
<span class="chip ai" v-else-if="n.status==='done'">✦ AI {{ n.aiModel || '' }} · {{ n.aiMs || 0 }}ms</span>
<span class="chip pend" v-else-if="n.status==='raw'">仅原文</span>
<span class="chip err" v-else-if="n.status==='error'">失败</span>`
}

/* 卡片头部的 meta 行：来源 + 状态 + 时间 + 标签 */
export const NoteMeta = {
  name: 'NoteMeta',
  components: { Ico, SrcChip, StatusChip },
  props: ['n'],
  setup(){ const H = inject('H'); return { H } },
  template: `
<src-chip :n="n"/><status-chip :n="n"/>
<span><ico n="clock" cls="s"/> {{ H.fmtTime(n.createdAt) }}</span>
<span class="chip tag" v-for="t in n.tags || []" :key="t"><ico n="tag"/> {{ t }}</span>`
}

/* 搜索命中来源（「标题」/「正文」/「来自图片文字」）；无命中渲染空 */
export const NoteHits = {
  name: 'NoteHits',
  components: { Ico },
  props: ['n'],
  setup(props){
    const H = inject('H');
    const where = computed(() => (H.SR.where && H.SR.where[props.n.id]) || [])
    return { H, where }
  },
  template: `
<span class="hit" v-for="(x, i) in where" :key="i" :class="{img: x==='来自图片文字'}"><ico :n="x==='来自图片文字' ? 'image' : 'search'"/>{{ x }}</span>`
}

/* 多附件提示（只有一个附件时不显示，那个附件就是缩略图） */
export const NoteAttach = {
  name: 'NoteAttach',
  components: { Ico },
  props: ['n'],
  template: `
<span class="hit" v-if="n.attachments && n.attachments.length > 1"><ico n="clip"/>{{ n.attachments.length }} 个附件</span>`
}

/* 关键信息（AI 抽出来的 q/a 列表）；整块 .facts 由本组件自己 v-if，
   这样消费方不用先算一遍内层 HTML 再判空（原来那是 factsInner 的用途）。 */
export const NoteFacts = {
  name: 'NoteFacts',
  components: { Ico },
  props: ['n'],
  setup(props){
    const f = computed(() => props.n.facts || [])
    return { f }
  },
  template: `
<div class="facts" v-if="f.length">
  <div class="fh"><ico n="search"/>关键信息</div>
  <div class="fr" v-for="(x, ki) in f" :key="ki" :style="'--k:'+ki"><span class="fq">{{ x.q }}</span><span class="fa">{{ x.a }}</span></div>
</div>`
}

/* 到期倒计时胶囊。文本每 20 秒由 app.js 的 tickCD() 就地改写 textContent / className
   （整页重绘会闪），所以这里的 :class / {{ }} 只是重绘时的初值。 */
export const CdChip = {
  name: 'CdChip',
  components: { Ico },
  props: ['t'],
  setup(props){
    const H = inject('H');
    return { H,
      show: computed(() => !!props.t.due && !props.t.done),
      cls: computed(() => H.cdCls(props.t.due)),
      txt: computed(() => H.cdText(props.t.due)) }
  },
  template: `
<span v-if="show" :class="cls" :data-due="t.due"><ico n="clock"/>{{ txt }}</span>`
}

/* 到期提醒的两个按钮（写系统日历 / 设闹钟）。前导空格是原字符串里的字面量。 */
export const RemindBtns = {
  name: 'RemindBtns',
  components: { Ico },
  props: ['n', 't'],
  setup(){ const H = inject('H'); return { H } },
  template: `
<template v-if="t.due && !t.done">{{ ' ' }}<span class="remind" title="写入系统日历" @click="H.toCalendar(n.id, t.id, $event)"><ico n="calendar"/></span>{{ ' ' }}<span class="remind" title="设为闹钟" @click="H.toAlarm(n.id, t.id, $event)"><ico n="alarm"/></span></template>`
}

/* 待办行的「到期」段：due 胶囊 + 倒计时 + 提醒按钮（原字符串函数里的 d 变量） */
export const TodoDue = {
  name: 'TodoDue',
  components: { Ico, CdChip, RemindBtns },
  props: ['n', 't'],
  setup(props){
    const H = inject('H');
    return { H,
      due: computed(() => H.fmtTime(props.t.due)),
      cls: computed(() => {
        const t = props.t
        const overdue = t.due < H.now(), today = t.due.slice(0, 10) === H.now()
        return 'due' + (overdue && !t.done ? ' over' : (today ? ' today' : ''))
      }) }
  },
  template: `
<template v-if="t.due"><span :class="cls"><ico n="calendar"/>{{ due }}</span><cd-chip :t="t"/><remind-btns :n="n" :t="t"/></template>`
}

/* 待办行的优先级 / 来源标签（原 extra 数组，join 用的那个空格在消费方） */
export const TodoPriChips = {
  name: 'TodoPriChips',
  components: { Ico },
  props: ['t', 'compact'],
  template: `
<span class="chip err" v-if="t.priority==='high'"><ico n="bolt"/>重要</span>
<span class="chip" v-else-if="t.priority==='low'"><ico n="chevup"/>低</span>
<span class="chip" v-if="!compact && t.source==='manual'">{{ (t.priority==='high'||t.priority==='low') ? ' ' : '' }}<ico n="edit"/>手动</span>`
}

/* 待办页一行的文字块（.tx 的内容）：文本 + 到期段 + 来源笔记链接 */
export const TodoTx = {
  name: 'TodoTx',
  components: { Ico, CdChip, RemindBtns },
  props: ['t', 'n'],
  setup(props){
    const H = inject('H');
    return { H,
      due: computed(() => H.fmtTime(props.t.due)),
      over: computed(() => props.t.due < H.now() && !props.t.done) }
  },
  template: `
<span class="ttx">{{ t.text }}<small><template v-if="t.due"><span class="due" :class="{over: over}"><ico n="calendar"/>{{ due }}</span>{{ ' ' }}<cd-chip :t="t"/><remind-btns :n="n" :t="t"/></template><a href="#" @click.prevent="H.jump(n.id)">{{ n.title || '查看笔记' }}</a></small></span>`
}

/* 笔记卡里的紧凑待办行（原字符串版第三个参数 compact=true：没有删除按钮）。
   与待办页的 TodoRow 不是一回事：那页的 .tx 里是 <span class="ttx">文本<small>…</small></span>，
   这里的 .ttx 只有文本、<small> 是它的兄弟节点，两条 DOM 各自有测试断言，不能合。 */
export const TodoRowCompact = {
  name: 'TodoRowCompact',
  components: { Ico, TodoDue, TodoPriChips },
  props: ['t', 'n'],
  setup(props){
    const H = inject('H');
    return { H, cls: computed(() => H.todoRowCls(props.n, props.t)) }
  },
  template: `
<div class="todo" :class="cls" :id="'t'+n.id+'_'+t.id">
  <div class="cb" :class="{on:t.done}" @click="H.toggle(n.id, t.id, $event.currentTarget)"><ico n="check"/></div>
  <div class="tx"><span class="ttx">{{ t.text }}</span><small><todo-due :t="t" :n="n"/>{{ ' ' }}<todo-pri-chips :t="t" :compact="true"/></small></div>
</div>`
}

/* ---------- 步骤 16b：统计页 / 设置页 / 附件页 / 剪贴板页的叶子 ---------- */

/* 设置页与我的页满屏都是这一行：左标签 + 右值。三种形态（对应迁移前的三种拼法）：
   - vstyle：值本身带样式的（采集卡那行绿字）——样式落在值 span 自己身上，不能多套一层；
   - 默认插槽：值是富文本（<b style="color:var(--bad)">、OCR 就绪胶囊）；
   - v：值是纯文本（数字、esc 后的文本），步骤 16d 起走 {{ }}（原来是 v-html 直插）。
     全部调用方（blocks.js 的统计/运行信息卡、settings.js 的采集卡）传的都是数字与中文
     字面量，没有标签，textContent 与 innerHTML 产出的节点相同。
   多包一层 <span> 就是 DOM 差异（VDIFF 比结构），所以三个分支各自直接当那个值 span。 */
export const KvRow = {
  name: 'KvRow',
  props: ['k', 'v', 'vstyle'],
  template: `<div class="kv"><span>{{ k }}</span><span v-if="vstyle" :style="vstyle">{{ v }}</span><span v-else-if="hasSlot"><slot/></span><span v-else>{{ v }}</span></div>`,
  setup(props, ctx){
    return { hasSlot: !!ctx.slots.default }
  }
}

/* 本地 OCR 引擎状态胶囊（我的页运行信息卡与设置页「本地 OCR」卡共用） */
export const OcrReady = {
  name: 'OcrReady',
  props: ['ready'],
  template: `<b style="color:var(--ok)" v-if="ready">● 就绪</b><span style="color:var(--warn)" v-else>◌ 初始化中</span>`
}

/* 附件页顶部的统计条。原字符串是「附件 <b>N</b> · 大小 · <i>缺失</i>」：
   「附件 」与「 · 」这些带空格的文本节点必须逐字保住，所以插值之间不写换行。 */
export const FileStrip = {
  name: 'FileStrip',
  setup(){
    const H = inject('H');
    /* 返回容器本身是陷阱：reassign(FA, …) 原地改键，computed 每次返回同一个 proxy，
       Vue 判定「值没变」就不重渲染（症状：附件页顶部条永远停在旧数字）。返回快照。 */
    return { H, FA: computed(() => ({ total: H.FA.total, bytes: H.FA.bytes, missing: H.FA.missing })) }
  },
  template: `
<div class="strip"><template v-if="!FA.total">附件 <b>0</b></template><template v-else>附件 <b>{{ FA.total }}</b> · {{ H.fmtSize(FA.bytes) }}<template v-if="FA.missing"> · <i>{{ FA.missing }} 个文件缺失</i></template></template></div>`
}

/* 附件卡的图标块（非图片附件走这里：按 kind 查 sprite 图标名） */
export const AttachGlyph = {
  name: 'AttachGlyph',
  components: { Ico },
  props: ['a'],
  setup(props){
    const H = inject('H');
    return { n: computed(() => H.attachGlyphName(props.a)) }
  },
  template: `<div class="aglyph"><ico :n="n" cls="xl"/></div>`
}

/* 附件卡的元信息行：类型 · 大小 · 时间（三段文本 + 两个「 · 」分隔，逐字照抄原拼接） */
export const AttachMeta = {
  name: 'AttachMeta',
  props: ['a'],
  setup(){ const H = inject('H'); return { H } },
  template: `<div class="ameta">{{ a.kind }} · {{ H.fmtSize(a.size) }} · {{ H.fmtTime(a.createdAt) }}</div>`
}

/* 剪贴板弹层底部的计数条（#clipFoot 这个 id 是 test.sh 夹具与 CSS 的定位点，不能改） */
