# 更新日志

版本按开发阶段（Pn）记录，全部在手机上完成。界面改动都经过后台屏截图核对 +
`tools/ui_test.js`（122 项 UI 结构契约，S3 步骤 11 起吸收了原 `ui_sig_test.js` 的 84 项签名）
+ `go test ./...`。

## 0.1（当前）

### 测试基线（P13 S8 步骤 1，D18）

* **`test.sh` 跑前重置数据**（默认开，`--no-reset` 关）：先删 `shot.json` / `shotseen.json` /
  `inbox/`（暂存记录、「永远别再提醒」表、「已扫过」表，app 只在启动时读，所以必须赶在
  `am_start` 前），再走 API 清空笔记+附件、剪贴板暂存、截图暂存，然后原样回写 settings 并把
  主题归一到 light。不用 `pm clear`：LLM 的 base URL / key / 目标文件夹存在 app 私有 prefs 里，
  测试全程不写它们，清了必红。基线断言 `notes=0 todos=0 clip=0 theme=light base=yes att=0 shots=0`。
* **重置基线当场揪出两个靠设施历史数据才绿的用例**：`go/stats_test.go` 的 due 写 `T23:00`，
  而这台机器 Go 的 `time.Local` 是 UTC（设备 CST+8），本地 00:00–08:00 每天固定红 8 小时（改 `T23:59`）；
  P8.5 面板点的是第二行，重置后只剩 1 条逾期项就假红（现在用例自己造 2 条固定装置）。

### 界面（P13 S8 步骤 2，D12 / D21）：转 ES module + 导出表 + 状态桥

* **`index.html` 的 `<script>` 加 `type="module"`**，与导出表、闸门① 同批落地（D12：中间态
  不能存在）。页面里 70 处内联 handler（69 onclick + 1 oninput）按**全局**作用域解析函数名，
  转 module 后顶层 function 变成模块作用域 —— 少了导出表就是 70 个 handler 全部静默失效，
  点了没反应、控制台什么都不说（P12 那一类）。
* `app.js` 末尾新增**单处对象字面量** `window.__enoteActions = { … }`，57 个 key
  = 内联 handler 调用的 54 个 ∪ jseval 载荷独有的 `api refresh render`；紧跟
  `Object.assign(window, window.__enoteActions)` —— 这是「70 处 handler 逐字不动」的唯一办法。
* **状态桥 `window.__enote.state`**（D21）：`tab S MISSED open shotSel shotList` 六个，全部 get+set。
  `tab` / `MISSED` / `shotSel` 在测试载荷里是整体赋值，**没 setter 就会假绿**：赋值只在 window 上
  新建一个同名全局变量，模块里的变量一动不动，测试全绿而界面没动。`test.sh` 的 5 个 jseval 载荷
  已全部改走状态桥（函数名保持裸调用，靠 `Object.assign`）。
* `go/web_test.go` 的 D9 断言**反向**：从「不许有 type="module"」改成「必须有 module + 导出表 +
  `Object.assign` + 状态桥」，缺任一项判红；`tools/ui_test.js` 闸门①（Tony）按
  「handler 调用的函数名 ⊆ 导出表 key ∪ 内建」判红，能单独报出 module 无表 / 有表缺
  `Object.assign` / 表缺 key 三种失效。
* **重复顶层声明 `dueMs` 是转 module 的拦路虎**（真机跑出来的）：`app.js:133`（正则解析
  `YYYY-MM-DD[ HH:MM]`）与 `app.js:970`（`new Date(iso)`）同名。普通脚本里 function 声明提升时
  **后者覆盖前者**，:133 那份从写下来就没执行过；ES module 不允许顶层同名 function 声明，
  直接 `Uncaught SyntaxError: Identifier 'dueMs' has already been declared`，**整个模块不执行**。
  症状很隐蔽：index.html 正常加载（`script type=module`）、`/js/app.js` 正常取到 82306 字节且
  内容含导出表，但 `typeof api === "undefined"`，页面全空。已删死代码那份（行为零变化），
  并要闸门加一条「顶层声明不得重名」（闸门③）：只抽顶层 `function`/`let`/`const`/`var` 声明名，
  `var+var` 重复合法，`function` 参与的重名才判红（实测全文件只 `dueMs` 一处）。
* **运行时防线**（`test.sh` P6.6 载荷之前）：静态闸门能证明源码里写了导出表，证明不了它在真机
  WebView 里活着（实测：静态 13 闸门 + 签名 84 全绿，P6.6 直接 exit 1）。新载荷挨个打印
  `typeof __enote` / `Object.keys(__enote.actions)` / `typeof window.delNote` /
  `typeof window.open` / `typeof __enote.state.tab`，断言 key 名单与 app.js 里的导出表**逐项相等**
  （名单从 app.js 现取，不在测试里重复钉数字），三个哨兵各盯一种失效：module 没加载（白屏）、
  `Object.assign` 没跑（70 个 handler 全废，P12 那一类）、状态桥没接上。
* **`open` 是最阴的一个**（Tony 发现，方向和我第一版哨兵相反）：`app.js:6` 的 `var open = {}`
  在非 module 树上把原生 `window.open` 盖掉了，所以载荷里裸 `open` 拿到的是 app 的对象；
  module 作用域不是全局作用域，module 化后 `var open` **不再往 window 上挂**，裸 `open` 变回原生
  函数，`Object.keys(open).length` **恒为 0 不抛异常**，`jumped=` 断言静默变假。已迁到
  `__enote.state.open`，哨兵也钉成两条：`typeof window.open === "function"`（证明模块作用域隔离
  生效）+ `typeof __enote.state.open === "object"`（证明 app 那份 open 映射从桥上拿得到）。
  实测这条闸门第一版就写反了（断言 `window.open` 是 object），是运行时防线当场抓出来的。
* **测试可追溯性**：`test.sh` 的 install 步骤打印 APK sha256 + HEAD + 分支名。设备是共享的，
  两个 worktree 轮流装，本轮被对方的安装 / force-stop 打断过两次，事后得能自证跑的是谁的树。
* `vd.sh` 修一个竞态：`id` 读的是启动时写的文件，而旧 app 退出时的异步钩子会把**自己的旧
  display id** 写回去（实测新 VD 是 36，文件里是旧的 37）→ `am start --display 37` 报
  `Permission Denial ... launchDisplayId=37`，整轮测试在启动那步就 exit 255。现在按
  `dumpsys display` 的 uniqueId 现查活着的 id，文件只当兼容回退；`create` 还等旧命名 display
  真的消失（旧 app 退出钩子会 `removeVirtualDisplay` 把新建的拆掉）。
* 两个实测结论（Austin / Tony 各扫一遍，互为验证）：strict mode **安全**，6 个隐式全局候选
  （`shotStartAt stopped iv stBusy prefsLoaded animLock`）全是逗号声明列表的后续名字；
  jseval 闭集是 **16 不是 15**（状态是 6 个，`shotList` 被 `test.sh:1102` 用到）。
* 记账：注释里不能写 `onclick="…"` 这种字面量（闸门按文本扫 handler，会把注释里的例子当真）；
  module 把 WebView 地板从 Chrome 58 抬到 61，feature probe 在步骤 3，中间有一个「老 WebView
  白屏无提示」的窗口（不判红：VENDOR.md 的语言基线是 ES2020/Chrome 80）。
* **测试设施**：`vd.sh` 的 display id 改以 `dumpsys display` 里名为 `apkdbg` 的 display 为权威
  （id 文件会被旧 daemon 的异步 shutdown hook 写回旧值），`create` 先等旧 display 消失；
  `test.sh` 的 `am_start` 遇到 Permission Denial 会用真 id 重试并更新 `VDID`。
  症状：跑测途中 display 换号后，P6.5 的 `am start --display 37` 直接退 255。

### 测试缝（P13 S8 步骤 3，D16 / D17）：`__enote` + `build.json` + feature probe

这一步是**纯增量**：不改任何界面行为，只把「页面到底活着没、跑的是哪一版」变成可断言的东西。
步骤 2 的教训是静态全绿而真机白屏，所以防线必须建在运行时。

* **`__enote` 测试缝**（D17，`app.js` 末尾）：`ready`（首屏画完兑现的 Promise）、`build`
  （`/build.json` 的内容）、`api(path, body)`、`dom:{main,sheet,panel,toast,dlg}`、`probe`、
  `markReady`。**必须 `Object.assign(window.__enote, {…})` 合并**：整份赋值会把步骤 2 的
  `state` 六个 getter/setter 全冲掉，载荷里 `tab="notes"` 变成往新对象上写，模块里的 `tab`
  一动不动 —— 那 11 处载荷集体假绿，比白屏难查一个量级。`go/web_test.go` 直接禁止
  `window.__enote = {` 这种写法，Tony 的反向实验（改成整份赋值）必须让运行时哨兵变红。
* `ready` 的兑现点做成 `markReady()`（`render()` 最后一句）而不是直接引用 Promise：`refresh()`
  在模块末尾的 `__enote` 装配**之前**就发出去了，直接引用会拿到 `undefined`。
* **`build.json`**（D17）：`build.sh` 在 go build/test 之前写 `go/ui/build.json`
  = `{sha, builtAt, app}`，由 `//go:embed all:ui` 打进二进制，`/build.json` 走 no-store。
  sha 带 `-dirty` 后缀：本轮多次全量跑在未提交的树上，不标出来就是谎话。
  设备是共享的（两个 worktree 轮流装），测试拿它和页面里的 `__enote.build.sha` 逐项比，
  才能断言「WebView 里跑的就是刚装的这版」；`test.sh` 的 install 行也把它打出来。
  它是构建产物 → 进 `.gitignore`，否则每次构建都弄脏工作区，EXECUTE 签名就没法签。
* **feature probe**（D16，`index.html` 内联）：必须是**普通内联脚本、在 module 之前、语法停在
  ES5**。老 WebView 连 `type="module"` 都不认，模块静默不执行 —— 探针写进 app.js 就是跟着
  一起死；探针自己用上新语法则是第一个解析失败的脚本。两种都回到白屏，probe 白写。
  探测项按「Vue 3 能跑的最小集」定：`Proxy`/`Reflect`（Chrome 49，Vue 3 响应式）、`Symbol`（45，
  Vue 内部标记）、`Promise`（32，fetch 链）、`Object.assign`（45，导出表/合并）、
  `padStart`（57，app.js 时间格式化）、`Object.entries`（54，Vue 模板遍历对象）——
  全部 ≤ module 的 Chrome 61，定高了会把本机 Chrome 159 挡在门外（假红），定低了永远不响（假绿）。
  实测 app.js 的 ES2020+ 特性用量是 **0**（无 `?.`/`??`/`Object.entries`），门槛不该按它定。
* **看门狗**：`WATCHDOG_MS = 12000`（Tony 提醒别太短：全量测试里首屏有慢的，P6 那几步带 sleep，
  阈值短了会变偶发假红）。两级：`__enote.actions` 不存在 → 模块没跑；模块跑了但 `ready`
  未兑现 → 首屏没画完。外加 capture 阶段的 `window.addEventListener('error', …, true)`，
  模块解析/加载失败立刻报，不等看门狗。失效时页面画一张红框卡片 + `document.title` 改成
  「界面没起来」+ `console.log('ENOTE PROBE FAIL …')`（test.sh 抓得到）。
  步骤 2 那个 `dueMs` 重名 SyntaxError 就是这套机制要抓的形状 —— 当时页面上一句话都没有。
* **运行时防线扩展**（`test.sh`，导出表闸门之后）：新载荷 `JSEVAL seam` 断言 `ready` 在 15s 内
  兑现、`build.sha` == `go/ui/build.json` 里的 sha、`dom.main` 是 `view:MAIN` 且
  `sheet/panel/toast/dlg` 齐、`api` 是函数、`probe.ok === true` 且 `moduleError` 为空。
  这同时替掉了 Tony 点名的 `typeof api === "function"` 脆弱哨兵（它连 module 没执行都看不出来）。
* `go/web_test.go`：内联 `<script>` 从「一律判红」改成「只允许 `id="probe"` 那一个」，并断言它
  不含箭头/模板字符串/`const`/`let`/`?.`/`??`/`class`、位置在 module 之前；D21 状态桥的六个名字
  **逐个钉** `get x()` / `set x(v)`（原来只钉 `window.__enote.state = {` 字面量，改名就漏）；
  新增 `TestBuildJSONServed`（200 / `application/json` / no-store / sha 形如 12 位 hex 可带
  `-dirty` / `builtAt` 是 UTC ISO8601）。Tony 确认 `ui_test.js` / `ui_sig_test.js` 都不统计内联
  script 数量，加探针不碰闸门基线。
* 两个踩过的坑：`git diff --quiet || git diff --cached --quiet || SHA="$SHA-dirty"` 会被第二个
  `--quiet`（返回 0）短路，未提交的树标不出 `-dirty`，改成 `if ! … || ! …; then`；`index.html`
  里**没有 `#main`**，主容器是 `<main id="view">`，所以 `dom.main` 取的是 `#view`。
* **probe 自己的判定式写错了，是运行时防线当场拓出来的**（全量首跑）：`Reflect` 是命名空间
  对象（同 `Math` / `JSON`），`typeof Reflect` 是 `'object'`，写成 `=== 'function'` 就永远报缺，
  Chrome 159 上直接假红（`missing=Reflect（Vue 3 响应式（Chrome 49））`）。修成探 Vue 3 真用的
  方法（`Reflect.ownKeys` / `Reflect.get`）。这类 bug **只有真跑一遍判定式才看得见**，所以新增
  `go/web_test.go` 的 `TestProbeSelfTest`：抽出探针脚本，在 node 的 `vm` 里用最小 window/document
  桩跑一遗，断言 `ok === true` 且 `missing` 为空（没 node 则 skip）——静态验收命令就能抖出来。
  顺手修一个解析陷阱：`missing` 里带说明文本（含空格）会把 seam 载荷的空格分隔 token 解析弄脏，
  现在 `missing` 只存名字，给人看的那份放 `missingDetail`（页面卡片用它）。

### 测试契约（P13 S8 步骤 4，D12b / D13）：`render()` → Promise + 闸门② 闭集

* **`render()` 现在返回 Promise**（D13）：今天的实现是同步 `innerHTML`，`return` 时 DOM 已经更新完，
  所以 `Promise.resolve()` 就是真语义（不是装样子）；步骤 5-10 视图转 Vue 后换成 `nextTick()`，
  调用点一行不用改。`markReady()` 留在 `return` **之前** —— `ready` 的语义是「首屏画完」，甩进
  `.then` 就变成「首屏之后的某个微任务」，步骤 3 的 seam 断言 `ready@0ms` 语义就变了。
  `app.js` 内部 16 处调用点一律不 await（Tony 逐条核过：没有一处紧跟读新 DOM），只有 3 处
  jseval 载荷 await —— 那里是「点完立刻断言 DOM」的场景。
* **2 处载荷的包装必须一起改**：`test.sh` 的 folderSheet / shotSheet 载荷包在同步 `(function(){` 里，
  直接加 `await` 是 SyntaxError —— 症状是整段载荷解析失败、JSEVAL token 集体消失（表现为
  「用例没跑」而不是「用例红了」）。
* **闸门② 重写为闭集断言**（D12b）：从 `test.sh` 抽 7 个 jseval 载荷（边界 = 单引号 JS 串，到
  `> "$TMPDIR/js*.json"` 为止），剥掉注释 / 字符串 / 正则字面量，抽自由标识符，减去载荷局部名，
  断言 == 闭集：函数 10 个（`api refresh render missedDismiss missedSheet folderPick folderSave
  folderSheet shotPick shotSheet`）；状态 6 个（`tab S MISSED open shotSel shotList`）必须只以
  `__enote.state.X` 出现，裸名判红。为什么这么狠：裸写 `tab="notes"` 是往 window 上写，模块里的
  `tab` 一动不动，测试全绿而界面根本没切页 —— 这种假绿比崩溃难查一个量级，而步骤 5-10 转 Vue
  之后（模块顶层名字不再自动是 window 属性）它会成批出现。
* 扫描器三条**实测**假阳性（都写进注释）：`.pane[data-tab=mine]` 这类选择器串会命中裸名 `tab`；
  载荷块后面的 Python（`open(sys.argv[1])` / `print` / `int`）不是 JS；`replace(/\s+/g,"")` 里的
  `g`/`d`/`s` 会被当成标识符。闸门自己的防线：载荷数 < 7 判红（抽取正则失效 = 闸门自己假绿）。
* 五条反向实验逐条变红：裸写 `tab="notes"`、删掉一个 `await`、引入闭集外的新全局、把一处载荷的
  输出文件改名（载荷扫不到）、闭集里 `shotPick` 不再被引用。
* Tony 审步骤 3 的三条后续一并落地：probe 的 `Object.entries` 依据改成「版本下限哨兵」（vendored
  Vue 3.5.46 里 `Object.entries` **0 次**、`Object.keys` 11 次，实测）；`TestBuildJSONServed` 在
  `go/ui/build.json` 缺失时 `t.Skip`（它是构建产物、进了 `.gitignore`，干净树上新 clone 必红）；
  `__enote.buildReady` 存下 build.json 的 fetch promise，seam 载荷带超时 await 并断言
  `buildready=ok`（`ready` 首屏就兑现、`build` 由独立 fetch 填，原本没顺序保证）。
* `go/web_test.go` 钉住 D13：`render()` 必须 `return Promise.resolve()`，且 `markReady()` 在 return 之前。
* 闸门② 补上**逐载荷编译检查**：每个载荷过一遍 `new Function(body)`。包装漏改 `async` 是整段
  SyntaxError（JSEVAL token 集体消失），静态就能抓，不用等真机跑完才知道。

### 界面（P13 S3 步骤 5，D14）：Notes 页转 Vue + 定下组件模式模板

* **首页（笔记页）现在由 Vue 渲染**，其余七个页还是字符串路径。开关是 `app.js` 里的
  `var VUE_VIEWS = { notes: NotesView }`：加一行迁移一个视图，删一行退回今天的路径。
  用户看到的东西不变（这一步的验收就是「行为零变化」），变的是实现与可验证性。
* **组件模式模板定下来了**（步骤 6/7/9/10 照抄）：结构（循环 / 条件 / 卡片骨架）用模板语法，
  叶子片段（图标、chip、待办行、facts）用 `v-html` 复用现成的字符串函数，DOM 与今天逐字一致；
  视图根读 `V.tick`，子组件一律收 `:tick="tick"`；模板里只写 `H.名字(…)` 直调。
* **修掉一个真机才暴露的静默失效**：删光剪贴板后首页横幅不消失。组件里的
  `computed(() => H.S.info.clip)` 没有响应式依赖（`S` 是普通模块变量），computed 永远缓存，
  视图停在首帧。现在所有读模块状态的 computed 一律包 `live(() => …)`（依赖渲染计数器），
  闸门⑮ 静态守这条：组件里出现没包 `live()` 的 `computed(` 直接判红。
* **新增闸门⑮**（`tools/ui_test.js`）：6 个 Vue 模板全部过 vendored Vue 的 `compile()`（在 node 里跑）；
  注册表里的视图必须读 `V.tick`、子组件必须全收 `:tick`；模板里的 handler 名必须在导出表里
  （Vue 模板用 `@click`，闸门① 只认 `onclick="…"`，不扩它验的集就会静默缩小）。
* **新增 DOM 逐字一致夹具**（`test.sh`，Tony）：在真 WebView 里把 Vue 产出的 DOM 与遗留字符串
  渲染器各渲染一次，规范化（属性按名排序 / 空白折叠 / 文本 trim）后逐字比。签名 84 项是源码级
  正则，抓不到 DOM 漂移，这条是步骤 5-10「行为零变化」的唯一硬证据。
* `shotGo(kind)`：截图横幅四种状态点下去各去哪，从模板里的动态成员访问 `H[text.go]()` 改成显式函数
  （导出表 57 → 58 key）——动态成员访问静态抓不到，拼错就是「点了没反应」（P12 同款）。
* **DOM 逐字一致夹具跑通了：`same=1`**（真机，规范化后 8078 字节逐字相等）。跑的过程中抓到四处
   真漂移：① `:style` 的序列化与字符串写法不同（`--i:0` vs `--i: 0;`，CSS 语义等价，夹具两边
   都过一遍 `cssText`）；② 遗留路径的内联 `onclick` 属性在 Vue 侧不存在（绑定机制不是 DOM
   形状，两条路径的 handler 由闸门①/①b 分别验）；③ `v-html` 必顶多一层包装，所以被复用的
   字符串函数要拆成「内层」（新增 `factsInner`）；④ 字符串侧要过一遍和 `render()` 同样的收尾
   （`syncExpand` 会按正文高度隐藏「展开详情」按钮），为此加了 `__enote.afterPaint` 缝。
* 记账：VDIFF 夹具第一版「一条也没打出来」不是前端抛异常，是载荷根本没执行——jseval 钩子只在
  `.devmode` 存在时干活，夹具块紧跟在上一块删 `.devmode` 之后注入；签名测试的失败行是
  `  FAIL`（两个前导空格），`grep '^FAIL'` 恒为 0，判据要用 ok 计数。

* **状态桥闭合集 16 → 17（+`SR`，D21）**：夹具里 `S.notes=[]` + `await render()` 画不出空态，
  烧了两轮真机探针才定位，根因两条且都不是 Vue 的问题：`notesFiltered()` 的第一优先级是
  `if(SR.notes) return SR.notes`（服务端搜索结果），而 app 每 ~2s 轮询 `/api/state` 整体替换 `S`，
  载荷的赋值活不过下一次轮询 —— 症状看起来像「Vue 视图的 computed 冻住了」。
  空态的正解是走 API：删完 → `refresh(true)` → `.empty` 出现（真机实测 `cards=0 empty=true`）。
  `SR` 进闭合集是给夹具做诊断用，不是让它造空态。探针证据链见 plan.md §9.9。

### 界面（P13 S3 步骤 6）：待办页转 Vue + `.cb` 裁切用数据核销

* **待办页现在由 Vue 渲染**（`go/ui/js/views/todos.js`：`TodosView` + 子组件 `TodoRow`），
  注册表 `VUE_VIEWS` 加一行 `todos: TodosView`。分组 / 排序 / 筛选在 Vue 的 computed 里重算，
  `.cb` 与 `.tx` 两块叶子 HTML 走 `v-html` 复用 app.js 新抽的 `cbInnerHTML()` / `todoTxHTML()` /
  `todoRowCls()`，遗留字符串渲染器改成调同一对函数 —— DOM 逐字一致不是约定，是共用一份代码。
* **新增 Vue 路径的观测缝**：`render()` 的门禁是 `VUE_VIEWS[tab]`，而 VDIFF 比的是 DOM、两条
  路径的 DOM 设上就逐字相同 —— 所以步骤 5 的用例结构上区分不了「Vue 没跑」和「Vue 跑了」。
  app.js 现在导出 `window.__enote.vue = { app, views, apps, isVue }`（观测缝，不是生产门禁），
  TINT 断言 `isVue(todos) === true` 且 `apps.todos` 非空。防线：`go/web_test.go` 钉住注册表含
  notes+todos 且 `window.__enote.vue =` 必须存在；闸门⑮ 新增两条静态检查（视图里的 `H.xxx`
  必须在 `setHost({...})` 的 key 里 —— Vue 读的是宿主对象不是 window；模板里的每个自定义标签
  必须列在该视图的 `components:` 里，无全局豁免）。
* **三条防线全做了反向实验，顺手挖出闸门⑮ 自己恒绿**：① 删 `components:` 里的 `EmptyState` →
  立刻红（「模板用了 <empty-state> 但视图没在 components: 里注册」）；② 从 `setHost` 删掉模板用的
  `toggle` 或 setup 用的 `cbInnerHTML` → 立刻红；③ 把 `todos` 从注册表摘掉装到真机 → TINT 红在
  「`isVue(todos) 不是 true`」，而 `done1=true` / `moved=gone` / `srRows=2` / 几何全绿 ——
  直接证明只有这条断言能抓到「走了字符串路径」。实验② 之前不红：那条检查的捕获组编号错位
  （`m[1]` 是事件名，恒真）加上过滤方向写反（删的是「在集合里的」），两条合起来永不会红。
  修正后正向输出：`模板 handler 10 个全在导出表；视图里的 H.xxx 31 个全在 setHost`。
  顺带抓到 `setHost` 里两个不存在的名字（`isOver` / `priFilter`）：它们会让 app.js 在模块求值时
  `ReferenceError` 白屏。
* **`.cb` 左边缘被裁：量出来三站点全都没裁，CSS 一行没改**。真机量 `.cb::before`（圆圈本体）
  左边缘 vs 父 `.todo` 的 padding-box 左边缘：待办列表 36.93 vs 35.43（+1.50px，正好是
  `::before` 的 `left:1.5px` 内缩）、笔记卡片预览同值、逾期面板 `.msrow .cb` +3.50px，
  `overflow:hidden` 没吃到圆圈。账本里那条是 S1 时代基线截图留下的，S2 的 tokens/base 落地时
  已经修掉了。几何断言现在钉在真机（见 TINT），红字直接给 circleL / padBoxL0 / overflow。
* **VDIFF 夹具参数化**成 `vdiff_tab()`，现在跑 `notes` + `todos` 两个 tab：以后每个视图转完 Vue
  自动拿到「DOM 逐字一致」这条防线，不用一个视图抄一遍。
* **新增 TINT 真机用例**（`Todos 交互在 Vue 路径上真的生效`）：`isVue`/`mounted`/切 tab 后
  `mounted2` 钉住 Vue 路径是活的；点 `.cb` 后服务端 `done` 必须翻转且行从「未完成」列表消失
  （`moved=gone`、`rows1=rows0-1`），再点回来必须复原；搜索态下渲染行数必须等于服务端
  `SR.todoIds` 里未完成的条数（`SR` 是模块 var，computed 不依赖它就会「搜索后列表不动」）；
  顺带量 `.cb` 几何。夹具自建两条 + 开头 purge 同名残留 + 结尾按 `ok:true` 计数，`cleaned==made`。
* **`/api/todo` 的删除动作是 `delete` 不是 `del`**，而 `go/web.go` 的 `switch` 没有 `default`：
  写错时服务端连响应体都不写，夹具永远删不掉，下一轮命中上一轮已勾完的旧夹具，症状是
  `done0=true` / `row=none`，完全像「Vue 渲染坏了」。
* **夹具要挂在解析已终结的笔记上**：`go/llm.go` 解析完成时是 `n.Todos = nil` 整体替换，
  赶在解析前插进去的夹具会被抹掉（探针全绿，suite 里 `done1=null rows1=0`）。现在先等所有笔记
  进 `done/raw/error` 终态再插。
* **jseval 日志约定一行一个键值对**：解析用的正则 `TINT (\w+)=(.*)` 每行只取一对，且 key 必须紧跟
  `=`（`geo0 circleL=…` 会被解析成 key=`circleL`，几何列表永远为空，实测假红）。
* **一个真机 flake（Tony 跑步骤 5 时遇到，本步修）**：`search + per-page prefs (server side)` 往
  服务端灌笔记后立刻查 `src=status:inbox`，而 app 的自动解析在后台跑，笔记被解析成 `status=done`
  → `ERROR: src/status filters are ignored`。现在该步骤开头先 `wait_parse_idle`（等所有笔记进
  `done/raw/error` 终态，120s 超时后照旧走原断言，不会把真 bug 藏起来）。
* **修了一个真 bug：待办页筛选面板里的「全部」是个空操作**。`prefPayload()` 把值为 `all`
  的筛选项省略掉，而 `go/search.go` 对 todos 在 `done` 缺失时默认成 `open` —— 用户点「全部」
  之后仍然只看得见未完成。现在 `done` 的 `all` 显式发给服务端（`matchTodo` 对 `done=all`
  不匹配任何 case → 不过滤）。这条是截图逼出来的：要让勾选态进画面就得选「全部」。
* **视觉验收脚本被 Tony 打回一次，三条都是「验收项自己空跑」**（详见 plan.md §9.11）：量不到
  `.cb` 从 warn+跳过 改成 die，四张图齐了才算过；脚本自己造三条夹具（逾期+high / 今天 /
  已完成）再截，不拍空态页；走真实用户路径点底部导航（`tab='todos'; render()` 不会同步
  `.tab.on`，图里会导航亮笔记、画面是待办），并断言 `.tab.on` 就是 todos。产出
  `docs/shots/vue-todos-{light,dark}.png` + 两张 `.cb` 特写（圆圈在明暗两档都完整）。
* 数字：Vue 模板 6→8 个、模板 handler 9→10 个、jseval 载荷 9→10 个、VDIFF 覆盖 1→2 个 tab；
  导出表 58 key、闸门 15 个、签名 84 项、D15 冻结 class 名 10 个全部不变。

### 界面（P13 S3 步骤 7）：附件页转 Vue

* **附件页现在由 Vue 渲染**（`go/ui/js/views/files.js`：`FilesView` + 子组件 `AttachCard`），
  注册表加一行 `files: FilesView`。三态（骨架屏 / 空态 / 网格）的判定顺序和遗留
  `renderFiles()` 逐字一致（骨架屏优先于空态，否则首屏会闪一下「还没有附件」）；
  strip 文案、卡片 class、glyph 图标、meta 行四条叶子 HTML 抽成 app.js 的
  `fileStripInner` / `filesSkeleton` / `attachCardCls` / `attachGlyphHTML` / `attachMetaHTML`，
  遗留渲染器和 Vue 组件共用。`FA` / `q` 走 `setHost` 的 getter：传值的话 Vue 拿到的是装配时
  那份快照，2s 轮询换掉 `FA` 后附件页永远停在首屏数据。
* **`setHost` 的写法是闸门认出来的字面量**：`tools/ui_test.js` 的 `setHostKeys()` 靠
  `setHost({` 定位对象字面量，改成 `var HOST = {…}; setHost(HOST)` 它直接返回空数组，
  「模板里的 `H.xxx` 全在 setHost」当场变 40 条红。FINT 载荷要调 `filesNow()`（它不是内联
  handler，不在导出表里），所以让 `setHost(h)` 返回 h，app.js 写 `var HOST = setHost({…})`，
  再把 `HOST` 挂到 `__enote.vue.host` 观测缝上（测试刷新某一页的唯一入口）。
* **`/api/attachments` 空库时 `items` 是 `null` 不是 `[]`**（Go 侧 nil slice 编码成 JSON null）：
  FINT 第一版在删除后的轮询里读 `r.items.length` 直接抛
  `Cannot read properties of null (reading 'length')`。JS 侧统一 `(r.items||[])`，
  shell 侧统一 `.get("items") or []`。
* **新增 FINT 真机用例**（`附件页交互在 Vue 路径上真的生效`）：夹具是 shell 侧分享进来的一个
  PDF（附件只能由分享意图产生，JS 侧没有建附件的 API），轮询 `/api/attachments?q=` 等它出现，
  不出现就 `fail`（夹具不存在 ⇒ 断言全空跑）。断言链：`isVue(files)` + 挂载 →
  `FA.items.length == 页面卡片数` → strip 文案含「附件 <total>」（证明读的是实时 `FA`）→
  点卡片出「预览即将上线」toast → 点删除弹确认框且真删到服务端 → 删完卡片少一张。
  夹具笔记在步骤末尾删掉。
* **`vdiff_tab files` 跑在空库上是空跑**：只比到 strip + 空态（145 字节），卡片网格这条主路径
  根本没进比较。现在夹具到位后先跑 `FLOAD` 载荷（`filesNow()` 真加载 `FA`，断言
  `loaded=true` 且 `fa>=1`），再跑第二次 `vdiff_tab files`，这次比的是真卡片。
* **`class="acard" :class="cls"` 会渲染成 `class="acard acard enter"`**：`attachCardCls()` 自带
  `acard`，Vue 拼接静态与动态 class，VDIFF 比 class 字符串就多一个 token。模板只写 `:class`。
* **闸门⑮ 自己还有一条空跑（记进步骤 11 审计清单）**：`tools/ui_test.js:852` 的
  `/template: `([\s\S]*?)`\n/` 只取每个视图文件里第一个 template 检查「子组件必须收
  `:tick="tick"`」，而 todos.js / files.js 的第一个 template 都是子组件（里面没有自定义元素），
  所以 `<empty-state>` 少写 `:tick` 一直没被报出来。
* **视觉验收脚本 `tools/shots_files.sh`**（步骤 6 的三条硬约束照搬）：自己分享两个夹具（一个
  PDF 走 glyph、一张 PNG 走缩略图），轮询断言附件数 ≥2，走真实导航点击并断言
  `.tabbar .tab.on == files`，量不到 `.acard` 直接 `die`，末尾自检四张图存在且明暗两张不同。
  产出 `docs/shots/vue-files-{light,dark}.png` + 两张卡片特写。
* 数字：Vue 模板 8→10 个、注册表 2→3 个视图、模板 handler 10→11 个、视图里的 `H.xxx` 31→40 个、
  jseval 载荷 10→12 个、VDIFF 覆盖 2→3 个 tab；导出表 58 key、签名 84 项、闸门 15 个不变。

#### 步骤 7 被 Tony 打回一次（一条真 DOM 漂移 + 三条空跑）

* **`<empty-state>` 收 `:tick` 是真 DOM 漂移**：`EmptyState` 的 props 只有 `icon/title/sub`，
  多传的 `:tick` 被 Vue 当透传属性落到根元素——真机实测 Vue 路径 `<div class="empty" tick="27">`，
  遗留 `__enote.legacy.files()` 是 `<div class="empty">`，VDIFF 的 `ser()` 比属性，一比就红。
  `files.js` 与 `notes.js` 两处都去掉 `:tick`（空态文案的响应性已由 `emptyTitle: live(...)` 覆盖）；
  `todos.js` 是反向问题：`<strip-bar/>` 对应的 StripBar **声明了** `props: ['tick']` 却没传，
  补成 `<strip-bar :tick="tick"/>`。
* **VDIFF 补第三遍：空态**。前两遍比的是骨架屏（`FA.loaded=false`，实测 `hasSkel=1 hasEmpty=0`）
  和网格（items 非空），空态分支（恰好是上面那条的现场）从没进过比较。现在 FINT 删完夹具后
  跑 FEMPTY 载荷（断言 `loaded=true`、`fa=0`、页面有 `.empty`、无 `.skel`、`.empty` 上没有
  `tick` 属性）再比一次。同时修掉「第一遍比到 strip + 空态」这句错的注释。
* **闸门⑮ 从「只看第一个模板」改成扫全部模板 + 双向 tick 规则 + 注册表完整性**（Tony 的反向
  实验：删 `attach-card` 的 `:tick` → 绿；删注册表里的 `files: FilesView` → 绿）。现在扫
  `js/**` 里每个 `export const X = {…}` 的 `props`：声明了 `tick` 的元素必须收 `:tick="tick"`，
  没声明的**禁止**收（收了就透传成 DOM 属性）；视图文件导出的每个 `*View` 必须在 `VUE_VIEWS`
  里。四条反向实验全部实测会红（删 attach-card 的 `:tick` / 注册表删 files / 给 empty-state
  加回 `:tick` / strip-bar 去 `:tick`）。
* `tools/shots_files.sh` 以 100644 提交，`./tools/shots_files.sh` 直接 Permission denied
  （其余 shots 脚本是 100755）—— `chmod 755` 并把 mode 一起提交。

### 界面（P13 S3 步骤 8）：截图暂存页 + 选文件夹页 + 导入进度层转 Vue

* **两个弹层页 + 一个 body 级进度层转 Vue**：新增 `go/ui/js/views/shots.js`（`ShotItem` /
  `ShotsView` / `ShotProgress`）与 `go/ui/js/views/folders.js`（`FolderRow` / `FoldersView`），
  `vue.js` 加 `mountSheet` / `unmountSheet` / `sheetPaint`，app.js 加**第二张注册表**
  `VUE_SHEETS = { shots, folders, progress }` 与 `pageSheetVue()` 分发。进度层挂在 body 级的
  `#shotOvlRoot`（不在 `.panel` 里）：`shotsImported()` 会先 `closeSheet()` 再等 AI 解析，
  进度层必须活过弹层。遗留字符串渲染器（`shotSheetHTML` / `folderListHTML` / `folderRows` …）
  全部保留并挂到 `__enote.legacy.*`，VDIFF 靠它们比对。
* **必修 bug：模板里用 `H.xxx` 的组件必须在 `setup()` 返回里暴露 `H`**（真点击用例抓出来的）。
  Vue 把模板表达式编成 `_ctx.H.xxx(...)`，没暴露时**渲染期不碰它就静默过**，点一下才抛
  `TypeError: Cannot read properties of undefined (reading 'shotSelAll')` —— 全选 / 全不选 /
  只选截图目录 / 搜索框全部点了没反应，而 VDIFF（比 DOM）+ 84 项签名 + 闸门⑮ 全绿。
  闸门⑮ 新增静态检查：模板用了 `H.xxx` 的组件必须在 `setup()` 返回里出现 `H,`
  （反向实验：删 `ShotItem` 的 `H` → 红，删 `FoldersView` 的 `H` → 红）。
* **`closeSheet()` 的 110ms 收起动画有竞态**：关弹层后 110ms 内重开，迟到的定时器会把刚
  `mountSheet` 出来的新实例卸掉 —— DOM 还留在 `.panel` 里而 app 已死，弹层空白且点了没反应。
  加 `sheetGen` 世代号，三个开启入口（`pageSheet` / `pageSheetVue` / `sheet`）各自 bump，
  回调发现世代变了就什么都不做。
* **folders 搜索框的 `:value="fq"` 造成真 DOM 漂移**：Vue 会把 `value` 写成 DOM 属性，
  `innerHTML` 多一个 `value=""` → VDIFF folders 在 `<input>` 处红。输入节点是静态的、重画不
  重建，去掉受控即可（遗留路径本来也是非受控）。
* **测试缝**：`__enote.vue.{sheets, VUE_SHEETS, isVueSheet, shotPaint, folderPaint}`；状态桥
  7→10 名（`folderAll` / `folderSel` / `folderQ`，get+set 都要 —— 没 setter 时夹具注入是空跑）；
  导出表 58→60 key（`shotOverlay` / `shotOvlSub`，进度层的入/出口，真跑一次 AI 解析要几十秒
  且依赖 LLM，直接调这两个函数比等真导入稳定）。
* **`vdiff_sheet <页> <形态>` 参数化夹具**（Austin）：复用 `vdiff_tab` 的 ser/norm/canon，跳过
  `on*` 属性，日志窗口用 `readtlog`。四遍：截图页网格（shell 侧分享两张 PNG 进 inbox，再走
  真 `/api/shots/add` 断言 `added=2`）/ 截图页空态 / 选文件夹页注入三个目录（含 `missing:true`
  分支与「已选浮到顶」排序）/ 选文件夹页空目录。每遍都断言 `isvue=1` + `mounted=1` —— VDIFF 比
  的是 DOM，而两条路径的 DOM 按设计逐字相同，它结构上分不出走了哪条路径。
* **两条真点击交互用例**（Austin 的截图页 + Tony 的文件夹页）：`.shotitem` / `.cliptop .btn.sm`
  用 `element.click()`，断言选中数与底部计数**真的变**、只选一张时三个导入按钮塌成「创建
  笔记」、全选/全不选生效。「勾选后滚动不跳」原来在真机上是空跑（只 3 个目录，页面滚不动），
  现在用状态桥注 40 个假目录（断言 `fakescroll=1`）再测，容差一行高 ~57px —— Chrome 的 scroll
  anchoring 会在上方内容被移动时主动调 `scrollTop`（真机实测 delta=58），真正要断言的是「不跳回
  顶部」（`innerHTML` 重建的旧病）。
* **闸门② 的载荷提取有盲区**（Tony）：原来只扫 `python -c sys.argv[1]` 那种写法，
  `js = r'''…'''` heredoc 载荷（截图页交互用例）完全在视野外；现在两种都扫（12→15 个），
  全局闭集补 `closeSheet` / `folderFilter` / `shotOverlay` / `shotOvlSub`。
* **视觉**：`tools/shots_vue.sh` 扩到 8 张（夹具走真 `/api/shots/add`，自检 8 图互不相同），
  新增 `docs/shots/vue-shots-{light,dark}.png`、`vue-folders-light.png`、`vue-progress.png`。
* 数字：Vue 模板 10→15 个（⑮ 扫 13 个）、注册表 3 视图 + 3 弹层、组件 tick prop 10 个、
  模板 handler 11→20 个、`H.xxx` 40→59 个、暴露 `H` 的组件 6 个、导出表 60 key、状态桥 10 名、
  jseval 载荷 12→15 个、VDIFF 3 tab + 4 弹层遍、真机套件 54→59 项 ok。

### 界面（P13 S3 步骤 9）：剪贴板暂存页转 Vue

* **新增 `go/ui/js/views/clip.js`**（`ClipItem` / `ClipSheetView`），注册表加
  `clip: ClipSheetView`，`clipSheet()` 走 `pageSheetVue('clip','剪贴板暂存')`，`closeSheet()`
  的世代号收尾补 `unmountSheet('clip')`。遗留侧的 innerHTML 拼接抽成两条路径共用的叶子
  函数：`clipItemCls` / `clipPrevText` / `clipThumbText` / `clipMetaText` / `clipItemHTML` /
  `clipListHTML` / `clipCountHTML` / `clipParseText` / `clipSheetHTML`（VDIFF 基准，挂
  `__enote.legacy.clip`）。
* **模块变量 `clipList`（+ `clipLoading` / `clipError`）**取代「loadClips 直接写 innerHTML」；
  状态桥加 `clipList` / `clipSel`（闭集 20→22 名，app.js / `go/web_test.go` /
  `tools/ui_test.js` 三处名单同步）；`clipPick` / `clipSelAll` / `clipCount` 在 Vue 路径
  `return sheetPaint()`。
* **删掉遗留路径给 `.clicb` 加 `on` 的那次 class 切换**：CSS 里没有 `.clicb.on` 规则
  （勾选态由 `.clipitem.on .clicb` 驱动），它一直是空操作；留着就是两条路径的 DOM 差一个类名。
* **`loadClips()` 的 `clipSel` 清理不再在空列表分支提前 return**：旧代码 `clips.length===0`
  时留着上一批的 id 不删（计数以页面条目为准所以看不出来，`clipDelSel` 会去删已经不存在的 id）。
* **`clipDel` 的 HTML 引号 bug（VDIFF 抓出来的真 bug）**：遗留字符串写
  `onclick="clipDel(event," + JSON.stringify(id) + ")"`，双引号套在双引号属性里，浏览器在第一
  个内层引号就截断 → DOM 里是 `onclick="clipDel(event,"`（半个表达式，点一下抛 SyntaxError，
  **剪贴板页每条的删除按钮从来没生效过**）外加一个以 id 命名的野属性。改成单引号插值
  （id 由 `newID()` 生成，只含 `[0-9a-z]`）。
* **稳定 id（Tony 步骤 8 的账）**：`#clipSelAll`/`#clipSelNone`、`#shotSelAll`/`#shotSelNone`、
  `#folderSelAll`/`#folderSelNone`，clip 底部三按钮 `#clipDelSel`/`#clipRaw`/`#clipParseBtn`；
  遗留字符串与 Vue 模板逐字同 id（VDIFF 比属性）。test.sh 里四处按下标选按钮全换成 id
  （`querySelectorAll("#sheet .cliptop .btn.sm")[1]` 那种写法，加一个按钮就静默点错）。
* **VDIFF 扩到 3 tab + 6 弹层遍**：`clip grid`（夹具走 clipset 钩子，轮询断言 ≥3 条，
  不到位直接 fail 不 skip）+ `clip empty`（断言 `.empty`）。新增 **CIT** 真点击用例：
  点 `.clipitem` 勾选数与 `#clipFoot` 同步、全选/全不选、主按钮文案随勾选数收敛、
  点 `.clipdel` 删一条不顺手勾选（stopPropagation）、删除所选后就地换空态（弹层不关，与遗留一致）。
* **`skip` 分支从「打印 ok 并跳过」改成判红**（Tony 提，本步收掉）：`vdiff_tab` / `vdiff_sheet` /
  CIT / SIT 四处 python 侧原来见到 `skip=no-legacy` / `no-pane` / `no-sheet` / `no-vue-*` /
  `no-items` 就 `print("  ok …")` + `exit 0`。混合期早就结束，五个 tab + 四个弹层的遗留基准
  全在，缺任何一个都是「比较对象没了」，这一遍等于没测。改完 N6 反向实验（删
  `__enote.legacy.clip`）从全绿变红。
* **两个夹具坑（真机跑出来的）**：
  1. `go/clip.go:124`「同来源 5s 内 → 覆盖最新一条」——钩子写进来的 app 都是 `hook`，
     1s 连发三条实测塌成 1 条，网格那一遍没条目可比（第一次真机跑 fail 在这里）。三条夹具
     改成间隔 6s，文本互不相同（完全相同的那条会被直接丢弃）。
  2. `/api/clip/clear` 之后前台轮询会立刻把系统剪贴板上那条旧文本重新暂存，空态那一遍比的是
     1 条列表 —— 先把剪贴板写成空格再 clear。
  3. 计数条初始值不是「0 条已选」：`clipSel` 的冻结语义是首次见到某 id **默认选中**，所以
     刚加载完是「N 条已选 · 共 N 条」、主按钮带条数（CIT 第一版按「默认全不选」写断言，
     真机跑出来才发现）。三条 clipset 给套件带来 +12s（6s = `go/clip.go:124` 的 5s 去抖 + 1s 余量）。
* **反向实验六条（全部在真机 / 静态闸门上实测过）**：删注册表 `clip: ClipSheetView` →
  `go/web_test.go` FAIL；删状态桥 `clipList` → `go/web_test.go` FAIL；`ClipItem` 不暴露 `H` →
  闸门⑮ 红；删 `:tick="tick"` → 闸门⑮ 红；`computed` 不包 `live()` → 闸门⑮ 红；
  删 `__enote.legacy.clip` → **改 skip 分支前全绿**（真机 VDIFF 只打印
  `ok (skip=no-legacy)`），改完判红：`AssertionError: clip 这一遍没比成（no-legacy）：
  VDIFF 的基准/挂载点缺失，不许绿`。
* **视觉**：`tools/shots_vue.sh` 扩到 10 张（新增 `vue-clip-light` / `vue-clip-dark`，夹具走
  clipset 钩子 + 轮询断言 ≥3 条，自检明暗两张不同）。
* 数字：Vue 模板 15→17 个（⑮ 扫 13→15）、注册表 3 视图 + 3→4 弹层、组件 tick prop 10→11、
  模板 handler 20→24、`H.xxx` 59→74、暴露 `H` 的组件 6→8、导出表 60 key、状态桥 10→12 名、
  jseval 载荷 15→16 个、VDIFF 4→6 弹层遍、真机套件 59→63 项 ok（新增夹具 + clip grid /
  clip empty 两遍 VDIFF + CIT 真点击），套件时长 +约 15s（三条 clipset 夹具各隔 6s）。

### 界面（P13 S3 步骤 10）：我的页（tab）+ 设置页（弹层）转 Vue

* **新增 `go/ui/js/views/stats.js`**（`StatsStat` / `StatsChart` / `StatsLi` / `StatsView`）与
  **`go/ui/js/views/settings.js`**（`SettingsSheetView`）。注册表：`VUE_VIEWS` 加
  `mine: StatsView`（我的页是 tab），`VUE_SHEETS` 加 `settings: SettingsSheetView`
  （设置页是弹层，不是 tab）。`settingsSheet()` 变成分发器（Vue 走
  `pageSheetVue('settings','设置')`，否则 `pageSheet`），`$('#panel').dataset.kind='settings'`
  两条路径都写（CSS 钩子）；`closeSheet()` 补 `unmountSheet('settings')`。
* **`settingsRefresh()` 在 Vue 路径不重建 DOM**：改成 `sheetPaint()`（bump tick，computed 全
   失效重算）+ 滚位还原。重建会把输入框里正在打的字清掉 —— 设置页是全站唯一有六个输入框
   的页面，遗留路径是 innerHTML 整体重写，没这个顾虑。
* **两条路径共用的叶子函数**：`statsHeroInner`/`statsHeroHTML`、`statsNotesCardHTML`、
  `statsRunRowsHTML`/`statsRunInnerHTML`/`statsRunCardHTML`、`statCls`/`statHTML`/`liHTML`、
  `ocrReadyHTML`、`chartHTML`、`settingsCollectHTML`、`settingsOcrCardHTML`、`settingsUsageHTML`、
  `settingsKeepAliveNoteHTML`、`settingsDataCardHTML`、`settingsRunCardHTML`；遗留基准挂
  `__enote.legacy.mine` / `.settings`，入场动画的 seen 清掉新增缝 `__enote.clearSeen`。
* **真 bug 一：四个 handler 从步骤 2 起就是野名字**（Tony 的契约里点名要查的那处）。我的页的行是
  `liHTML(…, 'settingsSheet()')` 把 handler 当**字符串参数**传进去，闸门① 只扇 `onclick="…"`
  字面量，扇不到这种参数；转 module（步骤 2）后 `settingsSheet` / `scanShotsNow` /
  `rescanShots` / `clearShots` 不再是全局 → 我的页上「设置 / 现在扫描一次 / 回捞最近 7 天 /
  清空截图暂存」四行点了就是 `ReferenceError`（点了没反应，控制台一行日志）。四个名字补进
  导出表，并新增**闸门①d**：扇 handler 字符串参数里的调用名（68 处）必须全在导出表里。
* **真 bug 二：`exportJSON` 从来没定义过**。设置页的「导出 JSON」按钮与我的页那一行调的是一个
  不存在的名字（HEAD 里 `grep -c exportJSON` = 0，以前写的是内联 `location.href=…`），本次改成
  函数名后 module 加载时导出表求值直接抛 `ReferenceError: exportJSON is not defined` ——
  整页 JS 死在首屏（真机跑出来的，静态闸门全绿）。补 `function exportJSON(){ location.href =
  '/api/export' }`，两条路径共用。
* **闸门①e（Tony 的要求，封整类「首屏 JS 全死」）**：缺的不是 `exportJSON` 那一个名字，是
  「导出表里的右值必须是 app.js 里真存在的标识符」这条静态检查 —— 闸门① 只查「handler 名
  ⊆ 导出表 key」，表体 `exportJSON,` 的右值没人查，`node --check` 也不查未定义标识符，所以
  闸门与签名全绿的历史提交里带着一个首屏 ReferenceError（静态层对 module 求值期是盲的）。
  新闸门解析表体，凡右值是裸标识符的（简写 `{ api }` 与 `{ api: api }`）必须有 `function` /
  `var` / `let` / `const` / `class` / `import` 声明（含顶层解构），否则 FAIL 并列出名字。
* **VDIFF 的文本节点切分规则（本步踩满）**：序列化器逐文本节点 trim 后拼接，所以遗留的
  `'已排定 '+remindPending+' 条 · …'`（三个节点 → 「已排定12条 · …」）与模板里一个插值
  `{{ notifySub }}`（一个节点 → 「已排定 12 条 · …」）比不过。数据卡 / 运行状态卡 / 保活
  长说明整块改走叶子函数 v-html，提醒卡副标题按遗留的切分写三个插值，标签 chip 同理。
  规则写进 `views/stats.js` 文件头。
* **状态桥加 `ST`**（闭集 22→23 名，app.js / `go/web_test.go` / `tools/ui_test.js` 三处名单同步）；
  导出表 60→69 key（新增九个的动机写在表后的注释里，表体不能写注释 —— 运行时比对是粗解析）。
* **VDIFF 新增两遍 + 一个真点击用例**：`vdiff_tab mine`（带 ST 夹具的一遍 + 未加载骨架屏一遍，
  断言 `stats==6`/`chips==2`/骨架屏互斥）与 `vdiff_sheet settings`（`kind=settings`、六个输入框、
  seg 3 个、开关 ≥2、kv ≥10）；新增「设置页交互在 Vue 路径上真的生效」用例：从我的页点进设置 →
  主题 亮→暗→亮（`data-theme` 与 seg 选中态）→ AI 开关翻了再翻回（不留下改动）→ 保存得到
  「已保存」→ 清空全部只到确认框就取消（真机笔记不能删）→ 关闭卸载。`vdiff_tab` 夹具现在在两条
  路径各自开跑前调一次 `__enote.clearSeen()`（入场动画的 seen 是一次性状态，不清就是「谁先画
  谁拿到 enter」）。
* **VDIFF 的序列化现在归一化两处「绘制时机」差异**（都是真机跑出来的偶发红，不是审出来的）：
  ① `enter` 这个一次性入场动画标记（`enterCls` 只在某个 id 首次出现时给）从 class 里剔掉再比
  —— 它的有无取决于两条路径谁先画、后台轮询有没有在中间插一次重绘，那是时机不是 DOM 形状
  （动画本身由 CSS 与视觉截图覆盖）；本步第一次真机跑就是 todos 页红在 `card enter` vs `card`。
  ② 空的 `style` 属性与没有 `style` 属性等价（`syncExpand` 把「展开详情」按钮的 display 设过
  一遍再清掉，Vue 那侧留下 `style=""`，字符串路径没有这个属性），归一化后直接跳过该属性。
* **夹具坑（真机跑出来的）**：`Pictures/enote-test` 的 MediaStore 行不随 root 的 `rm` 消失，
  旧行 `date_added` 还是上次跑的时间，而扫描按 `rangeDays=1` 过滤 —— 跑满 24h 后两张测试图
  刚好掉出窗口，`added=0` 假红（本步验收第一次跑踩到，距上次绿跑 24h01m）。夹具现在先
  `content delete` 删行，让扫描重新登记。
* **反向实验（全部在真机 / 静态闸门上实测）**：删 `VUE_SHEETS.settings` 条目 →
  `go test -run TestIndexServedFromDirectory` FAIL（`web_test.go:179`）；`StatsLi` 不暴露 `H` →
  闸门⑮ 红；`computed` 不包 `live()` → 闸门⑮ 红；`components:` 里加回已删除的 `StatsKv` →
  闸门⑮ 红（新检查就是为这条加的）；从 HOST 与导出表同时删 `showLog` → 闸门①d 红
  （`showLog@go/ui/js/app.js×2`）而闸门① 仍绿 —— 证明①d 扇的是① 视野外的新面；导出表加一行
  `foo: notDefinedFn` → 闸门①e 红（`notDefinedFn`）。
* **夹具的第二个坑**：`vdiff_tab` 的断言脚本跑在 `"$PY" -c '…'` 里，python 写 `else ''` 会被
  shell 的单引号参数吃掉 → SyntaxError（症状是断言块整段没跑）。这类块里只能用双引号。
* **夹具的第四个坑（`stBusy` 这个互斥标志）**：`statsNow()` 开头是 `if(stBusy) return`，一次
  在飞的请求卡住就把后面所有调用全挡掉；套件里前一步刚清过库（`clearAllNotes` 把 ST 置 null），
  于是点「我的」tab 不会去取统计，我的页停在骨架屏，症状是「我的页上没有设置行」。用例现在直接
  `await api("/api/stats")` 注入状态桥（tab 仍然真点），不依赖那个标志。
* **夹具的第三个坑**：hero 的探针第一版读 `.hver`（版本号那一行，加载前后文本完全一样），断言
  「未加载那一遍必须含『正在统计』」就恒假 —— 「正在统计…」在 `.hstats` 里。探针选错元素等于
  断言恒假，本步第二次真机跑红在这里。
* **视觉**：`tools/shots_vue.sh` 扩到 14 张（新增 `vue-stats-light/dark`（ST 夹具注入，柱子 /
  数字 / chips 都有内容）与 `vue-settings-light/dark`，步骤 10 四张唯一数自检 4/4，明暗都人工看过：
  hero chips、6 张统计卡、图表柱子与图例、设置弹层的开关 / 分段 / 输入框值都在）。
* **截图夹具的五个坑（本步真机踩完）**：
  ① ST 夹具必须是完整 `/api/stats` 形状 —— 少 `ai` 时 `renderMine` 读 `s.ai.calls` 抛异常，
  截图停在上一页（第一版 stats 图其实是附件页）；
  ② `setTheme("dark")` 会让 Activity 走 night mode 重建、WebView 重新加载，**同一载荷里后面的
  语句随旧页面一起丢掉**（暗色设置页拍成「整屏糊掉、面板不在上面」）→ 主题改成单独一发
  （`settheme` 函数）+ 等 2.5s；
  ③ 重载之后 `.sheet.on .panel` 的入场过渡有概率不启动，面板停在初始态 → `SHEETON` 摘掉 `on`
  再强制回流挂回去，过渡一定重跑；
  ④ toast 是 `setTheme` 之后异步弹的，清 toast 必须放载荷**末尾**（放开头等于没清）；
  ⑤ `setTab` 没导出（导出它要动步骤 6 的基线），tabbar 高亮用 `MINEON` 直接改 class。
  另外脚本开头加 `am force-stop`：上一轮把 app 留在主屏时 `am start --display` 只回一句
  「delivered to currently running top-most instance」，整轮截图全是桌面（症状：唯一图片数 3/4）；
  `SHOT_WAIT=3` —— `am start` 立刻返回，载荷在 app 里异步跑，1.5s 沉降不够。
* 数字：Vue 模板 17→22 个（⑮ 扫 15→20）、注册表 3 视图 + 4 弹层 → **4 视图 + 5 弹层**、组件 tick
  prop 11→13、模板 handler 24→33、`H.xxx` 74→109、暴露 `H` 的组件 8→12、导出表 60→69 key、
  状态桥 12→13 名、jseval 载荷 16→17 个（闭集函数 15→16、render 的 await 12→11）、handler 总数
  121→131（内联 88 + Vue 模板 33 + 新增闸门①d 扫到 68 处 handler 字符串参数）、VDIFF 3 tab +
  6 弹层遍 → 4 tab + 7 弹层遍、静态签名 84 项、导出表右值 69 个全有声明、
  套件 63→**69 ok**（本步绿跑 EXIT=0，日志见 `test.sh --vd` 输出）、图片 10→**14**。

### 界面（P13 S3 步骤 11）：删光遗留 JS 与 sigOf，静态闸门 3 → 2

* **遗留渲染器整块拆掉**：`render()` 变成 Vue-only（注册表里没有的 tab 直接 `console.error` +
  `markReady()`，不再回落到字符串拼接），`shotSheet`/`loadShots`/`shotPick`/`shotSelAll`、
  文件夹页 6 个函数、剪贴板页 4 个函数、`settingsSheet`/`settingsRefresh` 里的
  `VUE_SHEETS.*` / `sheetApps.*` 分支全部删掉；`__enote.legacy`（VDIFF 的基准缝）与
  `afterPaint` 整块删除，导出表 69 → 67 key（`renderMineHTML` / `settingsHTML` 随实现没）。
  `app.js` **2499 → 1986 行（−513）**，删掉 **47 个只有死代码引用的函数**。
  删除用可达性不动点扫描（根 = 导出表 ∪ `setHost` ∪ 内联 handler ∪ 模板里的 `H.xxx` ∪
  顶层语句；注释里的名字算引用，所以只会漏删不会多删），扫描器本身第一版有 bug：
  按行数 `{`/`}` 会把 `function f(){ return x }` 判成「没开始」而吞掉下一个函数，改成逐字符扫。
  **`clipCountHTML` 必须留**（`views/clip.js` 的 `countHtml: live(() => H.clipCountHTML())`
  还在用）—— 这条是反向实验验出来的，不是靠读代码。
* **`sigOf` → `stateSig` + `SIG_SKIP` 排除表（契约翻转）**：原来手工挑要参与指纹的字段，
  漏一个就是静默不重绘（踩过 `info.shot` 漏了 → 首页横幅永不出现）；现在反过来整份
  `JSON.stringify([notes, info(去掉排除表), settings, 截图开关])`，只维护
  `SIG_SKIP = {uptimeS, tz, go, dir}`。代价是「列表不展示的字段变了会多画一次」——
  多画一次可见、Vue 的 patch 很便宜；漏字段的不重绘是静默的。签名行为断言 9 → **16** 项。
* **静态闸门 3 → 2**：`tools/ui_sig_test.js`（645 行、84 项）删除，签名段并入
  `tools/ui_test.js`（1066 → **1679** 行，**111 ok**，原 20 + 84 = 104，+7 全在签名行为）；
  `test.sh` 里两个 node 步骤合成一步「ui: 静态闸门（轮询指纹 / 内联 handler 存在性 /
  调色板一致性 / hex·px 棘轮）」。剩下的两份静态闸门 = `ui_test.js` + `go test ./...`。
* **VDIFF 随基准一起删**（基准没了就是恒绿闸门）：`test.sh` **2733 → 2351 行（−382）**、
  `step` **34 → 30**——两个 VDIFF step + `vdiff_tab` + `vdiff_sheet` + 全部调用（含
  `vdiff_tab files` 两次、`vdiff_sheet clip grid` / `clip empty` / `settings form`）删除，
  剪贴板页的 VDIFF 三步合并成「夹具 + 真点击交互」一步，夹具文字 `VDIFF 甲/乙/丙` →
  `夹具甲/乙/丙`；设置页载荷的 `legacy=` 探针与 `assert d["legacy"]=="1"` 随缝一起删。
  剪贴板夹具的两张图改成各自用 `tools/make_test_png.py` 现造（原来两次 `cp '$IMG'` →
  字节相同，「两张图」在像素上不可分）。
* **`go/web_test.go` 加遗留禁令**：`TestIndexServedFromDirectory` 断言 app.js 里不得出现
  `function buildPage` / `buildPage(tab)` / `function sigOf` / `__enote.legacy` / `legacy: {`
  —— 防「删掉的死代码被谁救回来」。
* **19 条反向实验全红得对**（`.test/s11_neg.sh`：脚本开头一次性备份 10 个文件到 `$TMPDIR`，
  `trap ... EXIT` 恢复，绝不用 `git checkout`；变异脚本必须原子——只在最后一步写文件）：
  签名 6 条（排除表去掉 uptimeS / 清空排除表 / 指纹不含 notes / 不含 settings / 不含截图开关 /
  不含 info）、`go test` 禁令 3 条、结构闸门 10 条（载荷调闭集外的 `settingsSheet` / 导出表右值
  不存在 / 内联 handler 指向不存在的函数 / 模板 handler 总数掉到基线下（须删 2 个，删 1 个刚好
  等于基线 73）/ 模板用 `setHost` 外的名字 / css 裸 hex / css 裸 px / 顶部 banner 顺序 /
  组件没暴露 `H`）。**「指纹不含截图开关」第一版没抓到**：签名段根本没有 SHOTFLAGS 的行为断言
  （它只是被 eval 的 `stateSig` 闭包到的一个夹具常量）—— 补了三条行为断言才红得对。
  已知盲区（记进步骤 13）：闸门③ 的 hex/px 棘轮**只扫 `go/ui/css/**`**，Vue 模板里的内联
  `style` 看不见；组件里把 `live(() => …)` 换成普通函数静态层全绿（computed 没依赖就永远缓存）。
  闸门⑮ 的 tick 扫描本步已扩到 `js/**` 全部模板（含 `components.js`）：扫的模板 20 → **25**。
* 数字：`app.js` 2499→**1986**、`test.sh` 2733→**2351**（step 34→**30**）、`ui_test.js`
  1066→**1679**（另删 `ui_sig_test.js` 645 行）、静态闸门 3→**2**、静态项数 104→**111 ok**、
  签名行为断言 9→**16**、导出表 69→**67** key、内联 handler 88→**31**（删掉的字符串渲染器里带的
  内联 `onclick`）、handler 总数 131→**74**（内联 31 + Vue 模板 43，基线 70→**73**）、
  闸门①d handler 字符串参数 68→**16**、jseval 载荷 17→**15** 个（闭集函数 16→15、
  render 的 await 11→10）、裸 hex **8** ≤ 8、裸 px **57** ≤ 57。真机套件 **30 步全绿**
  （EXIT=0，0 FAIL，0 skip）：`  ok` 行 69 → **146** —— 静态闸门步骤现在把 111 项 node 断言
  逐行内联打印（原来那一步只打 20 行、签名那一步一行不打），删掉的 VDIFF 三步 + 两次
  `vdiff_tab files` 共 −14 项真机断言。
* **Tony 审查打回一次：真机套件两次跑一次红一次绿**（同一 apk 同一设备，红的那次
  `FA.loaded 仍是 false：filesNow() 没拉到数据`）。根因在测试不在产品：附件页那三块载荷
  （FLOAD / FINT / FEMPTY）都是**单发一次 `await filesNow()` + 固定 sleep 就直接断言**，而
  `filesNow()` 用 `searchSeq`（**服务端搜索共用的序号**）丢弃过期结果 —— 套件里前后步骤都在
  `am start`、切 tab、写数据，只要期间 app 自己触发了一次 refresh，测试 await 的那次结果就被
  整次丢掉，`FA.loaded` 永远停在 false；绿的那次只是没撞上。三块都改成轮询（最多 12 次、每次
  250ms，每次重新发起，轮询到目标状态才继续；超时才 fail，`tries=` 打进日志与断言消息）。
  轮询闸门本身用 `.test/s11_flake_neg.sh` 证明不是恒绿：把 `app.js` 的 `filesNow()` 里
  `loaded:true` 改成 `loaded:false`（数据拉到了但 `FA.loaded` 永远是 false，正是竞态的表现），
  真机套件红在 `FA.loaded 仍是 false：filesNow() 轮询 12 次没拉到数据`（EXIT=1）。
  同一族剩下的「单发 await + 固定 sleep」用例（文件夹弹层 / 截图弹层 / 设置页 / TINT / NINT）
  已逐条列进 `plan.md` §9.17 的审计，步骤 12 一次性收；产品侧同一类（`filesNow()` 的
  `searchSeq`、`statsNow()` 的 `stBusy` 一次被抢占/卡住 → 这一页此后不再刷新，用户侧症状是
  附件页/我的页停在骨架屏）记进步骤 13。

### 测试（P13 S3 步骤 12）：OCR 搜索断言收紧 + 「固定 sleep 再断言」整族换轮询

* **为什么**：搜索用例的关键词是 `取快递`，本地 OCR 坏掉也照样绿 —— 分享图片时 LLM 会把图上的字
  回抄进标题/正文/待办（实测 title `取快递取件码 U7VQH4QM`、todo `取快递（取件码：…）`），
  「搜索命中」根本不证明 OCR 路径工作过。断言必须**只能由图片文字满足**。
* **新步骤「share 现造的随机串图 → 本地 OCR 逐字读出」**：图不来自仓库，是 app 自己在 WebView 里用
  canvas 现画的（1200×320 白底、`bold 100px sans-serif` 一行「取快递 + 8 位随机串」+ 一行 48px
  说明），随机串字符集去掉 OCR 易混的 0/O、1/I/l、2/Z、5/S、8/B **和 Q**（真机跑到 `RS=HEQKYTE4`
  被读成 `HEOKYTE4`，84px 下 Q 的尾巴丢了，于是同时把字号提到 100px、画布加宽）；PNG 的 base64
  走 testlog 分片回传（logcat 单行上限约 4KB，1200 字符一片，实测 34276 字符 / 29 片），python 侧
  拼片 + 校验 `len=` 与 PNG magic 后落盘，拷进 inbox 走 ShareActivity —— 与用户真实路径一致。
  断言 `source=share-image && ocrMs>0 && 随机串逐字出现在 ocrText`（实测 3 万余字节的图、
  OCR 26 字符 / 394ms）。
* **搜索断言收紧成「只能由图片文字满足」**：`q=<随机串>&src=text` → 0 命中；`q=<随机串>&src=image`
  → 恰好 1 条且 `where` 标签是 `来自图片文字`（`go/search.go` 的字段标签）；再加一条反向对照
  `q=<图上没有的随机串>` → 0 命中。可证的是**字段归属**而不是「正文里没有」（正文里真的有，LLM
  回抄的）。§9.17 审计「断言显式写出 src/status/pri/kind，不要只断言数量」一并收掉。
* **「单发 await + 固定 sleep 再断言」整族换轮询**（§9.17 审计 1–6 全部）：55 处替换覆盖文件夹弹层、
  剪贴板弹层、截图弹层、截图夹具载荷、设置页 SET、Notes NINT、Todos TINT、附件页 FINT、
  错过的提醒面板；统一 `poll(f,n,ms)` 助手（**必须 `await f()`**，NINT 传的是 async 谓词，
  不 await 时 Promise 恒真），每处打出 `tXxx=` 尝试次数，红的时候能分清「目标状态没到」和「到得慢」。
  固定 sleep 剩下的都在轮询循环体内，不是「睡一觉再断言」。
* **轮询的目标状态必须和它下面那条断言同源**，两次真机假红都是这条：错过的提醒面板轮询 `open`
  状态（状态先变、Vue 的 patch 在下一拍）红在「跳笔记之后面板没关掉」；设置页轮询「toast 非空」
  被上一条用例切主题的 toast（要挂 ~2s）立刻满足，红在「点保存没得到「已保存」（toast='主题：亮色'）」。
  现在分别轮询「open 增加且 `#sheet` 的 on 类摘掉」「toast 文案含已保存 / 含预览即将上线」。
* **闸门② 的载荷提取补盲**：正则以前只认一种写法，canvas 载荷（`.replace(...)` 形式）扫不到就等于
  不编译 → jseval 载荷 15→**16**、闸门⑯ 的 jseval 调用点 13→**14**。
* **两条反向实验**：`.test/s12_neg.sh`（画进图的随机串换成固定串 → 套件红在「OCR 没能在现造的图里
  读出 …」，实测 EXIT=1）、`.test/s12_poll_neg.sh`（产品侧 `toggleAI` 去掉「翻转 useAI」半句，DOM 的
  on 类照旧变 → `tFlip` 轮询超时、套件红在「点启用 AI 开关后 class 与 settings.useAI 没一起翻」；
  app.js 是 go:embed 进二进制的，脚本前后各 build + install 一次，跑完把干净 apk 装回去）。
* 外层等 `done=1` 的循环上限 20–60 → **90–120**（成功即 break，正常路径一秒都不多等）：载荷内部换
  轮询后最坏耗时变长，否则载荷里的轮询超时会被外层「载荷没跑完」盖住，红得没有信息量。
* **本步自己引入的竞态**（负向实验连撞两次）：新步骤刚 share 的图 OCR 先回、LLM 还在解析，解析回来
  整份重写 todos，而 `todo add / toggle / delete` 用例取的是 `notes[0]`，于是红在
  「the toggled todo is not what we wrote」；改成取 `status=="done"` 的笔记。
  教训：新增一条会产生笔记的步骤，等于把后面所有 `notes[0]` 的语义换掉了。
* 数字：`test.sh` 2351→**2624** 行、step 30→**31**、真机 `  ok` 146→**149**、静态闸门仍 **111 ok**、
  真机连续三次全绿（`$TMPDIR/t12e.log` / `t12f.log` / `t12g.log`）。

### 界面（P13 S3 步骤 13）：竞态与超时、裸 hex/px 清零、sheet 生命周期、窄屏计数

这一步收的是 §9.17/§9.18 明写「记进步骤 13」的账。四笔都是同一类：不是新 bug，
是**防线的覆盖范围落后于代码形态**。

* **一页一序号 + 请求超时（产品侧）**：`filesNow()` 以前借用服务端搜索的 `searchSeq` 做抢占判定，
  笔记页搜索一在飞，附件页这次请求的结果就被整次丢掉 → 附件页永久停在骨架屏，只能切走再切回来。
  `statsNow()` 的 `stBusy` 同类：没有超时，一次永不返回的 fetch 把我的页永久钉在骨架屏。
  现在每页用自己的序号（`filesSeq`），三个页面数据源都走新的 `apiTimeout`（12s，超时只放弃等待），
  失败写可观测的 `FA.error` / `stErr` / `srErr`，骨架屏上给文案 + 「立即重试」，附件页额外自动重试两次。
* **闸门⑰**：函数体切片检查（签名改了直接报「闸门在假绿」）—— 不许出现 `searchSeq`、必须走
  `apiTimeout`、失败必须记 error 且模板里可见可点。**真机 FPRE** 钉住并发抢占：
  反向实验（把 `filesNow` 改回借用 `searchSeq`）实测 `loaded=false`，断言必红。
* **裸 hex 8→0、裸 px 57→0，闸门③ 扫描范围扩到 `js/**`**：Vue 把结构搬进 js 后，新样式写在
  `style="…"` 里，而闸门③ 只扫 `css/**` —— 内联样式完全在账本外。现在只抽 style 属性内容
  （整扫 js 会把 `$('#fab')` 当成颜色），加两条假绿自检。刻度外的值就近归档，新增
  `--clear-bottom:104px` / `--on-solid` / `--mask-opaque` 三个 token。
  **闸门④** 把 app.js 写进 meta theme-color 的两个字面量纳入调色板一致性（第 6 处副本）。
* **sheet 生命周期**：`pageSheetVue` 只拆同名 sheet，而它会把 `.panel` 的 innerHTML 整块换掉 ——
  开过剪贴板页再开设置页，剪贴板那个 app 实例连同 effect 全泄漏在面板里；`closeSheet` 那边是
  手写四个名字，新增 sheet 忘了加就是静默泄漏。新增 `unmountAllSheets(keep)`（进度层是例外，
  它挂在 body 级的 `#shotOvlRoot`），**闸门⑱** 钉住不许再写硬编码名单，**真机 SLEAK** 断言
  `clip→settings` 之后 mount 表只剩 settings、关掉之后为空。
* **窄屏底部计数（步骤 8 记账）**：`.pfoot .count` 的 `min-width:0` 让计数在窄屏被压到比文字还窄，
  在「个已选 · 共」中间断行。现在计数整条不许断，挤不下就让按钮整条掉到第二行；
  真机加了四条窄屏断言（一行 / 不被裁 / 按钮不出条 / 不重叠）。

* **闸门⑮ 补 live()/普通函数双向契约**：把 `live(() => …)` 换成普通函数 `() => …` 时，所有
  静态闸门全绿，而模板按属性读它时渲染出的是函数源码（Vue 只对 computed ref 解包），
  用户侧就是「点了没反应」。现在两个方向都钉（普通函数必须被调用、computed 不许当函数调）。
  写这条时先踩到它自己的假绿：组件扫描只认 `export const X = {…};`，四个 tab 视图都是
  `export default {…}` —— 一个也没扫到，反向实验实测全绿才发现。现在两种写法都认，
  一个组件也没扫到就报「闸门在假绿」。
* **待办页筛选三态真点击**：`prefPayload` 里 done 的「全部」特例以前只有服务端覆盖，
  特例被删掉时服务端给 todos 默认成 open，筛选面板里的「全部」就是个空操作。现在真点击
  全部 / 已完成 两个 seg，断言未完成夹具与已完成夹具各自的显隐，末尾 `resetPrefs` 复原。
* **`--tile-h:96px`**（Tony 审查提出）：附件缩略图方块高度在 `.athumb`（图片）与 `.aglyph`
  （文档图标底）各写一份，两者必须同高（grid + item 默认 stretch）；它跟 `--clear-bottom`
  是两个概念，不能焊在一起。

**验证**：`node tools/ui_test.js` **115 ok / 0 FAIL**（新增闸门⑰⑱；裸 hex 0 ≤ 0、裸 px 0 ≤ 0）、
`(cd go && go test ./...)` ok、`bash -n test.sh` ok；真机 `./test.sh --skip-build --vd` 全绿，
`  ok` 行 149 → 156（新增 FPRE / SLEAK / 窄屏计数 / 筛选三态）。

* **`--toast-bottom:96px`**（Tony 设备实测后定）：`#toast` 的 96px 看着与 body 原来的 96px 同源，
  实测是两个量 —— toast 底边距视口底 89.6px、tabbar 顶边 69.4px、body padding-bottom 104px。
  toast 要「让开 tabbar」，`--clear-bottom` 是「内容让开 nav+fab」，并进后者会把浮层抬 8px。
* **闸门⑲ 弹层底部条的两种布局形态**：步骤 13 给 `.pfoot` 加的 `flex-wrap` 对 clip / shots
  完全没生效 —— 它们写的是内联 `style="display:block"`（计数独占一行，走 flex 会让计数和三个
  按钮挤一行）。这不是 bug，但删掉那行内联样式的人看不见差别、测试也不红，所以钉住四个
  `.pfoot` 的形态，两个模板各补一行注释。

* **导出表补 `sortSheet`，闸门② 把闭集与导出表求交**（Tony 定位）：真机日志
  `TINT ERR=sortSheet is not defined` —— 它靠 `$('#sortBtn').onclick = sortSheet` 挂上去，
  闸门① 只扇内联 handler 与 handler 字符串参数，管不到这种挂法；闸门② 只做两向检查，从不把
  闭集与导出表求交，「闭集里写了个导出表没有的名字」正好落在盲区（静态全绿、真机才红）。
  现在补 `CLOSED_FN ⊆ 导出表`，红时列出缺的名字。

### 界面（P13 S3 步骤 14）：稳定 id 定位、显式字段断言、clipParse 客户端回归、260px 底部按钮

这一步收 §9.19 明写「记进步骤 14」的四笔账，外加一笔跑测设施账。

* **索引选择器 → 稳定 id**：CIT / SIT 以前靠 `q()[0].click()` 点第一条，这种位置索引的失效是
  静默的（排序变了 / 上面多了横幅 → 点到别的条目，点击照样有反应、断言全绿）。`ClipItem` /
  `ShotItem` 根节点加 `:id="'clipitem-'+x.id"` / `:id="'shotitem-'+x.id"`（`NoteCard` 本来就有
  `n+id`），载荷走 `getElementById` 且把「找不到」打成 token（`item0=found/no`）由 python 判红。
  **闸门⑳** 钉两侧：模板里那句 `:id` 在、`test.sh` 里那串前缀在，只删一侧就红。
* **断言显式写出 `kind` / `src` / `status`**（§9.17 审计剩下那一半）：剪贴板条目断 `kind`、
  `.cliprev` 文本 = state 里 `text` 的前 220 字、`.climthumb` 不出现、`.clipmeta` 含来源 app；
  `kind=image` 那一支靠注入 `clipList` + `clipPaint()` 走组件输入路径（真机钩子只写文本），
  断完换回夹具列表并断它真换回。笔记卡片按稳定 id 找到卡片，断两个 `.chip` 的文案 = `source` /
  `status` 经 `srcChip` / `statusChip` 映射的结果。只数条数时这些失效全绿。
* **clipParse 的三条客户端分支**（步骤 11 记的账，当时写的是「要补得先做注入假 fetch」）：
  `app.js` 的 `api()` 加失败注入缝 `__enote.test.failApi`（默认空串 = 生产零影响），新步骤用它跑
  四段：原样存为笔记（toast / 弹层关掉卸载 / 出 `clipboard-text`+`raw` 笔记且 `todos` 空 /
  暂存区清空）、解析失败（toast「解析失败」且**弹层不关、勾选不丢、暂存区不消费**，清掉注入
  再点一次才入队）、真 LLM 路径（按 id 轮询到 `status=done` 且 `aiModel` 非空，`need_ai` 门控）、
  clipError（注入 `/api/clip/list` 抛 → `#clipList` 出「加载失败」并记下原因；清掉注入再开列表回来）。
  **产品侧同批改动（两条都是这一步抓出来的真 bug）**：① `clipParse` 以前不 catch 异常、不看 `r.ok`，
  失败时照样 `closeSheet()` + `clipSel = {}` —— 用户要重开弹层重勾一遍才能重试；现在 toast 出原因
  并保持弹层与勾选。② `loadClips` 的 catch 只写 `clipError`、不落下 `clipLoading`，而模板三态判定是
  `v-if="loading"` 优先于 `v-else-if="err"` —— 加载失败时界面永远停在「加载中…」，「加载失败」那一支
  是**死代码**（Go 确实返了错、前端确实记下了错，用户看到的是永久骨架屏；截图页的 `loadShots`
  一直是两个一起写的）。
* **260px 面板下弹层底部按钮裁字**（Tony 审查记的 nit）：`.btn` 是 `white-space:nowrap` +
  `overflow:hidden`，而 flex 项的自动最小尺寸（`min-width:auto`）在 `overflow` 不是 `visible` 时
  退化成 0 —— 内联 `flex:1`/`flex:1.2` 于是能让按钮缩到比自己的文字还窄。新增
  `.pfoot .btnrow{flex-wrap:wrap}` + `.btn{min-width:max-content}`，clip / shots 两个底部条改用
  `class="btnrow"`；真机压到 260px 逐按钮量 `scrollWidth <= clientWidth`，并断按钮数 = 3、
  文案含「原样存为笔记」（选择器失联时它是 0，不是「全没裁」）。
* **跑测设施：重置之后 `useAI` 是关的**（本轮基线跑测红在「the shared text note was never
  parsed」）：设备 `settings.json` 里 `useAI:false`（多半是某次设置页测试中途被打断留下的）时，
  笔记全停在 `status:"raw"` 而 `llm/test` 是 ok=1，整族「等 LLM 解析完」的断言永远不可能通过，
  红得完全不像设施问题。重置段现在把 `useAI` 归位成 `true`（baseUrl + model 齐备时），基线打印带
  `ai=yes`，`ai_step_unhappy` 补第三支（`--no-reset` 时 AI 开关关着就 loud skip 而不是判红）。
* **四条反向实验** `.test/s14_neg.sh`：模板 `:id` 改固定串 → 闸门⑳ 红；删掉
  `min-width:max-content` → 真机红在 260px 裁字；去掉 `clipParse` 的 catch → 真机红在
  「注入失败后没出解析失败的 toast」；删掉 `loadClips` catch 里的 `clipLoading = false` →
  真机红在「注入 /api/clip/list 失败后没出加载失败空态」（这条就是上面那个死代码的修复）。
  四条已逐条实测红，红话逐条抄在 plan.md §9.20。
* **跨轮泄漏：套件最后一次剪贴板写入必须是空**（Tony 验证时实测撞出）：本步是全套最后一个
  往系统剪贴板写夹具文本的地方，把 base clip 段原有的 `clipset ' '` 收尾顶掉了。因果：
  剪贴板留着非空文本 → app 启动扫一次剪贴板 + 前台轮询 `clipAdd` → `/api/clip/clear` 确实把
  `Clips` 置 nil 并 save（`go/clip.go:229`），但几秒内那条文本又被重新暂存 → 下一轮的硬基线
  （test.sh:280）红在 `clip=1`。坑人在**它不在本轮红**：写夹具的那一轮全绿，红的是下一轮开头
  一条与本步完全无关的断言。新 step 末尾现在 `clipset ' '` → `sleep 2` → `clip/clear` → `sleep 2`
  → 再读一次 `clip/list` 断它真的是 0，把跨轮泄漏变成本轮末尾的红（规则同步记进 §9.4）。
* **同一个收尾段的第一版写法自己中了自己的招**（Tony 在长跑跑到之前拦下）：注释写成了 C 风格
  块注释。test.sh 是 `sh` 跑的，行首的斜杠星是命令（glob）不是注释，test.sh:14 的 `set -eu`
  下直接 **127 退出**，而且 `bash -n` 看不出来（语法完全合法）—— 真跑到那行才炸，炸在套件
  最后几分钟，后面的收尾与自证一条都不执行。新增闸门㉑：禁止 test.sh 行首出现斜杠星（JS 载荷
  里的都是缩进的），同时钉住两处 `clipset ' '` 收尾与「本步收尾后剪贴板暂存区不是 0」那条断言。
  两条静态反向实验实测红：行首改成斜杠星 → 「test.sh:2221 行首是 /* —— sh 里这是命令不是
  注释，set -eu 下 127 退出」；把断空那行改成 `|| true` → 「剪贴板夹具步的收尾没断空」。
* 数字：`test.sh` 2800→**3294** 行、step 32→**33**、真机 `  ok` 156→**162**、静态闸门 116→**118 ok**（㉑ 扫仓库全部 41 个 `.sh`）；
  `GO_TEST=1 ./build.sh && ./install.sh && ./test.sh --vd` 全绿（交付 HEAD 上重跑一次：
  `sh ./test.sh --skip-build --vd` → `$TMPDIR/s14_head_green.log`，0 FAIL / 0 ERROR）。
  真机 `  ok` 这条计数会随 AI 解析分支 ±1（`test.sh:2140` 的 `ai_step_unhappy` 只在需要补一次
  解析时多打一条 ok：21:41 那次是 161，23:08 这次是 162），对数字时先确认走的是哪一支。

### 界面（P13 S3 步骤 15）：外壳转 Vue —— topbar / tabbar+fab / 弹层宿主 / 对话框 / toast

§9.21 盘点里「没被 Vue 接管」的三条硬证据，这一步干掉前两条：外壳骨架不再是静态 HTML，
也不再由命令式 JS 驱动。新增 `go/ui/js/shell.js`（156 行）：一张 `shell` reactive 状态表
（tab / dot / 搜索框 / fab / 指示条 / 弹层 / 对话框 / toast）+ 五个组件（`TopBar` `TabBar`
`SheetHost` `DialogHost` `ToastHost`）+ `mountShell()`。`index.html` 237→224 行，静态外壳标记
换成挂载点；`app.js` 2065→2122 行，`toast()` `paintStatus()` `dialog()` `closeDlg()` `sheet()`
`pageSheet()` `pageSheetVue()` `closeSheet()` `setTab()` `moveInd()` 从命令式 DOM 写改成写状态。

* **外壳状态是 `reactive()`，不是视图层那套 `V.tick` 拉模型**：视图读 tick 是因为
  `S` / `MISSED` 这些是会被整体赋值的普通 `var`；外壳状态本来就是响应式对象，
  `shell.sheet.on = true` 一行 DOM 自己跟上。这是数据层响应式在本项目第一次落地。
* **挂载点分两类，理由写进注释**：在流内的（`.topbar` 是 `position:sticky`、`.tabbar` 是
  `position:fixed`）**挂在原元素上**，Vue 只渲染内容 —— 包一层 div 会让 sticky 的包含块变成
  那层 div（高度就是它自己），顶栏会跟着内容一起滚走，肉眼可见但静态闸门看不见。
  浮层（`.sheet` / `.dlg` / `#toast`）挂在 body 级 `*Root` 容器里：Vue 的模板根元素是挂载点的
  **子节点**，`:class="{on:…}"` 绑不到挂载点自身，所以显隐类必须落在模板里的元素上。
* **顶栏显隐（我的页不显示顶栏）从 JS 写 style 换成 `body[data-tab]` + CSS**：它是「当前在哪个
  页签」的纯函数，写进 `css/views/shell.css` 就少一处 JS 会漏同步的地方。选择器比
  `components.css` 的 `.topbar` 更具体，层叠必赢，与闸门⑦ 不冲突。
* **顺手修掉一个泄漏**：`sheet()`（字符串弹层）以前直接换 `.panel` 的 `innerHTML`，上一个 Vue
  弹层的根节点就此游离 —— 与步骤 13 在 `pageSheetVue` 修掉的是同一个泄漏，只是这条路径没人查。
  现在四个开弹层入口 + `closeSheet()` 都走 `unmountAllSheets(['progress'])`（闸门⑱ 的名单只有一份）。
* **产出的 DOM 逐字保持**（id、class、元素顺序、内联 style），三处契约跟着搬了扫描源：
  `tools/ui_test.js` 的「『记一笔』在底栏第三格」从扫 `index.html` 的 `<nav class="tabbar">`
  改成扫 `shell.js` 的 `TabBar` 模板；`__enote.dom` 五个元素从「模块求值期取一次」改成 getter
  （外壳节点是挂载之后才出现的，取一次存下来拿到的全是 `null`）；`app.js` 新增 HOST 键
  `brandGo tabPick fabAct searchInput searchClear closeSheet sortSheet dlgOk dlgCancel`。
* **新闸门㉒：import 的名字必须真被目标模块 export**。这一步踩的坑值一道闸门：`app.js` 写
  `import { nextTick } from './vue.js'`，而 `vue.js` 内部一直是直接调 `Vue.nextTick()`、从没导出
  这个名字 —— module **解析期** SyntaxError，整份 `app.js` 一行都不执行、页面整块空白，而
  `node --check` 与所有旧闸门全绿（只看单文件语法与字符串契约）。真机上是启动自检 probe 报
  「模块解析/加载失败：does not provide an export named 'nextTick'」才看得见，而 probe 之后还要
  跑到 P6.6 才报红。㉒ 扫 `go/ui/js/**` 全部模块的 67 处具名 import，逐个查目标文件真导出了
  那个名字（三种 export 写法都认）+ 相对路径文件存在。反向实验实测红（删掉 `export` 立刻点名
  `nextTick`），还原用备份文件而不是 `git checkout`。
* **字符串弹层的开启动作现在返回 promise**：`sheet()` / `pageSheet()` 返回 `nextTick(...)`，
  `missedSheet` `sortSheet` `showLog` `showDebug` `addSheet` `addTodoSheet` 把它传出去。
  DOM 是 Vue 在 nextTick 画的，`missedSheet(); assert(面板里有行)` 会读到空（真机报
  「面板里没有行」）；`test.sh` 五处调用点跟着改成 `await`。
* **`#panel` 的 `data-kind` CSS 钩子搬进状态**：面板归 Vue 之后随弹层开合被创建/销毁，
  `settingsSheet()` 里 `$('#panel').dataset.kind='settings'` 写在了一个即将废弃的节点上，
  设置页样式全丢（真机：「`#panel` dataset.kind 不是 settings」）。现在是
  `shell.sheet.kind` + `pageSheetVue(name, title, kind)` + 模板上 `:data-kind="s.sheet.kind || null"`。
  **教训：凡是调用方直接写 Vue 拥有的节点，都要改成写状态，`dataset` 也算。**
* 数字：`app.js` 2065→2127 行、新增 `shell.js` 158 行、`index.html` 237→224 行；静态闸门
  116→**119** 项全绿；handler 总数 77→88（内联 29 + Vue 模板 59，基线 73）；Vue 模板 22→27 个
  （扫描 25→30）；视图里的 `H.xxx` 114→123 个全在 `setHost`。
* **验收**：`GO_TEST=1 ./build.sh`（含 `go test ./...`）绿、`./install.sh` Success、
  `./test.sh --vd` **163 项 ok / 0 FAIL / PASS**（基线 162，多的那条是闸门㉒）。
  中途 CPAI（剪贴板一键解析）红过一次，查下来是设备侧 WebView JS 线程挂死
  （6 分钟没有一条 2s 轮询打到 Go 服务、进程 CPU 0%、Java 主线程在 looper 空转），
  冷启动重跑即绿，与本次改动无关。

### 文档（P13）：Vue 迁移现状盘点（回答用户提问，Tony 逐条核过）

用户问「系统是不是已经由 Vue 替代了原来的纯手工撰写 WebView」，答案写进 `plan.md §9.21`，
每条带可自查位置（数字在 `main = f6657f3` 上实测）：

* **已替代**：页面级手工字符串渲染器在 S3 步骤 11 整批删除（§9.17）；现在 4 个 tab +
  4 个弹层 + 1 个 body 级进度层全在 Vue 注册表里（`app.js:1181` / `:1186`），`render()`
  只剩一条路径（`app.js:1203`）。
* **未替代**：外壳骨架（`index.html:100-125` 全静态，整份 `index.html` 里 Vue 指令只出现 1 次
  且是注释文字；Vue 只挂 pane 与弹层 body，`vue.js:25-29` / `:43-48`；外壳靠命令式 JS 驱动）
  与经 `v-html` 插入的叶子 HTML 片段（带 33 处内联 `onclick`，走 window 全局而不是 `@click`）。
* **与 Vue 无关的部分**：WebView 宿主（Go 服务 + JS 桥 + 原生转发）一直是自研。
* 本轮改的只有文档；代码零改动，闸门与真机验收沿用步骤 14 的 HEAD。

### 界面（P7）

* **启动器图标**：`tools/gen_icon.py` 用一份几何同时生成自适应图标（前景 / 背景 / monochrome
  矢量 XML）和 app 内 logo（`go/icon.png`，`go:embed`）。删掉所有 PNG 图标，APK
  14,174,783 → 13,837,907 字节。
* **图标系统**：内嵌 24dp 线性 SVG sprite（约 65 个 symbol），`ic('name')` 引用，
  颜色随 `currentColor`；顶栏、底栏、FAB、卡片、弹层、空状态、我的页全部换成线性图标，
  去掉界面里的 emoji。
* **顶栏 / 底栏**：搜索框 + 剪贴板入口 + 排序按钮；底栏选中项加胶囊底；FAB 渐变 + 图标。
* **指标卡**：待办 / 逾期（红色高亮）/ 笔记 + 整行 OCR 状态，数字用渐变字。
* **笔记卡片**：标题字号收紧、来源与状态改成图标胶囊（分享图片 / AI 模型 · 耗时 / 标签 /
  时间），正文改成左侧品牌色竖条的引用块；「关键信息」表格逐行淡入。
* **待办行**：圆形勾选框 + 弹性勾选动画、完成划线 + 淡出 + 新位置高亮入场；倒计时 / 到期
  标签带时钟图标；提醒按钮（日历 / 闹钟）；高优先级图标。
* **弹层**：顶部拖拽条、chevron 返回键、遮罩背景模糊、面板上浮阴影；toast 改成胶囊 + 图标。
* **空状态**：统一 `emptyState()` 组件（圆角渐变底 + 线性图标 + 说明文案）。
* **我的页**：hero 用应用图标 + 运行环境行 + 胶囊统计；指标卡加图标底（逾期红色）；
  近 7 天柱状图用品牌渐变柱。
* **动效**：卡片入场只给「新出现」的卡片（`seen` 表），按 `--i` 错峰 45ms，轮询重绘不再反复跳；
  tab 切换时清空重跑；正文展开加过渡；`prefers-reduced-motion` 全量降级。
* **深色模式**：颜色全走 CSS 变量，hero 渐变在深色下自动切浅色版（已截图核对）。

### 修正（P9，用户反馈的 7 处）

* 所有按钮文字居中（`.btn` 加 `justify-content:center`，flex 子项不吃 `text-align`）。
* 附件页统计行到列表的留白跟笔记页一致（`margin-top` 2px → 10px）。
* 切页不再重绘整页，且每个 tab 记住自己的滚动位置（常驻面板 + `tabScroll`）。
* checklist 圆框 22px → 18px。
* 启动器图标还原成用户提供的 `android-launcher-icons.zip`（PNG 自适应图层，逐字节一致）。
* 设置页 / 剪贴板暂存页等二级页面贴屏幕顶部（去掉底部弹层用的 drag grip 和 border-top）。
* 冷启动点通知丢参数（`flushPendingOpen` 在页面就绪前就清掉了 pending）——现在等 `onPageFinished`。

### 修正（P10，用户反馈「展开详情点了没反应」）

* **点了没反应的真因**：`expand()` 用了从没声明过的 `expAnim`，点一下先抛
  `ReferenceError`，界面一动不动。语法检查、结构断言都看不出来，只有真调用才暴露。
* **三行截断其实一直没生效**：`.body.clamp` 用的是 `-webkit-line-clamp`，而那套要求正常
  换行，正文是 `white-space:pre-wrap`（要保留用户写的换行），于是正文整段显示、每张卡
  都挂着一个没意义的「展开详情」。改成 `max-height:calc(3 * 1.65em + 18px)` + 底部淡出遮罩。
* **「展开详情」只在正文真的超过三行时出现**：渲染后实测（去掉 clamp 量整段高度、
  加上 clamp 量三行高度），一样高就说明没被截断，按钮直接隐藏；展开后显示「收起」。
* **勾选框尺寸统一**：待办圆框改成 18px 点击区里画 15px 圆，未勾选细圈和勾选后实心圆
  可见直径一致；剪贴板选择框同样处理（20px 区里 17px 方框），勾选前后不再一大一小。
* **加了两道防回归**：
  * `ui.html` 启动 1.2s 后跑 `selfCheck()`，把各页渲染和「展开详情」真跑一遍，
    出错打 `SELFCHECK FAIL`；
  * `test.sh` 新增「前端没有运行时报错」一步：本次运行出现 `web console: Uncaught` 或
    `SELFCHECK FAIL` 直接判失败——这类错误以前只会安静地把点击吞掉。
* `tools/ui_sig_test.js` 53 → 61 项：新增 `.cb` / `.clicb` 尺寸、`expAnim` 等状态表声明、
  `syncExpand` 显隐规则、`max-height` 截断（并禁止 `-webkit-line-clamp`）等断言。

### 功能（P11 截图捕获）

* **自动发现新截图**：每次打开 app（`onResume`）扫一次用户选定的监控文件夹（MediaStore，
  可多选；默认勾上名字/路径像截图目录的），新图复制进 `files/enote/inbox/shot-*` 后进暂存区。
  * 水位存在 `shared_prefs/shots.xml`（`DATE_ADDED` 秒），带 5 分钟重叠窗口 + sha1 去重表
    （`shotseen.json`，最近 500 条）：改名、移动、重复入库都不会再报。
  * **首次启用不回捞历史**——这台机器有 2759 张截图，回捞会直接糊满屏；要看旧的用
    「我的 → 截图捕获 → 回捞最近 7 天」（二次确认，仍走 sha1 去重）。
  * 单次最多收 50 张，暂存区硬上限 200 张（超出丢最老的并删文件）。
* **首页横幅**：`错过提醒 → 新截图 → 剪贴板`，青色系。三种状态：未开启（点开走向导）、
  没权限（点「去授权」才弹系统框）、有新图（`发现 N 张新截图 · 整理 ›`）。
* **截图暂存页**：3 列缩略图网格 + 多选，`合并成一条笔记`（N 个附件 + 一次 LLM）/
  `各存一条`（N 条笔记，超过 5 张先确认 N 次 AI 调用）/ `原样存` / `忽略所选（永久不再提醒）`。
* **文件夹多选向导**：`全选 / 全不选 / 只选截图目录` + 搜索框，列表按张数降序，带张数与字节数，
  已删除的目录标灰「已不存在」。改完文件夹会把水位重置为现在（同样不倒历史）。
* **导入进度层**：全屏不可点掉，滚动 elapsed 计时，文案是用户要求的醒目警告——
  「请保持屏幕常亮：不要锁屏、不要让手机黑屏，也不要退出 App 或切到别的应用」；
  同时 Java 侧真的加 `FLAG_KEEP_SCREEN_ON`。进度层**一直挂到这批笔记 AI 解析结束**
  （OCR + 入队只要 1 秒，收早了提示就白写了）。
* **一句话分工**：OCR 只能在 Java 侧（ML Kit），所以导入由 `Android.importShots` 发起，
  Go 只负责暂存/去重/忽略表/文件生命周期。合并笔记走新的 `kind=images`：N 个附件、OCR 文本
  用 `---` 拼接、**只调一次** LLM。

### 修正（P12.1，提醒面板点了没反应 / 去待办页跳错页 / 勾选没动画）

用户反馈：面板里「去待办页」跳到笔记页；点整行没反应；勾 ✓ 完成了但一闪就没，
看不出点没点上。三条都是同一个低级错误 —— **我调了根本不存在的函数**：

* `goTab('todos')` 不存在（真名 `setTab()`，而且它读全局 `tab`，不接参数），
  所以「去待办页」只是关掉面板，露出底下的笔记页。
* `goNote(nid)` 不存在（真名 `jump(nid)`），所以点整行静默失败。
* `openSheet()` 不存在（真名 `pageSheet()`），整个面板第一次是渲染不出来的。
* 勾 ✓ 是直接打 API 的，没有动画。现在整行复用待办页的 `.todo/.cb/.ttx` 结构并调
  `toggle()`，划线 → 原位淡出 → 从清单里摘掉，和待办页一模一样。

教训：`ui_sig_test` 只查"函数存在"，不查"调用点的名字对不对"。已加一条断言：
面板里只能出现 `setTab`/`jump`/`pageSheet` 这些真存在的名字，出现 `goTab`/`goNote` 直接 FAIL。
`test.sh` 的 P8.5 也升级成真点击：点整行断言 `open{}` 里多了一条、面板关掉；
勾 ✓ 断言 120ms 内出现 `justdone`（划线动画）、1.6s 后这条从清单消失。

### 修正（P12，用户反馈三条：横幅不刷新 / 提醒面板没法操作 / 截图要重进两次）

**1. 删光剪贴板后首页还提示「剪贴板暂存 N 条」**
* **真因**：`refresh()` 判定页面签名变了会调 `searchNow()`，而 `searchNow()` 在
  `/api/search` 返回内容和上次一样时直接 `return`，**不重绘**。首页横幅（剪贴板 / 新截图 /
  错过的提醒）不在搜索结果里，于是条数变了横幅文字不动。
* **修法**：`searchNow(force)`，`refresh()` 把 `dirty` 传进去；签名变了就强制重绘。
  这一处同时修掉了第 3 条的前端部分。

**2. 「错过的提醒」面板只能看不能处理**
* 原来的逻辑：横幅 = 上次打开 app 之后到点、且未完成的待办（服务端记 `lastopen.txt` 水位），
  看过一次水位就推进，同一批不再打扰。缺的是"我看过了"这个动作。
* 现在面板有三条明确的路：点整行 → 跳到笔记看上下文；每行左侧 ✓ → 直接把待办标完成并从清单里去掉；
  底部「这批我知道了」→ 待办一条不动，只承认看过了，横幅立刻消失。
* 底部条用 `.pfoot`（跟选文件夹页一致），并加 `.pfoot .btn{flex:0 0 auto}`——
  之前「这批我知道了」被挤成「这批我知道」。

**3. 截完图进 app 看不到提示，要退桌面重进一次**
* 两个原因叠在一起：扫描在 `onResume` 的后台线程里跑，比界面渲染慢；而扫完之后前端的重绘又被
  上面第 1 条那个短路吃掉了。第二次进 app 之所以有，是因为 `onAppResume` 直接调了 `render()`。
* **修法**：`EnoteApp` 进程一起来就注册 `ContentObserver` 监听 `MediaStore.Images`，
  截图落盘 1.2 秒后（去抖，系统一次截图会连发多次 onChange）就扫进暂存区，
  界面在的话直接 `shotsScanned()` 刷新横幅 —— 用户打开 app 时横幅已经在那儿了。

* **测试**：`test.sh` 新增 3 段（删光剪贴板后横幅消失、错过的提醒面板三条操作、相册监听已注册），
  全部用 `hook jseval` 在页面里断言；`ui_sig_test` 79 → 82。
* **测试自己的坑**：`refresh()` 不 `await searchNow()`，所以 jseval 里 `await refresh()` 之后立刻读 DOM
  会读到重绘前的旧界面（假红两次）。断言要轮询等 DOM 变化。

### 修正：API Key 不该每次都要重填（用户反馈）

* **不再打码**：`/api/settings` 以前返回 `sk-l…ellm`，设置页每次打开都只剩打码值，看着像"没存住"。
  现在原样返回明文（用户明确说不介意明文：key 本来就躺在 app 私有目录 `files/enote/settings.json`，
  别的 app 读不到），设置页打开就能看到已保存的 key，输入框下面还有一行说明。
* **settings.json 改成原子写**：原来 `os.WriteFile` 直接覆盖，写到一半被杀/断电就留下半截 JSON，
  下次启动解析失败 → 回默认值 → Base URL 和 key 全丢（这就是"每次都得重新填"的真正原因）。
  现在先写 `.tmp`、`fsync`、再 `rename`，并顺手留一份 `settings.json.bak`。
* **坏了能捡回来**：`openConfig` 主文件解析失败时自动退回 `.bak`；同时也接受"只填了 key、没填 Base URL"
  的配置（以前这种配置会被整份丢弃）。
* **测试**：`go test` 加两条用例（`.bak` 恢复、原子写不留 `.tmp`）；`test.sh` 的设置往返断言从
  「key 必须打码」改成「读回来 == 存进去、保存后 llm 仍可用」。

### 修正（P11 测试：清理时误删用户的截图笔记）

* **真因**：P11 段收尾是「把所有 `source` 以 `shot-` 开头的笔记都删掉」——那是用户真正导入的
  截图笔记，测试每跑一次就清一次（真实删过一次用户刚导入的通报截图）。
* **修法**：只删本步骤自己造的：从 `hook shotimport` 返回的 `noteIds` 记录，收尾按 id 删；
  并断言「这一步结束后笔记总数回到步骤开始时」，动了别人的笔记就红灯。
* 被误删的那条已用原截图重新导入恢复（`第十周课堂教学检查通报`）。
* **上游大模型不稳时的测试姿势**：代理偶发 500 秒级超时（实测一次 515s 才报 timeout），
  这时笔记会停在 `raw`（原文保留）。`test.sh` 新增 `upstream_down()`：若状态是 `raw` 且错误信息
  是超时/断连，打一行 `skip（上游大模型超时）` 继续跑，而不是把整套判红；真正的解析回归仍然会红。

### 修正（P11，用户反馈「截图笔记的缩略图不显示」）

* **真因**：导入成功后界面会调 `/api/shots/remove` 清理暂存区，而 `ShotStore.remove` 是
  `os.Remove(path)` —— 那几个文件刚刚才变成笔记的附件，于是被一起删掉了：笔记首页的
  `<img src="/img?id=…">` 永远 404（记录还在，文件没了）。
* **修法**：`ShotStore` 增加 `keepFn`（`appInit` 注入：所有被笔记引用的 `imagePath` +
  附件 `path`），`remove` / `ignore` / 超上限裁剪统一走 `dropUnlessKept()` —— 记录照删，
  没人引用的文件才真删。`shots_test.go` 加两条用例锁住这个行为。
* **测试补强**（原来为什么没发现）：P11 段只数了附件条目数，没验证文件在不在盘上。现在
  导入后先模拟界面清理暂存，再断言 `/api/attachments` 的 `missing == 0` 且 `/img?id=`
  返回 200，缩略图这条路才算真的测到。
* 受影响的笔记（`Screenshot_20261122_124947.jpg` 那张）已从系统相册把原图拷回原位。

### 界面修正（P11，用户反馈「选文件夹」页）

* **确定按钮固定到底部**：文件夹可能几十个，原来按钮排在列表末尾，要滚很久才点得到。
  新增 `.pfoot`（`position:sticky` 操作条），文件夹页 / 截图暂存页 / 剪贴板暂存页统一改用它，
  滚到一半也一直贴在屏幕底部。
* **已选数量实时显示**：底部条左边是「**3** 个已选 · 共 73 个」，勾一个变一次，
  主按钮文案也跟着变成「开始监控这 3 个」。
* **已选的文件夹排到最前**：勾选/取消会即时重排（组内仍按张数多的在前），已选项还会上底色，
  一眼能看出选了哪些；重排时记住并恢复滚动位置，手指下面的内容不会跳。
* **返回后立刻刷新统计**：`folderSave()` 之后强制重建当前页并按需重算统计，
  「我的 → 监控文件夹 N 个」当场就是新数字（原来要切个 tab 才变）。
  顺带把截图开关/文件夹数也纳入 `sigOf()` 签名 —— 这类「配置变了界面不动」的陈旧状态
  以后轮询也会自愈。
* **只有一张截图时只留一个按钮**：一张图时「合并成一条笔记」和「各存一条」是同一件事，
  摆两个只会让人犹豫（用户反馈）。现在 `syncShotBtns()` 按已选数量切换：1 张 → 单个
  「创建笔记」；2 张以上才出现「合并成一条笔记 / 各存一条 / 原样存」。
* **新增验收用 hook `jseval`**：`--es hook jseval --es arg '{"js":"..."}'` 直接在页面里跑 JS，
  结果用 `console.log('JSEVAL ...')` 落在 `files/testlog.txt`。虚拟显示上 `input tap` 太不稳，
  界面断言改成脚本驱动后既准又快（需要 `files/enote/.devmode` 才启用，避免任意 app 借 WebView 读笔记）。
  `test.sh` 用它新增了一段「底部固定条 + 实时计数 + 已选在前 + 返回后刷新」的断言。

### 修正（P11 附带，都是真实踩出来的）

* **`/api/settings` 部分字段的 POST 会把别的字段清零**：旧实现把请求体直接当成完整
  `Settings`，于是任何只带 `{"theme":"light"}` 的调用都会把 `temperature` 变 0、
  `useAI` 变 false、`timeoutS`/`maxTokens` 掉回默认。改成 `settingsPatch`（指针字段），
  没提交的字段保持原值。`config_test.go` 加了回归用例。
* **初次运行主动引导**：第一次打开 app（且没开过截图捕获）会弹一次「要不要自动收集截图？」，
  选「选择文件夹」直接串起 权限 → 文件夹多选向导，选「以后再说」也记下不再打扰。

### 工程（P11 测试）

* `test.sh` 开头先探一次 `/api/llm/test`：没有可用 AI（`settings.apiKey` 为空）时，
  依赖大模型的 4 段（分享文本解析、图片 OCR→AI、重新解析、打码 key 往返）改成 `skip`，
  其余用例照跑。没配 AI 时笔记停在 `raw`（原文保留）是正确行为，不该被当成失败。
  本地能验的（OCR 出字、入库、导出、附件、搜索、P11 截图）一条都没少。

### 工程（P11）

* `Shots.java`：MediaStore 枚举 / 多选配置 / 水位 / sha1 / 复制 / 扫描 / `keepScreenOn`。
  * 踩坑：`sortOrder` 里不能拼 `LIMIT`（这台机器的 MediaProvider 直接抛
    `IllegalArgumentException: Invalid token LIMIT`），改成自己数到上限就停。
* `go/shots.go` + `shots_test.go`（8 个用例）：去重、忽略永久生效、上限裁掉最老的并删文件、
  缺失文件自动丢弃、`shot.json` 落盘后重启仍在、`nativeShotAdd` 返回形状。
* 新 hook（测试用）：`shotscan`（`{"folders":[],"rangeDays":1}`）、`shotfolders`、
  `shotimport`（`{"mode":"merge|split","raw":bool,"shots":[…]}`）。
* 修 `sigOf` 漏了 `i.shot` 的问题：新截图只改条数时不会重绘，首页横幅根本不出现。
* `test.sh` 新增 P11 段（造图 → 扫描 → 合并 → 各存一条 → 幂等 → 忽略 → 清理），
  `ui_sig_test.js` 61 → 71 项（含"别黑屏"文案、进度层收起时机、权限声明、文件夹多选）。

### 功能

* **补看错过的提醒（P8）**：后台被厂商冻结时闹钟会被系统取消，纯标准 API 无解，于是改成
  「下次打开补一遍」——`/api/missed` 返回上次打开到现在之间到点、未完成的待办，笔记页
  顶部出现「错过 N 条提醒」横幅，点开是清单（哪条待办 / 来自哪篇笔记 / 逾期多久），
  点一条跳到对应笔记。上次打开时间存在 `files/enote/lastopen.txt`（不依赖 settings.json），
  看一次就把时间推到现在，不会重复打扰。边界由 `go/missed_test.go` 锁定。
* 剪贴板前台采集 + 暂存去重 + 批量一键解析（`/api/clip/*`）。
* 附件页（图片 / PDF / 音频 / 压缩包，按类型图标 + 预览）。
* 我的页统计（`/api/stats`）+ 全屏设置面板 + 主题切换（`/api/theme`）+ 每页排序偏好持久化。
* 事实提取（何时 / 何人 / 何事 / 何地 / 为什么 / 备注）+ 日历 / 闹钟提醒入口（标准 AOSP 契约）。
* 自研到期提醒：前台到点弹通知正常；后台被厂商冻结（详见 README「已知限制」）。
* 常驻后台开关（foreground service + 低优先级常驻通知）+ 标准电池优化引导，不做品牌分支。

### 工程

* `tools/ui_sig_test.js`：无浏览器的 UI 结构契约测试（53 项），防止界面重构时把关键约束改坏。
* `test.sh` 扩到 P6.5 各档（含常驻后台服务与通知渠道断言）；图片/附件测试改放 app 私有 inbox
  （`/sdcard/Android/data` 被 Scoped Storage 拒读）。
* 所有脚本在缺 root 时降级并打印提示（`APK_NO_ROOT=1` 可强制无 root 路径）。

### 界面质量重构（P13，进行中）

任务不是加功能，是把界面重做到"高级"：改用 Vue 3 重画 UI，全程仍要在手机上构建，
所以不引入 npm / bundler。完整计划见 `plan.md` §9。

* **S1a 拆单文件**：`go/ui.html`（2527 行）拆成 `go/ui/`——`index.html` +
  `css/{tokens,base,components,views}.css` + `css/views/*.css`（8 个占位）+ `js/app.js`。
  拆分是**按原始行号的连续区间**，CSS 拼接后与拆分前逐字节一致，层叠顺序没变；
  `js/app.js` 是非空行逐字节一致（1826 行，多一个空行，无行为影响）；
  这一步行为零变化，70 个内联 handler 全部照旧。
  `go/web.go` 改成 `//go:embed all:ui` + 目录静态服务：Content-Type 写死在代码里
  （Android 没有 `/etc/mime.types`，回落 `text/plain` 会让 WebView 拒绝执行脚本），
  每个文件都带 `no-store`。新增 `go/web_test.go`：页面引用的每个资源必须 200 且类型正确、
  路径穿越/目录必须 404、vendor 内容必须与 `VENDOR.md` 的 sha256 一致。
* **Vue 3.5.46 vendored**（`go/ui/vendor/vue.global.prod.js`，174KB，MIT）：全局构建自带模板
  编译器，已实测（`Vue.compile` 可用）。`VENDOR.md` 里 pin 了语言基线 = ES2020（Chrome 80），
  因为 `MIN_API=26` 的出厂 WebView 是 58/59。
* **教训固化**：`js/app.js` 头注释写明"加 `type=module` 会让 70 个内联 handler 静默失效"，
  `go/web_test.go` 直接断言首页不许出现 `type="module"`——这是 P12「点了没反应」那一类 bug
  的机器闸门，不靠人记得。
* **S1a 附带：把验收链路本身修绿**。这台设备第一次真跑 `./test.sh --vd`，一次暴露出六个
  真实环境/测试缺陷，它们与 UI 无关，但每一个都能让整条验收红掉：
  1. `lib/config.sh`：`vendor/` 的真实位置是 `.agents/skills/dev-apk-on-android/vendor`（git 跟踪），
     非交互 shell 里 `SKILL_DIR` 为空 → `vd.sh` 报「missing vd.jar」，--vd 从来没跑通过。
     现在找不到就回退到 skill 目录，谁 clone 谁可用。
  2. `vd.sh create`：旧 daemon 退出时把旧 display id 写回状态文件，create 的轮询立刻读到它，
     拿到一个已死的 id → `am start --display` 报 SecurityException。现在用 `dumpsys display`
     确认 id 真的存在才算创建成功。
  3. `test.sh am_start`：root 在虚拟屏上**开新任务**会被 SafeActivityOptions 拒（ShareActivity），
     MainActivity 只是因intent 投递给现有实例而「没事」。分享入口是 headless 的，不再带 --display。
  4. P6.6 剪贴板用例在和前台轮询赛跑：`/api/clip/clear` 之后 app 立刻把剪贴板上那条旧文本
     重新暂存，`count==0` 物理屏上侥幸过、--vd 上必红。现在先 `clipset ' '`（Go 侧 TrimSpace
     后为空 → clipAdd 直接拒）再删暂存。
  5. P11 截图用例：测试图从 PIL 生成换成 `tools/make_test_png.py`（纯标准库，这台设备装不上
     Pillow），路径从写死主仓绝对路径改成 `$HERE`（在 worktree 里跑会污染主仓），步骤开头
     清空 shots 暂存区（上次失败留下的图会让「合并 2 张」拿到 4 张附件），`shot_scan` 从
     固定 sleep 6 改成轮询新日志行（固定 sleep 会拿到上一次那行 added=2，报「不幂等」假红）。
  6. OCR 用例的 `.test/ocr-test.png` 是某台机器上手工放的文件，没进 git，新 worktree 上
     `test.sh` 直接 die 在第 43 行。现在图进仓库，`tools/crop_png.py`（纯标准库 PNG 裁剪）
     可随时重造；搜索用例的关键词同步从「周会」改成「取快递」（新图里没有周会）。
  静态服务加了 `X-Content-Type-Options: nosniff`，不认识的扩展名从 octet-stream 200 改成 404
  （`vendor/VENDOR.md` 这类给人看的文档不该被 WebView 拉走）。

### 界面（S2：设计刻度 + 密度收紧）

「能跑，但不高级」的根因不是缺组件，是没有刻度：全库 391 处裸 px，间距取值 44 种、
圆角 22 种、阴影 10 种。这一步建立刻度并把密度收紧。

* **刻度落地**（`go/ui/css/tokens.css`）：间距 `--s0..--s6`（2/4/8/12/16/24/32）、
  圆角 `--r1 --r2 --r3 --r-pill`（8/12/20/999）、阴影 `--sh1 --sh2 --sh3`（深色各配一档）、
  字号 `--fs-xs..--fs-display`（11–44，8 档）、图标 `--ic-1..--ic-4`（13/16/20/26）、
  动效时长 `--d1 --d2 --d3`（120/220/380ms，沿用原变量名）、新增弹性曲线 `--spring`。
  旧名全部保留，`--sh` = `--sh2`、`--grad` 不动，所以这一步不会改像素。
* **密度：10px → 8px**（Austin 批准，条件是把每一处映射列出来）。
  40 处间距（padding 13 / gap 11 / margin 9 / margin-top 4 / margin-bottom 3）换成
  `var(--s2)`，10 处 `border-radius:10px` 换成 `var(--r1)`。
  刻意**不动**的：`transform` 2 处、`height` 2 处、`min-height` 1 处、`right`/`top` 各 1 处
  （几何定位，不是间距）、`font-size:10px` 2 处（映射到 `--fs-xs`=11px，见下）。
  完整映射（51 行，含一条规则里两处 10px 的展开）：

**`base.css`**

* `.card` :24 — `margin: var(--s2) 0`
* `.agrid` :57 — `gap: var(--s2)`
* `.agrid` :57 — `margin-top: var(--s2)`
* `.athumb` :64 — `border-radius: var(--r1)`
* `.aglyph` :65 — `border-radius: var(--r1)`
* `.errbox` :73 — `border-radius: var(--r1)`
* `.todo` :77 — `gap: var(--s2)`
* `.facts .fh` :134 — `padding: 7px var(--s2) 5px`
* `.facts .fr` :137 — `padding: 6px var(--s2)`
* `.acts` :160 — `margin-top: var(--s2)`
* `.btn` :161 — `border-radius: var(--r1)`
* `input,textarea,select` :172 — `padding: var(--s2) 12px`
* `.empty div` :179 — `margin-bottom: var(--s2)`
* `.kv` :197 — `gap: var(--s2)`
* `pre` :200 — `border-radius: var(--r1)`
* `pre` :200 — `padding: var(--s2)`
* `#toast` :202 — `padding: var(--s2) 16px`
* `.seg button:focus-visible` :241 — `border-radius: var(--r1)`

**`components.css`**

* `.topbar` :1 — `padding: calc(8px + env(safe-area-inset-top)) var(--s2) 8px`
* `.search` :22 — `padding: 0 var(--s2)`
* `.strip` :32 — `margin: var(--s2) 2px 0`
* `.clipbanner` :54 — `gap: var(--s2)`
* `.clipbanner` :54 — `margin: var(--s2) 2px 0`
* `.missed` :62 — `gap: var(--s2)`
* `.missed` :62 — `margin: var(--s2) 2px 0`
* `.shotbanner` :70 — `gap: var(--s2)`
* `.shotbanner` :70 — `margin: var(--s2) 2px 0`
* `.shotgrid` :78 — `margin: var(--s2) 0`
* `.shotitem` :80 — `border-radius: var(--r1)`
* `.fin` :93 — `border-radius: var(--r1)`
* `.frow` :97 — `gap: var(--s2)`
* `.frow` :97 — `padding: var(--s2) 2px`
* `.frow.on` :103 — `border-radius: var(--r1)`
* `.owarn` :120 — `padding: var(--s2) 12px`
* `.msrow` :124 — `gap: var(--s2)`
* `.cliptop` :130 — `margin-bottom: var(--s2)`
* `.clipitem` :132 — `gap: var(--s2)`
* `.clipitem` :132 — `padding: var(--s2)`
* `.pfoot` :151 — `gap: var(--s2)`
* `.pfoot` :151 — `padding: var(--s2) 14px calc(12px + env(safe-area-inset-bottom))`
* `.li` :205 — `gap: var(--s2)`
* `.li .lico` :210 — `border-radius: var(--r1)`
* `.skel` :213 — `border-radius: var(--r1)`
* `.skel.img` :219 — `margin: var(--s2) 0`
* `.empty .em` :219 — `margin-bottom: var(--s2)`
* `.dlg .dacts .btn` :251 — `padding: var(--s2) 0`

**`views/settings.css`**

* `.phead` :8 — `padding: 14px 12px var(--s2)`

**`views/stats.css`**

* `.hero` :1 — `margin: 14px 0 var(--s2)`
* `.statgrid` :25 — `margin: var(--s2) 0`
* `.legend` :46 — `margin-top: var(--s2)`
* `.tagrow` :48 — `margin-top: var(--s2)`
* **修掉一个静默缺陷：`--spring` 从来没定义过。** `base.css` 的 `.cb .ic`（勾选动画）和
  `#toast` 都写了 `transition:...var(--spring)` 且没有回退值——CSS 变量未定义且无回退时，
  整条声明在计算值阶段失效，所以勾选动画和 toast 弹出一直是「瞬间出现」，测试全绿看不出来。
  定义成 `cubic-bezier(.34,1.56,.64,1)` 之后它们才第一次真的动起来。
* **高级感基础层**（`base.css` 末尾）：`:focus-visible` 焦点环（键盘/遥控器可见，鼠标点按不出现）、
  控件 `touch-action:manipulation`（去掉 300ms 点击延迟）、控件禁选文字、`::selection` 品牌色、
  隐藏滚动条、数字列 `tabular-nums`（计数/倒计时不再左右跳）、`text-wrap:pretty`。
* **CSS 按视图拆文件**：`css/views.css` 的 39 个顶层块按 `docs/css-map.md` 的归属搬进
  `css/views/{stats,settings,todos,shell}.css` 与 `components.css`，逐字节搬运，
  规则多重集拆分前后完全相同（349 条，0 差异）。
* **闸门 7 道 → 8 道**（`tools/ui_test.js`）：新增「每个 `var()` 必须能解析」——
  就是为 `--spring` 这类坑设的，未定义且无回退直接红；闸门⑦ 的跨文件层叠检查基线清零，
  扫描范围扩到 `css/views/`（原来只扫一层，S2 之后会完全扫不到 = 假绿）。
* **棘轮收紧**：裸 px 391 → 341（正好 −50）。
* **基线截图**：`tools/shots_before.sh` 在 VD 后台屏逐视图截图存 `docs/shots/before/`，
  自检 7 张 md5 互不相同（全同 = 切 tab 没生效，脚本直接失败）。
  踩到两个坑：`am start` 不带 `--display` 会把 app 拽回物理屏（7 张全同）；
  切 tab 必须调 `setTab()`，只改 `tab` 变量会让 tab 栏高亮停在旧 tab（截图看着对、其实是假的）。

### 界面（S2 续：base/components 全量迁移到刻度）

* **274 处裸 px → 刻度 token**（`base.css` 102 / `components.css` 172）：间距、圆角、
  字号、图标尺寸、1px 边框（→ `var(--hair)`）。几何尺寸不动（装饰圆、图表高度、
  条形宽度、logo 尺寸、`transform` 位移）。
  迁移前用脚本量过每个替换的位移量：**没有任何一处超过 4px**——说明这套刻度对现有
  设计是紧拟合，不是重新设计。
* **裸 px 棘轮 391 → 57**（−85%）。剩下 57 处是刻意保留的几何值。
* **`ui_sig_test.js` 5 处断言放宽**：它们写死了 `padding:0 14px 104px`、
  `font-size:10.5px`、`padding:9px 2px 9px 8px`、`margin-top:2px`、`gap:4px` 这些字面值。
  这些断言守的是结构契约（三类胶囊共用盒模型所以等高、勾选框对齐、页面有留白），
  不是那个数字，所以改成「字面值或对应 token 都接受」。
  胶囊那条断言从 `indexOf` 子串匹配改成断言函数数组，逐条可读。
  踩坑：给 `.tx small` 的断言加了收尾 `\}` 结果恒假——原断言没有收尾，因为那条规则
  后面还有声明。放宽断言时「改完变绿」不等于「改对了」，要确认它还能拦住原始缺陷。

## S2 补充：Austin 审查后的 3 条修正（a5158c9 之后）

审查提出 3 条非阻塞建议，全部核实为真，其中 2 条是缺陷，这里一起收掉。

**1. `--teal` 是幽灵 token（缺陷）**
`components.css` 4 处写 `var(--teal,#12b5a5)`、1 处 `var(--teal-s,var(--acc-s))`，
全仓 **0 处定义**。旧闸门⑧ 的判据是「有 fallback 就算安全」，所以全部放行——
但那个颜色实际活在 5 个 fallback 里，暗色模式永远调不到它。这和 `--spring`
是同一类问题：不是崩，是静默地不受控。
现在 `tokens.css` 明暗各定义一档，5 处 fallback 删掉：
明色 `#12b5a5`（= 原 fallback，外观零变化），暗色 `#2fd6c4`
（原值在 `#0b0f14` 上对比不足，以前被 fallback 锁死调不动）。
裸 hex 棘轮 **12 → 8**。

**2. 焦点环顶掉层级阴影（缺陷）**
`:focus-visible{outline:none;box-shadow:var(--focus)}` 是全局规则，
而 `.card`/`.acard`/`.sheet` 靠 `box-shadow:var(--sh)` 做层级——一聚焦阴影就被焦点环换掉。
改成通用规则用 `outline:2px solid var(--focus-ring);outline-offset:2px`（新增 `--focus-ring` token，
明暗各一档），`box-shadow` 焦点环只留给胶囊控件 `.tab/.iconbtn/.chip/.ib/.seg button` 和输入框。

**3. 可复制文本的回归闸门（建议）**
`user-select:none` 覆盖控件是对的，但笔记正文 `.body` 和剪贴板文本 `.clipbody`
是用户唯一要长按复制的东西。新增**闸门⑨**：任何带 `user-select:none` 的规则都不许覆盖
`.body`/`.clipbody`/`pre`。今天没有覆盖，这条闸门是防止后续 Vue 迁移顺手把它们加进去——
加进去不报错，只是长按没反应。

**闸门⑧ 同步加强**：新增幽灵 token 检查——`var()` 的名字在 `tokens.css` 里没有定义就判红，
**有 fallback 也判红**。fallback 是应急兜底，不是定义。负向测试：把 `.body` 加进
`user-select:none` 列表，闸门⑨ 立刻红。

`tools/ui_test.js` 10 → **12** 道闸门，全绿；`ui_sig_test.js` 84 ok；`go test` ok。

### 集成（S1a + S2 合并到同一棵树）

两边分头改了同一批文件，集成时暴露的问题全部在测试侧，产品代码零冲突：

* **唯一冲突是 `CHANGELOG.md`**：两边各自在 P13 段落下追加，按时间线保留双方（S1a 在前、S2 在后）。
  `go/ui/css/views.css` 是 Tony 删、我加，git 判定为删除——合并树里 `index.html` 引用的
  11 个 css 文件（tokens/base/components + views/*8）全部存在，层叠顺序不变。
* **附件用例的断言假设不成立**（合并树第一次跑 --vd 红在这里）：
  `diskFiles(17) >= files(19)`。一张截图先「各存一条」再被「合并进另一条笔记」时，
  两行附件共用同一个 inbox 文件，所以「行数 > 磁盘上不同文件数」是合法状态。
  改成按**唯一路径数**比。fail 文案也改了：原来任何断言失败都打印
  "the shared file never became an attachment"，而这次文件确实成了附件，把人往错方向带。
* **`api_get` 不抗 app 重启**（第二次跑红在更早的 todo 用例）：app 被系统杀掉重启后 Go 服务换端口，
  `api_get` 拿到空响应，python 里变成 `JSONDecodeError`，看不出真因是「服务还没起来」。
  现在 GET 最多试 8 次、每次重读日志里的端口；POST 不重试（有副作用，重试会重复建笔记）。
* **不用 `pm clear` 清设备数据**：Tony 建议清掉累积状态，实测不可行——LLM 的 base URL / key /
  目标文件夹存在 app 私有 prefs 里，`test.sh` 全程没有写入这些配置的步骤（它假设设备已配好）。
  清空后所有依赖大模型的用例会红，而且这是用户的真机数据。累积状态用上面的断言修正解决。
* 合并树上验证：`ui_test.js` 12 道闸门全绿（hex 棘轮 12→8）、`ui_sig_test.js` 84 ok、
  `go test` ok、`GO_TEST=1 ./build.sh` + `./install.sh` + `./test.sh --vd` **24 步全绿**，
  含 P8.5 错过提醒面板、P11 截图/文件夹页、WebView 无 Uncaught。
### 更正：上面第 2 条在 a5158c9→fc781b5 里其实没生效

`fc781b5` 的文件清单是 `CHANGELOG.md / components.css / tokens.css / tools/ui_test.js`——
**`base.css` 不在里面**。写闸门⑨ 的负向测试时我用了 `git checkout go/ui/css/base.css` 还原，
它把 base.css 整个退回 HEAD，顺手抹掉了同一文件里那笔未提交的焦点环修改。
于是交付物里 `--focus-ring` 定义了、0 处引用，焦点环仍是全局 `box-shadow`，
而 CHANGELOG 已经宣称它修好了。闸门⑧ 查不出来：它只看引用侧「用了没定义」，
不看定义侧「定义了没人用」。

补法：焦点环修改重新落进 `base.css`，并新增**闸门⑩**——定义了却没人用的 token 走棘轮
（基线 11 个，都是 S2 先建好、S5/S6/S7 迁移视图时才接入的刻度，只许降不许升）。
负向测试：把 `--focus-ring` 的引用撤掉，闸门⑩ 立刻红并点名它。
`tools/ui_test.js` 12 → **13** 道闸门。

教训写在这里：**负向测试还原文件要用备份，不能用 `git checkout`**——后者还原到 HEAD，
会连带丢掉同文件里其他未提交的改动。这个坑本轮踩了两次。


### 界面（P13 S3 步骤 16a）：叶子 HTML 字符串 → 真组件

混合期（步骤 5~10）的折中：卡片、chip、待办行这些「叶子片段」是 `app.js` 里的 HTML 字符串函数，
Vue 模板用 `v-html` 插进去 —— 当时两条渲染路径要产出逐字一致的 DOM，叶子 HTML 只能有一份。
步骤 11 删掉遗留渲染器之后只剩 Vue 一条路径，字符串函数就纯属负担：模板里看不见那块 DOM
（闸门⑮ 编译模板时它是个字符串，卡片少个 `.facts` 看不见）、事件写成字符串里的内联 `onclick`
（绕过闸门①b/⑮，P12 那一类）、每次重绘整段 `innerHTML`。

* 新增 `go/ui/js/components/leaf.js`：**13 个叶子组件**（`Ico` `SrcChip` `StatusChip` `NoteMeta`
  `NoteHits` `NoteAttach` `NoteFacts` `CdChip` `RemindBtns` `TodoDue` `TodoPriChips` `TodoTx`
  `TodoRowCompact`）。`NoteCard`、四个横幅、`StripBar`、待办页 `TodoRow` 与分组标题全部改成组件标签；
  `app.js` 删掉 12 个字符串函数共 109 行，HOST 换成组件要读的算法（`now cdCls cdText toCalendar toAlarm`）。
* 类名冻结（D15）：产出的 DOM 逐字一致。两条系统性差异写进文件头注释：元素之间的纯空白节点会被
  Vue 的 `whitespace:'condense'` 删掉（原字符串里那个字面空格要用 `{{ ' ' }}` 显式写），
  元素与文本之间的空格会保留成一个空格。
* **闸门⑮ 每个文件只取第一处 `components: {…}` 当注册表**：`leaf.js` 里最早用到子组件的组件
  定义在 `RemindBtns`/`TodoDue` 之前，那里写全量名单会撞 TDZ（速记属性是求值期读的），
  所以全量名单写在文件头注释里（闸门扫字符串，注释也算），运行时各组件注册自己用到的那些。
* 签名断言跟着搬：「关键信息」查 `<note-facts>` + `.facts/.fh/.fq/.fa`；「写入系统日历 / 设为闹钟」
  查 `name: 'RemindBtns'` + `v-if="t.due && !t.done"` + 两处 `<remind-btns`。
* **DOM 等价性**（VDIFF 在步骤 11 删了，没有逐字基准）：新增 `.test/probe_dom.sh` +
  `.test/dom_equiv.js`，把一份固定数据注入真机渲染抓回 DOM，与 `git show HEAD` 里迁移前那批
  字符串函数对同一份数据的输出逐字比。归一化只允许四类且各有理由：Vue 的 `<!---->` 占位、
  标签间空白、CSSOM 对 `style` 的序列化、以及「内联 `onclick` 属性消失」这条本次有意改动。
  结果：笔记卡 2495 字节、卡内紧凑待办行 651、待办页 `.ttx` 454 —— **三块全部逐字一致**。
* 顺带修探针：`am start` 从 Termux 直接发会被 Android 16 的后台启动限制挡掉（logcat 里
  `Background activity launch blocked`，`am` 自己还打印 `Starting: Intent`，看着像成功），
  改成走 root，与 `test.sh` 的载荷通道一致。
* 数字：视图模板里的 `v-html` 60+ → **51**（notes/todos/components 三个文件清零），`ic()` 调用
  52 → 6，内联 `onclick` 只剩 `app.js` 字符串弹层里的 21 处；handler 总数 82（内联 19 + Vue 模板 63）。
* 验收：`ui_test.js` **119 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  `./test.sh --vd` **163 项 ok / 0 FAIL / PASS**（与步骤 15 基线逐条相同）。

### 界面（P13 S3 步骤 16b）：统计页 / 设置页 / 附件页 / 剪贴板页 / 截图页 / 文件夹页的叶子字符串 → 真组件

16a 清了核心视图，这一步清剩下六个视图与两处弹层里剩下的 `*HTML` 字符串函数。
这些函数是步骤 10 的产物，理由是「两条渲染路径共用同一份字符串，零漂移面」；步骤 11 删掉
遗留渲染器之后只剩 Vue 一条路径，理由消失，负担留下：闸门⑮ 编译模板时那块结构是一个字符串
（卡片少个 `.kv` 它看不见），卡里的按钮写成字符串里的内联 `onclick`（绕过闸门①b 与闸门⑮，
P12「点了没反应」那一类），每次重绘整段 `innerHTML`。

* 新增 `go/ui/js/components/blocks.js`：**6 个整块组件**（`StatsHero` 含 `.hero` 外壳、
  `StatsNotesCard`、`StatsRunCard`、`SettingsDataCard`、`SettingsRunCard`、`SettingsOcrCard`）。
  `leaf.js` 加 6 个叶子：`KvRow`（`.kv` 行）、`OcrReady`（OCR 就绪胶囊）、`FileStrip`（附件统计条）、
  `AttachGlyph` / `AttachMeta`（附件卡图标块与元信息行）、`ClipCount`（剪贴板弹层计数条）。
  `stats.js` / `settings.js` / `files.js` / `clip.js` 改成组件标签，`folders.js` / `shots.js` 的
  勾选框图标与底部计数条（`#folderCount` / `#shotFoot`）从 `v-html` 搬进模板。
* `app.js` 删掉 **17 个字符串函数**（净 −114 行），HOST 去掉这 17 个名字、加一个
  `attachGlyphName(a)`：原 `attachGlyphHTML` 一半是算法（按 kind 查图标名）、一半是模板（包 `ic()`），
  现在前半留作函数、后半是 `<ico :n="…"/>`。设置页的采集卡与用法卡是纯静态文本，直接写进模板。
* **`KvRow` 的三种形态（返工一次）**：迁移前的 `.kv` 行有三种拼法（纯文本 / 值自带样式 /
  值是富文本）。第一版让插槽套在值 span 里面，DOM 多出一层 `<span>`，等价性工具当场抓到。
  现在三个分支各自直接当那个值 span：`vstyle` / 默认插槽 / `v`（`v-html`）。
  教训：**插槽不是免费的**，它插进哪里就多一层什么。
* **DOM 等价性（16b 版）**：`.test/probe_dom2_setup.sh` 分享一张 PDF 进来造真附件，
  `.test/probe_dom2.sh` 读真机同一份状态（`ST` / `S.info` / `FA` / `clipList` / `clipSel`）抓 13 块
  DOM，`.test/dom_equiv2.js` 用 `git show HEAD` 抽出迁移前的字符串函数在 node 里跑同一份状态逐字比。
  归一化在 16a 四条之外加两条且各有理由：`style` 属性文本（遗留是字符串 innerHTML，Vue 解成对象
  再写 `el.style.cssText`，浏览器重序列化成 `margin-top: var(--s0);`，计算样式相同）、`uptimeS`
  （状态 dump 与抓 DOM 隔了几秒，秒数必然差）。探针的坑：`byText(".card", "Go 服务")` 会命中
  「设置 / 运行日志」那张卡（副标题里有「Go 服务、解析队列、OCR 状态」），选择器要挑只出现在
  目标块里的字面量；两次 dump 用同一个 key 会被 `Object.assign` 后者覆盖。
  结果：**13 块全部逐字一致**（hero 469 B / 笔记状态卡 306 / 我的页运行卡 333 / 附件统计条 43 /
  元信息行 46 / 图标块 81 / 剪贴板计数条 83 / 采集卡 332 / OCR 卡 307 / 数据卡 527 / 设置运行卡 401 /
  用法卡 222 / 保活长说明 236）。
* 数字：模板里的 `v-html=` 属性 **33 → 7**（剩下：`shell.js` 三处，其中弹层那两处归 16c；
  `empty-state.js` 一处按设计；`leaf.js` 一处是 `KvRow` 的 `v` 兜底；`shots.js` 一处是服务端 HTML 串；
  `app.js` 那处是注释）；内联 `onclick` 21 处与 `ic()` 27 处全部集中在 `app.js` 的六个字符串弹层里，
  那是 16c。
* 验收：`ui_test.js` **119 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  `./test.sh --vd` **163 项 ok / 0 FAIL / PASS**（与步骤 15/16a 基线逐条相同）。

### 界面（P13 S3 步骤 16c）：最后六个字符串弹层 → 真组件，内联 `onclick` 21 → 1

* 新建 `go/ui/js/views/sheets.js`（162 行 / 6 个组件）：`SortSheetView`（排序与筛选）、
  `MissedSheetView`（错过的提醒）、`AddSheetView`（记一笔）、`AddTodoSheetView`（添加待办）、
  `LogSheetView`（运行日志）、`DebugSheetView`（AI 调用记录）。它们是 app.js 里最后一批
  HTML 字符串，也是最后 21 处内联 `onclick` 的所在地 —— 字符串里的 handler 绕过闸门①b
  与闸门⑮，正是 P12「点了没反应」那一类。
* 弹层开合收敛成一条路径：`pageSheet()` / `sheet()` 删掉，新增 `sheetVue(name, full)`，
  `pageSheetVue()` 改为返回 nextTick 的 Promise（D13）；`shell.js` 的 `SheetHost` 删掉
  `mode:'html'` 分支与 `v-html="s.sheet.html"`，`shell.sheet` 少掉 `mode` / `html` 两个字段。
  卡片形态的内容比迁移前多包在 `#sheetBody` 里（唯一结构差别），CSS 那条
  `.sheet .panel>h2` 同步补成 `.sheet .panel>h2, .sheet #sheetBody>h2`，否则标题钻到 ✕ 底下。
* 三条「迁移时容易悄悄改掉行为」的地方写进注释并守住了：
  `showLog`/`showDebug` 仍是**取完数据才弹**（组件里自己 fetch 会先弹出一个空的再填）；
  `MissedSheetView` 的 ✓ 仍复用 `toggle()` 的划线淡出动画（Vue 在动画那 900ms 里不重绘）；
  `setPref`/`resetPrefs` 的副作用链（写 prefs → 关弹层 → `searchNow` → `savePrefs`）一字未动，
  test.sh 的排序页用例是真点那些按钮。
* 删掉的死代码：`pageSheet` `sheet` `group` `cdChip`（`clip` 留着，经 `H.clipText` 给 AI 调用记录
  截断）。app.js 1917 → 1864 行。
* 闸门跟着搬（是「被迁移搬走」不是「契约失效」）：闸门⑲ 的 `.pfoot` 名单 `app.js` →
  `views/sheets.js`；四条签名断言换锚点（`pclose` 读 shell.js 模板、`cdChip(` 计数读 leaf.js 的
  `<cd-chip>`、`function pageSheet(title, html)` 改钉 `function sheetVue(name, full)`、
  错过的提醒跳转改钉 `@click.prevent="H.jump(t.nid)"`）。
* **DOM 等价性（16c 版）**：`.test/probe_sheets.sh` 在真机依次打开九个场景（排序页三个 tab、
  记一笔、添加待办、运行日志、AI 调用记录、错过的提醒 + 空态），dump `#sheetBody.innerHTML`
  与 `.panel` 形态，外加旧函数需要的同一份输入（每 tab 的 `P()`、`MISSED`、`logData`、
  `debugData`）；`.test/dom_equiv3.js` 从 `git show HEAD` 抠出被删的字符串函数在沙箱里跑同一份
  输入逐字比。归一化只加一条并有理由：`esc()` 把 `"` 转成 `&quot;` 塞进 innerHTML，Vue 的
  `{{ }}` 写 textContent、序列化回来 `"` 保持原样，两边 textContent 相同。
  结果：**9/9 全部逐字一致**。探针的坑：载荷里的单引号会打断 `am start --es arg` 的 shell 引号
  （JS 只用双引号）；`addSheet` 不在导出表里（只被 fab 闭包调），要经 `__enote.vue.host.fabAct()`。
* 数字：内联 `onclick` **21 → 1**（剩下 app.js:649 截图导入的「选文件夹」浮层，不是弹层）；
  handler 总数 81（内联 1 + Vue 模板 80，基线 73）；模板里的 `v-html=` 属性 **7 → 6**；
  `VUE_SHEETS` 11 条；闸门 **119** 项。
* 验收：`ui_test.js` **119 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  `./test.sh --vd` **163 项 ok / 0 FAIL / PASS**（与步骤 15/16a/16b 基线逐条相同）。

### 删掉字符串渲染器时代留下的死函数，闸门⑩ 加上「定义了没人调」半边（P14 S6 步骤 22）

表单值全部进状态之后，回头扫一遍迁移留下的死代码。扫描脚本：`go/ui/js`（剔 vendor）里所有
`function NAME(` 定义，引用侧 = 视图代码（剔注释）+ `test.sh` + `go/ui/index.html` +
`go/web_test.go` + ui_test.js 自己；出现次数 ≤ 定义次数的就是死函数。全库 172 个函数定义，
**只抓出一个：`syncShotBtns(n)`** —— 字符串渲染器时代命令式改截图弹层底部按钮的函数（一张
时只留「创建笔记」），视图转 Vue 后调用者没了，规则搬进 `views/shots.js` 的 `one` /
`goText` / `goStyle` 三个 computed，函数还活着。它为什么能藏住：两处注释提到它，而闸门
⑧/⑮ 只看引用侧（用了没定义 / 模板 handler 存活性），都不看「定义了没人用」。

* 闸门⑩ 扩半边：原来只查 CSS 自定义属性（`--x:` 定义了没人 `var()`，棘轮 11），现在同一套
  逻辑搬到 JS 函数，棘轮 **0**（新函数必须有人调）。两条合成一条闸门——闸门总数钉在 122，
  加一条就是改约定。反向测试：临时加一个 `function p22DeadProbe(){}`，闸门红并点名
  `p22DeadProbe（go/ui/js/app.js）`。
* 验收：`ui_test.js` **122 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  `./test.sh --vd` **164 项 ok / 0 FAIL / PASS**、三套 DOM 等价工具全部一致（纯删死代码，
  DOM 一个字节没变）。

### 记一笔 / 添加待办两个弹层的表单值搬进状态（P14 S6 步骤 21）

步骤 20 之后继续。剩下「把 DOM 当用户输入真相源」的地方只剩两个弹层：`addNote()` 读
`$('#addText').value`，`addTodo()` 读 `$('#tText')/#tDate/#tTime/#tPri` 四个。现在 app.js
加 `FORMS = Vue.reactive({ v: { add: null, todo: null } })` + `formSet(name, k, v)`，
`addSheet()` / `addTodoSheet(nid)` 灌初值，两个函数只读状态。

* 与设置页（步骤 20）的差别：这里用 `:value`（DOM property）而不是 `:value.attr` —— 这些
  元素今天 DOM 上没有 value 属性，写 property 保持序列化不变；设置页那六个必须写属性
  （test.sh 钉住 `#sUrl` 的 value 属性）。select 用 `@change` 不是 `@input`。
* 宿主接口加 `get FORMS()` / `formSet`，`HOST_KEYS` 的 `sheet:add` 2 → 4、`sheet:addtodo`
  2 → 4；闸门仍 122 项。
* 踩到的新坑（Vue 3.5 行为）：`:value` 不只写 property —— `patchProp` 走 prop 路径后会紧跟
  一次 `patchAttr`（`vendor/vue.global.js:12276`），所以 DOM 上真的多出 `value=""`（input/
  textarea）与 `value="normal"`（select）；浏览器自己不会这么干（探针实测
  `document.createElement("input").value=""` 序列化无属性）。它是默认值、与 property 相同，
  行为不变，但 DOM 序列化变了，`.test/dom_equiv3.js` 因此加一条归一化（只剥 input/
  textarea/select 自己开标签上的 value，option 的 value 有意义）。
* 设备验证（`.test/p21form.js` / `.test/p21verify.js`）：记一笔输入 → `FORMS.add.text` 同步 →
  保存后笔记出现；添加待办输入事项 + 2030-01-02 + 03:04 + high → `FORMS.todo` 四项全对 →
  卡片里出现「步骤 21 探针待办 … 03:04 … 重要」→ 删笔记级联删待办（探针数据自清理）。
  DOM A/B（基线 = `git stash` 出步骤 20 的构建）：五个元素的 outerHTML、八项计算样式与盒子
  矩形、select 的 selectedIndex/value 共 17 项全部逐字一致。
* 数字：`go/ui/js` 里「从 DOM 读用户输入」的站点 **4 → 0**；宿主 key 135 → 137。
* 验收：`ui_test.js` **122 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  `./test.sh --vd` **164 项 ok / 0 FAIL / PASS**、三套 DOM 等价工具全部一致；记一笔弹层
  一张 VD 截图核对（`.test/shot_21_add.png`）。

### 设置页六个输入框的值搬进状态（P14 S6 步骤 20）：`saveSettings()` 不再读 DOM

`saveSettings()` 是全站最后一处「把 DOM 当用户输入的真相源」：`$('#sUrl').value.trim()`
连读五个输入框，Vue 那一侧完全看不见正在打的东西。后果都写在旧注释里 ——
`settingsRefresh()` 专门警告「重建会把输入框里正在打的字清掉」，夹具想改一个字段只能写
DOM，探针也读不到表单当前值。现在 app.js 加 `SFORM = Vue.reactive({v:null})` +
`formFill()`（打开设置页从 `S.settings` 灌初值，保存成功后用服务端回包重灌）+
`formInput(k,v)`，六个输入框改成 `:value.attr="f.xxx" @input="H.formInput(...)"`。

* 不用 `v-model`：它写的是 DOM property，序列化出来没有 `value` 属性，而 `#sUrl` 的 value
  属性是 test.sh 钉住的契约（`urlAttr=1`，它同时保证「新建 input 的初值从属性来，保存不会
  存空值」）。`:value.attr` + `@input` 是同样的双向效果、属性真的在 DOM 上。
* 宿主接口加 `get SFORM()` / `formInput`，`HOST_KEYS['sheet:settings']` 22 → 24 个 key；
  签名断言 `id="sKey" :value.attr="s.apiKey || ''"` 改成新绑定。闸门仍 122 项。
* 顺带修掉一条过时注释：`settingsRefresh()` 只重画不重建的真原因不是「丢正在打的字」
  （值在 SFORM 里，重建不丢），是重建会打断 Android 输入法的组合中状态。
* 设备验证（`.test/p20form.js`）：往 `#sModel` 写值并派发 `input` → `SFORM.model` 立刻是
  `probe-model`、`value` 属性跟着变 → 保存存进去（toast「已保存」、回读一致）→ 关掉重开
  显示保存值 → 复原。DOM A/B（基线 = `git stash` 出步骤 19 的构建）：六个输入框的
  outerHTML、`#sUrl` 的七项计算样式与盒子矩形逐字一致。
* 数字：`go/ui/js` 里「从 DOM 读用户输入」的站点 **5 → 0**（设置页）；宿主 key 133 → 135。
* 验收：`ui_test.js` **122 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  `./test.sh --vd` **164 项 ok / 0 FAIL / PASS**（第一轮撞上既有的 OCR 抖动块，重跑绿）、
  三套 DOM 等价工具全部一致。

### 全项目最后一处 `innerHTML` 字符串渲染换成响应式模板（P14 S6 步骤 19）

设置页「测试连接」的结果区是最后一处 `$('#…').innerHTML = 拼字符串 + esc()`：它和闸门㉓
已经钉死的 `v-html` 是同一个面 —— 字符串 HTML 绕过模板编译（闸门⑮）、绕过 handler 扫描
（闸门①），`esc()` 漏一个就是 XSS 面。现在 `testLLM()` 只写一个 `Vue.reactive({v:null})`
盒子（整包赋值，宿主侧是 getter，同 `LOGDATA` / `DEBUGDATA`），三态 DOM 由 `settings.js`
的模板画，转义交给插值（textContent）。

* 宿主接口加 `get llmTest()`，`HOST_KEYS['sheet:settings']` 21 → 22 个 key（闸门⑮ 的越界
  检查会红：模板里写了 `H.llmTest` 而表里没有 → 运行时是 `undefined`）。
* 闸门㉓ 扩一半：原来只扫组件模板里的 `v-html`，现在同时扫 `go/ui/js/**.js`（剔注释后）里的
  `.innerHTML =` / `.outerHTML =` 赋值，ok 行改成「v-html 归零，JS 里 innerHTML 赋值归零」。
  反向实验：往 app.js 塞一行 `x.innerHTML='<b>hi</b>'` → 立刻红并点名 app.js。闸门仍 122 项。
* 设备 A/B（`.test/p19llm.js` 读 `#llmOut` 的 outerHTML，基线 = `git stash` 出 18e 的构建，
  比对器 `.test/cmp_llm.js`）：连接中态与结果态逐字一致，未测态只差 v-if 的注释占位
  `<!---->`（不产生元素，三套 DOM 等价工具的归一化也吃它）；结果行的 `style` 属性文本从
  `margin-top:var(--s2)` 变成 `margin-top: var(--s2);`（innerHTML 解析保留原文 vs Vue 写
  `el.style.cssText` 后浏览器重序列化，计算样式相同，步骤 16b 记过同一条）。大模型回复文本
  与耗时每次不同，比对器把这两处归一化成占位。
* 数字：`go/ui/js` 里的 `.innerHTML` 赋值 **2 → 0**，`esc()` 的调用点随之减 2；宿主 key 132 → 133；
  闸门 **122** 项。
* 验收：`ui_test.js` **122 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  `./test.sh --vd` **164 项 ok / 0 FAIL / PASS**、三套 DOM 等价工具全部一致；设置页结果区
  一张 VD 截图核对（`.test/shot_19_llm.png`）。

### 开关与骨架屏换成 `van-switch` / `van-skeleton`（P14 S5 步骤 18e）：状态重新成为开关的唯一来源

设置页两个开关（常驻后台 / 启用 AI 解析）从手写的 `.sw` 换成 `<van-switch>`，附件页与我的页的
骨架屏从三个 `.skel` 块换成 `<van-skeleton>`。计划里的第三项 `van-picker` 判定为不适用（见末尾）。

**开关：删掉两处「像素与状态各改各的」。** 旧写法是 `onclick="toggleAI(this)"` 把元素递进函数，
函数里 `el.classList.toggle('on')` / `el.className='sw'+(on?' on':'')` 乐观改类名，500ms 后才校准。
现在 `:model-value` 读状态、`@update:model-value` 写状态，类名是状态的纯函数（`keepSwCls` /
`aiSwCls` 拼 `'sw' + (on?' on':'')`，test.sh 断言的 `on` 类名契约不变），三个 handler 的元素参数
（`toggleKeepAlive(el)`→`()`、`applyKeepAlive(el,on)`→`(on)`、`toggleAI(el)`→`()`）与两处 DOM 写
一起删掉，乐观那一步交给 computed（`applyKeepAlive` 里立刻 `settingsRefresh()`，500ms 那次保留）。
白拿 `role="switch"` + `aria-checked` + `tabindex`。

**尺寸映射是这一步全部的技术含量**：Vant 的开关全部由 font-size 驱动 —— 高 = `1em + 4px`、
宽 = `1.8em + 4px`、圆点 = `1em`、位移 = 宽 − 圆点 − 4px。旧 `.sw` 是 46×26（不是 2:1），所以
`--van-switch-size:22px`（高正好 26px）+ `--van-switch-width:46px`（位移自动 = 46−22−4 = 20px，
与旧版 `left:3px→23px` 逐字相同）；圆点 22px（旧版 20px）是这一步唯一的像素差，两边都垂直居中。
`base.css` 三条 `.sw` 规则只剩两条：`flex:0 0 46px`（`.setrow` 给开关留的宽度）与
`transition-timing-function:var(--ease)`（Vant 的轨道没写 timing-function、圆点写死回弹曲线，
旧版两处都是 `var(--ease)`）。`.sw.dis{opacity:.45}` 是死代码，删掉，禁用态改由
`--van-switch-disabled-opacity` 给。

**骨架屏：三种高度按位置补回来。** Vant 的骨架是「标题 + 一排等高段落」，我们是 120 / 14 / 10 px
三档，`components.css` 用 `:nth-child` / `:last-child` 补高度与圆角，动画保留我们自己的渐变扫过
（`shim`）。`:animate="false"` 是必需的：Vant 的 `van-skeleton--animate` 给根节点挂 opacity 呼吸
动画（实测 0.73~1 之间跳），与 shim 叠起来就是双重动画。`.skel` 类名留在根节点（test.sh 用它
判定「还在加载」）。

**闸门两处**：常驻后台的签名断言改成新签名，并加两条负断言（`applyKeepAlive(on)` 里必须能看到
`settingsRefresh()`、`el.className='sw'` 必须不存在）；闸门㉔ 加 `van-*` 豁免，与闸门⑮ 同源
（Vant 走 `app.use(Vant)` 全局注册），两处豁免必须成对出现。

**van-picker 判定：不适用。** app 里没有 app 内的时间选择器：添加待办的日期/时间是原生
`<input type="date">` / `<input type="time">`（`views/sheets.js:131`），点开的是**系统**控件。
换成 `van-picker` 是换交互（滚轮 vs 系统弹窗）而不是换实现，属于新增功能；⑥ 的边界是「只用
Vant 重写已有 UI」，所以不动它，将来要做 app 内滚轮时直接取用。

* 设备 A/B（`.test/p18sw.js` + `.test/cmp_sw.js`，基线 = `git stash` 出 18d 的构建）：开关轨道
  （46×26、`--grip`/`--acc2`、`background-color 0.18s`）、圆点（22px、白、无阴影、位移 20px、
  `var(--ease)`）、开/关两态与「点一下翻转」全部对齐；骨架屏三条（120/14/10 px、圆角 12/8/8、
  margin 8/8/0、宽度 100%/100%/45%、渐变与 shim 动画）**逐字一致**。四条允许的结构性等价（同一个
  像素的两种写法）写在比对器里：轨道圆角 999px→22px（26px 高上都算胶囊）、圆点圆角 50%→100%、
  位移 `transition:left`→`transition:transform`、轨道 `transition-property:background`→
  `background-color`。类名 `sw on` → `van-switch van-switch--on sw on`（我们的 `on` 在后，契约不变）。
* 探针污染修了一处：`.test/probe_sheets.sh` 读 `fab_notes` 前必须 `tabPick("files")` 再
  `tabPick("notes")` 走一趟 —— `tabPick` 对「已经在的页签」是早退（app.js:1565 只滚回顶部），
  上一支探针停在附件页时 fab 不会被重写，症状是 `dom_equiv3` 的「fab 图标 · 笔记页」抓到 `#i-clip`。
* 数字：`.sw` 的 DOM 写操作 2 → 0；`base.css` 的 `.sw` 规则 3 → 2；`components.css` 的 `.skel` 规则
  6 → 4（+1 条 `@keyframes`）；tokens.css 新增 11 条 `--van-switch-*` / `--van-skeleton-*` 映射；
  闸门 **122** 项。
* 验收：`ui_test.js` **122 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  `./test.sh --vd` **164 项 ok / 0 FAIL / PASS**（与步骤 18a–18d 基线逐条相同）、三套 DOM 等价工具
  全部一致；设置页开关与附件页骨架屏各一张 VD 截图核对。

### 弹层换成 `van-popup`（P14 S5 步骤 18d）：17i 的 `<Transition>` JS 钩子整批退役

`SheetHost` 的外壳换成 `<van-popup position="bottom">`。定位（fixed 贴底、宽 100%）、遮罩、
滚动锁定、z-index 分层归 Vant；`.sheet` 只剩「宽屏上把面板居中」、面板自己的样式和入场动画。
**类名契约一个没动**：`#sheet` 上的 `.on` / `.page`、`#panel`、`#sheetBody`、`.grip`、`.pclose`
全在，test.sh 的 8 处 `#sheet.on` 选择器、闸门⑥ 的 `.sheet`、闸门⑦ 的层叠基线全部照旧。
遮罩是 Vant 的 `.van-overlay`，配色与毛玻璃由 `overlay-class` 送进来的 `.sheet-ovl` 提供，
`rgba(10,16,26,.42)` + `blur(6px)` 逐字未动。`.van-popup` 自带白底和 `overflow-y:auto`，
两条都要写回：白底会在面板圆角外露出一圈，overflow 会裁掉面板往上散的那层阴影。

**遮罩是 v-if 方案的唯一例外**：Vant 的 Overlay 组件自带 `<Transition appear>`，挂载时挂
`van-fade-appear-from{opacity:0}`，摘这个类同样要等一次 rAF —— 不可见窗口上遮罩会永久透明。
`views/shell.css` 加一条把它钉回 `opacity:1`：迁移前遮罩是瞬间出现的（`display:none→flex`
本来就不触发 transition），「不淡入」就是现状。

显隐照 18b/18c 走 **`v-if` + `:show="true"`**，于是 17i 那套 `<transition :css="false">` 的 JS
钩子（`shEnter` / `shLeave` / `shLeaveCancel` / `leaveMs`）整批删掉 —— 理由和当年一模一样，
只是这次连 Vue 的过渡组件都不用了。`shell.sheet` 新增 `mounted`（节点在不在）与 `on`（看不看得见）
分离：`closeSheet()` = `on=false` 挂 `.closing` 播收场动画（面板下滑 + 遮罩淡出，关键帧与时长
沿用迁移前的 `down` / `--d1`）+ 定时器摘节点，摘节点时 van-popup 的 `@vue:unmounted` 调
`sheetLeft()` 拆弹层内容的 app。闸门⑱ 的契约跟着换：`@after-leave` → `@vue:unmounted`，
并新增「不许再用 `<transition>`」「时长必须从样式表读」「摘节点的定时器必须带状态守卫」三条。

踩到的坑：`cssMs` 第一版把 `getPropertyValue('--d1')` 读到的 `"110ms"` 当秒乘了 1000 → 110 秒后
才摘节点，`test.sh --vd` 报「关掉弹层之后还有 sheet 活着（sheets=settings）」。CSS 时长带单位，
`parseFloat("110ms")` 给的就是毫秒数。进度层 `.ovl` 的 z-index 从 80 提到 **9000**：旧版是
80 > sheet 40（进度层必须压在弹层之上），Vant 的 popup 从 2001 起递增，固定层级的东西只能站到
它上面去，不能混着排。

**真机计算样式对比**（基线 = `git stash` 出 18c 的构建，`.test/sh_base.txt` / `.test/sc_base.txt`
vs `.test/sh_18d.txt` / `.test/sc_18d.txt`）：page 形态的 `#sheet .panel` / `.phead` / `.pbody` /
`.btn`、卡片形态的 `#sheet .panel` / `.grip` / `.pclose` / `#sheetBody` **全部逐字一致**；
`#sheet` 根节点只差遮罩搬走、z-index 40→2001、`max-height:100%`（Vant 自带）与根盒从满屏变成
贴底的内容盒（透明 + `overflow:visible`，视觉零差别）；关掉之后节点与遮罩都无残留。
后台屏截图（运行日志卡片弹层：圆角、抓手、关闭按钮、遮罩压暗毛玻璃）核对通过。

验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、`./test.sh --vd`
**164 ok / 0 FAIL / PASS**、三套 DOM 等价工具全部一致。

### 对话框换成 `van-dialog`（P14 S5 步骤 18c）：顺带挖出 Vue 的 `<Transition>` 在不可见窗口上永不结束

`DialogHost` 的模板换成 `<van-dialog>`，标题走 `#title` 插槽（里面还是我们的 `<h3 id="dlgT">`）、
按钮走 `#footer` 插槽（`.dacts` + `.btn` 原样保留，闸门⑥ 钉的就是它）。Vant 那对平铺文字按钮用
`show-confirm-button=false` / `show-cancel-button=false` 关掉 —— 注意 footer 插槽是无条件渲染的，
这两个开关只管 Vant 自己的按钮，这点在 Vant 文档里没写，是读渲染函数确认的。

映射表进 `tokens.css`：宽度 `min(400px, calc(100% - var(--s5) * 2))`（旧版是 max-width:400px +
遮罩内距，Vant 的宽度变量在 `@media (max-width:320px)` 里会被 `--van-dialog-small-screen-width`
覆盖，两个都得给）、背景/圆角/字号/行高/内距/标题字重/正文色全部指回 D6 刻度。
`components.css` 的 `.dlg` 整块删掉，换成 `.enote-dialog`（阴影、边框、pop 动画）+
`.enote-dialog .van-dialog__header{color:var(--fg)}`（Vant 在这里写死 `var(--van-text-color)`
= `#323233`，那是它自己的灰，深色主题下会糊成一片）。遮罩色 `--van-overlay-background:.45`
是全局的，18d 换 sheet 时要单独覆盖（旧 `.sheet` 遮罩是 `.5`）。

**真机计算样式对比**（基线 vs 装 Vant，`.test/dlg_base_clean.txt` / `.test/dlg_vant2_clean.txt`，
`.test/dlgcmp.py`）：正文、取消、确定、标题 **零差异**；盒子那几处是定位方式换了（fixed +
transform 居中 vs flex 居中），视觉 top 546.6px vs 546.5px；遮罩只差 z-index（50 → Vant 全局 2001+）。
后台屏截图核对：白卡、左对齐粗标题、暗色正文、取消/确定胶囊按钮、遮罩压暗，与旧版一致。

**最大的收获是踩出来的**：装完第一版在虚拟屏上对话框「弹出来就看不见、点取消也关不掉」，
测试套件从 164 掉到 155。根因不在我们的 CSS，在 Vue：`van-popup` 的显隐是 Vue 的
`<Transition>` 驱动的，而 `enter()` 和 `leave()` 都在 `nextFrame`（双 `requestAnimationFrame`）
里起跳。Chrome 不给「不可见窗口」出帧，rAF 就不跑，于是 `enter-from` 类永不摘除
（`van-dialog-bounce-enter-from` 的 `opacity:0` 永久留着 → 弹层全透明），`leave()` 永不结束
（`display:none` 永不落下 → 关不掉、遮罩留在屏上）。真机前台不受影响，虚拟屏（`test.sh --vd`）
必踩，息屏时后台弹出的对话框是同一类场景。把 CSS 时长归零救不回来 —— Vue 的 `leave()`
连 `getTransitionInfo` 都在 `nextFrame` 里，量到 0 也照样先进 rAF 回调。

改法：显隐退回 **`v-if` + `:show="true"`**，「对话框在不在」是状态的纯函数，创建即可见、
销毁即消失，动画只剩我们自己的 `pop` 关键帧（CSS 动画走合成器，不经过 Vue，rAF 被节流也照跑）。
`ToastHost` 同步改成 v-if（18b 遗留的同一隐患）。代价是节点随开合创建/销毁，静息态没有
`#dlg`/`#toast` —— 测缝契约改成「先弹一个再读」（`seam dlgseen=1`），与 17i 的 `#sheet`、
18b 的 `#toast` 完全同构。`views/shell.css` 留一段注释说明这件事，避免以后有人把 v-if 改回
`v-model:show`。

test.sh 三处对话框轮询从「`.on` 类」改成「`offsetParent` 可见性」（两种实现都成立），
测缝补开合一次对话框。验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、
`./test.sh --vd` **164 ok / 0 FAIL / PASS**、三套 DOM 等价工具全部一致。

### Toast 换成 `van-toast`（P14 S5 步骤 18b）：第一块 Vant 组件落地，八项计算样式逐项命中

`ToastHost` 的模板从手写的 `<div id="toast" class="on">` 换成 `<van-toast v-model:show
:duration="0" position="bottom" :message>`。选它打头阵是因为 Vant 的 toast 尺寸全部走
`--van-toast-*` CSS 变量 —— 旧样式表里每一个值都能一一对上，是「用 Vant 换掉手搜 UI」风险最低的一块。

映射表写进 `tokens.css`（`--toast-*` 定义之后）：背景/字色/字号/圆角/内距/底距/max-width/min-width
八项全部指向 D6 的刻度，注释写明这张表是 Vant 和设计刻度之间唯一的桥。实测（探针读计算样式）：
`rgb(19,26,36)`、`rgb(255,255,255)`、`14.04px`、`8px`、`8px 16px`、`96px + safe-area`、`z=2001`、
字重 500 —— 八项全部命中。后台屏截图（记一笔空文本保存）位置、圆角、配色、阴影与旧版一致。

`:duration="0"` 是关键：Vant 默认 2000ms 自动关，会和 app.js 的 2200ms 定时器抢着关，谁后到谁赢。
**行为一行没改**：2.2s 定时、200ms 串行队列、`S.toast.on/msg` 全部留在 app.js。
`base.css` 删掉 `#toast{}` / `#toast .ic` / `#toast.on` 三条，只留 `.enote-toast`（字重 + 阴影，
Vant 没有阴影这个维度）。

DOM 形状是本次唯一的像素外变化：没弹时节点整个不存在（旧版常驻 + 切 `.on`），文案多包一层
`.van-toast__text`，z-index 90 → Vant 全局 2001。消费方只有 test.sh 四处（两处 `toastTxt()`、
设置页保存轮询、附件页预览 toast），全部改成「节点存在即弹出」；测试缝那条顺手补了真弹一次 toast
再断言（以前 `toast` 这个键在不在都能过），并把 `window.__enote.toast` 加进暴露面。
闸门⑩（闲置 token 棘轮）现在把 `vendor/*.css` 也算消费方，否则新加的 `--van-toast-*` 会被自己
报成闲置；闸门⑮ 的自定义标签注册表放行 `van-*`（走 `app.use(Vant)`，上面两条断言在守）。

验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、`./test.sh --vd` **164 ok / 0 FAIL / PASS**、
三套 DOM 等价工具全部一致（卡片 2495 B、todoRow 651 B、todoTx 454 B、进度层、设置页 236 B 逐字未动）。



P14 路线图第⑥项开工（用户批准：「同意引入 vant，减少自己手搓 ui 的不确定性」）。
开工前先量依赖，不查文档：vant 4.10.2 的 UMD 全局构建 245,846 B（gzip 80,005）+
`index.css` 199,570 B（gzip 52,773）；取全局 `Vue`（就是 vendored 那份），全局名小写 `vant`，
根导出有 `install` → `app.use(vant)` 注册 ~70 个 `van-*` 组件（真机验证：`<van-button>`
渲染出 `<button class="van-button van-button--primary">`）；语言基线在 ES2020 内
（`?.` 的 2 次命中是 `? .5 :` 三元假阳性，`??` `Proxy` `BigInt` `Object.fromEntries`
`queueMicrotask` 全 0）→ **`MIN_API=26` 不用抬**；CSS 无 `:is/:where/:has/@supports/
backdrop-filter`；z-index 从 2001 自增，与我们的 55/60/70/90 不混用（弹层换 `van-popup` 时
toast 必须同步换）。

- `go/ui/vendor/vant.min.js` + `vant.css`（整文件 vendor，`VENDOR.md` 记 sha256 / 来源 / MIT /
  体积 / 上面那张实测表）；`go/web_test.go` 的版本串检查按文件分流，并新增两条装配顺序断言：
  `vant.min.js` 在 `<script type=module>` 前、`vant.css` 在我们的 CSS 前（平手时设计系统赢）。
- `vue.js` 的 `withHost()` 里 `if (Vant) app.use(Vant)` —— 一处覆盖 19 个 app；node 沙箱里
  没 `window.vant` 就跳过（静态闸门要能跑）。本步**一个 `van-*` 标签都没用**。
- 关键坑：Vant 的 CSS 带三条全局规则 `a{text-decoration:none}`、
  `input,button,textarea{color:inherit;font:inherit}`、`ol,ul{margin:0;padding:0;list-style:none}`。
  真机 computed style 对比实测 **9 处差异**，全来自那条 `font:inherit`：`#fab`/`.btn`/
  `.tabbar .tab`/首个 `button` 的 font-family 从 Arial 变继承、line-height 从 normal 变 px。
  `base.css` 显式写回现状后重测：**4 页 + 设置弹层、20 个选择器 × 13 个属性逐字节相同**
  （`.test/p18all.js`，基线/新版快照 `.test/all_base.txt` / `all_vant.txt`）。
  全站无 `<ol>`/`<ul>`，那条对本站无影响。
- 闸门：⑦ 加「Vant 三条全局规则已被 base.css 写回现状」（含加载顺序），⑮ 加
  `app.use(Vant)` / `window.vant` 两条装配断言（仍 **122** 项，两条都反向验证过）。
- 体积：base.apk 341 KB 不变，Vant 进 `libenote.so`：7,773,768 → 8,223,208 B（+449 KB 原始）。
- 验收：122 静态检查、`GO_TEST=1 ./build.sh`、`./install.sh` Success、`./test.sh --vd` 全绿 PASS、
  三套 DOM 等价全部一致（本步 DOM 逐字未变）。

### 宿主接口按 app 收窄（P14 S4 步骤 17m）：每个 app 只拿到自己那棵树读的 key

`setHost` 那张表 132 个 key，每个 app 的组件树真正读到的只有 0–27 个，其中 93 个 key 全项目
只有**一个** app 用。全量下发的后果是拼错的 key 撞上别的域的名字也能跑：笔记模板里写
`H.clipParse()` 静态检查过得去（「在 setHost 里」），运行时也返回一个函数，只有画出来的不对。

- `app.js` 新增 `HOST_KEYS` 表（19 个 app：4 视图 + 10 弹层 + 5 外壳），由
  `.test/host_split.py --emit` 从组件注册表算出来：每个 app 根沿 `components: { A, B }` 取传递
  闭包，∪ 其中出现的 `H.xxx`。
- `vue.js` 新增 `narrowHost(keys)`（逐 key 搬 property descriptor，不是 `Object.assign`：
  `S` / `tab` / `MISSED.v` 是「会被整体赋值」的 var，宿主里是 getter，展开求值一次就永远读旧
  引用）+ `setHostKeys()` + `hostFor(appId)`；`withHost(app, host)` 多一个可选参数，三个挂载点
  改成 `withHost(app, hostFor('view:' + tab))` 等。
- 组件模板与 setup 一行没改：局部名还叫 `H`，只是 inject 到的对象变窄 → DOM 逐字不变。
  `setHost(HOST)` 仍是全量，测试缝 `__enote.vue.host.X` 照旧能读任意 key。
- 闸门⑮ 新增三向核对（仍 122 项，反向验证 5 次）：表里的 key 必须真在宿主上；组件树读到的
  必须在表里；表里不许列没读的 key、不许有没挂载点的 app。挂载点只写 `withHost(app)`（全量）也算红。
- `components.js` 的组件骨架加第 6 条：模板里新写一个 `H.xxx` 必须同时加进 `HOST_KEYS` 对应
  那一行，闸门⑮ 的 ok 行现在报「宿主按 app 收窄：19 个 app、表里共 158 个 key（三向核对过）」。
- 验收：122 静态检查、build、install Success、`./test.sh --vd` 164 项全绿 PASS、三套 DOM 等价
  全部一致（卡片 2495 B、todoRow 651 B、todoTx 454 B 逐字未变）。

### tick prop 管道整条删除（P14 S4 步骤 17l）：组件不再收 :tick

17h 删掉 `live()` 之后，`tick` prop 只剩管道没有读者：29 处 `:tick="tick"`、21 个组件声明
`props: ['tick', …]`、13 处 setup 返回 `tick: computed(() => V.tick)`，全项目没有任何一处读
`props.tick`。这次全删：模板少一个绑定、组件少一个 prop，「响应式」不再看起来依赖一个手动纪元号。

- 状态是 reactive 的，computed 读到谁就订阅谁；父组件重渲染时 props 变了子组件才跟着重渲染，
  这就是 Vue 的默认语义，不需要额外信号。
- 保留 `V.tick` 与 `sheetPaint()`/`vuePaint()` 的 bump：settings.js 的 `nat` 还要它 ——
  通知权限 / 常驻后台 / 电池优化是 Android 桥的「拉」式只读接口，只能靠纪元号失效。
- 顺手删掉宿主对象里的 `V: V`（`H.V` 全项目无人读）。这一步踩过一次：脚本把 app.js 的
  `V` 从 import 里摘了，宿主对象里还写着 `V: V` → 整模块 ReferenceError、页面白屏，
  静态闸门全绿，真机跑测试才抓到。
- 闸门⑮ 的 tick 规则反转（组件声明 tick prop 红、模板出现 `:tick` 红，两条都反向验证）；
  闸门①c 从「视图文件必须引用 tick」改成「必须出现 `computed()`」；新增「用 V 却没 import
  它」检查（反向验证：加一行 `const zz = V.tick;` 立刻红）。
- 注释与 test.sh 措辞同步：「computed 不依赖 tick 就永远缓存」→「读的是 reactive 容器，
  整包赋值即失效」；11 处「tick 链断了」→「响应式链断了」。
- 验收：122 静态检查、build、install Success、`./test.sh --vd` 164 项全绿 PASS、
  三套 DOM 等价全部一致（卡片 2495 B、todoRow 651 B、todoTx 454 B 逐字未变）。

### 宿主接口 H 改走 provide/inject（P14 S4 步骤 17k）：组件不再 import 模块级 H

- 13 个组件文件都 `import { H } from './vue.js'`，而 `H` 是 vue.js 里的**模块级 `let`**，
  由 app.js 在模块初始化期 `setHost({...})` 赋值：组件对此一无所知，只能赌「我 mount 的
  时候它已经装好了」。这份隐式依赖还堵死了拆 god-object 的路（123 个 `H.xxx`）。
- `vue.js` 加 `HOST_KEY` + `withHost(app)`（`app.provide('H', H)`），三个挂载点
  （`mountView` / `mountSheet` / shell.js 的 `mount`）各调一次；组件里 `const H = inject('H')`
  写在 setup 体首行，模板一行不改。共 47 处 setup，13 个文件的 import 行去掉 `H`、
  解构行加 `inject`（脚本改的：`.test/to_inject.py`，先掩码注释/字符串再配对括号）。
- 收益：依赖摆到明面上 —— 装配哪个 app 的人负责提供宿主一目了然；测试可以 provide 一个
  假宿主只挂单个组件；后续拆 H 只动三个挂载点。
- 闸门⑮ 扩 3 条（都反向验证过）：组件文件不许再 import `H`；setup 里出现 `H` 就必须
  `inject('H')`（漏了是 ReferenceError，整模块不执行 = 白屏）；三个挂载点必须
  `withHost(app)`（漏了 inject 拿到 undefined，模板里 `H.xxx` 全炸）。
- 验收：122 静态检查、build/install、`./test.sh --vd` **166 项全绿 PASS**（首跑撞到一个
  OCR 环境抖动：随机串 `FVWADDRT` 被读成 `FWADDRT`，与本次改动无关，重跑即过）、
  三套 DOM 等价全部一致。


### 进度层搬进外壳树的 `<Teleport>`（P14 S4 步骤 17j）：删掉第四个 app 与 `['progress']` 例外名单

- 截图导入进度层是页面上最后一个「命令式挂出来的 Vue app」：`shotOverlay(true,…)` 里
  `createApp(ShotProgress).mount(#shotOvlRoot)`，`shotOverlay(false)` 里 `unmount()`，
  存在的唯一理由是「要活过 `closeSheet()`」（靠的是物理位置：不在 `.panel` 里）。
  代价是一整圈特例：`unmountAllSheets(['progress'])` 三处调用点、`VUE_SHEETS.progress`、
  组件上残留的 `props:['tick']`。
- 现在 `SheetHost` 模板尾部一句 `<teleport to="#shotOvlRoot"><shot-progress/></teleport>`：
  进度层是外壳树的普通子组件，弹层开合与它无关，开关只剩 `SHOTPROG.on` 上的 `v-if`；
  DOM 落点与层叠零变化（dom_equiv3 的「进度层整张卡」逐字一致）。
  `unmountAllSheets` 的 `keep` 参数、`VUE_SHEETS.progress`（`go/web_test.go` 同步）、
  `shotOverlay` 的 mount/unmount、`props:['tick']` 一起没掉。
- 闸门⑮ 当场拓到真问题：它每文件只取第一处 `components:` 当全量名单，`<shot-progress>`
  被判未注册（prod 构建下未注册组件只 warn，症状是整块 DOM 直接没）→ 文件头补全量名单行。
  闸门⑱ 扩 4 条（teleport 在位、SheetHost 自己声明组件、不许再带例外名单、progress 不许回
  `VUE_SHEETS`），删掉 teleport 反向验证会红。
- `test.sh` 的 `ovlMounted`/`ovlUnmounted` 改成查 DOM，新增 `ovlReg == 0`（进度层进了 sheet
  注册表就会被 `closeSheet` 拆掉）；`.test/probe_sheets.sh` 不再自己 createApp，直接置
  `SHOTPROG.on` 走真路径。
- 验收：122 静态检查、build/install、`./test.sh --vd` **166 项全绿 PASS**、三套 DOM 等价全部一致、
  真机探针 `ovl=1 reg=0` → `afterClose=1 sheet=0` → `gone=0`。


### 弹层开合交给 `<Transition>`（P14 S4 步骤 17i）：删掉 `.closing` + `setTimeout(110)` + 收场序号守卫

- `closeSheet()` 从此只有一句 `shell.sheet.on = false`。以前是「加 `.closing` 类 → `setTimeout(110)`
  拆 app → `sheetGen` 号防迟到的回调把新弹层拆掉」三处必须同步的手写动画状态机。
  `SheetHost` 根节点改成 `v-if`（`class="sheet on"` 写死），`@after-leave` 里
  `unmountAllSheets(['progress'])`；`shell.sheet.closing` 删除，`sheetGen` 只剩「开」这一侧要防。
- **CSS 模式的 `<Transition>` 在真机上会卡死**：Vue 用 `requestAnimationFrame` 推进 CSS 过渡的状态机，
  页面不可见时 rAF 被挂起 → leave 永不落地 → 弹层关不掉、`@after-leave` 不调用、sheet 的 app 泄漏。
  `test.sh` 的剪贴板 raw 用例（虚拟屏 + 物理屏关）稳定复现。改成 **JS 钩子模式**（`:css="false"` +
  `@enter`/`@leave`/`@leave-cancelled`），`shLeave` 自己加类、用定时器收尾（后台页的 `setTimeout`
  被节流到 1s，但它会跑），时长仍从 CSS 读（`getComputedStyle().transitionDuration`）。
- CSS：leave 类加在根元素上，面板那条改成后代选择器 `.sheet.sh-leave-active .panel`；
  遮罩加一条 `transition:opacity var(--d1)`。可见差别只有一条：遮罩跟着淡出 110ms（以前瞬间消失）。
  `prefers-reduced-motion` 把时长归零 → 20ms 后收尾，动效开关照旧。
- `#sheet` 从常驻节点变成随开合创建/销毁：D17 测缝载荷先开一个弹层再读 `__enote.dom.sheet`，
  1047 行改成 null 安全的 `!q("#sheet.on")`。闸门⑱ 扩 5 条（`:css="false"`、`@leave="shLeave"`、
  `setTimeout(done`、`shLeaveCancel`、CSS 选择器形状），删掉 `:css="false"` 反向验证会红。
- 验收：122 静态检查、build/install、`./test.sh --vd` **166 项全绿 PASS**、三套 DOM 等价全部一致、
  leave 中段探针 `op=0.07 panelAnim=down panelDur=0.11s`（遮罩淡出 + 面板下滑，与迁移前一致）。


### 删掉 `live()`（P14 S4 步骤 17h）：tick 降级为「原生状态纪元号」

- `live()` 与 12 个 import 全删。闸门⑮ 的白名单作废，改成两条正向契约：视图里不许出现 `live(`；
  `computed(() => H.容器)` 直接返回**原地改键**那批容器（S/SR/FA/prefs/SHOTPROG/SHOTS/CLIP/FOLD/open）直接红。
  `ST`/`MISSED`/`SHOTFLAGS` 是 `{v:}` 容器且整包赋值，每次都是新对象，返回它本身没问题。
- 闸门自己也要反向验证：临时注入一个 `computed(() => H.FA)` 确认它会红
  （第一次注入没红 —— `matchAll` 只有一个捕获组却写了 `m[2]`，闸门在假绿）。
- 反向验证当场抓到存量真 bug：`ShotProgress` 的 `P: computed(() => H.SHOTPROG)`，
  `SHOTPROG.secs` 每秒逐键 +1 而 computed 返回容器本身 → 秒表冻在第一个数。
  改成返回快照，并删掉 `shotTimer`/`shotOvlSub` 里的 `sheetPaint()`。
- `V.tick` 不删，语义降级为原生状态纪元号：`notifyGranted()`/`keepAliveOn()`/`batteryIgnoring()`
  是 Android 桥的「拉」式接口，不可观察；settings.js 里 6 个 computed 显式读 `V.tick.v`，
  `settingsRefresh()` 在 `onAppResume`/`notifyResult` 里 bump 一次。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项全绿、三套 DOM 等价全部一致。


### 全部视图摘掉 tick（P14 S4 步骤 17g）：真响应式落地

- `notes/todos/stats/settings/sheets/files/leaf/components/blocks` 里的 `live(fn)` 全换成裸
  `computed(fn)`，删掉 `var t = H.tick.v;` 这类假依赖行；闸门⑮ 白名单 3 个文件 → 12 个。
- 三个坑（都记进 plan §9.33）：
  1. `live(` → `computed(` 是字符串替换，会咬到标识符：`toggleKeepAlive(` 变成 `toggleKeepAcomputed(`；
  2. `computed` 不是全局，各文件靠 `const { computed } = Vue` 拿；`leaf.js` 只 import 了 `live`，
     替换后 setup 抛错，模板里 `f.length` 炸成 `Cannot read properties of undefined (reading 'length')`；
  3. **computed 返回容器本身 = 永远不重渲染**：`computed(() => H.FA)` 每次返回同一个 proxy，
     `reassign(FA,…)` 原地改键时值没变，Vue 判定「没变化」跳过渲染（症状：附件页顶部条停在旧数字）。
     解法是返回派生快照 / 浅拷贝，踩到 6 处。
- 诊断缝（永久）：`mountView`/`mountSheet` 挂 `app.config.errorHandler`，打印
  `[组件名 @出错阶段] + 栈前 4 行`；另加 window `error`/`unhandledrejection` 的栈打印。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项全绿、三套 DOM 等价全部一致。


### 镜像盒子（P14 S4 步骤 17f）：`H` 暴露的标量接上响应式

- `tab`/`q`/`open`/`remindPending`/`stErr`/`srErr`/`SHEETARG` 是普通模块变量，组件读 `H.tab`
  追踪不到（整包赋值换的是引用）。`tab` 64 处引用、`q` 32 处，整词改名风险大于收益，
  所以用镜像盒子：原变量照旧用，赋值走 `syncBox(盒子,值)`，组件读盒子。
- 对象型的 `open` 让原变量直接指向盒子里的 proxy（`var open = OPENB.v`），逐键改也追踪得到。
- **声明顺序是硬要求**：盒子放在文件中部而 `var tab = TAB.v` 在第 32 行时，`var` 提升让
  `TAB` 那一刻是 undefined → 整份 app.js 抛 TypeError → 页面全白。静态闸门全绿，
  真机整页空白：这类错只有 `node --input-type=module --check` + 真机探针兜得住。
- 闸门签名 4 处跟着改（都保留旧写法兼容）：错过的提醒跳转、statsNow 的 stErr、
  `var tab = 'notes', open = {}` 声明断言、轮询指纹 mock。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项全绿。


### 状态层 reactive 化（P14 S4 步骤 17e）：视图还没摘 tick，依赖先接上

- `prefs`/`SR`/`FA` 用**原地 reassign**（`reassign(box,v)`：同一个 proxy 上先删键再写键，读侧零改动）；
  `MISSED`/`ST`/`SHOTFLAGS`/`LOGDATA`/`DEBUGDATA` 用 **`{v:初值}` 容器**（初值是 `null`，代码里到处是
  `if(!ST) return`，直接给对象会让真值性变味）。`setHost` 与 `__enote.state` 的名字全部不变，
  夹具与组件零改动。
- 从这一步起 `live()`（= `computed(tick + fn)`）除了 tick 依赖开始**真正追踪依赖**：状态先响应式化
  是安全的，视图可以之后逐页摘 tick。
- 改名坑：整词替换会连 `get MISSED(){` 一起改坏（`get MISSED.v(){` 是语法错误）、
  `var A = …, B = …` 一行两个变量也会被改坏；`node --input-type=module --check` 是最快的兜底。
- 闸门 mock 跟着换形状（轮询指纹用例的 `SHOTFLAGS` → `{v:{…}}`）。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项全绿。


### 真响应式第 3 片（P14 S4 步骤 17d）：截图页摘掉 `V.tick`

- `shotSel/shotList/shotLoading/shotError` 收进 `SHOTS = Vue.reactive({sel,list,loading,error})`；
  `views/shots.js` 的 13 个 `live()` 换成裸 `computed()`；`loadShots()` 返回 `Promise.resolve()`，
  `shotPick`/`shotSelAll` 的 `sheetPaint()` 删掉。真机：注入 2 张 → 2 格画出来，点一张 →
  `.shotitem.on` 0→1、主按钮变「创建笔记」（`selCount<=1` 分支），`tick 6→6` 没动。
- `SHOTFLAGS` 故意没进来：它是 `Android.shotFlags()` 的整包返回、读它的是「我的」页（还没迁）。
- 闸门签名跟着迁移走：`one: live(...)` → `one: (live|computed)(...)`，迁移期两种写法都认。
- OCR 有一次 flake（`test.sh --vd` 首轮在「读不出 VVVFEVMY」上 ERROR 中止，重跑 166 项全绿）；
  本地 tesseract 路径，与本轮 JS 改动无关。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项、`.test/dom_equiv3.js` 13 项全绿。


### 真响应式第 2 片（P14 S4 步骤 17c）：文件夹页摘掉 `V.tick`

- `folderSel/folderAll/folderQ` 收进 `FOLD = Vue.reactive({sel,all,q})`；`views/folders.js` 的
  8 个 `live()` 换成裸 `computed()`；`loadFolders()`/`folderPick`/`folderSelAll`/
  `folderPickShots`/`folderFilter` 里的 `sheetPaint()` 删掉。真机：注入 2 个目录 → 2 行画出来，
  点一行 → `.frow.on` 0→1、页脚「0 个已选」→「1 个已选」，`tick 7→7` 没动。
- 改名坑：正则把 `setHost`/`__enote.state` 的 getter **名**也改了（`get FOLD.all(){…}` 是语法错误），
  闸门 ⑮ 先于真机报红。对外名字必须原样保留。
- 修掉 DOM 等价探针的老脆弱点：`probe_sheets.sh` 第一个用例不设置 tab，热 app 上会继承上一轮
  停在的 tab（症状是「排序页·笔记」画出附件页的排序项）；现在第一步显式定 tab。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项、`.test/dom_equiv3.js` 13 项全绿。


### 真响应式第 1 片（P14 S4 步骤 17b）：clip 页摘掉 `V.tick`

- clip 页的四个模块变量收进 `CLIP = Vue.reactive({sel,list,loading,error})`；`views/clip.js` 的
  12 个 `live()` 换成裸 `computed()`；`loadClips()` / `clipPick` / `clipSelAll` 里的 `sheetPaint()`
  删掉。真机证明：注入 2 条 → 列表画出来，点一条 → `.clipitem.on` 1→2、页脚「1 条已选」→
  「2 条已选」，全程 `V.tick` 9→9 一动没动（`.test/probe_react.sh`）。
- `ClipCount`（clip 页脚）从 `components/leaf.js` 搬进 `views/clip.js`：通用组件库不该认识页内状态。
- 闸门 ⑮ 改白名单制：`REACTIVE_FILES` 里的文件必须裸 `computed`（不许 `live(`），其余文件仍必须
  `live()` 包 `computed`——迁移期两种写法各自的约束都留着，迁完的文件不会悄悄退回 tick 驱动。
- 三个诊断缝：`window.__enoteAppLoads`（app.js 被求值几次）、`window.__enoteVtick()`、
  `mountSheet` 记 `window.__enoteSheet={name,app}`（`app._instance.scope.active` 是「响应式更新
  能不能到达这个弹层」的唯一判据）。本轮靠它们排掉「app.js 求值两次 → 模块状态两份」的假说。
- 坑①：夹具要写 `window.__enote.state.*`（带 setter 的状态桥）。导出表 `__enoteActions` 上的
  `clipList`/`clipSel` 是**快照数据属性**，赋值只落在 window 上，模块里的 CLIP 一动不动——
  症状是「赋值读回来是对的、界面永远不动」，本轮在这里烧了十几轮探针。
- 坑②：dev 构建渲染 `<!--v-if-->` 注释节点（prod 是 `<!---->`），DOM 等价工具的归一化只删后者，
  所以跑 `.test/dom_equiv*.js` 前必须 `rm enote/.vuedev`（本轮 4 项「不一致」全是这个）。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项、`.test/dom_equiv3.js` 13 项 +
  `dom_equiv2.js` + `dom_equiv.js` 全绿。


### 调试基建（P14 S4 步骤 17a）：Vue 的 dev 构建 + `?vue=dev` + Chrome inspect

* 背景：用户问「Vue 有什么好处、装都装了怎么用起来」。盘点结果 `live()` 120 处 vs `reactive` 3 处、
  `watch` 0、`<transition>` 0、`<Teleport>` 0、provide/inject 0 —— 只用了模板+组件这一层，
  响应式那层被 `V.tick++` 大锤绕过了。新阶段 P14 按性价比排：调试基建 → 真响应式 → Transition →
  Teleport → provide/inject → Vant（像素会变，开工前问用户）。
* vendor Vue 的 dev 构建 `vue.global.js`（612 KB，同版本 3.5.46，sha256 进 VENDOR.md 新增的表）。
  实测 prod 构建里 `__VUE_DEVTOOLS_GLOBAL_HOOK__` 出现 0 次、dev 版 1 次 —— 这就是「调试必须换文件、
  不是加开关」的根据，`go/web_test.go` 钉住它。
* `index.html` 的 `id="vue-select"` 内联脚本按 `?vue=dev` / localStorage `enote.vue=dev` 选构建，
  `document.write` 解析期同步插入，保证早于 `<script type=module>`。
* `MainActivity`：`setWebContentsDebuggingEnabled(true)`（`chrome://inspect` 入口）+
  私有目录有 `enote/.vuedev` 时自动带 `?vue=dev`。开关刻意与 jseval 的 `.devmode` 分开：
  测试工具每次都建 `.devmode`，共用会让 `test.sh` 跑成 dev 版 Vue，165 项基线就没得比。
* 为什么值得多带 612 KB：运行时警告只在 dev 版里。16d 真机抓到的裸 `<ico>` 在 prod 完全静默；
  dev 模式下 probe 挂一个未注册标签，testlog.txt 立刻出现
  `[Vue warn]: Failed to resolve component: nosuchtag`（`onConsoleMessage` 把 console 全写进日志）。
* 闸门：新增 ㉕（共 122 项，见 plan.md §9.27）；`TestVendorHashMatchesDoc` 改成逐文件核对 sha256；
  首页内联脚本白名单从 1 个放宽到 2 个，ES5 检查对两个都跑。
* README 新增 §5.2：dev 模式两条路 + `adb connect 127.0.0.1:5555` + `chrome://inspect` +
  Vue Devtools 扩展步骤（设备装了 Chrome、Termux 无 adb 可装、unpkg 可达，都核过）。
* 验收：`ui_test.js` **122 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  真机双模式 probe 各一次（prod `vue.global.prod.js`/dev=false，dev `vue.global.js`/dev=true，
  dev 启动日志有 `You are running a development build of Vue.`）、`test.sh --vd` **166 ok / 0 FAIL / PASS**。

### 界面（P13 S3 步骤 16d）：最后一批字符串 → 真模板，`v-html` 与内联 `onclick` 双双归零

* 删死代码簇 `folderRender` / `folderCountLabel` / `emptyState`（16c 删掉 `folderRows` /
  `folderCountHTML` 后它们已无人调用，真机 probe 一调就抛 ReferenceError）。
  `emptyState` 里那句 `onclick="sheetMsg(...)"` 是全项目**最后一处内联 handler**：内联 `onclick`
  **21 → 0**（步骤 15 是 21 处，全在弹层字符串里）。
* 删 `shotOverlay` / `shotOvlSub` 的字符串回退分支（`VUE_SHEETS.progress` 恒为真，那段跑不到）
  与死变量 `SHOTOVL_TEXT`；计时器留在 app.js（它是行为不是视图）。app.js **1864 → 1796 行**。
* 剩下 6 处 `v-html` 全部翻成模板 + `<ico>`：fab 图标（`FABS` 改存图标名）、`<empty-state>` 内部片段、
  KvRow 的 `v` 分支、进度层 `.owarn`、排序筛选按钮的图标（选项从 `[值, HTML]` 变 `[值, 图标名, 文案]`）。
  逐个查过调用方传的都是纯文本（EmptyState 的 7 个调用方、KvRow 的统计/采集卡），
  `{{ }}`（textContent）与 v-html 产出的节点相同；筛选项没有图标时多出一个 v-if 注释节点 `<!---->`，
  它不是元素，textContent、布局、点击都一致。模板里的 `v-html=` 属性 **6 → 0**。
* **真机抓到一个真 bug**：进度层组件用 `<ico>` 只加了文件头注释里的注册表，没加组件自己的
  `components: { Ico }` → Vue 运行时只 `console.warn(Failed to resolve component)`，页面上是个
  裸 `<ico n="alert">` 元素，图标位置空着。闸门⑮ 的注册表是「每文件一份」，Vue 认的是组件自己的
  `components` 选项，两者可以不一致。新增闸门㉔（29 个组件的自定义标签全在自己 components 里）
  与闸门㉓（59 个模板 v-html 归零），两条都做过反向实验。
* DOM 等价性：`probe_sheets.sh` 加四个夹具点（fab 在两个 tab 的 `.fico`、进度层 `.owarn` 与整张
  `.ovlcard`），`dom_equiv3.js` 扩到 **13 例**全一致；因为 16d 动了 KvRow 与 EmptyState，
  16b/16a 两套重跑：`dom_equiv2.js` **13 块**、`dom_equiv.js` **3 块**全一致 → 共 29 例逐字一致。
  三个工具的旧侧基线不再写 `HEAD`（HEAD 一路在动，这一步第一次跑就撞上「HEAD 里找不到 cdChip」），
  钉死到「那批字符串函数被删掉之前的最后一版」：16d→`cf69909`、16b→`bd91977`、16a→`98915cc`。
* 数字：内联 `onclick` **0**；模板 `v-html` **0**；handler 80（全在 Vue 模板，基线 73）；
  导出表 68 个 key；闸门 **121** 项（+2）。
* 验收：`ui_test.js` **121 项全绿**、`GO_TEST=1 ./build.sh` 绿、`./install.sh` Success、
  `./test.sh --vd` **165 项 ok / 0 FAIL / PASS**。
* P13 的「手工 WebView 代码」到此清零：`go/ui/js/` 里没有字符串拼 HTML 的渲染器；`index.html` 剩下
  图标 sprite（`<use>` 的引用源，必须静态）、五个挂载容器、probe 兜底面板（刻意裸 JS：Vue 起不来时它要能画）。
