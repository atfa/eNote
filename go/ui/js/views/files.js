/* 附件页（S3 步骤 7；步骤 16b 把叶子片段翻成真组件）。结构在模板里；strip 统计条、
   附件图标块与元信息行是 components/leaf.js 里的真组件（FileStrip / AttachGlyph /
   AttachMeta），按钮图标是 <ico>；本文件 v-html 已清零。

   读模块状态一律 live()（见 js/vue.js）：FA 是普通模块变量，filesNow() 每次整体替换它，
   computed 不依赖 tick 就永远缓存 → 附件页永远停在首屏那份数据。
   FA / q 走 setHost 的 getter（不是快照）：装配时传值的话，后面换掉的 FA 视图看不见。

   三态的判定顺序和遗留 renderFiles() 逐字一致：骨架屏（FA.loaded=false）优先于空态，
   空态优先于网格 —— 首屏时 items 是空数组，把空态排在前面会先闪一下「还没有附件」。

   <empty-state> 不收 :tick：EmptyState（Tony owner）的 props 只有 icon/title/sub，多传的
   :tick 会透传成根元素属性，真机实测 Vue 路径 <div class="empty" tick="27">、遗留路径
   <div class="empty"> —— 空态的 VDIFF 一比就红。空态文案的响应性已由 emptyTitle: live(...)
   覆盖，tick 对它没意义。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，所以全量名单写在下面这行：
   components: { EmptyState, AttachCard, Ico, AttachGlyph, AttachMeta, FileStrip } */

import { V, H, Vue, live } from '../vue.js'
import { EmptyState } from '../components.js'
import { Ico, AttachGlyph, AttachMeta, FileStrip } from '../components/leaf.js'

const { computed } = Vue

export const AttachCard = {
  name: 'AttachCard',
  components: { Ico, AttachGlyph, AttachMeta },
  props: ['tick', 'a', 'k'],
  setup(props){
    return {
      H,
      // cls 里已经带 'acard'，所以模板只写 :class，不再叠静态 class="acard"
      // （Vue 会合并成 "acard acard enter"，VDIFF 比 class 字符串，多一个就红）
      cls: live(() => H.attachCardCls(props.a)),
      idx: live(() => Math.min(props.k || 0, 8)),
      isImg: live(() => props.a.kind === 'image' && !props.a.missing)
    }
  },
  template: `
  <div :class="cls" :style="'--i:'+idx" @click="H.openAttach(a.id)">
    <img class="athumb" v-if="isImg" loading="lazy" :src="'/file?id='+a.id">
    <attach-glyph v-else :a="a"/>
    <div class="aname">{{ a.name }}</div>
    <attach-meta :a="a"/>
    <div class="anote">{{ a.noteTitle || '' }}</div>
    <div class="amiss" v-if="a.missing">文件已不在</div>
    <div class="arow" @click.stop>
      <button class="btn sm gh" @click.stop="H.jump(a.noteId)"><ico n="note"/>笔记</button>
      <button class="btn sm dg" @click.stop="H.delAttach(a.id)"><ico n="trash"/>删除</button>
    </div>
  </div>`
};

export const FilesView = {
  name: 'FilesView',
  components: { EmptyState, AttachCard, FileStrip },
  setup(){
    const tick = computed(() => V.tick);
    const FA = live(() => H.FA);
    const items = live(() => H.FA.items);
    return {
      tick, FA, items, H,
      // 空态文案分两种：搜索中 vs 真的一个附件都没有（和遗留 renderFiles 一致）
      emptyTitle: live(() => H.q ? '没有匹配的附件' : '还没有附件')
    }
  },
  template: `
<file-strip/>
<div class="card" v-if="!FA.loaded">
  <div class="skel img"></div><div class="skel l"></div><div class="skel s"></div>
  <div class="errbox" v-if="FA.error">{{ FA.error }}，正在重试 ·
    <button class="btn sm gh" @click="H.filesNow()">立即重试</button>
  </div>
</div>
<empty-state v-else-if="!items.length" icon="clip"
             :title="emptyTitle" sub="分享图片 / PDF，或点右下角「添加附件」"/>
<div class="agrid" v-else>
  <attach-card v-for="(a,k) in items" :key="a.id" :a="a" :k="k" :tick="tick"/>
</div>`
};

export default FilesView;
