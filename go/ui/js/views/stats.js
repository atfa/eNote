/* 我的页（S3 步骤 10）。模式同 views/clip.js：结构在模板里，叶子片段（图标、kv 行、
   运行信息）调 app.js 的 ic / kvHTML / statCls / statsHeroInner / statsRunRowsHTML ——
   两条渲染路径共用同一批叶子函数，VDIFF 才逐字比得过。

   前面几步踩过、写在这里省得再踩的坑：
   1) 读模块状态一律 computed()：ST / SHOTFLAGS 是普通模块变量，statsNow() / shotFlags()
      整体替换它们，computed 不依赖 tick 就永远缓存 → 数字永远停在首屏那份。
   2) 模板里用原始值 + {{ }}，不要再 esc（Vue 的插值是 textContent，传 esc(x) 会双重转义）。
   3) 一个元素里只放一个 {{ }}：两个插值 = 两个文本节点，VDIFF 的序列化器会 trim 每个
      文本节点再拼，「#」+「tag」+「 · 」+「3」拼出来丢空格就红 —— 常见标签那条就是
      因为这个走 v-html。
   4) 模板里用 H.xxx 的组件必须在 setup() 返回里暴露 H（闸门⑮ 强制）。
   5) class 用拼接而不是「静态 class + 对象语法」：Vue 合并 class 的顺序与字符串拼接
      不同，VDIFF 比的是 class 属性字符串。

   哪些块走 v-html、哪些块写进模板（步骤 16b 之后）：
   - 全部写进模板。hero、笔记状态卡、底部运行信息卡现在是 components/blocks.js 里的真组件，
     图标是 components/leaf.js 的 <ico>；v-html 只剩「一个元素里多个插值会被 Vue 合并成
     一个文本节点」那种地方（本文件已清零）。
   - 常见标签的 chip 写进模板，插值的切分与遗留字符串的拼接一一对应：遗留的「#」+tag+「 · 」+n
     是四个节点，模板里写成一个插值就只剩一个节点（「#a · 3」 vs 「#a·3」）。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，所以全量名单写在下面这行：
   components: { StatsStat, StatsChart, StatsLi, StatsHero, StatsNotesCard, StatsRunCard, Ico } */
import { V, Vue } from '../vue.js'
import { Ico } from '../components/leaf.js'
import { StatsHero, StatsNotesCard, StatsRunCard } from '../components/blocks.js'

const { computed, inject } = Vue

/* 一个数字格子。遗留字符串：
   <div class="stat hot enter" style="--i:3"><div class="si">ic('alert')</div><b>2</b>
   <span>已逾期</span></div>
   enter 类由 enterCls('s'+label) 决定（只给第一次出现的卡片）；两条路径调同一个
   statCls，所以同一次绘制里结果一致。VDIFF 夹具会在两条路径各自开跑前调一次
   __enote.clearSeen()，否则「谁先画谁拿到 enter」会让两边差一个类（见 test.sh
   vdiff_tab 的注释）。 */
export const StatsStat = {
  name: 'StatsStat',
  components: { Ico },
  props: ['tick', 'i', 'v', 'label', 'icon', 'hot'],
  setup(props){
    const H = inject('H');
    return { H, cls: computed(() => H.statCls(props.hot, props.label)) }
  },
  template: `
  <div :class="cls" :style="'--i:'+i">
    <div class="si"><ico :n="icon"/></div><b>{{ v }}</b><span>{{ label }}</span>
  </div>`
};

/* 近 7 天双柱图。遗留 chartHTML(days) 的算法：先取所有柱子的最大值，再按 76px 归一，
   最低 2px；每根柱子的入场动画按列号错开 40ms（完成柱再晚 60ms）。
   style 属性两条路径写法不同（字符串 vs el.style），VDIFF 的 norm() 用浏览器自己的
   cssText 归一，所以这里只要求「语义相同」。 */
export const StatsChart = {
  name: 'StatsChart',
  props: ['tick', 'days'],
  setup(props){
    const H = inject('H');
    return {
      H,
      cols: computed(function(){
        var ds = props.days || [], mx = 1;
        ds.forEach(function(d){ mx = Math.max(mx, d.notes, d.done) });
        return ds.map(function(d, k){
          return {
            day: d.day, label: d.label, notes: d.notes, done: d.done, k: k,
            nh: Math.max(2, Math.round(d.notes / mx * 76)),
            dh: Math.max(2, Math.round(d.done / mx * 76))
          };
        });
      })
    }
  },
  template: `
  <div class="chart">
    <div class="col" v-for="c in cols" :key="c.day" :title="c.day+'：'+c.notes+' 条笔记 / '+c.done+' 条完成'">
      <div class="bars">
        <div class="bar n" :style="'height:'+c.nh+'px;animation-delay:'+(c.k*40)+'ms'"></div>
        <div class="bar d" :style="'height:'+c.dh+'px;animation-delay:'+(c.k*40+60)+'ms'"></div>
      </div>
      <div class="lb">{{ c.label }}</div>
    </div>
  </div>`
};

/* 一行可点的列表项。遗留 liHTML(icn,t,sub,fn) 的第 4 个参数是 handler 字符串，
   Vue 侧换成 @click + $emit，DOM 里没有 onclick 属性 —— VDIFF 的序列化器跳过 on*
   属性（它们是绑定机制不是 DOM 形状），所以比得过。sub 为空时两边都不渲染那行小字。 */
export const StatsLi = {
  name: 'StatsLi',
  components: { Ico },
  props: ['icon', 'title', 'sub'],
  emits: ['go'],
  // 末尾逗号不是风格：闸门⑮ 认的是 setup() 返回里的 `H,`，写成 return { H } 它认不出。
  setup(){ const H = inject('H'); return { H, } },
  template: `
  <div class="li" @click="$emit('go')">
    <span class="lico"><ico :n="icon"/></span>
    <div style="flex:1"><b style="font-size:var(--fs-base)">{{ title }}</b><div v-if="sub" style="font-size:var(--fs-xs);color:var(--dim2);margin-top:var(--hair)">{{ sub }}</div></div>
    <span style="color:var(--dim2)">›</span>
  </div>`
};

export const StatsView = {
  name: 'StatsView',
  // 注册表用简写形式（键 = 组件名）：闸门⑮ 的 components: 检查就是按这个形状扫的，
  // 写成 'stats-stat': StatsStat 会被它当成没注册（Vue 两种都认，闸门只认一种）。
  components: { StatsStat, StatsChart, StatsLi, StatsHero, StatsNotesCard, StatsRunCard },
  setup(){
    const H = inject('H');
    const tick = computed(() => V.tick);
    return {
      H,
      tick,
      i: computed(() => ({ ...H.S.info })),
      st: computed(() => H.ST),
      stErr: computed(() => H.stErr),
      sf: computed(() => H.SHOTFLAGS || {}),
      // 六格：值/图标/热态都从 ST 现算，顺序与遗留 renderMine() 逐字一致
      tiles: computed(function(){
        var s = H.ST;
        if(!s) return [];
        return [
          { i: 0, v: s.notes.total, label: '笔记', icon: 'note' },
          { i: 1, v: s.todos.total, label: '待办', icon: 'check-square' },
          { i: 2, v: s.todos.open, label: '未完成', icon: 'clock' },
          { i: 3, v: s.todos.overdue, label: '已逾期', icon: 'alert', hot: 1 },
          { i: 4, v: s.attach.count || 0, label: '附件', icon: 'clip' },
          { i: 5, v: s.ai.calls || 0, label: 'AI 调用', icon: 'sparkle' }
        ];
      }),
      tags: computed(() => (H.ST && H.ST.tags) || []),
      // 截图捕获卡的副标题：三处都是「权限/开关没到位时说什么」，与遗留逐字一致
      shotSubs: computed(function(){
        var sf = H.SHOTFLAGS || {};
        return {
          folders: sf.enabled ? ((sf.folders || 0) + ' 个 · 点这里增删') : '未开启 · 点这里开始',
          scan: sf.granted ? '只看上次之后的新图' : '需要先允许读取照片',
          staged: '当前 ' + ((H.S.info && H.S.info.shot) || 0) + ' 张待整理'
        };
      })
    }
  },
  template: `
<stats-hero :i="i" :st="st"/>
<template v-if="!st">
  <div class="card"><div class="skel l"></div><div class="skel s"></div></div>
  <div class="card" v-if="stErr"><div class="errbox">{{ stErr }} ·
    <button class="btn sm gh" @click="H.statsNow()">立即重试</button></div></div>
</template>
<template v-else>
<div class="statgrid">
  <stats-stat v-for="t in tiles" :key="t.label" :tick="tick" :i="t.i" :v="t.v" :label="t.label" :icon="t.icon" :hot="t.hot"/>
</div>
<div class="card"><h2>近 7 天</h2>
  <stats-chart :tick="tick" :days="st.days"/>
  <div class="legend"><span><i style="background:var(--acc)"></i>新增笔记</span><span><i style="background:var(--acc2)"></i>完成待办</span></div>
</div>
<div class="card"><stats-notes-card :st="st"/></div>
<div class="card" v-if="tags.length"><h2>常见标签</h2><div class="tagrow"><span class="chip tag" v-for="t in tags" :key="t.tag">#{{ t.tag }} · {{ t.n }}</span></div></div>
<div class="card"><h2>截图捕获</h2><div style="padding:0 var(--s3) var(--s1)">
  <stats-li icon="folder" title="监控文件夹" :sub="shotSubs.folders" @go="H.folderSheet()"/>
  <stats-li icon="image" title="截图暂存" :sub="shotSubs.staged" @go="H.shotSheet()"/>
  <stats-li icon="refresh" title="现在扫描一次" :sub="shotSubs.scan" @go="H.scanShotsNow()"/>
  <stats-li icon="calendar" title="回捞最近 7 天" sub="把最近 7 天的截图都收一遍（不会重复）" @go="H.rescanShots(7)"/>
  <stats-li icon="trash" title="清空截图暂存" sub="只删副本，不动系统相册" @go="H.clearShots()"/>
</div></div>
<div class="card" style="padding:var(--s0) var(--s3)">
  <stats-li icon="settings" title="设置" sub="AI 模型 / 外观 / 采集 / OCR / 数据" @go="H.settingsSheet()"/>
  <stats-li icon="file-text" title="运行日志" sub="Go 服务、解析队列、OCR 状态" @go="H.showLog()"/>
  <stats-li icon="sparkle" title="AI 调用记录" sub="本次运行的请求与返回" @go="H.showDebug()"/>
  <stats-li icon="download" title="导出 JSON" sub="全量备份笔记与待办" @go="H.exportJSON()"/>
  <stats-li icon="inbox" title="导入 JSON" sub="按笔记 ID 合并，不覆盖本地" @go="H.importJSON()"/>
  <stats-li icon="trash" title="清空全部" sub="删除所有笔记与附件" @go="H.clearAllNotes()"/>
</div>
<div class="card"><stats-run-card :i="i"/></div>
</template>`
};

export default StatsView;
