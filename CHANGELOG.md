# 更新日志

版本按开发阶段（Pn）记录，全部在手机上完成。界面改动都经过后台屏截图核对 +
`tools/ui_sig_test.js`（71 项 UI 结构契约）+ `go test ./...`。

## 0.1（当前）

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
