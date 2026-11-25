/* 待办页（S4）。模式同 views/notes.js：结构在模板里，叶子片段是 components/leaf.js 里的
   真组件（步骤 16 之前是 app.js 的 cbInnerHTML / todoTxHTML + v-html）。

   读模块状态一律 computed()，理由见 js/vue.js 的注释；S 自步骤 17e 起是 reactive 的，
   2s 轮询换掉整个 S 之后读它的 computed 自动重算（17h 之前靠组件读 tick）。
   SR.todoIds 是搜索态的第一优先级输入，和 notes 的 SR.notes 同一个坑。

   组件不接 tick prop（步骤 17l 删掉了这条管道）。当年那条「声明了 tick 就必须收 :tick、
   没声明禁止收」的双向规则（步骤 7 审查后由闸门⑮ 钉住）整类消失：现在没有 tick 可传，
   闸门⑮ 直接钉住「模板里不许出现 :tick」。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，本文件第一个组件是 TodoRow，
   所以全量名单写在下面这行注释里（运行时各组件注册自己用到的那些）。
   components: { StripBar, EmptyState, TodoRow, Ico, TodoTx } */
import { Vue } from '../vue.js'
import { StripBar, EmptyState } from '../components.js'
import { Ico, TodoTx } from '../components/leaf.js'

const { computed, inject } = Vue

const GROUP_ICONS = { '已逾期':'warn-tri', '今天':'fire', '明天':'calendar',
  '本周':'calendar-check', '以后':'seed', '无日期':'pin', '已完成':'check-circle' };

export const TodoRow = {
  name: 'TodoRow',
  components: { Ico, TodoTx },
  props: ['t', 'n'],
  setup(props){
    const H = inject('H');
    // computed() 读 reactive 的 S，2s 轮询换掉它之后自动重算（步骤 17l：tick prop 管道已删）
    return {
      H,
      cls: computed(() => H.todoRowCls(props.n, props.t))
    }
  },
  template: `
  <div class="todo" :class="cls">
    <div class="cb" :class="{on:t.done}"
         @click="H.toggle(n.id, t.id, $event.currentTarget)"><ico n="check"/></div>
    <div class="tx"><todo-tx :t="t" :n="n"/></div>
  </div>`
};

export const TodosView = {
  name: 'TodosView',
  components: { StripBar, EmptyState, TodoRow, Ico },
  setup(){
    const H = inject('H');
    // 分组 + 筛选 + 排序：逐字照抄 app.js 的 renderTodos，包括「搜索态优先用 SR.todoIds」
    const groups = computed(() => {
      const g = H.groupTodos(), p = H.P(), out = [];
      Object.keys(g).forEach(function(k0){
        if(k0==='已完成' && p.done==='open') return;
        if(k0!=='已完成' && p.done==='done') return;
        var items = g[k0].filter(function(o){
          if(H.SR.todoIds) return H.SR.todoIds[o.n.id+'|'+o.t.id];
          if(p.pri!=='all' && (o.t.priority||'normal')!==p.pri) return false;
          return H.hit([o.t.text, o.n.title, o.n.content].join(' '));
        });
        if(!items.length) return;
        if(p.sort==='pri') items.sort(function(a,b){ return H.rank(b.t)-H.rank(a.t) });
        out.push({ name:k0, icon:GROUP_ICONS[k0], items:items,
                   enterCls:H.enterCls('g'+k0), i:out.length });
      });
      return out;
    });
    return {
      groups
    }
  },
  template: `
  <strip-bar/>
  <template v-if="groups.length">
    <template v-for="g in groups" :key="g.name">
      <div class="sec"><ico :n="g.icon" cls="s"/>{{ g.name }} · {{ g.items.length }}</div>
      <div class="card" :class="g.enterCls" :style="'--i:'+g.i">
        <todo-row v-for="o in g.items" :key="o.t.id" :t="o.t" :n="o.n"/>
      </div>
    </template>
  </template>
  <empty-state v-else icon="check-circle" title="没有符合条件的待办"
               sub="分享一段文字，AI 会自动提取待办"/>`
};

export default TodosView;
