/* 共享视图组件（S3）。

   模式模板（步骤 6/7/9/10 照抄）：
   1. 结构（循环、条件、卡片骨架）写在 Vue 模板里；
   2. 叶子片段（图标、chip、待办行）继续用 app.js 里现成的 HTML 字符串函数，通过 v-html 插入
      —— 混合期两条渲染路径共用同一份叶子函数，产出的 DOM 逐字一致，签名断言只有一份真相；
   3. 组件不持有数据，只通过宿主接口 H 读模块状态；
   4. 每个组件收一个 tick prop：render() 每次递增它，父组件把 tick 传下来 → 子组件重渲染。
      今天的语义就是「每次 render() 全量重绘」，tick 是它的一比一翻译（见 vue.js 顶部说明）。
   5. 事件用 @click 绑宿主方法，事件对象用 $event。

   类名冻结（D15）：模板产出的 class 必须与遗留字符串渲染器逐字相同，
   ui_sig_test.js 的 84 项签名 + test.sh 的 10 个 class 断言是硬验收。 */

import { H, Vue, live } from './vue.js'
// 基础组件 <empty-state> 归 Tony（owner 见文件头注释），在这里统一注册。
import { EmptyState } from './components/empty-state.js'
export { EmptyState }

/* 读模块状态的 computed 一律用 live() 包（见 vue.js）：漏一个就是「数据变了视图不动」 */

export const StripBar = {
  name: 'StripBar',
  props: ['tick'],
  setup(){
    return { H, i: live(() => H.S.info) }
  },
  template: `
<div class="metrics">
  <div class="m"><b>{{ i.open || 0 }}</b><span v-html="H.ic('check-square','s')+'待办'"></span></div>
  <div class="m" :class="{hot: i.overdue}"><b>{{ i.overdue || 0 }}</b><span v-html="H.ic('alert','s')+'逾期'"></span></div>
  <div class="m"><b>{{ i.notes || 0 }}</b><span v-html="H.ic('note','s')+'笔记'"></span></div>
  <div class="m wide" :class="{ok: i.ocrReady}" v-html="H.ic(i.ocrReady ? 'mic' : 'mic-slash','s')+(i.ocrReady ? '本机 OCR 就绪' : 'OCR 引擎启动中…')"></div>
</div>`
}

export const MissedBanner = {
  name: 'MissedBanner',
  props: ['tick'],
  setup(){
    const m = live(() => H.MISSED)
    const more = live(() => m.value && m.value.count > (m.value.items || []).length)
    const sub = live(() => {
      const v = m.value
      return more.value ? '只列出最早到点的 ' + (v.items || []).length + ' 条'
                        : '你不在的时候到点了，闹钟可能没响'
    })
    return { H, m, sub }
  },
  template: `
<div class="missed" v-if="m && m.count" @click="H.missedSheet()">
  <span class="mi" v-html="H.ic('bell')"></span>
  <div style="flex:1;min-width:0"><b>错过 {{ m.count }} 条提醒</b><div class="cbsub">{{ sub }}</div></div>
  <span class="cbar">查看 ›</span>
</div>`
}

/* 截图横幅的四种状态（有截图 / 未开启 / 缺权限 / 没选目录），判定顺序与遗留 shotBanner() 一致 */
export const ShotBanner = {
  name: 'ShotBanner',
  props: ['tick'],
  setup(){
    const kind = live(() => {
      const n = (H.S.info && H.S.info.shot) || 0
      if (n > 0) return 'found'
      const f = H.SHOTFLAGS || {}
      if (!f.enabled) return 'off'
      if (!f.granted) return 'perm'
      if (!f.folders) return 'nofolder'
      return ''
    })
    const text = live(() => {
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
  template: `
<div class="shotbanner" v-if="text" @click="H.shotGo(text.go)">
  <span class="si" v-html="H.ic(text.go === 'perm' ? 'alert' : text.go === 'nofolder' ? 'folder' : 'image')"></span>
  <div style="flex:1;min-width:0"><b>{{ text.b }}</b><div class="cbsub">{{ text.s }}</div></div>
  <span class="cbar">{{ text.c }}</span>
</div>`
}

export const ClipBanner = {
  name: 'ClipBanner',
  props: ['tick'],
  setup(){
    const n = live(() => (H.S.info && H.S.info.clip) || 0)
    const hint = live(() => !n.value && H.clipHint())
    return { H, n, hint }
  },
  template: `
<div class="clipbanner" v-if="n" @click="H.clipSheet()" v-html="H.ic('clipboard')
  +'<div style=&quot;flex:1&quot;><b>剪贴板暂存 '+n+' 条</b><div class=&quot;cbsub&quot;>复制的内容已留在这里，点开勾选再处理</div></div>'
  +'<span class=&quot;cbar&quot;>整理 ›</span>'"></div>
<div class="clipbanner" v-else-if="hint" @click="H.importClip()" v-html="H.ic('clipboard')
  +'<div style=&quot;flex:1&quot;><b>剪贴板刚有更新</b><div class=&quot;cbsub&quot;>系统不让后台读，点这里收进暂存</div></div>'
  +'<span class=&quot;cbar&quot;>收进来 ›</span>'"></div>`
}

export const NoteCard = {
  name: 'NoteCard',
  props: ['tick', 'n', 'k'],
  setup(props){
    const exp = live(() => !!H.open[props.n.id])
    const todos = live(() => {
      const n = props.n
      return (n.todos && n.todos.length) ? n.todos.map(t => H.todoRow(t, n, true)).join('') : ''
    })
    return { H, exp, todos,
             idx: live(() => Math.min(props.k || 0, 8)),
             body: live(() => props.n.content || '(无正文)'),
             ec: live(() => H.enterCls('n' + props.n.id)) }
  },
  template: `
<div class="card" :class="ec" :id="'n'+n.id" :style="'--i:'+idx">
  <div class="row between"><p class="t">{{ n.title || '未命名笔记' }}</p></div>
  <div class="meta" v-html="H.metaHTML(n)"></div>
  <div class="hits" v-if="H.whereHTML(n)" v-html="H.whereHTML(n)"></div>
  <div class="hits" v-if="H.attachHTML(n)" v-html="H.attachHTML(n)"></div>
  <img class="thumb" v-if="n.imagePath" :src="'/img?id='+n.id">
  <div v-html="H.factsBlock(n)"></div>
  <div class="body" :class="{clamp: !exp}" v-text="body"></div>
  <div class="errbox" v-if="n.error" v-text="n.error"></div>
  <div style="margin-top:10px" v-if="todos" v-html="todos"></div>
  <div class="acts">
    <button class="btn sm gh exp" @click="H.expand(n.id)" v-html="H.ic(exp?'chevup':'chev')+(exp?'收起':'展开详情')"></button>
    <button class="btn sm" v-if="n.status==='done'||n.status==='raw'" @click="H.reparse(n.id)" v-html="H.ic('refresh')+'重新解析'"></button>
    <button class="btn sm" v-if="n.imagePath" @click="H.reocr(n.id)" v-html="H.ic('scan')+'重新识别图片'"></button>
    <button class="btn sm" @click="H.addTodoSheet(n.id)" v-html="H.ic('plus')+'待办'"></button>
    <button class="btn sm dg" @click="H.delNote(n.id)" v-html="H.ic('trash')+'删除'"></button>
  </div>
</div>`
}
