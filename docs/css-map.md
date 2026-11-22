# CSS 归属地图（S2 拆分依据）

`go/ui.html` 的 `<style>` 有 337 条顶层规则 / 324 个选择器。S1a 是**按原始行号**切成
tokens/base/components/views 四段的，好处是逐字节可核对、行为零变化；代价是分段和视图无关
（`views.css` 里混着「我的页 + 活动柱状图 + 全屏设置面板 + 通知高亮」四件事）。

S2 把它按**视图**重排成 `css/views/*.css`，一个文件一个 owner，S5/S6 才能并行改视图而
不互相踩。归属不是拍脑袋定的：每个 class 都回到 `js/app.js` 里查它由哪个渲染函数产出
（例：`.metrics` 在 `strip()`、`.ovl*` 在 `shotOverlay()`、`.statgrid`/`.chart` 在
`renderMine()`、`.msrow` 在 `missedSheet()`、`.panel.page` 在 `pageSheet()`）。

## 层叠安全（拆分的头号风险）

CSS 层叠 = 特异性，同特异性看**书写顺序**。拆成多文件后加载顺序固定为
`tokens → base → components → views/*`，所以同一选择器的多条规则一旦被分到两个文件，
后写的那条可能不再赢——像素变了而测试全绿。

规则：**同一选择器的多条规则若属性集有交集，必须待在同一个文件里。**
`tools/ui_test.js` 闸门⑦ 机器强制（棘轮，基线里只有 S1a 遗留的 `.sheet` / `.sheet .panel`，
S2 重排时清零）。

拆分前实测只有 3 个选择器有多条规则：`.skel.l`（相邻两行，同文件）、`.body`（62 设
font-size/color，181 设 transition，属性不相交）、`.cb`（118 设几何，509 设 animation，
属性不相交）——所以按视图拆是安全的，但这条不变量必须长期守住。

## 归属表

| 文件 | 规则 | owner | 内容 |
|---|---|---|---|
| `tokens.css` | 2 | Tony | 调色板 + 刻度 |
| `base.css` | 36 | Tony | 重置、图标、排版、卡片、chip、输入控件 |
| `components.css` | 121 | Tony | btn/li/cb/sheet/dlg/toast/tabbar/skel/empty/seg/sw 等原语 |
| `views/shell.css` | 11 | Tony | 顶栏、底部导航、搜索、通知横幅（`missedSheet`/`.msrow`） |
| `views/notes.css` | 30 | Austin | 笔记卡、附件卡、指标卡、同步条、AI 解析条 |
| `views/todos.css` | 32 | Austin | 待办行、优先级、截止日、倒计时、事实卡 |
| `views/files.css` | 13 | Austin | 选文件夹页 |
| `views/shots.css` | 22 | Tony | 截图网格、进度层（`shotOverlay`） |
| `views/clip.css` | 22 | Tony | 剪贴板导入 |
| `views/stats.css` | 29 | Tony | 我的页头部（hero）、计数卡、活动柱状图、标签分布 |
| `views/settings.css` | 6 | Tony | 全屏设置面板（`pageSheet`） |

合计 324 个选择器（337 条规则）。**Austin 93 条，Tony 231 条**（含 base/components 169 条共享层）。
`@media (prefers-reduced-motion)` 那条归 `base.css`。

### `go/ui/css/tokens.css` — 2 条规则 — owner Tony

```
:root
html[data-theme=dark]
```

### `go/ui/css/base.css` — 36 条规则 — owner Tony

```
*
.between
.body
.body.clamp
.body:not(.clamp)
.card
.card.enter
.chip
.chip .ic
.chip.ai
.chip.err
.chip.img
.chip.pend
.chip.tag
.fhint
.ic
.ic.l
.ic.m
.ic.s
.ic.xl
.meta
.row
.sec
.sec:after
.t
a
body
h2
html
html.theming body
input
label
main#view
pre
svg.defs
textarea
```

### `go/ui/css/components.css` — 121 条规则 — owner Tony

```
#toast
#toast .ic
#toast.on
.btn
.btn .ic
.btn.dg
.btn.gh
.btn.pri
.btn.sm
.btn:active
.cb
.cb .ic
.cb.on
.cb.on .ic
.cb.on:before
.cb:before
.dlg
.dlg .dacts
.dlg .dacts .btn
.dlg .dacts .btn.dg
.dlg .dbody
.dlg .dbox
.dlg h3
.dlg.on
.empty
.empty .em
.empty .eo
.empty .eo .ic
.empty .esub
.empty div
.grid2
.grip
.hit
.hit .ic
.hit.img
.hits
.iconbtn
.iconbtn .dot
.iconbtn .dot.bad
.iconbtn .ic
.iconbtn img.brand
.iconbtn:active
.kv
.kv span:first-child
.kv span:last-child
.li
.li .lico
.li .lico .ic
.li:active
.li:first-child
.pclose
.pclose:active
.pfoot
.pfoot .btn
.pfoot .count
.pfoot .count b
.pfoot .sp
.pill
.rip
.search
.search .sclr
.search .sico
.search .sico .ic
.search input
.search.has .sclr
.search:focus-within
.seg
.seg button
.seg button.on
.seg button:active
.sheet
.sheet .panel
.sheet .panel.full
.sheet .panel>h2
.sheet.closing .panel
.sheet.on
.skel
.skel.img
.skel.l
.skel.s
.spin
.sw
.sw.dis
.sw.on
.sw.on:after
.sw:after
.tabbar
.tabbar .fab
.tabbar .fab .fico
.tabbar .fab.hide
.tabbar .fab:active
.tabbar .fab:active .fico
.tabbar .ind
.tabbar .tab
.tabbar .tab .ti
.tabbar .tab .ti .ic
.tabbar .tab em
.tabbar .tab.on
.tabbar .tab.on .ti
.tabbar .tab.on::before
.tabbar .tab::before
.tabbar .tab:active
.topbar
@keyframes bob
@keyframes cardin
@keyframes cbpop
@keyframes down
@keyframes fabin
@keyframes factin
@keyframes grow
@keyframes hitin
@keyframes pop
@keyframes rip
@keyframes shim
@keyframes sp
@keyframes spin
@keyframes strike
@keyframes todoenter
@keyframes tokflash
@keyframes undone
@keyframes up
```

### `go/ui/css/views/shell.css` — 11 条规则 — owner Tony

```
.missed
.missed .cbar
.missed .cbsub
.missed .mi
.missed b
.msrow
.msrow .mcd
.msrow .mt
.msrow .mt .mts
.msrow .mt .mtt
.msrow:last-child
```

### `go/ui/css/views/notes.css` — 30 条规则 — owner Austin

```
.acard
.acard.gone
.acard:active
.acts
.aglyph
.agrid
.ameta
.amiss
.aname
.anote
.arow
.arow .btn
.athumb
.errbox
.metrics
.metrics .m
.metrics .m b
.metrics .m span
.metrics .m.hot
.metrics .m.hot b
.metrics .m.wide
.metrics .m.wide.ok
.metrics .m:active
.remind
.remind .ic
.remind:active
.strip
.strip .sp
.strip b
.strip i
.thumb
```

### `go/ui/css/views/todos.css` — 32 条规则 — owner Austin

```
.cd
.cd .ic
.cd.done
.cd.over
.cd.soon
.due
.due .ic
.due.over
.due.today
.facts
.facts .fa
.facts .fh
.facts .fh .ic
.facts .fq
.facts .fr
.facts .fr:last-child
.pri-high
.pri-low
.todo
.todo.done .ttx
.todo.done .tx
.todo.enter
.todo.flash
.todo.justdone .ttx
.todo.justdone .ttx::after
.todo.leaving
.todo.undone
.todo:first-child
.ttx
.tx
.tx small
.tx small>*
```

### `go/ui/css/views/files.css` — 13 条规则 — owner Austin

```
.fcb
.fcb .ic
.fin
.fin:focus
.frow
.frow .fmeta
.frow .fname
.frow .fpath
.frow.gone
.frow.on
.frow.on .fcb
.frow.on .fcb .ic
.frow:last-child
```

### `go/ui/css/views/shots.css` — 22 条规则 — owner Tony

```
.ovl
.ovlcard
.ovlcard .orw
.ovlcard .osub
.ovlcard b
.owarn
.owarn .ic
.shotbanner
.shotbanner .cbar
.shotbanner .cbsub
.shotbanner .si
.shotbanner b
.shotck
.shotck .ic
.shotgrid
.shotitem
.shotitem img
.shotitem.on
.shotitem.on .shotck
.shotitem.on .shotck .ic
.shotitem.on:after
.shottime
```

### `go/ui/css/views/clip.css` — 22 条规则 — owner Tony

```
.clicb
.clicb .ic
.clicb:before
.climeta
.climthumb
.clipacts
.clipacts .btn
.clipbanner
.clipbanner .cbar
.clipbanner .cbsub
.clipbanner b
.clipbody
.clipdel
.clipdel:active
.clipitem
.clipitem.on
.clipitem.on .clicb .ic
.clipitem.on .clicb:before
.clipload
.cliprev
.cliptop
.cliptop .sp
```

### `go/ui/css/views/stats.css` — 29 条规则 — owner Tony

我的页（`renderMine()` app.js:1381）的全部样式：头部 hero + 计数卡 stat +
活动柱状图 chart + 标签分布。`.hero`/`.stat` 一开始被归到 notes，查过渲染函数后
确认是 mine 页 → 归 stats（owner 从 Austin 改成 Tony）。

```
.chart
.chart .bar
.chart .bar.d
.chart .bar.n
.chart .bars
.chart .col
.chart .lb
.hero
.hero .hlogo
.hero .hlogo img
.hero .hrow
.hero .hstats
.hero .hstats .ic
.hero .hstats span
.hero .hver
.hero h1
.hero p
.hero:after
.legend
.legend i
.stat
.stat .si
.stat .si .ic
.stat b
.stat span
.stat.hot .si
.statgrid
.tagrow
```

### `go/ui/css/views/settings.css` — 6 条规则 — owner Tony

```
.panel.page
.panel.page .grip
.pbody
.pgroup
.pgroup:first-child
.phead
```
