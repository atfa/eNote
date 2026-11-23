/* 剪贴板暂存页（S3 步骤 9）。模式同 views/shots.js：结构在模板里，叶子片段（图标、预览、
   时间）调 app.js 的 clipPrevText / clipThumbText / clipMetaText / clipCountHTML ——
   两条渲染路径共用同一批叶子函数，VDIFF 才逐字比得过。

   前面几步踩过、写在这里省得再踩的坑：
   1) 读模块状态一律 live()：clipList / clipSel 是普通模块变量，loadClips() 与 clipParse()
      整体替换它们，computed 不依赖 tick 就永远缓存 → 勾选点了没反应。
   2) 模板里用原始值 + {{ }}，不要再 esc：遗留路径是 innerHTML 拼 esc(x)，DOM 文本 =
      解码后的原值；Vue 的 {{ }} 是 textContent，传原值才等价（传 esc(x) 会双重转义）。
      图标那一段是 HTML，所以走 v-html，并且必须与遗留拼的是同一个字符串（一个文本节点）。
   3) 一个元素里只放一个 {{ }}：两个插值 = 两个文本节点，VDIFF 的序列化器会 trim 每个
      文本节点再拼，「app」+「 · 」+「刚刚」拼出来丢空格就红。
   4) 模板里用 H.xxx 的组件必须在 setup() 返回里暴露 H（步骤 8 的教训：模板编成
      _ctx.H.xxx(...)，没暴露时渲染期不碰它就静默过，点一下才抛 undefined）。

   与遗留路径的**有意**差异（别当 bug 改回去）：遗留 clipPick / clipSelAll 会顺手给
   .clicb 也加一个 on 类，而 CSS 里没有任何 .clicb.on 规则（勾选态由 .clipitem.on .clicb
   驱动），那是一次空操作；本步骤把遗留侧那次 toggle 删掉，两条路径都只动 .clipitem。 */
import { V, H, Vue, live } from '../vue.js'
import { EmptyState } from '../components.js'

const { computed } = Vue

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
  props: ['tick', 'x'],
  setup(props){
    return {
      H,
      cls: live(() => H.clipItemCls(props.x)),
      isImg: live(() => props.x.kind === 'image'),
      thumb: live(() => H.clipThumbText(props.x)),
      prev: live(() => H.clipPrevText(props.x)),
      meta: live(() => H.clipMetaText(props.x))
    }
  },
  template: `
  <div :class="cls" @click="H.clipPick(x.id)">
    <div class="clicb" v-html="H.ic('check')"></div>
    <div class="clipbody">
      <div class="climthumb" v-if="isImg" v-html="H.ic('image')+thumb"></div>
      <div class="cliprev" v-else>{{ prev }}</div>
      <div class="climeta">{{ meta }}</div>
    </div>
    <button class="clipdel" aria-label="删除这条" @click.stop="H.clipDel($event, x.id)" v-html="H.ic('x')"></button>
  </div>`
};

/* 暂存页主体。挂载点 = pageSheetVue 建的 .pbody（app.js），所以模板是多根片段，
   三个根节点与遗留 clipSheet() 写进 .pbody 的三段 DOM 一一对应。
   id（#clipList / #clipFoot）逐字保留：CSS 与真机夹具都靠它们定位，改了就是静默失联。 */
export const ClipSheetView = {
  name: 'ClipSheetView',
  components: { EmptyState, ClipItem },
  setup(){
    const tick = computed(() => V.tick);
    const items = live(() => H.clipList);
    const selCount = live(() => H.clipList.filter(function(c){ return !!H.clipSel[c.id] }).length);
    return {
      H,
      tick, items,
      loading: live(() => H.clipLoading),
      err: live(() => H.clipError),
      // 三态判定顺序与 loadClips() / clipListHTML() 一致：加载中 → 加载失败 → 空 → 列表
      countHtml: live(() => H.clipCountHTML()),
      // clipCount() 那句：只选一条时不带数字
      parseText: live(() => H.clipParseText(selCount.value))
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
  <clip-item v-for="(x,k) in items" :key="x.id" :x="x" :tick="tick"/>
</div>
<div class="pfoot" style="display:block">
  <div class="count" id="clipFoot" style="margin-bottom:8px" v-html="countHtml"></div>
  <div style="display:flex;gap:8px">
    <button class="btn" style="flex:1" id="clipDelSel" @click="H.clipDelSel()">删除所选</button>
    <button class="btn" style="flex:1.2" id="clipRaw" @click="H.clipParse(false)">原样存为笔记</button>
    <button class="btn pri" style="flex:1.2" id="clipParseBtn" @click="H.clipParse(true)">{{ parseText }}</button>
  </div>
</div>`
};

export default ClipSheetView;
