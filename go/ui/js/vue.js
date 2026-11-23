/* Vue 装配层（S3 / D14 混合期）。

   混合期 = Vue 视图与遗留字符串渲染器共存：render() 仍是唯一绘制入口，已迁移的 tab 走这里，
   未迁移的 tab 走 app.js 里的老函数。步骤 11 删掉遗留路径。

   组件不持有数据：数据在 app.js 的模块状态里，组件通过宿主接口 H 读，靠 V.tick 递增触发重算。
   为什么用 tick 而不是把 S 改成 reactive：迁移期要「行为零变化」可对照，今天的语义就是
   「每次 render() 全量重绘」，tick 是它的一比一翻译；数据层响应式化留到步骤 11（遗留路径删完、
   只剩一条绘制路径时再动，那时出问题只有一条路径要查）。 */

export const Vue = window.Vue;

/* 每次 render() 递增一次。组件的 computed 读它 → 整棵子树重算。 */
export const V = Vue.reactive({ tick: 0 });

/* 宿主接口：app.js 在装配时注入（状态 getter + 渲染叶子 + 事件方法）。
   组件在 mount 时才 setup()，那时 H 已经装好，所以直接返回 H 给模板用是安全的。 */
export let H = null;
/* 返回 h：app.js 要把同一个对象再挂到 __enote.vue 上给测试用（步骤 7），
   而闸门⑮ 的 setHostKeys() 认的是 `setHost({` 这个字面量，不能改成 `var HOST = {…}; setHost(HOST)`。 */
export function setHost(h){ H = h; return h }

export const apps = {};

export function mountView(tab, pane, def){
  const app = Vue.createApp(def);
  app.config.productionTip = false;
  app.config.devtools = false;
  app.mount(pane);
  apps[tab] = app;
  return app;
}

/* 组件里读模块状态的 computed 必须包 live()：S / MISSED / SHOTFLAGS 是普通
   模块变量，不是响应式的，computed 没有响应式依赖就永远缓存 —— 数据变了视图不动
   （症状：删光剪贴板后首页横幅不消失，实测踩过）。live() 让 computed 依赖 V.tick，
   render() 每调一次就全部失效重算，语义等于今天的「全量重绘」。 */
export function live(fn){ return Vue.computed(function(){ V.tick; return fn() }) }

/* 一次绘制：bump tick → 等 Vue 把 DOM 打完。
   返回的 Promise 就是 render() 对外的 Promise（D13），调用点 await 它即可。 */
export function vuePaint(){
  V.tick++;
  return Vue.nextTick();
}
