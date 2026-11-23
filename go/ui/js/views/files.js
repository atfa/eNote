/* 附件页（S3 步骤 7）。模式同 views/notes.js、views/todos.js：结构在模板里，叶子 HTML
   （strip 文案、卡片 class、图标、meta 行）调 app.js 的 fileStripInner / attachCardCls /
   attachGlyphHTML / attachMetaHTML —— 两条渲染路径共用同一份叶子函数，VDIFF 才逐字比得过。

   读模块状态一律 live()（见 js/vue.js）：FA 是普通模块变量，filesNow() 每次整体替换它，
   computed 不依赖 tick 就永远缓存 → 附件页永远停在首屏那份数据。
   FA / q 走 setHost 的 getter（不是快照）：装配时传值的话，后面换掉的 FA 视图看不见。

   三态的判定顺序和遗留 renderFiles() 逐字一致：骨架屏（FA.loaded=false）优先于空态，
   空态优先于网格 —— 首屏时 items 是空数组，把空态排在前面会先闪一下「还没有附件」。 */

import { V, H, Vue, live } from '../vue.js'
import { EmptyState } from '../components.js'

const { computed } = Vue

export const AttachCard = {
  name: 'AttachCard',
  props: ['tick', 'a', 'k'],
  setup(props){
    return {
      H,
      // cls 里已经带 'acard'，所以模板只写 :class，不再叠静态 class="acard"
      // （Vue 会合并成 "acard acard enter"，VDIFF 比 class 字符串，多一个就红）
      cls: live(() => H.attachCardCls(props.a)),
      idx: live(() => Math.min(props.k || 0, 8)),
      glyph: live(() => H.attachGlyphHTML(props.a)),
      meta: live(() => H.attachMetaHTML(props.a)),
      isImg: live(() => props.a.kind === 'image' && !props.a.missing)
    }
  },
  template: `
  <div :class="cls" :style="'--i:'+idx" @click="H.openAttach(a.id)">
    <img class="athumb" v-if="isImg" loading="lazy" :src="'/file?id='+a.id">
    <div class="aglyph" v-else v-html="glyph"></div>
    <div class="aname">{{ a.name }}</div>
    <div class="ameta" v-html="meta"></div>
    <div class="anote">{{ a.noteTitle || '' }}</div>
    <div class="amiss" v-if="a.missing">文件已不在</div>
    <div class="arow" @click.stop>
      <button class="btn sm gh" @click.stop="H.jump(a.noteId)" v-html="H.ic('note')+'笔记'"></button>
      <button class="btn sm dg" @click.stop="H.delAttach(a.id)" v-html="H.ic('trash')+'删除'"></button>
    </div>
  </div>`
};

export const FilesView = {
  name: 'FilesView',
  components: { EmptyState, AttachCard },
  setup(){
    const tick = computed(() => V.tick);
    const FA = live(() => H.FA);
    const items = live(() => H.FA.items);
    return {
      tick, FA, items,
      stripHtml: live(() => H.fileStripInner()),
      // 空态文案分两种：搜索中 vs 真的一个附件都没有（和遗留 renderFiles 一致）
      emptyTitle: live(() => H.q ? '没有匹配的附件' : '还没有附件')
    }
  },
  template: `
<div class="strip" v-html="stripHtml"></div>
<div class="card" v-if="!FA.loaded">
  <div class="skel img"></div><div class="skel l"></div><div class="skel s"></div>
</div>
<empty-state v-else-if="!items.length" :tick="tick" icon="clip"
             :title="emptyTitle" sub="分享图片 / PDF，或点右下角「添加附件」"/>
<div class="agrid" v-else>
  <attach-card v-for="(a,k) in items" :key="a.id" :a="a" :k="k" :tick="tick"/>
</div>`
};

export default FilesView;
