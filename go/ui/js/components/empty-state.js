import { Ico } from './leaf.js'

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
  components: { Ico },
  props: {
    icon: { type: String, required: true },
    title: { type: String, default: '' },
    sub: { type: String, default: '' },
  },
  /* 步骤 16d：内部片段换成模板语法，v-html 没了。字符串版是
     '<div class="empty"><div class="eo">' + ic(icon) + '</div></div>' + t
     + (sub ? '<div class="esub">' + sub + '</div>' : '') + '</div>'，
     标题 t 是**原样插入**的 HTML —— 逐个查过全部 7 个调用方（notes / todos / files /
     clip / shots / folders / sheets），传进来的全是纯文本字面量，没有一处带标签，
     所以 {{ }}（textContent）与 v-html 产出的 DOM 相同。以后谁要往 title 里塞 HTML，
     加插槽，别把 v-html 请回来。
     文本节点位置也一致：</div>{{ title }}<div 之间没有空白，Vue 的模板空白折叠不会多出空格。 */
  template: `<div class="empty"><div class="eo"><ico :n="icon"/></div>{{ title }}<div class="esub" v-if="sub">{{ sub }}</div></div>`
};
