/* Notes 视图（S3 步骤 5，D14 混合期的第一个 Vue 视图）。

   这是步骤 6/7/9/10 照抄的模板，四条骨架：
   1. 读模块状态一律 computed()：S.notes 这批容器自步骤 17e 起是 reactive 的，computed
      读到谁就订阅谁，赋值即重画（17h 之前这里读的是 V.tick 那套全量
      重绘（读 V.tick 那套），live() 已删；闸门⑮ 钉住「不许再包 live()」与「computed 不许只返回容器本身」）。
   2. 组件不接 tick prop（步骤 17l 删掉了这条管道）。当年 <empty-state> 多收一个 :tick 会
      透传成根元素属性（真机实测 Vue 路径 <div class="empty" tick="27">、遗留路径
      <div class="empty">，VDIFF 一比就红，步骤 7 审查抓到）—— 现在没有 tick 可传，
      这一整类漂移没了，闸门⑮ 直接钉住「模板里不许出现 :tick」。
   3. 结构在模板里，叶子片段（图标/chip/meta/关键信息/待办行）是 components/leaf.js 里的
      真组件（步骤 16），不再走 v-html。
   4. 事件用 @click="H.xxx(...)"，函数名必须 ⊆ 导出表（闸门①(a)）。 */

import { Vue } from '../vue.js'
import { StripBar, MissedBanner, ShotBanner, ClipBanner, EmptyState, NoteCard } from '../components.js'

const { computed, inject } = Vue

export const NotesView = {
  name: 'NotesView',
  components: { StripBar, MissedBanner, ShotBanner, ClipBanner, EmptyState, NoteCard },
  setup(){
    const H = inject('H');
    const list = computed(() => H.notesFiltered());
    /* 两种空态与遗留 renderNotes() 一致：一条笔记都没有 vs 有笔记但被筛没了 */
    const empty = computed(() => H.S.notes.length
      ? { icon: 'search', t: '没有符合条件的笔记', sub: '换个关键词，或点右上角重置筛选' }
      : { icon: 'inbox', t: '还没有笔记',
          sub: '在任何 app 里点「分享 → 懒得记」，文字和图片会自动变成笔记与待办' });
    /* 步骤 13：服务端搜索失败（超时/断网）时退回本地过滤，顶部给一条可重试的错条；
       不静默把「拉不到」画成「没有」。 */
    return { H, list, empty, srErr: computed(() => H.srErr) };
  },
  template: `
<strip-bar></strip-bar>
<div class="errbox" v-if="srErr">{{ srErr }}，已退回本地过滤 ·
  <button class="btn sm gh" @click="H.searchNow(true)">重试</button></div>
<missed-banner></missed-banner>
<shot-banner></shot-banner>
<clip-banner></clip-banner>
<empty-state v-if="!list.length" :icon="empty.icon" :title="empty.t" :sub="empty.sub"></empty-state>
<note-card v-for="(n,k) in list" :key="n.id" :n="n" :k="k"></note-card>
`
}
