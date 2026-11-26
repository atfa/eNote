/* 截图暂存页 + 导入进度层（S3 步骤 8）。模式同 views/files.js：结构在模板里，叶子片段
   （图标、时间、空态）调 app.js 的 ic / esc / fmtClock / emptyState —— 两条渲染路径共用
   同一份叶子函数，VDIFF 才逐字比得过。

   三个坑，都是前面几步踩过、写在这里省得再踩：
   1) 读模块状态一律 computed()（见 js/vue.js）：shotList / shotSel 自步骤 17e 起是 reactive
      的，shotSelAll 整包赋值让读它们的 computed 失效 → 勾选立刻有反应。
   2) 模板里用原始值 + {{ }}，不要再 esc：遗留路径是 innerHTML 拼 esc(x)，DOM 文本 =
      解码后的原值；Vue 的 {{ }} 是 textContent，传原值才等价（传 esc(x) 会双重转义）。
      唯一例外是进度层的 what：今天写的是 sub.textContent = esc(what)，DOM 文本里就是
      字面 &amp;，所以 app.js 存进 SHOTPROG.what 的已经是 esc 过的字符串（契约 (c)）。
   3) 一个元素里只放一个 {{ }}：两个插值 = 两个文本节点，VDIFF 的序列化器会 trim 每个
      文本节点再拼，「X · 已用 」+「0s」拼成「X · 已用0s」，空格丢了就比不过。

   步骤 17l 之前这里还有一条「<empty-state> 不许收 :tick」（多传的 :tick 会透传成根元素
   属性，步骤 7 的真机漂移：<div class="empty" tick="27">）；tick prop 管道整条删掉后没了。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，所以全量名单写在下面这行：
   components: { EmptyState, ShotItem, Ico, ShotProgress } */

import { Vue } from '../vue.js'
import { EmptyState } from '../components.js'
import { Ico } from '../components/leaf.js'

const { computed, inject } = Vue

/* 一张截图的格子。遗留字符串：
   <div class="shotitem on" onclick="shotPick('id',this)"><img src="/shotimg?id=…" alt=""
   loading="lazy"><div class="shottime">HH:MM</div><div class="shotck">ic('check')</div></div>
   class 用拼接而不是静态 class + 对象语法：Vue 合并 class 的顺序与字符串拼接不同，
   VDIFF 比的是 class 属性字符串，多一个空格或多一次重复就红（见 views/files.js 的 acard）。 */
export const ShotItem = {
  name: 'ShotItem',
  components: { Ico },
  props: ['x'],
  setup(props){
    const H = inject('H');
    return {
      H,
      cls: computed(() => 'shotitem' + (H.shotSel[props.x.id] ? ' on' : '')),
      src: computed(() => '/shotimg?id=' + encodeURIComponent(props.x.id)),
      clock: computed(() => H.fmtClock(props.x.dateAdded || 0))
    }
  },
  template: `
  <!-- 稳定 id（步骤 14，同 clip.js 的 ClipItem）：截图页用例也靠它定位那一条。 -->
  <div :id="'shotitem-'+x.id" :class="cls" @click="H.shotPick(x.id)">
    <img :src="src" alt="" loading="lazy">
    <div class="shottime">{{ clock }}</div>
    <div class="shotck"><ico n="check"/></div>
  </div>`
};

/* 暂存页主体。挂载点 = pageSheetVue 建的 .pbody（app.js），所以模板是多根片段，
   三个根节点与遗留 shotSheet() 写进 .pbody 的三段 DOM 一一对应。
   id（#shotGrid / #shotFoot / #shotGo / #shotSplit / #shotRaw）逐字保留：
   真机夹具和 CSS 都靠它们定位，改了就是静默失联。 */
export const ShotsView = {
  name: 'ShotsView',
  components: { EmptyState, ShotItem, Ico },
  setup(){
    const H = inject('H');
    const items = computed(() => H.shotList);
    const selCount = computed(() => H.shotList.filter(function(x){ return !!H.shotSel[x.id] }).length);
    return {
      // 模板里写 H.xxx 的组件必须把 H 返回出去：模板表达式编译成 _ctx.H.xxx(...)，
      // setup 没返回 H 时，渲染期不碰它就不报错，点一下才抛
      // 「Cannot read properties of undefined (reading 'shotSelAll')」 —— 症状是按钮点了没反应。
      // 实测：全选 就是这么静默死掉的（步骤 8，被「截图页交互」用例抓到）。
      H,
      items,
      loading: computed(() => H.shotLoading),
      err: computed(() => H.shotError),
      // 三态判定顺序与 loadShots() 一致：加载中 → 加载失败 → 空 → 网格。
      // 计数条单独一套：加载中时遗留路径写的是「已选 0 张」纯文本，loadShots() 完成后
      // 才换成 <b>N</b> 张已选 · 共 M 张 —— 首屏就照这个来，别提前显示 <b> 版。
      // 步骤 16b：原来是整条字符串 v-html，现在结构在模板里（#shotFoot 这个 id 是
      // test.sh 夹具与 CSS 的定位点，不能动）。
      sel: selCount,
      total: computed(() => H.shotList.length),
      /* 只有一张时「合并成一条」和「各存一条」是同一件事，只留一个按钮（用户反馈）。
         这条规则以前是 app.js 的 syncShotBtns(n) 命令式改 DOM，步骤 22 删了它，
         规则住在这里：one / goText / goStyle 三个 computed。 */
      one: computed(() => selCount.value <= 1),
      goText: computed(() => selCount.value <= 1 ? '创建笔记' : '合并成一条笔记'),
      goStyle: computed(() => 'flex:' + (selCount.value <= 1 ? '1' : '1.6')),
      subStyle: computed(() => selCount.value <= 1 ? 'flex:1;display:none' : 'flex:1')
    }
  },
  template: `
<div class="cliptop">
  <button class="btn sm" id="shotSelAll" @click="H.shotSelAll(true)">全选</button>
  <button class="btn sm" id="shotSelNone" @click="H.shotSelAll(false)">全不选</button>
  <div class="sp"></div>
  <button class="btn sm dg" @click="H.shotIgnoreSel()">忽略所选</button>
</div>
<div id="shotGrid" class="clipload">
  <template v-if="loading">加载中…</template>
  <div class="empty" v-else-if="err">加载失败</div>
  <empty-state v-else-if="!items.length" icon="image" title="没有待整理的截图" sub="新截图出现时会先在这里排队"/>
  <div class="shotgrid" v-else>
    <shot-item v-for="(x,k) in items" :key="x.id" :x="x"/>
  </div>
</div>
<!-- 内联 display:block 是有意的（闸门⑲ 钉住）：这两个弹层的计数独占一行、按钮整行排在下面。
     .pfoot 默认是 flex + flex-wrap（步骤 13 为文件夹页窄屏加的），走 flex 会让计数和三个按钮挤一行。 -->
<div class="pfoot" style="display:block">
  <div class="count" id="shotFoot" style="margin-bottom:var(--s2)"><template v-if="loading">已选 0 张</template><template v-else><b>{{ sel }}</b> 张已选 · 共 {{ total }} 张</template></div>
  <!-- class="btnrow"（步骤 14）：与 clip 弹层同一套做法，260px 面板下按钮文字不裁。 -->
  <div class="btnrow">
    <button class="btn pri" id="shotGo" :style="goStyle" @click="H.doImportShots('merge')">{{ goText }}</button>
    <button class="btn" id="shotSplit" :style="subStyle" @click="H.doImportShots('split')">各存一条</button>
    <button class="btn" id="shotRaw" :style="subStyle" @click="H.doImportShots('raw')">原样存</button>
  </div>
</div>`
};

/* 导入进度层（步骤 8 契约 (c)）：状态在 app.js 的 SHOTPROG（Vue.reactive），因为
   shotOvlSub 是 Java 侧回调写的全局函数，状态放组件里 Java 写不到。组件是纯渲染器。
   步骤 17j：宿主从「app.js 另起一个 Vue app 挂进 body 级 #shotOvlRoot」改成外壳组件
   SheetHost 里的 <teleport to="#shotOvlRoot">：DOM 落点与层叠零变化，但进度层从此
   常驻外壳树，弹层开合与它无关（unmountAllSheets 的 ['progress'] 例外名单因此没掉）。 */
export const ShotProgress = {
  name: 'ShotProgress',
  // 每个组件自己声明 components：闸门⑮ 的注册表是「每个文件一份」（写在文件头注释里），
  // Vue 运行时认的却是组件自己的 components 选项。步骤 16d 给进度层加 <ico> 时就是撞在
  // 这个缝上：静态全绿，真机上渲染出一个 <ico> 裸元素（Vue 只 warn 不报错）。闸门㉔ 钉住它。
  components: { Ico },
  setup(){
    const H = inject('H');
    return {
      H,
      /* 返回容器本身是陷阱：SHOTPROG 是逐键改的（secs 每秒 +1），computed 每次返回同一个
         proxy → Vue 判定「值没变」不重渲染，秒表会冻在第一个数。返回快照。 */
      P: computed(() => ({ ...H.SHOTPROG }))
    }
  },
  template: `
<div class="ovl" id="shotOvl" v-if="P.on">
  <div class="ovlcard">
    <div class="orw"></div>
    <div class="otx">
      <b>{{ '正在处理 ' + P.total + ' 张截图' }}</b>
      <div class="osub" id="shotOvlSub">{{ P.what + ' · 已用 ' + P.secs + 's' }}</div>
      <div class="owarn"><ico n="alert"/>请保持屏幕常亮：不要锁屏、不要让手机黑屏，也不要退出 App 或切到别的应用，否则解析会中断。</div>
      <div style="font-size:var(--fs-xs);color:var(--dim2);margin-top:var(--s1)">完成后会自动回到列表，不用一直盯着</div>
    </div>
  </div>
</div>`
};

export default ShotsView;
