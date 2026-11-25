/* Notes 视图（S3 步骤 5，D14 混合期的第一个 Vue 视图）。

   这是步骤 6/7/9/10 照抄的模板，四条骨架：
   1. setup() 里 `const tick = computed(() => V.tick)` —— 视图必须**在渲染期真的读到 tick**：
      S.notes 是非响应式的模块变量，渲染 effect 只跟踪响应式依赖，没读到 tick 的组件在
      render() 后纹丝不动（点了删除没反应，正是 P12 那类静默 bug）。闸门①(b) 静态钉这条。
   2. 声明了 tick prop 的子组件都收 :tick="tick"：子组件的 props 变了才会重渲染，视图读到
      tick 不够。**没声明 tick prop 的组件禁止收**：Vue 把它当透传属性落到根元素上，
      真机实测 <empty-state> 收 :tick 时 Vue 路径是 <div class="empty" tick="27">，遗留
      路径是 <div class="empty"> —— VDIFF 比属性，空态一比就红（步骤 7 审查抓到）。
      闸门⑮ 现在按组件的 props 双向钉这条。
   3. 结构在模板里，叶子片段（图标/chip/meta/关键信息/待办行）是 components/leaf.js 里的
      真组件（步骤 16），不再走 v-html。
   4. 事件用 @click="H.xxx(...)"，函数名必须 ⊆ 导出表（闸门①(a)）。 */

import { V, Vue } from '../vue.js'
import { StripBar, MissedBanner, ShotBanner, ClipBanner, EmptyState, NoteCard } from '../components.js'

const { computed, inject } = Vue

export const NotesView = {
  name: 'NotesView',
  components: { StripBar, MissedBanner, ShotBanner, ClipBanner, EmptyState, NoteCard },
  setup(){
    const H = inject('H');
    const tick = computed(() => V.tick);
    const list = computed(() => H.notesFiltered());
    /* 两种空态与遗留 renderNotes() 一致：一条笔记都没有 vs 有笔记但被筛没了 */
    const empty = computed(() => H.S.notes.length
      ? { icon: 'search', t: '没有符合条件的笔记', sub: '换个关键词，或点右上角重置筛选' }
      : { icon: 'inbox', t: '还没有笔记',
          sub: '在任何 app 里点「分享 → 懒得记」，文字和图片会自动变成笔记与待办' });
    /* 步骤 13：服务端搜索失败（超时/断网）时退回本地过滤，顶部给一条可重试的错条；
       不静默把「拉不到」画成「没有」。 */
    return { H, tick, list, empty, srErr: computed(() => H.srErr) };
  },
  template: `
<strip-bar :tick="tick"></strip-bar>
<div class="errbox" v-if="srErr">{{ srErr }}，已退回本地过滤 ·
  <button class="btn sm gh" @click="H.searchNow(true)">重试</button></div>
<missed-banner :tick="tick"></missed-banner>
<shot-banner :tick="tick"></shot-banner>
<clip-banner :tick="tick"></clip-banner>
<empty-state v-if="!list.length" :icon="empty.icon" :title="empty.t" :sub="empty.sub"></empty-state>
<note-card v-for="(n,k) in list" :key="n.id" :tick="tick" :n="n" :k="k"></note-card>
`
}
