/* 共享视图组件（S3）。

   模式模板（步骤 6/7/9/10 照抄）：
   1. 结构（循环、条件、卡片骨架）写在 Vue 模板里；
   2. 叶子片段（图标、chip、meta、关键信息、卡片里的紧凑待办行）是 components/leaf.js 里的
      真组件（步骤 16）：结构在模板里看得见、事件走 @click，不再经 v-html 插字符串；
   3. 组件不持有数据，只通过宿主接口 H 读模块状态；
   4. 每个组件收一个 tick prop：render() 每次递增它，父组件把 tick 传下来 → 子组件重渲染。
      今天的语义就是「每次 render() 全量重绘」，tick 是它的一比一翻译（见 vue.js 顶部说明）。
   5. 事件用 @click 绑宿主方法，事件对象用 $event。

   类名冻结（D15）：模板产出的 class 与迁移前逐字相同，
   tools/ui_test.js 的闸门 + 签名段 + test.sh 的 class 断言是硬验收
   （步骤 11 已删掉遗留字符串渲染器，「与它逐字相同」的基准没了，类名契约改由这些静态断言守）。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，StripBar 是第一个组件、
   它只用得到 <ico>，所以全量名单写在下面这行注释里（运行时各组件注册自己用到的那些）。
   components: { Ico, EmptyState, NoteMeta, NoteHits, NoteAttach, NoteFacts, TodoRowCompact } */

import { Vue } from './vue.js'
const { computed, inject } = Vue
// 基础组件 <empty-state> 归 Tony（owner 见文件头注释），在这里统一注册。
import { EmptyState } from './components/empty-state.js'
/* 步骤 16：叶子片段（图标 / chip / meta / 关键信息 / 紧凑待办行）从 app.js 的 HTML 字符串
   函数翻成真组件，v-html 在这里清零。 */
import { Ico, NoteMeta, NoteHits, NoteAttach, NoteFacts, TodoRowCompact } from './components/leaf.js'
export { EmptyState, Ico, NoteMeta, NoteHits, NoteAttach, NoteFacts, TodoRowCompact }

/* 本文件的 computed 全部裸写（真依赖追踪）：读到的模块状态都是 reactive 的。
   返容器本身是陷阱（FileStrip 的 i 就是浅拷贝），见 vue.js 头部两条契约。 */

export const StripBar = {
  name: 'StripBar',
  props: ['tick'],
  setup(){
    const H = inject('H');
    /* 返回容器本身是陷阱：S.info 是原地改键的 reactive 对象，computed 每次返回同一个
       proxy，Vue 判定「值没变」就不重渲染。返回快照。 */
    return { H, i: computed(() => ({ ...H.S.info })) }
  },
  components: { Ico },
  template: `
<div class="metrics">
  <div class="m"><b>{{ i.open || 0 }}</b><span><ico n="check-square" cls="s"/>待办</span></div>
  <div class="m" :class="{hot: i.overdue}"><b>{{ i.overdue || 0 }}</b><span><ico n="alert" cls="s"/>逾期</span></div>
  <div class="m"><b>{{ i.notes || 0 }}</b><span><ico n="note" cls="s"/>笔记</span></div>
  <div class="m wide" :class="{ok: i.ocrReady}"><ico :n="i.ocrReady ? 'mic' : 'mic-slash'" cls="s"/>{{ i.ocrReady ? '本机 OCR 就绪' : 'OCR 引擎启动中…' }}</div>
</div>`
}

export const MissedBanner = {
  name: 'MissedBanner',
  props: ['tick'],
  setup(){
    const H = inject('H');
    const m = computed(() => H.MISSED)
    const more = computed(() => m.value && m.value.count > (m.value.items || []).length)
    const sub = computed(() => {
      const v = m.value
      return more.value ? '只列出最早到点的 ' + (v.items || []).length + ' 条'
                        : '你不在的时候到点了，闹钟可能没响'
    })
    return { H, m, sub }
  },
  components: { Ico },
  template: `
<div class="missed" v-if="m && m.count" @click="H.missedSheet()">
  <span class="mi"><ico n="bell"/></span>
  <div style="flex:1;min-width:0"><b>错过 {{ m.count }} 条提醒</b><div class="cbsub">{{ sub }}</div></div>
  <span class="cbar">查看 ›</span>
</div>`
}

/* 截图横幅的四种状态（有截图 / 未开启 / 缺权限 / 没选目录），判定顺序与遗留 shotBanner() 一致 */
export const ShotBanner = {
  name: 'ShotBanner',
  props: ['tick'],
  setup(){
    const H = inject('H');
    const kind = computed(() => {
      const n = (H.S.info && H.S.info.shot) || 0
      if (n > 0) return 'found'
      const f = H.SHOTFLAGS || {}
      if (!f.enabled) return 'off'
      if (!f.granted) return 'perm'
      if (!f.folders) return 'nofolder'
      return ''
    })
    const text = computed(() => {
      const n = (H.S.info && H.S.info.shot) || 0
      switch (kind.value){
        case 'found':    return { b: '发现 ' + (n >= 50 ? '50+' : n) + ' 张新截图',
                                  s: '点开勾选：可以合并成一条笔记，也可以各存一条', c: '整理 ›', go: 'shotSheet' }
        case 'off':      return { b: '自动收集截图', s: '选几个文件夹盯着，新截图自动变成笔记', c: '开启 ›', go: 'shotSetup' }
        case 'perm':     return { b: '需要允许读取照片', s: '不给权限就发现不了新截图（只读，不上传）', c: '去授权 ›', go: 'askShotPerm' }
        case 'nofolder': return { b: '还没选监控文件夹', s: '至少选一个目录（默认会勾上截图目录）', c: '去选择 ›', go: 'folderSheet' }
      }
      return null
    })
    return { H, text }
  },
  components: { Ico },
  template: `
<div class="shotbanner" v-if="text" @click="H.shotGo(text.go)">
  <span class="si"><ico :n="text.go === 'perm' ? 'alert' : text.go === 'nofolder' ? 'folder' : 'image'"/></span>
  <div style="flex:1;min-width:0"><b>{{ text.b }}</b><div class="cbsub">{{ text.s }}</div></div>
  <span class="cbar">{{ text.c }}</span>
</div>`
}

export const ClipBanner = {
  name: 'ClipBanner',
  props: ['tick'],
  setup(){
    const H = inject('H');
    const n = computed(() => (H.S.info && H.S.info.clip) || 0)
    const hint = computed(() => !n.value && H.clipHint())
    return { H, n, hint }
  },
  components: { Ico },
  template: `
<div class="clipbanner" v-if="n" @click="H.clipSheet()"><ico n="clipboard"/>
  <div style="flex:1"><b>剪贴板暂存 {{ n }} 条</b><div class="cbsub">复制的内容已留在这里，点开勾选再处理</div></div>
  <span class="cbar">整理 ›</span></div>
<div class="clipbanner" v-else-if="hint" @click="H.importClip()"><ico n="clipboard"/>
  <div style="flex:1"><b>剪贴板刚有更新</b><div class="cbsub">系统不让后台读，点这里收进暂存</div></div>
  <span class="cbar">收进来 ›</span></div>`
}

export const NoteCard = {
  name: 'NoteCard',
  components: { Ico, NoteMeta, NoteHits, NoteAttach, NoteFacts, TodoRowCompact },
  props: ['tick', 'n', 'k'],
  setup(props){
    const H = inject('H');
    const exp = computed(() => !!H.open[props.n.id])
    // 外层 .hits / .facts 只在有内容时存在（原来是 v-if="H.whereHTML(n)"），
    // 判空条件跟着搬进来，渲染函数与组件里的 v-if 用同一个表达式。
    const hits = computed(() => {
      const w = H.SR.where && H.SR.where[props.n.id]
      return !!(w && w.length)
    })
    const attach = computed(() => props.n.attachments && props.n.attachments.length > 1)
    const todos = computed(() => props.n.todos || [])
    return { H, exp, hits, attach, todos,
             idx: computed(() => Math.min(props.k || 0, 8)),
             body: computed(() => props.n.content || '(无正文)'),
             ec: computed(() => H.enterCls('n' + props.n.id)) }
  },
  template: `
<div class="card" :class="ec" :id="'n'+n.id" :style="'--i:'+idx">
  <div class="row between"><p class="t">{{ n.title || '未命名笔记' }}</p></div>
  <div class="meta"><note-meta :n="n" :tick="tick"/></div>
  <div class="hits" v-if="hits"><note-hits :n="n" :tick="tick"/></div>
  <div class="hits" v-if="attach"><note-attach :n="n" :tick="tick"/></div>
  <img class="thumb" v-if="n.imagePath" :src="'/img?id='+n.id">
  <note-facts :n="n" :tick="tick"/>
  <div class="body" :class="{clamp: !exp}" v-text="body"></div>
  <div class="errbox" v-if="n.error" v-text="n.error"></div>
  <div style="margin-top:var(--s2)" v-if="todos.length"><todo-row-compact v-for="t in todos" :key="t.id" :t="t" :n="n" :tick="tick"/></div>
  <div class="acts">
    <button class="btn sm gh exp" @click="H.expand(n.id)"><ico :n="exp?'chevup':'chev'"/>{{ exp?'收起':'展开详情' }}</button>
    <button class="btn sm" v-if="n.status==='done'||n.status==='raw'" @click="H.reparse(n.id)"><ico n="refresh"/>重新解析</button>
    <button class="btn sm" v-if="n.imagePath" @click="H.reocr(n.id)"><ico n="scan"/>重新识别图片</button>
    <button class="btn sm" @click="H.addTodoSheet(n.id)"><ico n="plus"/>待办</button>
    <button class="btn sm dg" @click="H.delNote(n.id)"><ico n="trash"/>删除</button>
  </div>
</div>`
}
