/* 外壳视图（S3 步骤 15）：顶栏 / 底栏+fab / 弹层宿主 / 对话框 / toast 转 Vue。

   这是 P13 的最后一块手工区：步骤 5-11 把四个 tab 与四个弹层迁进 Vue 之后，界面上剩下的
   手工代码全在这里曾经的样子 —— index.html 里的静态标记 + app.js 里的命令式 DOM 操作
   （toast 写 innerHTML、开弹层 classList.add('on')、切页签换 fab 图标、对话框逐字段
   textContent）。这类代码的失效方式是「状态与 DOM 各改各的」：切页签时忘了同步 fab、
   关弹层时忘了拆 Vue 实例，都是 P12 那一类「点了没反应」。

   五条骨架与视图层一致（见 views/notes.js 顶部）：
   1. 组件不持有数据，只读 shell 这张 reactive 表；app.js 是唯一的写入方。
   2. 外壳读的是 reactive 状态，不是 V.tick —— 这是数据层响应式的第一块落地：
      toast/对话框/弹层的开关从此是「改一个布尔，DOM 自己跟上」，不需要 tick。
   3. 事件用 @click="H.xxx(...)"，函数名必须 ⊆ app.js 的 setHost（闸门⑮）。
   4. 产出的 DOM 与迁移前逐字相同：id、class、元素顺序、内联 style 全部保持
      （闸门⑥ 钉 class、test.sh 用 #toast/#dlg/#sheet/#panel/#q/#fab 这些 id 定位）。
   5. 挂载点分两类：
      - 在流内的（.topbar 是 sticky、.tabbar 是 fixed）挂在**原元素上**，只渲染它的内容。
        包一层 div 会让 sticky 的包含块变成那层 div，顶栏会跟着内容一起滚走。
      - 浮层（.sheet 是 position:fixed）挂在 body 级的 *Root 容器里，
        这样 :class="{on:…}" 能落在真正带样式的那个元素上（Vue 的模板根元素是挂载点的
        子节点，绑不到挂载点自身）。步骤 18b/18c 起 #toast 与 #dlg 是 Vant 的 popup：
        显隐走 v-model:show，定位与 z-index 由 van-popup 自带，*Root 只剩挂载作用。

   顶栏的显隐（我的页不显示顶栏）走 body[data-tab] + CSS，不走 JS 写 style：
   它是「当前在哪个页签」这个状态的纯函数，写在 CSS 里比写在 JS 里少一处会漏同步的地方。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，所以全量名单写在下面这行：
   components: { Ico, ShotProgress } */

import { Vue, withHost, hostFor } from './vue.js'
import { Ico } from './components/leaf.js'
import { ShotProgress } from './views/shots.js'

const { reactive, createApp, inject } = Vue

/* 外壳状态：app.js 是唯一写入方，组件只读。
   初值 = 迁移前 index.html 静态标记渲染出来的样子，首屏不闪。 */
export const shell = reactive({
  tab: 'notes',
  /* 右上角状态点：'' = 正常，'bad' = 服务/OCR 未就绪（app.js paintStatus 写） */
  dot: '',
  /* 搜索框：q 是输入框里的原文（v-model，未 trim），has 控制清除按钮显隐。
     真发给服务端的 q 在 app.js 里，是 q.trim()。 */
  q: '',
  has: false,
  placeholder: '搜索笔记与待办',
  /* 各页签的浮动操作图标及无障碍名称。 */
  fab: { icon: 'mic', label: '记一笔' },
  /* 页签指示条：moveInd() 量完活动页签的几何写进来（DOM 测量只能读真实布局） */
  ind: { w: 0, x: 0 },
  sheet: {
    on: false,
    /* 步骤 18d：节点在不在（v-if）。on 是「看得见」，mounted 是「节点存在」——
       关掉时先 on=false 播收场动画，动画跑完才 mounted=false 摘节点（app.js closeSheet） */
    mounted: false,
    /* page: true = 全屏页形态（.phead + .pbody），false = 底部卡片形态（.grip + .pclose）
       kind: #panel 的 data-kind（CSS 钩子，见 SheetHost 注释），空 = 不写这个属性
       步骤 16c：内容只剩 Vue 挂载一条路，mode:'html' 与 html 字段随六个字符串弹层一起删掉。 */
    page: false, full: false, title: '', kind: ''
  },
  toast: { on: false, msg: '' },
  dlg: { on: false, title: '', body: '', ok: '确定', cancel: '取消', danger: false, noCancel: false }
});

function mount(id, def){
  const el = document.getElementById(id);
  if(!el) return null;
  const app = createApp(def);
  app.config.productionTip = false;
  app.config.devtools = false;
  withHost(app, hostFor('shell:' + id));   // 步骤 17k 提供、17m 收窄：外壳树（含 <teleport> 里的进度层）的 H 都从这里 inject
  app.mount(el);
  return app;
}

/* 顶栏：品牌按钮（→ 我的页）、搜索框、剪贴板入口、排序筛选入口。
   图标是 sprite 引用（index.html 的 <svg class="defs">），<use href="#i-x"> 在模板里
   与在静态 HTML 里等价：sprite 不在本组件的子树里也能解析。 */
export const TopBar = {
  name: 'TopBar',
  setup(){ const H = inject('H'); return { H, s: shell } },
  template: `
<button class="iconbtn" id="brandBtn" aria-label="我的" @click="H.brandGo()"><img class="brand" src="/icon.png" alt=""><span class="dot" :class="{bad: s.dot==='bad'}" id="dot"></span></button>
<div class="search" id="searchBox" :class="{has: s.has}">
  <span class="sico"><svg class="ic"><use href="#i-search"/></svg></span>
  <input id="q" type="search" :placeholder="s.placeholder" autocomplete="off" v-model="s.q" @input="H.searchInput(s.q)">
  <button class="sclr" id="qClear" aria-label="清除" @click="H.searchClear()"><svg class="ic s"><use href="#i-x"/></svg></button>
</div>
<button class="iconbtn" id="clipBtn" aria-label="从剪贴板导入" @click="H.importClip()"><svg class="ic l"><use href="#i-clipboard"/></svg></button>
<button class="iconbtn" id="sortBtn" aria-label="排序与筛选" @click="H.sortSheet()"><svg class="ic l"><use href="#i-sort"/></svg></button>
`
}

/* 底栏只包含四个页签和指示条。 */
export const TabBar = {
  name: 'TabBar',
  setup(){ const H = inject('H'); return { H, s: shell } },
  template: `
<span class="ind" id="ind" :style="{width: s.ind.w+'px', transform: 'translateX(' + s.ind.x + 'px)'}"></span>
<button class="tab" :class="{on: s.tab==='notes'}" data-tab="notes" @click="H.tabPick('notes')"><span class="ti"><svg class="ic"><use href="#i-note"/></svg></span><em>笔记</em></button>
<button class="tab" :class="{on: s.tab==='todos'}" data-tab="todos" @click="H.tabPick('todos')"><span class="ti"><svg class="ic"><use href="#i-check-square"/></svg></span><em>待办</em></button>
<button class="tab" :class="{on: s.tab==='files'}" data-tab="files" @click="H.tabPick('files')"><span class="ti"><svg class="ic"><use href="#i-clip"/></svg></span><em>附件</em></button>
<button class="tab" :class="{on: s.tab==='mine'}" data-tab="mine" @click="H.tabPick('mine')"><span class="ti"><svg class="ic"><use href="#i-user"/></svg></span><em>我的</em></button>
`
}

export const FloatingAction = {
  name: 'FloatingAction',
  components: { Ico },
  setup(){ const H = inject('H'); return { H, s: shell } },
  template: `
<button type="button" class="fab vrec" id="fab" :class="{hide: s.sheet.mounted}"
        :aria-label="s.fab.label" :aria-hidden="s.sheet.mounted ? 'true' : null"
        :tabindex="s.sheet.mounted ? -1 : 0"
        @pointerdown="H.fabHold($event)" @click="H.fabAct($event)" @contextmenu.prevent>
  <ico :n="s.fab.icon"/>
</button>
`
}

/* 弹层宿主（步骤 18d：外壳换成 Vant 的 van-popup）：遮罩 + 面板。
   面板有两种形态，与迁移前一致：
   - page 形态（全屏页）：.panel.page = .phead（返回按钮 + 标题）+ .pbody
   - 卡片形态（底部弹出）：.panel = .grip + .pclose + 内容
   内容都交给弹层视图挂载（#sheetBody 是它的容器，也是夹具锚点）：步骤 16c 之后
   字符串内容那条路（mode='html'）已经没有了，六个字符串弹层全成了 VUE_SHEETS 里的组件。
   卡片形态的内容比迁移前多出 #sheetBody 这一层包装，CSS 里唯一受影响的子选择器
   `.sheet .panel>h2` 已补上 `#sheetBody>h2`（见 css/components.css）。
   两个 .panel 分支各带 id="panel"：v-if/v-else 同时只渲染一个，id 不会重复。

   换成 van-popup 之后分工变了：定位（fixed 贴底、宽 100%）、遮罩、滚动锁定、z-index
   分层归 Vant，`.sheet` 只剩「让 .panel 在宽屏上居中」和面板自己的样式（见 css/base.css）。
   类名契约一个没动：#sheet 上的 .on / .page、#panel、#sheetBody、.grip、.pclose 全在，
   test.sh 的 8 处 `#sheet.on` 选择器与闸门⑥ 的 .sheet 都照旧。

   显隐是 v-if + :show="true"（同 18b/18c，理由见下面 DialogHost 的注释：Vue 的
   <Transition> 靠双 requestAnimationFrame 排程，不可见窗口上永不结束）。代价与对话框一样：
   节点随开合创建/销毁，且没有 leave 阶段 —— 收场动画（面板下滑 + 遮罩淡出）改由
   .closing 类 + app.js closeSheet 的定时器驱动：on=false 先挂 .closing 播动画，
   动画时长（--d1，从样式表读）跑完才把 mounted 置 false 摘掉节点。
   摘节点时 van-popup 的 @vue:unmounted → H.sheetLeft 拆掉弹层内容的 app（闸门⑱）。 */
export const SheetHost = {
  name: 'SheetHost',
  components: { ShotProgress },
  setup(){ return { H: inject('H'), s: shell } },
  template: `
<van-popup v-if="s.sheet.mounted" id="sheet" :show="true" position="bottom"
           :class="['sheet', s.sheet.on ? 'on' : 'closing', s.sheet.page ? 'page' : '']"
           :overlay-class="s.sheet.on ? 'sheet-ovl' : 'sheet-ovl sheet-closing'"
           :close-on-click-overlay="true" @click-overlay="H.closeSheet()"
           @vue:unmounted="H.sheetLeft">
  <!-- 收场动画：.closing 挂在 #sheet 上（app.js closeSheet 的定时器决定它挂多久），
       面板下滑 + 遮罩淡出的规则在 css/components.css，关键帧与时长沿用迁移前的
       down / --d1，像素与动效零变化。入场动画是 .sheet .panel{animation:up}，
       节点新建就自己跑，不需要任何 JS 参与。 -->
  <!-- data-kind 是 CSS 钩子（css/views/settings.css 靠它定位设置页）。步骤 15 之前面板是
       index.html 里的常驻元素，调用方直接写 #panel.dataset.kind 就行；现在面板随弹层开合被
       创建/销毁，钩子必须进状态，否则设置页样式全丢（真机验收抓到）。空串时不写这个属性。 -->
  <div class="panel page" id="panel" :data-kind="s.sheet.kind || null" v-if="s.sheet.page">
    <div class="phead"><button class="iconbtn" aria-label="返回" @click="H.closeSheet()"><svg class="ic"><use href="#i-chev"/></svg></button><div style="flex:1">{{ s.sheet.title }}</div></div>
    <div class="pbody" id="sheetBody"></div>
  </div>
  <div class="panel" id="panel" v-else :class="{full: s.sheet.full}" :data-kind="s.sheet.kind || null"><div class="grip"></div><button class="pclose" @click="H.closeSheet()" aria-label="关闭">✕</button><div id="sheetBody"></div></div>
</van-popup>
<!-- 步骤 17j：截图导入进度层从「app.js 里另起一个 Vue app 挂进 #shotOvlRoot」改成
     外壳组件里的 <teleport>。它要活过弹层（shotsImported 之后 AI 解析还在跑，
     closeSheet 已经发生），以前靠的是「不在 .panel 里」这个物理位置，代价是
     unmountAllSheets 要带一个 ['progress'] 例外名单、shotOverlay 要手动 mount/unmount
     一个 app、VUE_SHEETS 要给它留个位子。现在它是外壳树里的普通子组件：
     弹层的开合与它无关，teleport 把 DOM 依旧送到 body 级的 #shotOvlRoot（层叠与
     位置零变化），开关由 SHOTPROG.on 上的 v-if 管。 -->
<teleport to="#shotOvlRoot"><shot-progress/></teleport>
`
}

/* 自绘对话框：原生 confirm/alert 会显示“网址为 http://127.0.0.1 的网页显示：”。
   Java 的 onJsAlert/onJsConfirm 也转发到这里（app.js window.uiDialog）。
   按钮顺序 No 在左 Yes 在右，与迁移前一致；noCancel 用 v-show（迁移前是 style.display）。

   步骤 18c：外壳换成 van-dialog（遮罩、居中、入场动画、滚动锁定、z-index 分层交给 Vant），
   标题/正文/按钮三个区走它的 title / default / footer 三个插槽，元素 id、类名、按钮文案
   一个没动（test.sh 用 #dlgYes/#dlgNo 点按钮，闸门 ⑥ 钉着 .dacts .btn）。
   两个 prop 是有讲究的：
     :show-confirm-button="false" + :show-cancel-button="false" —— 不用 Vant 那对平铺文字按钮，
       footer 插槽里是我们自己的 .btn（Vant 的 footer 插槽无条件渲染，不受这两个开关影响）；
     :close-on-click-overlay="true" —— van-dialog 这个 prop 默认 false，旧版点遮罩是取消的
       （@click.self），不显式打开就少一条退出路径；点遮罩走 click-overlay → dlgCancel，
       回调照旧跑（Vant 自己只把 show 置 false，不会调 onCancel）。

   显隐用 v-if + :show="true"，不用 v-model:show。原因：van-popup 的显隐是 Vue 的
   <Transition> 驱动的，而 Vue 的 enter/leave 都在 nextFrame（双 requestAnimationFrame）里
   起跳。Chrome 不给「不可见窗口」出帧，rAF 就不跑，于是 enter-from 类永不摘除（对话框永久
   opacity:0）、leave 永不结束（点取消关不掉、遮罩留在屏上）。虚拟屏（测试用的 VD）必踩，
   息屏时后台弹出的对话框是同一类场景。v-if 让「对话框在不在」退回成状态的纯函数：
   创建即可见、销毁即消失，动画只剩我们自己的 pop 关键帧（合成器驱动，不经过 Vue）。
   代价：节点随开合创建/销毁，静息态没有 #dlg —— __enote.dom.dlg 的测缝契约因此改成
   「先弹一个再读」，与步骤 17i 的 #sheet、18b 的 #toast 完全同构。 */
export const DialogHost = {
  name: 'DialogHost',
  setup(){ const H = inject('H'); return { H, s: shell } },
  template: `
<van-dialog v-if="s.dlg.on" id="dlg" class="enote-dialog" :show="true"
            :show-confirm-button="false" :show-cancel-button="false"
            :close-on-click-overlay="true" @click-overlay="H.dlgCancel()">
  <template #title><h3 id="dlgT">{{ s.dlg.title }}</h3></template>
  <div class="dbody" id="dlgB">{{ s.dlg.body }}</div>
  <template #footer>
    <div class="dacts">
      <button class="btn" id="dlgNo" v-show="!s.dlg.noCancel" @click="H.dlgCancel()">{{ s.dlg.cancel }}</button>
      <button class="btn" id="dlgYes" :class="s.dlg.danger ? 'dg' : 'pri'" @click="H.dlgOk()">{{ s.dlg.ok }}</button>
    </div>
  </template>
</van-dialog>
`
}

/* 轻提示（步骤 18b）：外壳换成 Vant 的 van-toast。
   行为依旧在 app.js toast() 里（2.2s 自动收起、重复调用续期）—— 这里 `:duration="0"`
   让 Vant 不管自动收起，视图与行为的分工与 18a 之前一致（Vant 自己的定时器会在
   message 变化时重启，语义相同，但定时器是行为不是视图，不搬过去）。
   `id="toast"` 落在 van-toast 根节点上（Vant 不拦 attrs），test.sh 与 __enote.dom.toast 照旧。
   像素变化（用户已批准）：去掉信息图标（那是我们自己的 sprite，Vant 的 icon prop 走它自带的
   图标字体）、圆角从 pill 收到 8px、阴影去掉。
   显隐同样用 v-if + :show="true"（理由见上面 DialogHost 的注释：Vue 的 <Transition> 靠 rAF
   排程，不可见窗口上永不结束），入场动画由 .enote-toast 上的 pop 关键帧提供，与迁移前一致。
   节点随开合创建/销毁，静息态没有 #toast —— 测缝契约改成「先弹一条再读」，见 test.sh。 */
export const ToastHost = {
  name: 'ToastHost',
  setup(){ return { s: shell } },
  template: `
<van-toast v-if="s.toast.on" id="toast" class="enote-toast" :show="true" :duration="0"
           position="bottom" :message="s.toast.msg"></van-toast>
`
}

/* 外壳应用必须在首次 render() 之前挂载：app.js 的 __enote.dom 与所有
   toast/dialog/sheet 调用点都假定这些节点已经存在。 */
export function mountShell(){
  return {
    topbar: mount('topbar', TopBar),
    tabbar: mount('tabbar', TabBar),
    fabRoot: mount('fabRoot', FloatingAction),
    sheet: mount('sheetRoot', SheetHost),
    dlg: mount('dlgRoot', DialogHost),
    toast: mount('toastRoot', ToastHost)
  }
}
