/* Vue 装配层（S3 / D14 混合期）。

   混合期 = Vue 视图与遗留字符串渲染器共存：render() 仍是唯一绘制入口，已迁移的 tab 走这里，
   未迁移的 tab 走 app.js 里的老函数。步骤 11 删掉遗留路径。

   组件不持有数据：数据在 app.js 的模块状态里，组件通过宿主接口 H 读。
   步骤 17e–17h 之后这些模块状态本身是 Vue.reactive 的（CLIP / FOLD / SHOTS / SHOTPROG / S /
   prefs / SR / FA 原地改键，MISSED / ST / SHOTFLAGS / LOGDATA / DEBUGDATA 是 {v:} 容器），
   所以组件里写裸 computed 就建立依赖 —— 谁读了谁重画，没有「每次 render 全量重绘」这回事。
   两条契约（闸门⑮ 钉着）：不许再包 live()（已删）；computed 不许只返回容器本身，
   原地改键时值没变，Vue 判定「没变化」直接跳过渲染。 */

export const Vue = window.Vue;

/* 步骤 15：外壳（js/shell.js）与 app.js 的弹层挂载都要排到 DOM 落地之后那一拍，
   nextTick 得能从外面 import 到。踩过：只在 vue.js 内部写 Vue.nextTick()，app.js
   import 它是 module 解析期 SyntaxError（「does not provide an export named
   'nextTick'」），整份 app.js 不执行 —— 静态闸门全绿，真机整页空白。 */
export const nextTick = Vue.nextTick;

/* 每次 render() 递增一次。组件的 computed 读它 → 整棵子树重算。 */
export const V = Vue.reactive({ tick: 0 });

/* 宿主接口：app.js 在装配时注入（状态 getter + 渲染叶子 + 事件方法）。
   组件在 mount 时才 setup()，那时 H 已经装好，所以直接返回 H 给模板用是安全的。 */
export let H = null;
/* 返回 h：app.js 要把同一个对象再挂到 __enote.vue 上给测试用（步骤 7），
   而闸门⑮ 的 setHostKeys() 认的是 `setHost({` 这个字面量，不能改成 `var HOST = {…}; setHost(HOST)`。 */
export function setHost(h){ H = h; return h }

export const apps = {};

/* 诊断缝（步骤 17g）：Vue 组件里抛的错默认只打 message，栈才是有用的那半。
   踩过：迁移响应式后渲染函数抛 TypeError，控制台只有「Cannot read properties of
   undefined (reading 'length')」，找不到是哪个组件；加上栈之后一眼定位。 */
function vueErrHandler(e, instance, info){
  var name = instance && instance.$options ? (instance.$options.name || instance.$.__name || '?') : '?';
  console.log('VUE-ERR [' + name + ' @' + info + '] ' +
    (e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : String(e)));
}

export function mountView(tab, pane, def){
  const app = Vue.createApp(def);
  app.config.productionTip = false;
  app.config.devtools = false;
  app.config.errorHandler = vueErrHandler;
  app.mount(pane);
  apps[tab] = app;
  return app;
}

/* ---------- 弹层（sheet）的挂载表（步骤 8） ----------
   弹层与 tab 页的生死不同：tab pane 常驻（切页签只换显示），sheet 每次打开重建、关掉就
   销毁（closeSheet 把 .panel 的 innerHTML 换掉，Vue 的根节点随之消失）。所以另开一张表，
   并且必须显式 unmountSheet：不 unmount 的话 app 实例和它的 effect 永远留着，反复开合
   就是只增不减的泄漏。混在 apps 一张表里，「切 tab 保留 / 关弹层销毁」这条规则就没地方表达。
   同名重复打开先 unmount 旧的：遗留 sheet 的 DOM 已被 innerHTML 换掉，旧实例的根节点
   是个游离节点，留着它 = 泄漏一棵永远渲染不到的子树。 */
export const sheetApps = {};

export function mountSheet(name, el, def){
  unmountSheet(name);
  const app = Vue.createApp(def);
  app.config.productionTip = false;
  app.config.devtools = false;
  app.config.errorHandler = vueErrHandler;
  app.mount(el);
  sheetApps[name] = app;
  /* 验收缝（步骤 17b）：真机探针要查「这个弹层的 app 实例还活着吗」——
     _instance.scope.active 是响应式更新能不能到达它的唯一判据。 */
  window.__enoteSheet = { name: name, app: app };
  return app;
}

export function unmountSheet(name){
  const app = sheetApps[name];
  if (!app) return;
  delete sheetApps[name];   // 先摘表：unmount 里的 beforeUnmount 钩子若抛异常，表里不能留个死实例
  app.unmount();
}

/* 步骤 13：全量拆弹层。pageSheetVue 会把 .panel 的 innerHTML 整块换掉，上一个 sheet
   （哪怕名字不同）的根节点从此是个游离节点：实例、effect、computed 缓存全都留着，
   渲染却永远到不了它 —— 开过剪贴板页再开设置页，剪贴板那个 app 就泄漏到 app 关闭。
   closeSheet 以前是手写名单（shots/folders/clip/settings），新增 sheet 忘了加就是
   静默泄漏；现在名单只有一份，就是 sheetApps 这张表本身。
   步骤 17j：以前还要带一个 keep=['progress'] 例外（进度层挂在 body 级，要活过弹层），
   现在进度层是外壳树里的 <teleport> 子组件，不在这张表里，例外整个没用了。 */
export function unmountAllSheets(){
  Object.keys(sheetApps).forEach(n => unmountSheet(n));
}

/* 步骤 17h 之后 tick 不再是「全量重绘大锤」：状态本身是 reactive 的，computed 直接追踪。
   现在 tick 只有一个用途 —— Android 桥那种「拉」式只读接口（notifyGranted / keepAliveOn /
   batteryIgnoring）不可观察，原生状态变了得有人喊一嗓子。settings.js 里那几个 computed
   显式读 V.tick.v，settingsRefresh() 在 onAppResume / notifyResult 里 bump 一次。 */
export function sheetPaint(){
  V.tick++;
  return Vue.nextTick();
}

/* 验收缝（步骤 17b）：真机探针要证明「DOM 变了而 V.tick 一动没动」，也就是更新来自
   响应式依赖本身，不是 tick 大锤。live() 已删（17h），这个缝留着继续当反证。 */
if (typeof window !== "undefined") window.__enoteVtick = function(){ return V.tick };

/* 一次绘制：bump tick → 等 Vue 把 DOM 打完。
   17h 之后 bump 不再是「让所有 computed 失效」（数据是 reactive 的，赋值自己就重画），
   而是告诉组件「原生状态可能变了」——见上面 sheetPaint() 的注释。DOM 落地靠 nextTick。
   返回的 Promise 就是 render() 对外的 Promise（D13），调用点 await 它即可。 */
export function vuePaint(){
  V.tick++;
  return Vue.nextTick();
}
