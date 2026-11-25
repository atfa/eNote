/* 待办页（S4）。模式同 views/notes.js：结构在模板里，叶子片段是 components/leaf.js 里的
   真组件（步骤 16 之前是 app.js 的 cbInnerHTML / todoTxHTML + v-html）。

   读模块状态一律 computed()，理由见 js/vue.js 的注释；组件的 computed 必须读 tick，
   否则 2s 轮询换掉整个 S 之后 computed 不重算（闸门⑮ 扫这个）。
   SR.todoIds 是搜索态的第一优先级输入，和 notes 的 SR.notes 同一个坑。

   :tick 的双向规则（步骤 7 审查后由闸门⑮ 钉住）：组件声明了 tick prop 就必须收
   :tick="tick"（本视图第一版写的是 <strip-bar/>，靠 computed() 也能重渲染，但约定不统一
   就是给以后埋雷：一旦组件改成读 props.tick，它会永远是装配时那份快照）；没声明
   tick prop 的组件（EmptyState）禁止收，多传的 :tick 会透传成根元素属性。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，本文件第一个组件是 TodoRow，
   所以全量名单写在下面这行注释里（运行时各组件注册自己用到的那些）。
   components: { StripBar, EmptyState, TodoRow, Ico, TodoTx } */
import { V, Vue } from '../vue.js'
import { StripBar, EmptyState } from '../components.js'
import { Ico, TodoTx } from '../components/leaf.js'

const { computed, inject } = Vue

const GROUP_ICONS = { '已逾期':'warn-tri', '今天':'fire', '明天':'calendar',
  '本周':'calendar-check', '以后':'seed', '无日期':'pin', '已完成':'check-circle' };

export const TodoRow = {
  name: 'TodoRow',
  components: { Ico, TodoTx },
  props: ['tick', 't', 'n'],
  setup(props){
    const H = inject('H');
    // computed() 自己读 V.tick，父组件 tick 一变就重算；:tick="tick" 同时保证子组件重渲染
    return {
      H,
      cls: computed(() => H.todoRowCls(props.n, props.t))
    }
  },
  template: `
  <div class="todo" :class="cls">
    <div class="cb" :class="{on:t.done}"
         @click="H.toggle(n.id, t.id, $event.currentTarget)"><ico n="check"/></div>
    <div class="tx"><todo-tx :t="t" :n="n" :tick="tick"/></div>
  </div>`
};

export const TodosView = {
  name: 'TodosView',
  components: { StripBar, EmptyState, TodoRow, Ico },
  setup(){
    const H = inject('H');
    const tick = computed(() => V.tick);
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
      tick, groups
    }
  },
  template: `
  <strip-bar :tick="tick"/>
  <template v-if="groups.length">
    <template v-for="g in groups" :key="g.name">
      <div class="sec"><ico :n="g.icon" cls="s"/>{{ g.name }} · {{ g.items.length }}</div>
      <div class="card" :class="g.enterCls" :style="'--i:'+g.i">
        <todo-row v-for="o in g.items" :key="o.t.id" :t="o.t" :n="o.n" :tick="tick"/>
      </div>
    </template>
  </template>
  <empty-state v-else icon="check-circle" title="没有符合条件的待办"
               sub="分享一段文字，AI 会自动提取待办"/>`
};

export default TodosView;
