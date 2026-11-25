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
      - 浮层（.sheet/.dlg/#toast 都是 position:fixed）挂在 body 级的 *Root 容器里，
        这样 :class="{on:…}" 能落在真正带样式的那个元素上（Vue 的模板根元素是挂载点的
        子节点，绑不到挂载点自身）。

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
  /* fab：icon 是图标名（'plus' / 'clip'），SVG 由 <ico> 组件画（步骤 16d 之前这里存的是
     ic('plus','l') 那串字符串，靠 v-html 直插）。初值 = 笔记页的「记一笔」。 */
  fab: { icon: 'plus', label: '记一笔', hidden: false },
  /* 页签指示条：moveInd() 量完活动页签的几何写进来（DOM 测量只能读真实布局） */
  ind: { w: 0, x: 0 },
  sheet: {
    on: false,
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

/* 底栏：四个页签 + 中间的大按钮（fab）+ 顶部指示条。
   元素顺序与迁移前逐字相同（notes、todos、fab、files、mine）：fab 夹在中间是布局的一部分。 */
export const TabBar = {
  name: 'TabBar',
  components: { Ico },
  setup(){ const H = inject('H'); return { H, s: shell } },
  template: `
<span class="ind" id="ind" :style="{width: s.ind.w+'px', transform: 'translateX(' + s.ind.x + 'px)'}"></span>
<button class="tab" :class="{on: s.tab==='notes'}" data-tab="notes" @click="H.tabPick('notes')"><span class="ti"><svg class="ic"><use href="#i-note"/></svg></span><em>笔记</em></button>
<button class="tab" :class="{on: s.tab==='todos'}" data-tab="todos" @click="H.tabPick('todos')"><span class="ti"><svg class="ic"><use href="#i-check-square"/></svg></span><em>待办</em></button>
<button class="fab" id="fab" :class="{hide: s.fab.hidden}" @click="H.fabAct()"><span class="fico"><ico :n="s.fab.icon" cls="l"/></span><span class="flabel">{{ s.fab.label }}</span></button>
<button class="tab" :class="{on: s.tab==='files'}" data-tab="files" @click="H.tabPick('files')"><span class="ti"><svg class="ic"><use href="#i-clip"/></svg></span><em>附件</em></button>
<button class="tab" :class="{on: s.tab==='mine'}" data-tab="mine" @click="H.tabPick('mine')"><span class="ti"><svg class="ic"><use href="#i-user"/></svg></span><em>我的</em></button>
`
}

/* 弹层宿主：遮罩 + 面板。面板有两种形态，与迁移前一致：
   - page 形态（全屏页）：.panel.page = .phead（返回按钮 + 标题）+ .pbody
   - 卡片形态（底部弹出）：.panel = .grip + .pclose + 内容
   内容都交给弹层视图挂载（#sheetBody 是它的容器，也是夹具锚点）：步骤 16c 之后
   字符串内容那条路（mode='html'）已经没有了，六个字符串弹层全成了 VUE_SHEETS 里的组件。
   卡片形态的内容比迁移前多出 #sheetBody 这一层包装，CSS 里唯一受影响的子选择器
   `.sheet .panel>h2` 已补上 `#sheetBody>h2`（见 css/components.css）。
   两个 .panel 分支各带 id="panel"：v-if/v-else 同时只渲染一个，id 不会重复。 */
export const SheetHost = {
  name: 'SheetHost',
  components: { ShotProgress },
  setup(){
    const H = inject('H');
    /* 步骤 17i：开合动画走 JS 钩子（:css="false"），不用 Vue 的 CSS 模式。原因：CSS 模式下
       Vue 用 requestAnimationFrame 推进 leave 的状态机，页面不可见时 rAF 被挂起，leave 永不
       落地 —— 真机验收（test.sh 的剪贴板 raw 用例，虚显 + 屏关）拓到：弹层关不掉，sheet 的
       app 也不拆（泄漏）。改成定时器推进：后台标签页的 setTimeout 会被节流到 1s，但它会跑。
       时长仍从 CSS 读（transition-duration = --d1），样式表依旧是唯一时长来源。 */
    function leaveMs(el){
      var d = '';
      try{ d = getComputedStyle(el).transitionDuration || '' }catch(e){ return 0 }
      var ms = 0;
      String(d).split(',').forEach(function(s){
        var v = Math.round(parseFloat(s) * 1000);
        if(v > ms) ms = v;
      });
      return ms;
    }
    function shEnter(el, done){ done() }   /* 入场动画是 .sheet .panel{animation:up}，元素新建就自己跑 */
    function shLeave(el, done){
      el.classList.add('sh-leave-active', 'sh-leave-to');
      setTimeout(done, leaveMs(el) + 20);
    }
    /* 关掉立刻重开：leave 被取消，得自己把 leave 类抹掉（:css="false" 时 Vue 不记账） */
    function shLeaveCancel(el){ el.classList.remove('sh-leave-active', 'sh-leave-to') }
    return { H, s: shell, shEnter, shLeave, shLeaveCancel }
  },
  template: `
<transition :css="false" @enter="shEnter" @leave="shLeave" @leave-cancelled="shLeaveCancel" @after-leave="H.sheetLeft">
<div class="sheet on" id="sheet" v-if="s.sheet.on" @click.self="H.closeSheet()">
  <!-- 步骤 17i：开合动画与拆 app 都交给 <Transition>。以前是 CSS 的 .sheet.closing .panel
       {animation:down} + app.js 里 setTimeout(110) 手动拆 app，还要 sheetGen 号防「关掉立刻
       重开」时迟到的回调把新弹层拆掉。Vue 在 leave 被取消时不会调 after-leave，那个守卫
       整个没用了。时长与关键帧沿用原来的 --d1 / up / down，像素与动效零变化；
       唯一的可见差别：遮罩（.sheet 背景）现在随 leave 淡出 110ms，以前是瞬间消失。 -->
  <!-- data-kind 是 CSS 钩子（css/views/settings.css 靠它定位设置页）。步骤 15 之前面板是
       index.html 里的常驻元素，调用方直接写 #panel.dataset.kind 就行；现在面板随弹层开合被
       创建/销毁，钩子必须进状态，否则设置页样式全丢（真机验收抓到）。空串时不写这个属性。 -->
  <div class="panel page" id="panel" :data-kind="s.sheet.kind || null" v-if="s.sheet.page">
    <div class="phead"><button class="iconbtn" aria-label="返回" @click="H.closeSheet()"><svg class="ic"><use href="#i-chev"/></svg></button><div style="flex:1">{{ s.sheet.title }}</div></div>
    <div class="pbody" id="sheetBody"></div>
  </div>
  <div class="panel" id="panel" v-else :class="{full: s.sheet.full}" :data-kind="s.sheet.kind || null"><div class="grip"></div><button class="pclose" @click="H.closeSheet()" aria-label="关闭">✕</button><div id="sheetBody"></div></div>
</div>
</transition>
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
   按钮顺序 No 在左 Yes 在右，与迁移前一致；noCancel 用 v-show（迁移前是 style.display）。 */
export const DialogHost = {
  name: 'DialogHost',
  setup(){ const H = inject('H'); return { H, s: shell } },
  template: `
<div class="dlg" id="dlg" :class="{on: s.dlg.on}" @click.self="H.dlgCancel()">
  <div class="dbox">
    <h3 id="dlgT">{{ s.dlg.title }}</h3>
    <div class="dbody" id="dlgB">{{ s.dlg.body }}</div>
    <div class="dacts">
      <button class="btn" id="dlgNo" v-show="!s.dlg.noCancel" @click="H.dlgCancel()">{{ s.dlg.cancel }}</button>
      <button class="btn" id="dlgYes" :class="s.dlg.danger ? 'dg' : 'pri'" @click="H.dlgOk()">{{ s.dlg.ok }}</button>
    </div>
  </div>
</div>
`
}

/* 轻提示：2.2s 自动收起的定时器在 app.js toast() 里（那是行为，不是视图）。 */
export const ToastHost = {
  name: 'ToastHost',
  setup(){ return { s: shell } },
  template: `
<div id="toast" :class="{on: s.toast.on}"><svg class="ic"><use href="#i-info"/></svg><span>{{ s.toast.msg }}</span></div>
`
}

/* 五个外壳应用。必须在首次 render() 之前调用：app.js 的 __enote.dom 与所有
   toast/dialog/sheet 调用点都假定这些节点已经存在。 */
export function mountShell(){
  return {
    topbar: mount('topbar', TopBar),
    tabbar: mount('tabbar', TabBar),
    sheet: mount('sheetRoot', SheetHost),
    dlg: mount('dlgRoot', DialogHost),
    toast: mount('toastRoot', ToastHost)
  }
}
