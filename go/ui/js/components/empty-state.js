/* <empty-state>：空列表的占位块。owner: Tony（基础组件）；注册在 js/components.js（Austin）。
 *
 * 模式（步骤 5 定，6/7/9/10 照抄）：**先包后换**。
 *   根元素 + v-html 直接复用现成的字符串渲染器 → 产出的 DOM 与今天逐字一致，
 *   迁移这一步「行为零变化」是可证明的（tools/vue_dom_test.js 逐字比 innerHTML）。
 *   之后再把内部片段逐块换成模板语法，每块都可独立验收。
 * 反过来（先写模板再对 DOM）会踩 Vue 模板规范化的三个坑：属性顺序、空白节点、
 * class 合并顺序——签名测试是源码级正则，抓不到这些。
 */
export const EmptyState = {
  name: 'EmptyState',
  props: {
    icon: { type: String, required: true },
    title: { type: String, default: '' },
    sub: { type: String, default: '' },
  },
  /* 字符串版是 '<div class="empty"><div class="eo">…</div>' + t + (sub ? '<div class="esub">'
     + sub + '</div>' : '') + '</div>'：标题 t **原样插入**，调用方传的是已拼好的 HTML
     （有的带 <b>）。所以整段走 v-html：用 {{ }} 会多一层转义，用 <span v-html> 会多一个元素，
     两种都会让 DOM 与今天不一致。 */
  template: '<div class="empty" v-html="html"></div>',
  computed: {
    html() {
      return '<div class="eo"><svg class="ic"><use href="#i-' + this.icon + '"/></svg></div>'
        + this.title
        + (this.sub ? '<div class="esub">' + this.sub + '</div>' : '');
    },
  },
};
