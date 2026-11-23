/* 截图暂存页 + 导入进度层（S3 步骤 8）。模式同 views/files.js：结构在模板里，叶子片段
   （图标、时间、空态）调 app.js 的 ic / esc / fmtClock / emptyState —— 两条渲染路径共用
   同一份叶子函数，VDIFF 才逐字比得过。

   三个坑，都是前面几步踩过、写在这里省得再踩：
   1) 读模块状态一律 live()（见 js/vue.js）：shotList / shotSel 是普通模块变量，
      shotSelAll 整体替换它，computed 不依赖 tick 就永远缓存 → 勾选点了没反应。
   2) 模板里用原始值 + {{ }}，不要再 esc：遗留路径是 innerHTML 拼 esc(x)，DOM 文本 =
      解码后的原值；Vue 的 {{ }} 是 textContent，传原值才等价（传 esc(x) 会双重转义）。
      唯一例外是进度层的 what：今天写的是 sub.textContent = esc(what)，DOM 文本里就是
      字面 &amp;，所以 app.js 存进 SHOTPROG.what 的已经是 esc 过的字符串（契约 (c)）。
   3) 一个元素里只放一个 {{ }}：两个插值 = 两个文本节点，VDIFF 的序列化器会 trim 每个
      文本节点再拼，「X · 已用 」+「0s」拼成「X · 已用0s」，空格丢了就比不过。

   <empty-state> 不收 :tick：EmptyState 的 props 只有 icon/title/sub，多传的 :tick 会
   透传成根元素属性（步骤 7 的真机漂移：<div class="empty" tick="27">）。 */

import { V, H, Vue, live } from '../vue.js'
import { EmptyState } from '../components.js'

const { computed } = Vue

/* 一张截图的格子。遗留字符串：
   <div class="shotitem on" onclick="shotPick('id',this)"><img src="/shotimg?id=…" alt=""
   loading="lazy"><div class="shottime">HH:MM</div><div class="shotck">ic('check')</div></div>
   class 用拼接而不是静态 class + 对象语法：Vue 合并 class 的顺序与字符串拼接不同，
   VDIFF 比的是 class 属性字符串，多一个空格或多一次重复就红（见 views/files.js 的 acard）。 */
export const ShotItem = {
  name: 'ShotItem',
  props: ['tick', 'x'],
  setup(props){
    return {
      H,
      cls: live(() => 'shotitem' + (H.shotSel[props.x.id] ? ' on' : '')),
      src: live(() => '/shotimg?id=' + encodeURIComponent(props.x.id)),
      clock: live(() => H.fmtClock(props.x.dateAdded || 0))
    }
  },
  template: `
  <div :class="cls" @click="H.shotPick(x.id)">
    <img :src="src" alt="" loading="lazy">
    <div class="shottime">{{ clock }}</div>
    <div class="shotck" v-html="H.ic('check')"></div>
  </div>`
};

/* 暂存页主体。挂载点 = pageSheetVue 建的 .pbody（app.js），所以模板是多根片段，
   三个根节点与遗留 shotSheet() 写进 .pbody 的三段 DOM 一一对应。
   id（#shotGrid / #shotFoot / #shotGo / #shotSplit / #shotRaw）逐字保留：
   真机夹具和 CSS 都靠它们定位，改了就是静默失联。 */
export const ShotsView = {
  name: 'ShotsView',
  components: { EmptyState, ShotItem },
  setup(){
    const tick = computed(() => V.tick);
    const items = live(() => H.shotList);
    const selCount = live(() => H.shotList.filter(function(x){ return !!H.shotSel[x.id] }).length);
    return {
      tick, items,
      loading: live(() => H.shotLoading),
      err: live(() => H.shotError),
      // 三态判定顺序与 loadShots() 一致：加载中 → 加载失败 → 空 → 网格。
      // 计数条单独一套：加载中时遗留路径写的是「已选 0 张」纯文本，loadShots() 完成后
      // 才换成 <b>N</b> 张已选 · 共 M 张 —— 首屏就照这个来，别提前显示 <b> 版。
      countHtml: live(() => H.shotLoading
        ? '已选 0 张'
        : '<b>' + selCount.value + '</b> 张已选 · 共 ' + H.shotList.length + ' 张'),
      // syncShotBtns(n)：只有一张时「合并成一条」和「各存一条」是同一件事，只留一个按钮。
      one: live(() => selCount.value <= 1),
      goText: live(() => selCount.value <= 1 ? '创建笔记' : '合并成一条笔记'),
      goStyle: live(() => 'flex:' + (selCount.value <= 1 ? '1' : '1.6')),
      subStyle: live(() => selCount.value <= 1 ? 'flex:1;display:none' : 'flex:1')
    }
  },
  template: `
<div class="cliptop">
  <button class="btn sm" @click="H.shotSelAll(true)">全选</button>
  <button class="btn sm" @click="H.shotSelAll(false)">全不选</button>
  <div class="sp"></div>
  <button class="btn sm dg" @click="H.shotIgnoreSel()">忽略所选</button>
</div>
<div id="shotGrid" class="clipload">
  <template v-if="loading">加载中…</template>
  <div class="empty" v-else-if="err">加载失败</div>
  <empty-state v-else-if="!items.length" icon="image" title="没有待整理的截图" sub="新截图出现时会先在这里排队"/>
  <div class="shotgrid" v-else>
    <shot-item v-for="(x,k) in items" :key="x.id" :x="x" :tick="tick"/>
  </div>
</div>
<div class="pfoot" style="display:block">
  <div class="count" id="shotFoot" style="margin-bottom:8px" v-html="countHtml"></div>
  <div style="display:flex;gap:8px">
    <button class="btn pri" id="shotGo" :style="goStyle" @click="H.doImportShots('merge')">{{ goText }}</button>
    <button class="btn" id="shotSplit" :style="subStyle" @click="H.doImportShots('split')">各存一条</button>
    <button class="btn" id="shotRaw" :style="subStyle" @click="H.doImportShots('raw')">原样存</button>
  </div>
</div>`
};

/* 导入进度层（步骤 8 契约 (c)）：状态在 app.js 的 SHOTPROG（Vue.reactive），因为
   shotOvlSub 是 Java 侧回调写的全局函数，状态放组件里 Java 写不到。组件是纯渲染器。
   容器由 app.js 挂在 body 级：closeSheet() 会换掉 .panel 的 innerHTML，而进度层要在
   弹层关掉之后继续活着（shotsImported → AI 解析全部完成才收）。 */
export const ShotProgress = {
  name: 'ShotProgress',
  props: ['tick'],
  setup(){
    return {
      P: live(() => H.SHOTPROG),
      warn: H.ic('alert') + '请保持屏幕常亮：不要锁屏、不要让手机黑屏，'
        + '也不要退出 App 或切到别的应用，否则解析会中断。'
    }
  },
  template: `
<div class="ovl" id="shotOvl" v-if="P.on">
  <div class="ovlcard">
    <div class="orw"></div>
    <b>{{ '正在处理 ' + P.total + ' 张截图' }}</b>
    <div class="osub" id="shotOvlSub">{{ P.what + ' · 已用 ' + P.secs + 's' }}</div>
    <div class="owarn" v-html="warn"></div>
    <div style="font-size:11px;color:var(--dim2);margin-top:10px">完成后会自动回到列表，不用一直盯着</div>
  </div>
</div>`
};

export default ShotsView;
