/* 剪贴板暂存页（S3 步骤 9；步骤 16b 把叶子片段翻成真组件）。结构在模板里；图标是
   components/leaf.js 的 <ico>，底部计数条是 <clip-count>（#clipFoot 这个 id 是 CSS
   与真机夹具的定位点，跟着进了组件模板）；本文件 v-html 已清零。

   步骤 17b 起本文件不再用 live()：app.js 的剪贴板状态换成了 Vue.reactive 的 CLIP 对象，
   赋值即触发重画，computed 直接读 H.clipList / H.clipSel 就建立依赖。踩过的坑：
   1) 状态不是响应式的时候，computed 永远缓存 → 勾选点了没反应，当时的解法是每个 computed
      包一层 live()（依赖 V.tick，render() 每调一次全部失效）。那是全量重绘，不是响应式；
      现在状态本身响应式了，包 live() 反而让每次 render() 都重算这些与剪贴板无关的 computed。
   2) 模板里用原始值 + {{ }}，不要再 esc：遗留路径是 innerHTML 拼 esc(x)，DOM 文本 =
      解码后的原值；Vue 的 {{ }} 是 textContent，传原值才等价（传 esc(x) 会双重转义）。
      图标那一段是 HTML，所以走 v-html，并且必须与遗留拼的是同一个字符串（一个文本节点）。
   3) 一个元素里只放一个 {{ }}：两个插值 = 两个文本节点，VDIFF 的序列化器会 trim 每个
      文本节点再拼，「app」+「 · 」+「刚刚」拼出来丢空格就红。
   4) 模板里用 H.xxx 的组件必须在 setup() 返回里暴露 H（步骤 8 的教训：模板编成
      _ctx.H.xxx(...)，没暴露时渲染期不碰它就静默过，点一下才抛 undefined）。

   与遗留路径的**有意**差异（别当 bug 改回去）：遗留 clipPick / clipSelAll 会顺手给
   .clicb 也加一个 on 类，而 CSS 里没有任何 .clicb.on 规则（勾选态由 .clipitem.on .clicb
   驱动），那是一次空操作；本步骤把遗留侧那次 toggle 删掉，两条路径都只动 .clipitem。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，所以全量名单写在下面这行：
   components: { EmptyState, ClipItem, Ico, ClipCount } */
import { Vue } from '../vue.js'
import { EmptyState } from '../components.js'
import { Ico } from '../components/leaf.js'

const { computed, inject } = Vue

/* 一条暂存。遗留字符串：
   <div class="clipitem on" onclick="clipPick('id',this)"><div class="clicb">ic('check')</div>
   <div class="clipbody"><div class="cliprev">预览</div><div class="climeta">app · 时间</div></div>
   <button class="clipdel" onclick="clipDel(event,'id')" aria-label="删除这条">ic('x')</button></div>
   （遗留那句历史上写的是 clipDel(event,"id")，双引号套双引号属性，被浏览器截断 ——
   步骤 9 的 VDIFF 抓出来的真 bug，见 app.js clipItemHTML 的注释。）
   class 用拼接而不是静态 class + 对象语法：Vue 合并 class 的顺序与字符串拼接不同，
   VDIFF 比的是 class 属性字符串（见 views/files.js 的 acard）。 */
export const ClipItem = {
  name: 'ClipItem',
  components: { Ico },
  props: ['x'],
  setup(props){
    const H = inject('H');
    // cls 读的是 CLIP.sel（响应式），勾选一条只重画这一条
    return {
      H,
      cls: computed(() => H.clipItemCls(props.x)),
      isImg: computed(() => props.x.kind === 'image'),
      thumb: computed(() => H.clipThumbText(props.x)),
      prev: computed(() => H.clipPrevText(props.x)),
      meta: computed(() => H.clipMetaText(props.x))
    }
  },
  template: `
  <!-- 稳定 id（步骤 14）：端到端用例要「真点击那一条」，以前写 q()[0].click()，
       DOM 顺序一变（排序、新增字段、加表头）就静默点到别的条目，断言全绿而测的不是目标。
       id 由服务端 x.id 派生，与 DOM 顺序无关；静态闸门⑳ 钉住模板里这句。 -->
  <div :id="'clipitem-'+x.id" :class="cls" @click="H.clipPick(x.id)">
    <div class="clicb"><ico n="check"/></div>
    <div class="clipbody">
      <div class="climthumb" v-if="isImg"><ico n="image"/>{{ thumb }}</div>
      <div class="cliprev" v-else>{{ prev }}</div>
      <div class="climeta">{{ meta }}</div>
    </div>
    <button class="clipdel" aria-label="删除这条" @click.stop="H.clipDel($event, x.id)"><ico n="x"/></button>
  </div>`
};

/* 底部计数条（步骤 17b 从 components/leaf.js 搬过来：它是剪贴板专属的，跟着状态走）。
   id="clipFoot" 是 CSS 与真机夹具的定位点，逐字保留。 */
export const ClipCount = {
  name: 'ClipCount',
  setup(){
    const H = inject('H');
    return {
      sel: computed(() => { var n = 0; H.clipList.forEach(function(c){ if(H.clipSel[c.id]) n++ }); return n }),
      total: computed(() => H.clipList.length)
    }
  },
  template: `
<div class="count" id="clipFoot" style="margin-bottom:var(--s2)"><b>{{ sel }}</b> 条已选<template v-if="total"> · 共 {{ total }} 条</template></div>`
}

/* 暂存页主体。挂载点 = pageSheetVue 建的 .pbody（app.js），所以模板是多根片段，
   三个根节点与遗留 clipSheet() 写进 .pbody 的三段 DOM 一一对应。
   id（#clipList / #clipFoot）逐字保留：CSS 与真机夹具都靠它们定位，改了就是静默失联。 */
export const ClipSheetView = {
  name: 'ClipSheetView',
  components: { EmptyState, ClipItem, ClipCount },
  setup(){
    const H = inject('H');
    const items = computed(() => H.clipList);
    const selCount = computed(() => H.clipList.filter(function(c){ return !!H.clipSel[c.id] }).length);
    return {
      H,
      items,
      loading: computed(() => H.clipLoading),
      err: computed(() => H.clipError),
      // 三态判定顺序与 loadClips() / clipListHTML() 一致：加载中 → 加载失败 → 空 → 列表
      // clipCount() 那句：只选一条时不带数字
      parseText: computed(() => H.clipParseText(selCount.value))
    }
  },
  template: `
<div class="cliptop">
  <button class="btn sm" id="clipSelAll" @click="H.clipSelAll(true)">全选</button>
  <button class="btn sm" id="clipSelNone" @click="H.clipSelAll(false)">全不选</button>
</div>
<div id="clipList" class="clipload">
  <template v-if="loading">加载中…</template>
  <div class="empty" v-else-if="err">加载失败</div>
  <empty-state v-else-if="!items.length" icon="inbox" title="暂存区是空的"/>
  <!-- v-else 包住 v-for（与截图页 .shotgrid v-else 同款）：loadClips 失败分支只清
       loading/error 不清 CLIP.list，裸 v-for 会在错误态下把残留旧条目一起画出来。
       真机夹具 CPERR 断言 items==0 就是被它抓的（注入 /api/clip/list 失败时
       #clipList 里能看到「加载失败」+ 残留条目并存）。 -->
  <template v-else>
    <clip-item v-for="(x,k) in items" :key="x.id" :x="x"/>
  </template>
</div>
<!-- 内联 display:block 是有意的（闸门⑲ 钉住）：这两个弹层的计数独占一行、按钮整行排在下面。
     .pfoot 默认是 flex + flex-wrap（步骤 13 为文件夹页窄屏加的），走 flex 会让计数和三个按钮挤一行。 -->
<div class="pfoot" style="display:block">
  <clip-count/>
  <!-- class="btnrow"（步骤 14）：整行允许换行、按钮不许缩到比自己的文字还窄，
       260px 面板下「原样存为笔记」不再被裁（css/components.css 的 .pfoot .btnrow）。 -->
  <div class="btnrow">
    <button class="btn" style="flex:1" id="clipDelSel" @click="H.clipDelSel()">删除所选</button>
    <button class="btn" style="flex:1.2" id="clipRaw" @click="H.clipParse(false)">原样存为笔记</button>
    <button class="btn pri" style="flex:1.2" id="clipParseBtn" @click="H.clipParse(true)">{{ parseText }}</button>
  </div>
</div>`
};

export default ClipSheetView;
