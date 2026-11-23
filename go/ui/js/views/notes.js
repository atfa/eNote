/* Notes 视图（S3 步骤 5，D14 混合期的第一个 Vue 视图）。

   这是步骤 6/7/9/10 照抄的模板，四条骨架：
   1. setup() 里 `const tick = computed(() => V.tick)` —— 视图必须**在渲染期真的读到 tick**：
      S.notes 是非响应式的模块变量，渲染 effect 只跟踪响应式依赖，没读到 tick 的组件在
      render() 后纹丝不动（点了删除没反应，正是 P12 那类静默 bug）。闸门①(b) 静态钉这条。
   2. 每个子组件都收 :tick="tick"：子组件的 props 变了才会重渲染，视图读到 tick 不够。
   3. 结构在模板里，叶子片段（图标/chip/待办行）走 v-html 复用 app.js 里的现成函数。
   4. 事件用 @click="H.xxx(...)"，函数名必须 ⊆ 导出表（闸门①(a)）。 */

import { V, H, Vue } from '../vue.js'
import { StripBar, MissedBanner, ShotBanner, ClipBanner, EmptyState, NoteCard } from '../components.js'

const { computed } = Vue

export const NotesView = {
  name: 'NotesView',
  components: { StripBar, MissedBanner, ShotBanner, ClipBanner, EmptyState, NoteCard },
  setup(){
    const tick = computed(() => V.tick);
    const list = computed(() => H.notesFiltered());
    /* 两种空态与遗留 renderNotes() 一致：一条笔记都没有 vs 有笔记但被筛没了 */
    const empty = computed(() => H.S.notes.length
      ? { icon: 'search', t: '没有符合条件的笔记', sub: '换个关键词，或点右上角重置筛选' }
      : { icon: 'inbox', t: '还没有笔记',
          sub: '在任何 app 里点「分享 → 懒得记」，文字和图片会自动变成笔记与待办' });
    return { H, tick, list, empty };
  },
  template: `
<strip-bar :tick="tick"></strip-bar>
<missed-banner :tick="tick"></missed-banner>
<shot-banner :tick="tick"></shot-banner>
<clip-banner :tick="tick"></clip-banner>
<empty-state v-if="!list.length" :tick="tick" :icon="empty.icon" :title="empty.t" :sub="empty.sub"></empty-state>
<note-card v-for="(n,k) in list" :key="n.id" :tick="tick" :n="n" :k="k"></note-card>
`
}
