/* 待办页（S4）。模式同 views/notes.js：结构在模板里，叶子 HTML 调 app.js 的
   cbInnerHTML / todoTxHTML（两条路径共用一份 HTML 生成代码，DOM 才逐字一致）。

   读模块状态一律 live()，理由见 js/vue.js 的注释；组件的 computed 必须读 tick，
   否则 2s 轮询换掉整个 S 之后 computed 不重算（闸门⑮ 扫这个）。
   SR.todoIds 是搜索态的第一优先级输入，和 notes 的 SR.notes 同一个坑。

   :tick 的双向规则（步骤 7 审查后由闸门⑮ 钉住）：组件声明了 tick prop 就必须收
   :tick="tick"（本视图第一版写的是 <strip-bar/>，靠 live() 也能重渲染，但约定不统一
   就是给以后埋雷：一旦组件改成读 props.tick，它会永远是装配时那份快照）；没声明
   tick prop 的组件（EmptyState）禁止收，多传的 :tick 会透传成根元素属性。 */
import { V, H, Vue, live } from '../vue.js'
import { StripBar, EmptyState } from '../components.js'

const { computed } = Vue

const GROUP_ICONS = { '已逾期':'warn-tri', '今天':'fire', '明天':'calendar',
  '本周':'calendar-check', '以后':'seed', '无日期':'pin', '已完成':'check-circle' };

export const TodoRow = {
  name: 'TodoRow',
  props: ['tick', 't', 'n'],
  setup(props){
    // live() 自己读 V.tick，父组件 tick 一变就重算；:tick="tick" 同时保证子组件重渲染
    return {
      H,
      cls: live(() => H.todoRowCls(props.n, props.t)),
      cbHtml: live(() => H.cbInnerHTML()),
      txHtml: live(() => H.todoTxHTML(props.t, props.n))
    }
  },
  template: `
  <div class="todo" :class="cls">
    <div class="cb" :class="{on:t.done}"
         @click="H.toggle(n.id, t.id, $event.currentTarget)" v-html="cbHtml"></div>
    <div class="tx" v-html="txHtml"></div>
  </div>`
};

export const TodosView = {
  name: 'TodosView',
  components: { StripBar, EmptyState, TodoRow },
  setup(){
    const tick = computed(() => V.tick);
    // 分组 + 筛选 + 排序：逐字照抄 app.js 的 renderTodos，包括「搜索态优先用 SR.todoIds」
    const groups = live(() => {
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
      tick, groups,
      // 顶部三张统计卡 + OCR 状态条由 strip() 生成（每个页面都有），不在本视图里重画
      icHtml: function(n, s){ return H.ic(n, s) }
    }
  },
  template: `
  <strip-bar :tick="tick"/>
  <template v-if="groups.length">
    <template v-for="g in groups" :key="g.name">
      <div class="sec" v-html="icHtml(g.icon, 's')+g.name+' · '+g.items.length"></div>
      <div class="card" :class="g.enterCls" :style="'--i:'+g.i">
        <todo-row v-for="o in g.items" :key="o.t.id" :t="o.t" :n="o.n" :tick="tick"/>
      </div>
    </template>
  </template>
  <empty-state v-else icon="check-circle" title="没有符合条件的待办"
               sub="分享一段文字，AI 会自动提取待办"/>`
};

export default TodosView;
