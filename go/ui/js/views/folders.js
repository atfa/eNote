/* 选监控文件夹页（S3 步骤 8）。模式同 views/shots.js：结构在模板里，叶子片段（图标、
   目录显示名）调 app.js 的 ic / folderLabel —— 两条渲染路径共用同一份叶子函数，
   VDIFF 才逐字比得过。

   与遗留路径的两处**有意**差异，都记在这里，别当 bug 改回去：
   1) 搜索框过滤：遗留 folderFilter() 给不匹配的行加 style="display:none"（节点留在 DOM 里），
      Vue 用 computed 过滤，节点直接不渲染。VDIFF 比的是未过滤状态（folderQ 为空），
      两边逐字一致；过滤后的差异是「隐藏」与「不存在」，视觉上等价。
   2) folderRender() 那句「记住 #sheet .panel 的 scrollTop，画完放回」在 Vue 路径不需要：
      v-for 带 :key，勾选只是移动已有节点，滚动位置天然不动（真机量过：Chrome 的滚动
      锚定只会让 scrollTop 移动正好一行高，不会跳回顶部，见 test.sh 的 P11 假夹具）。
   3) 搜索框**不能**写 :value="fq"：Vue 会把 value 写成 DOM 属性，innerHTML 序列化出来多一个
      value=""，遗留字符串里没有这个属性 → VDIFF 在 input 那一字节就红。输入框本来也不需要
      受控：输入节点是静态的，重画不会重建它，用户输的字自然留着（真机验过）。

   读模块状态一律 computed()：folderSel 是普通模块变量，folderSelAll / folderPickShots 整体替换
   它，computed 不依赖 tick 就永远缓存 → 勾选点了没反应。
   模板里用原始值 + {{ }}，不要再 esc（见 views/shots.js 顶部第 2 条）。
   <empty-state> 不收 :tick（步骤 7 的透传漂移）。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，所以全量名单写在下面这行：
   components: { EmptyState, FolderRow, Ico } */

import { V, Vue } from '../vue.js'
import { EmptyState } from '../components.js'
import { Ico } from '../components/leaf.js'

const { computed, inject } = Vue

/* 一行文件夹。遗留字符串：
   <div class="frow on gone" data-path="…" onclick="folderPick('…')"><div class="fcb">ic('check')
   </div><div style="flex:1;min-width:0"><div class="fname">label</div><div class="fpath">path
   </div></div><div class="fmeta">N 张|已不存在</div></div> */
export const FolderRow = {
  name: 'FolderRow',
  components: { Ico },
  props: ['tick', 'f'],
  setup(props){
    const H = inject('H');
    return {
      H,
      cls: computed(() => 'frow' + (H.folderSel[props.f.path] ? ' on' : '') + (props.f.missing ? ' gone' : '')),
      label: computed(() => H.folderLabel(props.f.path)),
      meta: computed(() => props.f.missing ? '已不存在' : (props.f.count || 0) + ' 张')
    }
  },
  template: `
  <div :class="cls" :data-path="f.path" @click="H.folderPick(f.path)">
    <div class="fcb"><ico n="check"/></div>
    <div style="flex:1;min-width:0"><div class="fname">{{ label }}</div><div class="fpath">{{ f.path }}</div></div>
    <div class="fmeta">{{ meta }}</div>
  </div>`
};

/* 排序与遗留 folderRender() 逐字一致：已选（且未消失）的排最前，组内按张数多的优先，
   再按路径字典序。放在视图里是因为它是纯函数（只读 folderAll / folderSel），
   进 setHost 只会多一个要维护的接口面。 */
function sortRows(all, sel){
  return all.slice().sort(function(a, b){
    var sa = (sel[a.path] && !a.missing) ? 1 : 0;
    var sb = (sel[b.path] && !b.missing) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
    return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0);
  });
}

export const FoldersView = {
  name: 'FoldersView',
  components: { EmptyState, FolderRow, Ico },
  setup(){
    const H = inject('H');
    const tick = computed(() => V.tick);
    const rows = computed(() => sortRows(H.folderAll, H.folderSel));
    const q = computed(() => String(H.folderQ || '').toLowerCase());
    return {
      H,
      tick,
      rows,
      shown: computed(() => {
        const t = q.value;
        return t ? rows.value.filter(function(f){ return String(f.path).toLowerCase().indexOf(t) >= 0 })
                 : rows.value;
      }),
      // 计数与 folderCountLabel() 一致：missing 的行既不进「共 M 个」也不进「已选 N 个」
      // 步骤 16b：原来是整条字符串 v-html，现在结构在模板里（#folderCount 是 test.sh 的断言点）
      sel: computed(() => {
        let n = 0;
        H.folderAll.forEach(function(f){ if (!f.missing && H.folderSel[f.path]) n++ });
        return n;
      }),
      total: computed(() => {
        let total = 0;
        H.folderAll.forEach(function(f){ if (!f.missing) total++ });
        return total;
      }),
      saveText: computed(() => {
        let n = 0;
        H.folderAll.forEach(function(f){ if (!f.missing && H.folderSel[f.path]) n++ });
        return n ? '开始监控这 ' + n + ' 个' : '开始监控';
      })
    }
  },
  template: `
<div class="cliptop">
  <button class="btn sm" id="folderSelAll" @click="H.folderSelAll(true)">全选</button>
  <button class="btn sm" id="folderSelNone" @click="H.folderSelAll(false)">全不选</button>
  <button class="btn sm" @click="H.folderPickShots()">只选截图目录</button>
</div>
<div style="margin:var(--s2) 0 var(--s1)"><input id="folderQ" class="fin" placeholder="搜索文件夹" @input="H.folderFilter($event.target.value)"></div>
<div id="folderList" class="clipload">
  <empty-state v-if="!rows.length" icon="folder" title="读不到文件夹" sub="需要先允许读取照片（我的 → 截图捕获 → 去授权）"/>
  <folder-row v-for="f in shown" :key="f.path" :f="f" :tick="tick"/>
</div>
<div class="pfoot">
  <div class="count" id="folderCount"><b>{{ sel }}</b> 个已选 · 共 {{ total }} 个</div>
  <div class="sp"></div>
  <button class="btn pri" @click="H.folderSave()">{{ saveText }}</button>
</div>`
};

export default FoldersView;
