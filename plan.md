# eNote 开发计划 v2：界面重构 + 附件页 + 剪贴板收集 + 明暗主题

> 状态：**计划已定，本机开发**（不 handoff，全部功能做完再交接）。每阶段做完立即 `git push`，不丢成果。
> 需求来自 2026-11-21 的口头描述，本文档做了三件事：**拆解 → 分析依赖与平台约束 → 重排成可交付阶段**。
> 每阶段都是"可编译、可安装、可验收"的完整增量，做完一步再动下一步。

---

## 0. Handoff：新设备上手三步

```sh
# 1) 工具链（约 20 分钟，需要网络）
cd eNote/.agents/skills/dev-apk-on-android && sh scripts/setup-toolchain.sh
# 2) OCR 引擎：从旧手机拷 ~/ocr 到本机 ~/ocr（vivo 离线 OCR 的 jar + .so + 模型）
#    项目里的 assets/mdl_ocr 与 jniLibs/arm64-v8a 已随仓库带过来，正常不需要重拷
# 3) 构建 + 安装 + 验收
GO_TEST=1 ./build.sh && ./install.sh && ./test.sh --vd
```

关键约定（详见 `README.md` 与 `.agents/skills/dev-apk-on-android/references/pitfalls.md`）：

* 全程在手机上构建，无 Gradle / 无 PC；`app.env` 是唯一配置入口（包名 `dev.xduo.enote`）。
* 用户正在用手机时，所有 UI 操作在后台屏：`./vd.sh create|launch|shot f.png|tap X Y|swipe ...|destroy`。
* 读 app 私有目录要 `su --mount-master -c "..."`；API 端口从日志里取：
  `P=$(su --mount-master -c "grep -o '127.0.0.1:[0-9]*' /data/data/dev.xduo.enote/files/enote/enote.log" | tail -1 | cut -d: -f2)`
* 验收一律跑 `./test.sh --vd`（含构建），不许只截图目测。

---

## 1. 现状盘点（代码地图，2026-11-21 的 main = 54ed353）

| 位置 | 内容 | 与本次需求的关系 |
|---|---|---|
| `AndroidManifest.xml:33` | MainActivity 用 `Theme.Material.NoActionBar.Fullscreen` | **R1 状态栏被隐藏的直接原因** |
| `AndroidManifest.xml:14-15` | 只有 `INTERNET` / `ACCESS_NETWORK_STATE` | R7 要加通知、前台服务、剪贴板相关权限 |
| `src/dev/xduo/enote/` | 5 个类：`EnoteApp` `Bridge` `OcrHelper` `ShareActivity` `MainActivity`（约 700 行） | R7 要加 `ClipService`（前台服务）；`Bridge` 要加主题同步、剪贴板补读 |
| `src/dev/xduo/enote/Bridge.java:96` | `pickImage()` / `reocr(id)` / `log` / `status` | 附件页的"添加文件"入口挂在这里 |
| `go/ui.html`（392 行，单文件 UI） | `:root` 深色 CSS 变量（8-13 行）、`header`（19-27 行）、`nav`（31-42 行，3 tab + 圆形 fab）、`renderNotes/renderTodos/renderSettings` | **R2/R3/R4/R5/R6/R8 全部落在这里** |
| `go/store.go:33-52` | `Note{ID,Title,Content,RawText,Tags,Todos,Source,ImagePath,ImageName,OCRText,OCRMs,AIModel,AIMs,AIRaw,Status,Error,CreatedAt,UpdatedAt}` | 附件模型要泛化（R4）；排序/筛选字段基本够用 |
| `go/web.go:50-78` | 路由：`/`、`/api/state\|note\|add\|reparse\|delete\|todo\|settings\|llm/test\|llmlog\|log\|export`、`/img?id=` | 要加 search / attachments / stats / clipboard / theme |
| `go/pipeline.go` | 异步 ingest 队列：`queued → parsing → done\|raw\|error` | R7 的"批量解析"直接复用这个队列 |
| `go/config.go` | BYOK 设置（`baseUrl/apiKey/model/timeoutS/maxTokens/temperature/useAI`），默认无端点 | 要加 `theme`、`ui`（每页排序筛选）、`clipWatch` |
| `test.sh` | 端到端验收：selftest hook → 分享文本 → 分享图片 → 待办增删改 → 重新解析 → 设置回环 | 每阶段都要加断言 |

当前 UI 结构（要改的起点）：

```
header:  eNote 品牌字 + 统计数字
main:    笔记列表 / 待办分组 / 设置表单
nav:     [笔记] [待办] (＋圆形fab) [设置]
```

目标 UI 结构：

```
header:  [icon] [搜索框........] [排序筛选]      ← 笔记/待办/附件三页共用
main:    笔记 | 待办 | 附件 | 我的
nav:     [笔记] [待办] [附件] [我的]        +  右下角圆角矩形 FAB（悬浮在内容上）
```

---

## 2. 需求清单（原始 8 条 → 可执行条目）

| 编号 | 原始描述 | 拆解出的工作项 |
|---|---|---|
| **R1** | 状态栏被自动隐藏，不是游戏，要显示出来 | 去掉 Fullscreen 主题；状态栏图标颜色随主题；header 顶部内边距改用真实 insets |
| **R2a** | 底部四个按钮：笔记、待办、附件、我的 | nav 从 3 tab 改 4 tab；`设置` tab 取消 |
| **R2b** | 新建按钮改成右下角圆角矩形 FAB | fab 从 nav 里拿出来，`position:fixed` 悬浮，避开 safe-area；各页语义不同（笔记=记一笔，待办=加待办，附件=添加文件，我的=无） |
| **R3** | 顶栏 = 左 icon + 中搜索框 + 右排序筛选按钮（浮动面板，可按创建时间等各种信息排序筛选） | 新组件 `topbar`；后端搜索 + 排序 + 筛选 API；面板 UI；每页各自记忆条件 |
| **R4** | 附件页展示用户加进 app 的各种附件（现在只有图片，未来有别的格式），暂不写点击打开的代码；顶栏排序筛选也作用于这一页 | 附件数据模型泛化；附件索引 API；网格 UI；`/file?id=` 通用文件服务；分享接收扩展 mime |
| **R5** | 我的页展示统计信息；设置按钮移到这里，点击打开新的设置面板 | 统计 API；我的页设计；设置从 tab 变成全屏面板 |
| **R6** | 笔记/待办/附件三页顶栏统一；我的页单独设计、要好看 | 顶栏组件化；我的页独立视觉 |
| **R7** | 加通知权限、常驻通知、监控剪贴板；复制的文字+图片先暂存不解析；打开 app 后批量勾选、一键解析 | **定稿：前台监听**（Android 10+ 只允许默认输入法/有焦点 app 读剪贴板，无障碍服务不豁免——实测被 ClipboardService 拒绝）。MainActivity onResume 注册 ClipboardManager 监听 + 读一次剪贴板；Go 侧 clip.json 暂存 + 去重（同内容跳过、同源 5 秒内替换、单条 20000 字上限）；横幅 + 批量勾选页 + 一键解析/原样存为笔记 |
| **R8** | 明暗主题切换，默认亮色 | CSS 变量双主题；`theme` 设置项（light/dark/auto）；状态栏 + `theme-color` 同步；默认 light |
| **R9** | 重绘 app 图标：现代简洁，有竖琴的神韵 | 新画 1024 母图（几何竖琴 + 蓝绿渐变）→ 自适应图标（前景/背景层）+ 各密度 mipmap；`tools/gen_icon.py` 一键重生成 |
| **R10** | 界面元素增加大量微动画（按钮、点击等），形成自己的组件库方便复用 | `go/ui.css` 组件层（btn/card/chip/sheet/toast/topbar/tabbar/fab/switch/segmented/empty/skeleton）+ 动画 token；按钮按压回弹、tab 滑动指示器、卡片 stagger 入场、勾选划线、删除滑出、主题交叉淡入；`prefers-reduced-motion` 降级 |
| **R12** | AI 不只提取待办，还要提取「事实类关键信息」：体检报告→体检时间/异常指标；获奖证书→何时/何机构/何奖项。门类无法穷举，改用固定提问框架 | 解析 JSON 增加 `facts`：按 **何时 / 何人 / 何地 / 何事 / 为何 / 下一步** 六问抽取，每条 `{q,a}`；无信息则留空；卡片上渲染「关键信息」块；搜索纳入 `facts` |
| **R13** | 有了倒计时，能不能接系统日历 / 闹钟 / 系统提醒？还是自研提醒 | 见 §3.5 评估：先做「写入系统日历 + 设为闹钟」intent（零权限），自研提醒留到 P6 之后（复用常驻通知基建） |
| **R14** | 顶栏左上角 logo：圆角矩形外面那圈白色留白要去掉 | `.iconbtn` 继承 UA `button{padding}` 把图挤小 → `padding:0`，图片铺满按钮 |

---

## 3. 分析

### 3.1 依赖关系（决定顺序的东西）

```
R1 状态栏 ──┐
            ├─→ R8 主题 token ──┐
（窗口层）  │                   │
            └───────────────────┼─→ R2 外壳（4 tab + FAB + 顶栏骨架）
                                │        ├─→ R3 搜索/排序/筛选（顶栏的功能）
                                │        ├─→ R4 附件页（依赖附件模型 + 顶栏组件）
                                │        └─→ R5/R6 我的页 + 设置面板（依赖 tab 结构）
                                │
R7 剪贴板/通知 ─────────────────┘（依赖外壳：批量勾选 UI 要挂在笔记页/新页上）
```

结论：**窗口与主题是地基，外壳是骨架，剪贴板是最大且最独立的一块，放最后。**

### 3.2 平台约束（先想清楚再写代码，这几条会决定方案）

1. **状态栏（R1）**：`Theme.Material.NoActionBar.Fullscreen` 是全屏主题，去掉即可。非全屏后 WebView 会自动避开状态栏，`env(safe-area-inset-top)` 变成 0，`go/ui.html:19` 的 header padding 要跟着调，否则顶部会突然挤一下。亮色主题下要让状态栏图标变深色：API 23+ 的 `windowLightStatusBar`（minSdk 26 可直接用），API 30+ 用 `WindowInsetsController.setAppearanceLightStatusBars()`。

2. **剪贴板（R7，最大的坑）——已定方案 B：无障碍服务**。Android 10（API 29）起，**非前台应用读不到剪贴板内容**（`getPrimaryClip()` 在后台返回被裁剪的占位），**前台服务不豁免**，豁免对象只有输入法与**无障碍服务**。所以：

   * 声明 `ClipWatchService : AccessibilityService`（`android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"` + `meta-data android.accessibilityservice` 指向 `res/xml/clip_accessibility.xml`）。
   * 服务内 `onServiceConnected` 里 `getSystemService(ClipboardManager).addPrimaryClipChangedListener(...)`；无障碍服务在后台调 `getPrimaryClip()` **能拿到全文**，图片也能拿到 `content://` URI。
   * 事件驱动，**不轮询**；`onAccessibilityEvent` 里只处 `TYPE_WINDOW_CONTENT_CHANGED` 做心跳兼底（部分 ROM 后台 listener 会失效）。
   * 用户引导：设置页→“采集”→开关，未授权时 `startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))` 直接跳到无障碍列表（vivo OriginOS 路径：设置→快捷与辅助→无障碍→已下载的应用），开屏文案要写明“只读剪贴板，不点解析不上传”。
   * 常驻通知由同一个服务挂（无障碍服务本身就是系统绑定的，比普通前台服务存活好），开关关闭时 `disableSelf()`。
   * 图片：`ClipDescription.hasImage()`（API 24+）；`content://` 能读就拷进 `attachments/`，读不到（无权限/已失效）则只存元数据并提示手动添加。
   * 兼容：minSdk 26，无障碍 API 全可用；Android 13+ 的“粘贴提示”toast 属于系统行为，无法关闭，需在文档说明。

   备选（已否决）：A = 前台服务只记元数据、回前台补读（后台拓不到内容）；C = 不监听，只提供“粘贴一条”按钮。

3. **通知（R7）**：targetSdk 33 → `POST_NOTIFICATIONS` 是运行时权限，必须 `requestPermissions`；常驻通知需要前台服务（`FOREGROUND_SERVICE` 权限 + 通知渠道 `IMPORTANCE_LOW`，别响铃）。若以后把 targetSdk 升到 34+，前台服务必须声明 `foregroundServiceType`（`specialUse` 最贴合），现在先留注释。

4. **主题（R8）**：现在是硬编码深色（`go/ui.html:8-13` 的 `:root`）。做法：`:root` 放**亮色**（默认），`html[data-theme=dark]` 覆盖；`<meta name=theme-color>` 与状态栏图标由 Java 侧同步（`Bridge.setTheme(mode)`）。`auto` 用 CSS `prefers-color-scheme` + Java 侧 `UiModeManager` 双向同步。**所有颜色必须走变量**，任何硬编码 `#0b0f14` 都是 bug——这条要写进验收。

5. **附件（R4）**：现在一条笔记最多一张图（`Note.ImagePath`）。泛化成 `Note.Attachments[]`，兼容策略选**惰性迁移**：加载时若 `imagePath` 非空且 `attachments` 为空，就合成一条附件记录；写入时双写（`imagePath` 保留），这样旧读取路径（`/img?id=`、卡片缩略图）不用一起改。分享接收的 intent-filter 若要收任意文件，加 `<data android:mimeType="*/*" />` 的 SEND —— 这会让 eNote 出现在**所有**分享菜单里，是产品决策（见 §3.4）。

6. **搜索（R3）**：中文不做分词，直接大小写不敏感子串匹配（title/content/rawText/ocrText/tags/todos 全参与），数据量级（几百条）线性扫完全够，别引入 boltdb/sqlite。

7. **图标（R9）**：现在 `res/mipmap-*/ic_launcher.png` 是脚本生成的占位图。重绘要点：现代简洁 + **竖琴神韵**（琴柱 + 琴颈 + 弦的几何抽象，不做写实插画）。做法：`tools/gen_icon.py`（PIL）画 1024 母图（蓝绿渐变圆角底 + 白色琴弓曲线 + 5～7 根弦），同时输出：
   * 自适应图标 `res/mipmap-anydpi-v26/ic_launcher.xml` + `ic_launcher_background.xml`/`ic_launcher_foreground.xml`（矢量，前景留安全区 66dp）；
   * 各密度 `mipmap-{mdpi..xxxhdpi}/ic_launcher.png`（legacy，给分享面板/启动页用）；
   * `docs/icon-master.png`（1024，商店用）。
   约 30 行矢量代码，不用设计工具；改设计只改脚本重跑。

8. **微动画与组件库（R10）**：约束是**不引入构建链与动画库**（无 npm、无 framer），纯 CSS + 少量 JS 工厂：
   * 动画 token：`--d1:110ms --d2:180ms --d3:280ms --ease:cubic-bezier(.2,.8,.2,1)`，全组件只用这三个时长；
   * 只用 `transform` / `opacity`（不触发重排），`will-change` 节制使用；
   * 组件库落在 `go/ui.css`（构建时与 `ui.html` 一起打包）：`btn / btn-primary / btn-ghost / icon-btn`（按压 scale .96 + ripple）、`card`（入场 rise + stagger）、`chip`、`switch`、`segmented`、`sheet`（弹性上滑 + 遮罩淡入）、`toast`、`topbar`、`tabbar`（滑动指示器）、`fab`（圆角矩形，按压 + 图标旋转）、`list-item`（删除滑出）、`empty`、`skeleton`（shimmer）、`field`；
   * 微动画清单：按钮/图标按压回弹、tab 切换指示器滑动 + 内容淡入、卡片 stagger 入场（≤ 8 张，每张 24ms）、待办勾选划线 + 行变淡、FAB 点击图标旋转 45°、sheet 拖拽关闭、搜索框展开、主题切换交叉淡入、骨架屏 shimmer、数字滚动（统计页）；
   * `@media (prefers-reduced-motion: reduce)` 统一降级为无动画；
   * 验收：新页面不得自写样式，必须复用组件库；grep 检查无 `animation:` 硬编码时长（全走 token）。

### 3.3 数据与 API 变更（一次设计好，避免反复改 JSON）

新增/变更设置项（`go/config.go`，全部有默认值，旧 `settings.json` 直接兼容）：

```jsonc
{ "baseUrl": "...", "apiKey": "...", "model": "...", "timeoutS": 90, "maxTokens": 2048,
  "temperature": 0.2, "useAI": true,
  "theme": "light",            // light | dark | auto，默认 light（R8）
  "clipWatch": true,           // 常驻通知 + 剪贴板监听开关（R7）
  "ui": {                      // 每页各自的排序筛选记忆（R3/R4）
    "notes":  {"q":"","sort":"created","dir":"desc","filters":{}},
    "todos":  {"q":"","sort":"due","dir":"asc","filters":{"status":"open"}},
    "files":  {"q":"","sort":"created","dir":"desc","filters":{"mime":""}}
  }
}
```

新增端点（`go/web.go`）：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/search` | GET | `q, sort(created\|updated\|due\|title\|priority\|size), dir, source, status, tag, hasFile, due(open\|today\|overdue\|none), limit` → 笔记列表 + 命中片段 |
| `/api/attachments` | GET | `q, sort(created\|size\|name\|mime), dir, mime, note` → 附件列表（含所属笔记标题） |
| `/file?id=` | GET | 通用文件服务（按附件 id，带正确 mime，inline） |
| `/api/stats` | GET | 我的页统计：笔记数、待办（今日/逾期/完成）、附件数与字节、AI 调用数与均耗时、OCR 次数、近 7 天分布 |
| `/api/clip` | GET/POST | 剪贴板暂存队列：列出 / Java 侧写入 / 删除单条 |
| `/api/clip/parse` | POST | `{ids:[...]}` → 批量入队（复用现有 ingest 队列），返回新建笔记 id |
| `/api/theme` | POST | `{mode}` → 写 settings 并回传新色板（Java 侧同步状态栏用） |

Java 侧新增：`ClipWatchService`（无障碍服务，后台读剪贴板 + 常驻通知）、`Notify`（渠道）、`Bridge.setTheme(mode)`、`Bridge.pickFile()`、`Icon`（自适应图标由资源提供）。

### 3.4 决策记录（已拍板，2026-11-21）

| # | 问题 | 决定 |
|---|---|---|
| 1 | 剪贴板方案 | **B：无障碍服务**（后台可读全文，接受去设置里开权限） |
| 2 | 常驻通知 | 默认开，设置里可关（关了 = 停止采集） |
| 3 | 分享入口 mime | 先收窄：`text/*` + `application/pdf`（不加 `*/*`，避免出现在所有分享菜单） |
| 4 | 附件页添加入口 | 加文件选择器（`ACTION_OPEN_DOCUMENT`） |
| 5 | 主题 | 三档 light/dark/auto，**默认 light** |
| 6 | 搜索范围 | 包含 `ocrText`，结果里标注“来自图片文字” |
| 7 | 待办默认筛选 | 默认只看未完成，面板里可勾选已完成 |
| 8 | 开发方式 | **不 handoff**，本机（Termux）开发完所有功能，每阶段推 github |

---

### 3.5 R13 评估：系统日历 / 闹钟 / 自研提醒（2026-11-21）

| 方案 | 做法 | 权限 | 结论 |
|---|---|---|---|
| A. 系统日历（intent） | `CalendarContract.Events.CONTENT_URI` 走 `ACTION_INSERT`，预填标题/开始/结束时间，用户在日历里点保存 | 无需权限 | ✅ 做。vivo 日历能收到并自带到期提醒；零权限、零后台进程 |
| B. 系统闹钟（intent） | `AlarmClock.ACTION_SET_ALARM` + `EXTRA_SKIP_UI`（API 23+） | `SET_ALARM`（normal，装机即有） | ✅ 做，作为「设为闹钟」次选。部分国产时钟 App 不认 SKIP_UI，失败就 toast |
| C. 直接写日历数据库 | `CONTENT_URI` insert + `Calendars` 账号 | `WRITE_CALENDAR`（dangerous，要弹窗） | ⏸ 暂不做。多一个运行时权限弹窗，收益只是省一次点击 |
| D. 系统「提醒事项」 | 无公开 API（Google Tasks / 三星 Reminder 各自私有） | — | ❌ 不可行 |
| E. 自研提醒 | `AlarmManager.setExactAndAllowWhileIdle` + 通知渠道「到期提醒」，点击打开对应待办 | `POST_NOTIFICATIONS`(33) + `SCHEDULE_EXACT_ALARM`(31+，可在设置里被关) | ✅ 做，但排在 P6 之后：常驻通知、前台服务、通知渠道这些基建 P6 才建好，届时只加一个闹钟调度 |

**结论**：P5.5 先落 A + B（每个待办行加「📅 日历」「⏰ 闹钟」两个小按钮，有 due 才显示）；A/B 只用 AOSP 标准契约（`ACTION_INSERT` + `CalendarContract.EXTRA_EVENT_BEGIN_TIME/END_TIME`、`AlarmClock.ACTION_SET_ALARM` + `EXTRA_HOUR/MINUTES/SKIP_UI` + normal 权限 `SET_ALARM`），**不为任何厂商魔改做适配**——厂商 App 认不认 extras 是它的事，拉了不该拉的界面就 toast 提示，不追。

**E（自研提醒）提升为 P6.5 并前移**：厂商日历/闹钟的 extras 兼容性不可控（vivo 会丢自定义时间、SKIP_UI 被忽略），而 `AlarmManager.setExactAndAllowWhileIdle` + `NotificationChannel` 是纯标准 API，所有 Android 8+ 行为一致。因此「到点弹通知」由自己做，系统日历/闹钟只作为「我想在系统里也留一条」的次要出口。

## 4. 重排后的开发顺序

> 每个阶段结束必须：`GO_TEST=1 ./build.sh && ./install.sh && ./test.sh --vd` 全绿 + 后台屏截图存 `.test/shots/`，并在 `CHANGELOG`/commit 里记录。

### P0 状态栏回归（R1）— 最小，先做，立刻能看到效果
* `AndroidManifest.xml:33` 主题改 `Theme.Material.NoActionBar`（去掉 `.Fullscreen`）；ShareActivity 的 Dialog 主题不动。
* 加 `windowLightStatusBar`（亮色主题下深色图标），Java 侧统一由主题同步函数处理（P1 会用到）。
* `go/ui.html:19` header 的 `padding-top` 改成"非全屏时的固定值 + `env(safe-area-inset-top)`"，避免顶部跳动。
* 验收：截图里状态栏（时间/电量/信号）可见；下拉通知栏正常；`test.sh` 增加断言"app 前台时 display 0/151 的 `mCurrentFocus` 正常且无 ANR"。

### P1 主题系统（R8）— 先定 token，后面所有页面直接继承
* `go/ui.html`：`:root` 换成**亮色**默认（白/浅灰底、深灰字、主色保留蓝绿渐变），新增 `html[data-theme=dark]{...}` 覆盖；把散落的硬编码色（header 渐变、fab 渐变、chip、toast、sheet）全部换成变量。
* `<meta name=theme-color>` 由 JS 按当前主题动态设置；`Bridge.setTheme(mode)` 同步状态栏图标（亮色→深色图标）。
* `config.go` 加 `theme`（默认 `light`）+ `/api/theme`；设置项 UI 在 P5 落地，本阶段先用调试入口（长按顶栏品牌字切换，P5 删掉）。
* 验收：`test.sh` 加断言：`GET /api/state` 的 `settings.theme=="light"`；`POST /api/theme {mode:dark}` 后 `/api/state` 返回 dark；截图两张（light/dark）人工核对；grep 检查 `go/ui.html` 里除 `:root`/`[data-theme]` 外无硬编码颜色。

### P2 外壳重构（R2a + R2b + R6 骨架 + R10 组件库基座）

> **已完成（本机）**：组件库内联在 `go/ui.html`（不拆 `go/ui.css`，避免打包步骤）；4 tab + 滑动指示器、圆角矩形 FAB（随页语义换文案）、共用顶栏、`.btn/.card/.chip/.sheet/.seg/.li/.empty/.skel/.hero/.statgrid` + 动画 token。
* **先做组件库**（`go/ui.css`）：动画 token + `btn/card/chip/switch/segmented/sheet/toast/topbar/tabbar/fab/list-item/empty/skeleton/field`，现有页面改成调用组件（否则后面四个页面会各自造轮子）。
* nav 改 4 tab：`笔记 待办 附件 我的`，带滑动指示器动画；`设置` tab 移除（临时把设置挂在“我的”页顶部，P5 完成）。
* FAB 从 nav 里拿出来：`position:fixed; right:16px; bottom:calc(84px + env(safe-area-inset-bottom))`，**圆角矩形**（`border-radius:16px`，图标+文字“新建”），按压回弹 + 图标旋转，随页面语义变文案/动作；滚动时轻微缩小。
* 顶栏组件化：`topbar(mode)` 生成 `icon + 搜索框 + 排序筛选按钮`，笔记/待办/附件三页共用；“我的”页用独立 header（P5）。
* 现有 `renderSettings()` 保留但只从“我的”进入，保证阶段结束时功能不丢。
* 验收：4 个 tab 可切换且各自内容正确；FAB 在四页语义正确（笔记=记一笔 / 待办=加待办 / 附件=添加文件 / 我的=无 FAB）；FAB 不遮挡列表最后一项；tab 切换与按钮按压有可见动效（连拍截图对比）；`test.sh` 加断言：`/api/state` 正常 + VD 上 tap 四个 tab 后截图。

### P3 搜索 + 排序 + 筛选（R3）

> **已完成（本机）**：`go/search.go` = `runSearch`（q 命中 标题/正文/待办/标签/图片文字/原始分享文字，命中来源以 `where` 返回，前端渲染成 🔍 徽标，图片文字单独配色）；`GET /api/search?tab&q&sort&dir&src&status&done&pri&limit`；`POST /api/prefs` 写 `settings.ui.<page>`，重启后每页恢复自己的条件。Go 单测 `go/search_test.go`（4 个用例）+ `test.sh` 的 `search + per-page prefs` 步骤。**未做**：有无附件 / 标签 / 日期范围筛选（P4 附件模型落地后加）、关键词高亮。
* 后端 `/api/search`（§3.3），Go 单元测试覆盖：中文子串、tag 命中、todo 文本命中、各 sort、各 filter、dir。
* 前端：搜索框防抖 250ms；排序筛选按钮弹**浮动面板**（复用 `.sheet`/panel 组件），面板内容 = 排序字段 + 升降序 + 筛选 chips（来源、状态、有无附件、有无未完成待办、标签、日期范围）；按钮上显示"已启用 N 项筛选"徽标；条件写进 `settings.ui.<page>`，切页/重启后记忆。
* 空结果态、搜索中态、命中关键词高亮。
* 验收：`test.sh` 加：写入 3 条测试笔记 → `/api/search?q=牛奶&sort=created&dir=desc` 命中 1 条；`filter=hasFile` 命中图片笔记；`due=overdue` 命中逾期项；UI 上 tap 搜索→输入→tap 筛选→勾选→截图。

### P4 附件页（R4）
* 数据：`Note.Attachments[]`（`ID,NoteID,Name,MIME,Size,Path,CreatedAt,Source`）+ 惰性迁移（§3.2.5）；`Store.remove` 从删单图改成遍历删附件文件（现有逻辑在 `go/store.go` 的 `remove`，已实现单图删除，扩展成遍历）。
* 后端：`/api/attachments`、`/file?id=`；分享接收扩展 mime（按 §3.4 第 3 条的答复）；`Bridge.pickFile()`（`ACTION_OPEN_DOCUMENT`，取 persistable 权限）。
* 前端：网格视图（图片=缩略图卡片，其他=类型图标 + 文件名 + 大小 + 日期），点击**暂不打开**（点击给 toast "预览即将上线"），长按/卡片菜单可"跳到所属笔记"和"删除附件"；顶栏排序筛选组件作用于本页（按大小/名称/时间/类型）。
* 验收：分享一张图 + 分享一段文本 → 附件页只多一条；`/api/attachments` 数量与磁盘文件数一致；删除笔记后附件文件从磁盘消失（`su --mount-master` 数文件）；截图网格页（图片卡 + 非图片卡）。

> **已完成（本机）**：`go/attach.go` = 附件模型（`Attachment{ID,NoteID,Name,MIME,Size,Path,Source,CreatedAt}`）+ `attachTo`（同路径去重，双写 `Note.ImagePath`）+ `mimeByExt/kindOfMime`（扩展名兜底：`file://` 分享常带 `application/octet-stream`）+ `listAttachments`（`sort=new/size/name/kind`，`dir` 直接表示方向而非翻转；`mime` 支持 `image/` 前缀或 `image/pdf/doc/...` 类型名；`files/missing` 统计的是**过滤后**列表）+ `handleFile`（`inline; filename*=UTF-8''`，404/410）。`/api/attachments`、`/api/attach/delete`、`/file?id=`。`store.remove` 遍历删附件文件；`openStore` 惰性迁移 `imagePath` → `Attachments[]`（日志 `synthesised attachment records for N note(s)`）。分享扩展：`ShareActivity.processFile`（`share-file`）+ 清单加 `text/*`、`application/pdf`（刻意不收 `*/*`）；`Bridge.enqueueFile` + `MainActivity.pickFile()`（`ACTION_OPEN_DOCUMENT`，图片走 OCR、其余存文件）+ FAB「添加附件」。搜索加 `附件名` 字段和有无附件筛选（`file=yes/no`，笔记页筛选面板第四组）。Go 单测 `go/attach_test.go`（6 个用例）+ `test.sh` 的 `attachments: share a file, list it, delete it` 步骤（分享 PDF → 列表 +1 且与磁盘数一致 → 按名搜索 → `/file` 取字节 → 删附件 → 删笔记后文件清零）。**未做**：附件预览（点击 toast「预览即将上线」）、导入/多选删除、非图片附件缩略图。

### 修补：列表秒级闪烁（P4 验收时发现）
* 症状：停在列表页什么都不做，界面约每秒重绘一次（卡片入场动画重播、缩略图重载、滚动位置微跳）。
* 原因：`setInterval(refresh, 1800)` 无条件 `render()` 重建 `#view.innerHTML`；且 `#view` 上的 `enter` class 加上后再未移除，于是每次重建都重播 `.card`/`.acard` 的入场动画。
* 修法：轮询改“安静刷新”——`sigOf(S)` 指纹（笔记数/状态/updatedAt/标题/待办数/附件数/统计/主题）没变就只刷状态点；`searchNow`/`filesNow` 再比一次响应指纹，内容相同不重建 DOM；`enter` 在 520ms 后摘掉，`.acard` 去掉无条件动画；搜索框改为 260ms 防抖（原来每敲一个字重建一次）。
* 回归：`tools/ui_sig_test.js`（从 `ui.html` 注释真实 `sigOf` 源码测 12 条断言）接进 `test.sh` 的 `ui: 轮询只在数据变化时重绘` 步骤；真机连拍验证——静止时逐像素相同，外部改数据后截图变化。 + 自绘对话框 + 逐级返回（P4 验收后反馈）
### 修补：底部导航 5 按钮 + 自绘对话框 + 逐级返回（P4 验收后反馈）
* **“记一笔”进底栏**：`#fab` 从悬浮层移进 `<nav class="tabbar">`，放在「待办」和「附件」中间，形成 5 格：笔记 | 待办 | ＋记一笔 | 附件 | 我的。`.tabbar{align-items:flex-end}`，中间按钮 `flex:0 0 auto;width:96px;height:46px;border-radius:15px`（圆角矩形，不是圆形 FAB）；`body` 底部留白 168px → 96px；`setTab` 用 `FABS[tab] || FABS.notes`，中间按钮常驻可见，文案随页切（笔记=＋记一笔 / 附件=＋加附件）。
* **指示条不居中**：`.tabbar .ind` 没写 `left`，绝对定位的静态原点是 flex 内容盒，而 `offsetLeft` 从 padding 盒量起，两者差一个 `padding-left:8px`，指示条整体右偏 8px，看起来贴着按钮左对齐。加 `left:0` 后原点统一（真机实测：「我的」文字中心 961，指示条中心 959.5）。
* **不要原生弹框**：`confirm()`/`alert()` 在 WebView 里顶着一行“网址为 "http://127.0.0.1" 的网页显示：”。新增 `.dlg` 遮罩 + `dialog()/closeDlg()/askDel()`，页面里一处原生调用都不剩；Java 侧 `onJsAlert`/`onJsConfirm` 转发给 `window.uiDialog(title,msg,id)`，结果由 `Bridge.dialogResult(id,ok)` 回传（`static JsResult pendingJs`），第三方页面调 `confirm` 也不会露原生框。
* **面板关闭按钮**：`sheet()` 注入 `.pclose`（右上角 32px ✕，`panel{position:relative}`、`h2{padding-right:38px}` 避让）。
* **逐级返回 + 连返两次退出**：返回键原来直接 `finish()` 退出 app。现在 Java `back()` 先问 `window.uiBack()`——关对话框 → 关面板 → 回笔记页，都关不掉才返回 0。`back()` 同时接在 `onKeyDown(KEYCODE_BACK)` 和 `onBackPressed()`（部分 ROM 的侧滑手势只走后者），`backInFlight` + 800ms 超时去重，防止同一次返回被派发两次。已经在笔记页时要**连返两次**（2.2s 内）才退出，第一下弹 toast “再返回一次退出 eNote”。
* **页面左右留白**：`main#view{padding:0 14px}`，卡片不再贴屏幕边缘；顶栏 / 底栏是整宽条，保持全幅。
* **“我的”页过度设计**：左滑会拉伸半屏再回弹——那是 WebView 自己的 overscroll，加 `web.setOverScrollMode(View.OVER_SCROLL_NEVER)`；同时删掉 hero/stat 的 `rise` 入场动画和 hero 上两个装饰圆环；“外观主题”行也删了（设置面板里已有，只留一个入口）。
* **涟漪闪屏**：涟漪选择器里带了 `.li`，而 `.li`、`.tabbar .fab`、`.seg button` 都没有 `position:relative`，水波的定位基准落到 viewport，在“我的”页任意处点一下都会盖出一个满屏灰色圆。现在涟漪只给真按钮，并给 `.tabbar .fab`、`.seg button` 补上 `position:relative` + `overflow:hidden`。
* 回归：`tools/ui_sig_test.js` 从 12 条扩到 26 条（FAB 在底栏、`left:0`、无原生 `confirm(`/`alert(`、Java 转发、`.pclose`、`uiBack`+`evaluateJavascript`、`onBackPressed`+退出 toast、`OVER_SCROLL_NEVER`、无装饰动画、页面留白、主题单入口、涟漪不溢出），真机验证：`n3` 底栏 5 按钮、`n4` 指示条居中、`n5` 面板 ✕、`n6`/`n7` 返回逐级、`n9` 自绘删除框、`n10` 返回关对话框、`o1` 页面留白、`p2` 退出提示 toast、`p3` 从“我的”返回笔记。

### P5 我的页 + 设置面板（R5 + R6）
* `/api/stats`；我的页独立视觉：头像区（应用图标 + 本地数据摘要）、统计卡片（笔记/待办/附件/AI 调用）、近 7 天柱状（纯 CSS）、入口列表（设置、主题、AI 调用记录、导出、导入、关于）。
* 设置改成**全屏面板**（从"我的"进入），分组：AI（端点/Key/模型/超时/maxTokens/温度/开关 + 测试连接）、外观（主题三档）、采集（剪贴板监听开关，P6 后启用）、OCR（引擎状态、重新识别）、数据（导出/导入/清空）。
* 删掉 P1 的临时调试入口（长按品牌字切换主题）。
* 验收：`/api/stats` 数字与 `/api/state` 一致；设置面板保存后重启 app 保持；主题在设置里切换即时生效；截图（我的页 light + dark、设置面板）。

### P5 验收补充（真机反馈后的修补，全部已落地）
* **应用改名「懒得记」**：`AndroidManifest.xml` 的 `android:label`、`res/values/strings.xml`、`go/ui.html` 顶栏品牌位同步；包名 `dev.xduo.enote` 不变（改名不换包，升级安装不丢数据）。
* **逾期差 8 小时**：Go 侧按 UTC 算「今天」，Java 把 `TimeZone.getDefault().getID()` 通过 `ENOTE_TZ` 传给 Go，`time.LoadLocation` 后按本地时区算天界；按天统计（近 7 天）同源修复。我的页「运行状态」新增一行「时区 Asia/Shanghai (UTC+8:00)」便于核对。
* **待办到期倒计时（R11）**：`dueChip(t)` 输出「不足 N 天 / 不足 N 小时 / 不足 N 分钟 / 逾期 N…」，每秒就地改文案（`setInterval` 只写 `.cd` 的 `textContent`，不重建 DOM，不打断别的动画）；逾期红、临期黄、远期灰。
* **勾选完成的动画**：划线（`.justdone` 删除线动画）→ 原位淡出（`.leaving`）→ 提交 → 新位置高亮入场；动画期间 `animLock` 让轮询跳过重绘，避免划线被 1.8s 刷新打断。
* **「重要」chip 比时间标签高一截**：根因不是字体缩放，是**类名撞车**——笔记错误框 `.err`（`font-size:12px;padding:7px 9px;border-radius:10px;margin-top:8px`）与 chip 的 `class="chip err"` 同特异性、写在后面，把 chip 的盒模型整条盖掉了。错误框改名 `.errbox`，chip 只留配色；`.chip`/`.due`/`.cd` 统一 `display:inline-flex;align-items:center;font-size:10.5px;line-height:1.4;padding:1px 7px;border:1px solid …`，`.tx small` 改 `display:flex;align-items:center;gap:4px`。真机像素核对：时间 55px / 倒计时 51px / 重要 51px，上下沿 y 913–963 完全对齐。
* **数据进出**：`/api/import`（按笔记 ID 合并，不覆盖本地）+ `/api/clear` + 导出 JSON；导入走系统文件选择器（`ACTION_GET_CONTENT` → `REQ_IMPORT` → `ContentResolver` 读流 → POST），导出页用返回键可退出（Java 返回键先回退网页历史）。
* **启动图标换成用户提供的图标集**（不再是 `tools/gen_icon.py` 自绘竖琴，脚本保留备用）：`res/mipmap-{m,h,x,xx,xxx}hdpi/ic_launcher.png`（48/72/96/144/192）+ `res/drawable-*/ic_launcher_{background,foreground}.png`（108…432）+ `res/mipmap-anydpi-v26/ic_launcher.xml` 自适应图标；删掉全部 `ic_launcher_round.*`，`android:roundIcon` 指向 `@mipmap/ic_launcher`。app 内 logo 同源：512 母图缩到 96×96 作 `go/icon.png`，`go/web.go` `//go:embed` 后挂在 `/icon.png`，顶栏品牌位 `<img class="brand">`。母图归档 `docs/icon-src/`。
* 回归：`tools/ui_sig_test.js` 扩到 40 条（改名、图标各尺寸 + 自适应图层 + app 内 logo、chip 统一盒模型、倒计时文案与就地更新、完成动画三段、时区传递、导入导出清空、设置面板分组）；`./test.sh --skip-build --vd` 全绿。截图：`v2-chips`/`v2-todos`/`v2-mine`/`v2-mine-bottom`/`v2-settings`/`v2-dark-*`/`v2-anim-*`。

### P5.5 事实提取 + 提醒入口 + logo 留白（R12 + R13-A/B + R14）— 小步快跑，先于 P6
* **R14**：`.iconbtn{padding:0}`（UA `button{padding:1px 6px}` 没被 reset，flex 里的 `<img>` 被挤小 → 一圈白底外框）；`img.brand` 铺满并继承 12px 圆角。
* **R12**：`systemPromptTemplate` 增加 `facts` 字段与六问框架（何时/何人/何地/何事/为何/下一步），规则写明「只写原文里有的，没有就省略该问」；`parsedNote` 加 `Facts []fact`；`Note.Facts` 落 JSON；卡片在正文上方渲染「关键信息」列表（问题做 label、答案做正文）；`/api/search` 把 `facts` 纳入匹配；旧笔记无 `facts` 时不显示该块（向后兼容，不迁移）。
* **R13-A/B**：`MainActivity` 暴露 `addToCalendar(title, dueMs)` / `setAlarm(dueMs, label)` 两个 JS 桥（`addJavascriptInterface` 已有 `Bridge`，直接加方法），JS 侧在待办行 due 存在时显示两个小按钮。
* 验收（分层，不依赖任何厂商 UI）：
  * R12 文本链路：`/api/add` 打真模型 → `notes.json` 里 `facts` 六问齐（已实测：何时/何人/何地/何事/下一步）。
  * R12 渲染/搜索：`go test`（`TestSearchMatchesFacts`、`TestCleanFacts`）+ 后台屏截图（已存 `.test/shots/v2-facts.png`）。
  * R13 契约：`go test` + `tools/ui_sig_test.js` 静态断言（标准 extra key、normal 权限）；系统层用 `dumpsys alarm` 计数与 `dumpsys activity` 里 intent 解析核对（已验证：SET_ALARM 生效、日历 intent 带着正确 DTSTART 拉起）。
  * R14：像素扫描顶栏左侧白色环带宽度 68px→0（已核对）。
* **已知差异（不阻塞，记录备查）**：部分厂商日历会忽略 `EXTRA_EVENT_BEGIN_TIME` 只取当前时间；部分厂商时钟忽略 `EXTRA_SKIP_UI` 直接弹编辑页。均为厂商 App 行为，非本 App 缺陷。

### P6 剪贴板采集（R7，定稿：前台监听）— 完成于 P5.6
* **关键实测**（2026-11-21）：无障碍服务方案（plan §3.4 方案 B）**不可行**——Android 10+ 的 `ClipboardManager.getPrimaryClip()` 只豁免默认输入法和有焦点的应用，无障碍服务**不在豁免列表**；真机日志：`ClipboardService: Denying clipboard access ... not in focus nor is it a system service`。监听器 `onPrimaryClipChanged` 能触发，但读内容被拒。
* **定稿方案**：
  * Java：`MainActivity` `onResume` 注册 `ClipboardManager` 监听并读一次当前剪贴板（此时有焦点，合法），`onPause` 注销；文字走 `Bridge.clipAdd`（JNI `nativeClipAdd`）。
  * Go：`clip.json` 暂存队列（`clip.go`）：同内容跳过、同源 5 秒内替换、单条 20000 字；`/api/clip/list|remove|clear|parse`；`clipParse` 复用 ingest 队列（`Raw` 支持原样保存不调 LLM）。
  * UI：笔记页顶部横幅「📋 剪贴板暂存 N 条」；批量勾选页（全选/反选/预览/来源/时间）+「一键解析」「原样存为笔记」；来源芯片「剪贴板/剪贴板图片」。
  * 砍掉：无障碍服务（ClipWatchService）、常驻通知（后台监控不可行，常驻通知失去意义）。
* 验收：真机复制 → 切回 app → 横幅出现 → 勾选 → 一键解析 → `clipboard-text` 笔记 `status=done`、facts 已提取、clip 清空（已实测）。
* 备注：通知权限（POST_NOTIFICATIONS）保留，P6.5 到期提醒要用。

### P6d 剪贴板真凶：去重签名自比恒真（用户第三轮实测，2026-11-21）

* **现象**：浏览器 / 原子笔记复制 → 切回 app，什么都没发生（前两轮修的焦点问题是真的，但不是主因）。
* **诊断日志给出的证据**（这轮开始每个静默分支都写日志）：
  ```
  22:40:43.818 clip 重复，未暂存 28 字（text, label=data）：浏览器复制测试 224100 https://a
  22:40:43.910 clip add: kind=text runes=28 app="data" path=""
  22:40:43.910 clip add: 与最新一条完全相同 → 丢弃（最新 15 字）
  ```
  28 字的新内容和 15 字的旧内容被判定为「完全相同」。
* **根因**：
  ```go
  func (c *Clip) kindSig(kind, text, path string) string { return kind+"\x00"+text+"\x00"+path }
  if last.kindSig(kind, text, path) == sig { /* 丢弃 */ }
  ```
  签名方法把**新内容**当参数传进去，完全忽略 `c` 自己的字段，于是 `last.kindSig(新) == sig(新)` 是**恒真式**——历史上第一条能存（队列为空），之后每一条都被当重复丢弃。test.sh 那档先 `clip/clear` 清空队列，所以永远只测到「第一条」，长期把这个 bug 并掩埋了。
* **修**：`func (c *Clip) sig() string { return c.Kind+"\x00"+c.Text+"\x00"+c.Path }`，用存储项自己的值比较；新增 `go/clip_test.go`：三次不同复制必须存下三条（回归护栏）、完全重复丢弃、同来源 5s 内覆盖不叠加。
* **同时修掉**：浏览器（Chrome / vivo 浏览器）复制的是 `ClipData.newHtmlText("data", …)`，第一项 `getText()` 有值但形态是 HTML，部分场景为 null → 用官方 `Item.coerceToText()` 兼底；`sigOf` 之前不含 `info.clip`，抓到新内容页面不重画，横幅要等切页 → 已加入签名。
* **顺带结论**：常驻服务的后台剪贴板监听在这台机器上只在**前台**回调（日志证明），后台不保证送达，所以它只能当锦上添花；主路径是前台读 + 顶栏 📋 手动。

### P6c 剪贴板焦点修复（用户实测反馈，2026-11-21）

* **现象**：在浏览器复制一段文字 → 下拉状态栏 → 点常驻通知回到 app → 没有看到「剪贴板暂存 N 条」横幅。
* **根因**（日志实锤）：`ClipboardService: Denying clipboard access to dev.xduo.enote, application is not in focus nor is it a system service`。Android 10+ 只允许**当前焦点窗口**读剪贴板，被拒时 `getPrimaryClip()` 直接返回 `null`（不抛异常），而 `onResume()` 比窗口拿到焦点**更早**执行——所以从通知/启动器点进来的那一次必然读不到，旧代码把它当成「剪贴板是空的」静默吞了。
* **修**：
  * `onWindowFocusChanged(true)` 里补读一次（`clipWaitingFocus` 标记，只在 onResume 后需要时读）；
  * `getPrimaryClip()` 返回 null 时退避重试（300/600/900/1200ms，最多 4 次）；
  * 顶栏新增 📋 手动入口（`Android.clipImport()` → `clipImportNow()` → `window.onClipRead(n, added)`）：用户主动点的时候窗口肯定有焦点，这条路径 100% 读得到，读到就打开整理页，没读到弹 toast 说明原因。
* **设计说明**：本来就是「前台采集」的设计，流程没错；错在把「前台」当成了 `onResume`，而 Android 上的「前台」等于「有焦点」。横幅只在队列非空时出现，失败时用户完全看不到入口，📋 就是补上这个缺口。
* **验收**：`test.sh` 新增一档（hook `clipset` 模拟在别的 app 复制 → HOME → 通知式回到 app → 断言队列里出现该文字）；真机手动 📋 已实测（清空队列后点 📋 → 直接打开「剪贴板暂存」并列出那条）。

### P6.5 自研到期提醒 + 常驻后台（2026-11-21）

* **提醒本体的定稿**：`AlarmManager.setAlarmClock()`（API 21+）登记，`AlarmReceiver` 到点发 `reminder` 渠道通知（IMPORTANCE_HIGH，heads-up/声音/震动）。选它而不是 `setExactAndAllowWhileIdle` 的理由：它是系统时钟 app 自己排闹钟的入口，属于「必须响」的登记方式；`setExactAndAllowWhileIdle` 在本机后台冻结时会被**无声取消**。旧方案靠 `shared_prefs/reminders.xml` 里的 `scheme` 版本号自愈升级：读到旧版本先把老 PendingIntent 全删一遍再按新方式重排。
* **状态归属**：Java 不存业务状态。UI 每次渲染后把「未完成 + 未来到期」的待办整份推到 `Bridge.syncReminders`；另外 Go 新增 `nativeReminders()`（`store.pendingReminders()`），给前台服务在没有 WebView 时用同一份数据重排。
* **常驻后台（用户新要求）**：`KeepAlive.java` 是标准 foreground service + 一条 IMPORTANCE_MIN 的常驻通知（渠道 `keepalive`），默认关闭，开关在「设置 → 后台 → 常驻后台」，状态存 `shared_prefs/keepalive.xml`；进程被回收后靠 `START_STICKY` + `EnoteApp.onCreate` / `MainActivity.onResume` 恢复；服务每 10 分钟 `Reminders.sync(...)` 自愈一次被系统丢掉的闹钟。
* **电池优化引导**：开关打开且未豁免时，设置页直接展开标准步骤（①点按钮 ②找到「懒得记」③选不限制），按钮走 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` → `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` → `ACTION_APPLICATION_DETAILS_SETTINGS` 三级回退。**不做品牌判断**，页面名字由厂商决定。
* **通知点击路由修复**：以前把笔记标题当 id 传（`openTodo` = 标题），点进去等于打开不存在的笔记。现在 `Reminders` 的 extras 分开携带 `noteId` / `todoId`，`MainActivity` 先 `openNote` 再 `openTodo(noteId,todoId)`，待办滚到中间并闪一下（`.todo.flash`，2.6s）。
* **实测结论（必须记住的边界）**：
  * 前台：闹钟到点 → 系统通知正常弹出（`channel=reminder importance=4`，已有截图）。
  * 后台：本机（vivo/OriginOS）在应用进入后台后冻结进程，**不到 1 分钟** loopback API 就超时，即使已经：①开着前台服务（`curProcState=4 mAdjType=fg-service`）②有常驻通知 ③在 Doze 白名单里（`dumpsys alarm` 的 `Exempted bucket packages` 含 `dev.xduo.enote`）。
  * 冻结状态下到点，系统直接 `Reason=alarm_cancelled` 取消闹钟，广播不投递、通知不出现、`reminders.xml` 的 key 还在 → 属于厂商调度层行为，纯标准 API 已无手段。
  * 结论：不声称后台可靠。UI 文案改成「尽量不被后台清理」，并提示「打开 app 时未完成的待办都在待办页」；真正有意义的补救是「打开时补看错过的提醒」（P8，已做），而不是继续加保活手段。
* **诊断日志**：`Bridge.syncReminders` 里临时的 `a.note("syncReminders: ...")` 已删除（改看 `Reminders.sync` 自己的 `Log.i`）。
* **验收**：`test.sh` 新增「P6.5 常驻后台」一档：hook 打开开关 → `dumpsys activity services` 有 `KeepAlive` 且 `isForeground=true` → `dumpsys notification` 有 `channel=keepalive` → hook 关掉 → 服务消失。

### P7 图标重绘（R9）+ 打磨
* **图标（2026-11-22 重做）**：`tools/gen_icon.py` 用一份 Python 几何常量同时输出
  `res/drawable/ic_launcher_{background,foreground,monochrome}.xml`（自适应图标，`<aapt:attr>` 渐变）
  + `res/mipmap-anydpi-v26/ic_launcher.xml` + `go/icon.png`（192×192，`go:embed`，app 内 logo 走 `/icon.png`）。
  所有 mipmap/drawable PNG 删除，APK 14,174,783 → 13,837,907 字节。旧母图归档 `docs/icon-src/`。
  坑：`<vector>` 上必须声明 `xmlns:aapt="http://schemas.android.com/aapt"` 才能用 `<aapt:attr>`。
* **图标系统（P7b-A）**：`go/ui.html` 内嵌 24dp 线性 SVG sprite（约 65 个 `<symbol>`，紧跟 `<body>`），
  `ic(name, cls)` 生成 `<svg class="ic"><use href="#i-…"/></svg>`，颜色随 `currentColor`；
  `.ic.s/.m/.l/.xl` 控尺寸。顶栏 / 底栏（选中加胶囊底）/ FAB / 指标卡全部图标化。
  修掉一个真 bug：`--grad-hot` 没定义 → 逾期数字透明看不见。
* **卡片与待办行（P7b-B）**：标题 16.5px/-.2px；来源与状态改成图标胶囊；正文改成左竖条引用块
  （`padding:9px 11px`、`border-radius:0 11px 11px 0`）；`.chip`/`.due`/`.cd` 统一
  `inline-flex + gap:3px + 11px 图标 + padding:1px 7px`（sig 测试断言「重要」与时间标签同高，
  padding 不能改）；圆形勾选框 + SVG 勾 + `scale(.4)→scale(1)` 弹性；提醒按钮（日历/闹钟）。
* **弹层 / 空状态 / 我的页（P7c）**：`pageSheet()` 顶部加 `.grip` + chevron 返回键，遮罩 `backdrop-filter:blur(6px)`；
  新增 `emptyState(icon,t,sub)`（76px 圆角渐变底 + 图标）替换全部 emoji 空状态；
  待办分组标题、剪贴板横幅与条目勾选、我的页列表项（`.lico` 32px 图标底）、主题分段、排序浮层、
  toast（胶囊 + 弹性上浮）、附件类型 `KIND` 图标全部去 emoji。
* **动效（P7c）**：`.card/.acard/.stat.enter` 入场动画，`animation-delay:calc(min(var(--i),6)*45ms)`；
  JS 用 `seen` 表只给「新出现」的卡片加 `.enter`，`setTab()` 时 `clearSeen()`，轮询重绘不再反复跳；
  关键信息行按 `--k` 错峰 40ms；`.body` 展开加 `max-height` 过渡；`prefers-reduced-motion` 全量降级。
* **我的页（P7d）**：hero 左侧应用图标（`/icon.png`）+ 标题 + 运行环境行 + 胶囊统计；
  指标卡加图标底（逾期红色）；近 7 天柱状图渐变柱 + 底部淡底。深色模式截图核对通过。
* **文档**：`README.md` 重写（界面截图 `docs/shots/`、5 tab 用法、完整 API 表、已知限制含厂商冻结与
  剪贴板边界、新增踩坑条目）、`CHANGELOG.md` 新建。
* 无障碍：tab `aria-label`、删除按钮 `aria-label`、点击目标 ≥44px（`.tab` 56px、`.remind` 18px 高但
  外层有 44px 命中区 `.hit`）。
* **打开时补看错过的提醒（P8，已做）**：厂商冻结后台时闹钟被系统取消，纯标准 API 没有别的办法，
  所以改成「下次打开时补一遍」。`go/missed.go` 把上次打开时间记在 `files/enote/lastopen.txt`，
  `/api/missed` 取出「上次到现在之间到点、且未完成」的待办（按到点时间正序，最多列 20 条，
  另外单独算总数用于「只列出最早的 N 条」），然后把时间推到现在 —— 用户点「查看」或直接忽略
  都不会被重复打扰。前端 `loadMissed()` 在首屏后异步问一次，笔记页顶部出现 warn 色横幅
  「错过 N 条提醒」，点开是清单（条目 + 来源笔记 + 逾期多久），点一条跳到对应笔记展开待办。
  存在独立文件而不是 `settings.json`：settings 只在配了 AI 时才整体生效（BYOK 全新安装
  `BaseURL` 为空，写进去读不回来），提醒不该依赖它。
  测试 `go/missed_test.go` 锁死边界：上次打开之前到点的不算、还没到点的不算、已完成的不算、
  首次打开（零值 since）不倒历史、`since == now` 为空、limit 生效。

### P9 用户反馈的 7 处修正（实测截图逐条核对）

1. **按钮文字居中**：`.btn` 是 `inline-flex`，`text-align:center` 对 flex 子项无效 —— 全局加
   `justify-content:center`。对话框「取消 / 删除」、剪贴板暂存页的三个按钮、设置页「已开启」
   全部正了；顺带 `white-space:nowrap`，「已开启」不再被挤成两行。
2. **附件页统计行到列表的留白**：`.agrid` 的 `margin-top` 2px → 10px，跟笔记页 `.card`
   的 `margin:10px 0` 对齐。
3. **切页不重绘 + 记住滚动位置**：每个 tab 一个常驻面板（`panes` / `paneBuilt` / `paneDirty`），
   切页只 `showPane()` 切显示；`tabScroll` 离开时存 `window.scrollY`、回来时还原。
   数据变了才把其它页标脏（`invalidatePanes`），切过去重建一次。
   实测：待办页滑到中间 → 去笔记页 → 回待办页，两张截图 md5 完全一致（位置和 DOM 都没变）。
4. **checklist 圆框** 22px → 18px（勾选图标 13 → 11px，描边 2.8）。
5. **启动器图标**：还原成用户在 `android-launcher-icons.zip` 里给的那套 PNG（5 套密度的
   `ic_launcher_{background,foreground}.png` + 5 套 `mipmap-*/ic_launcher.png` + 自适应 XML），
   与压缩包逐字节一致；`tools/gen_icon.py` 删除，`go/icon.png` 仍是同一份底稿（96×96）。
   P7a 曾整套换成矢量，是我的错，sig 测试现在锁死「不许再换成矢量」。
6. **二级页面贴顶**：`pageSheet()` 不再插 `.grip`（那是底部弹层的拖拽条），`.panel.page`
   去掉 `border-top`，`.panel.page .grip{display:none}`。设置页 / 剪贴板暂存页现在从屏幕最顶上开始。
7. **剪贴板暂存页同理** —— 同一个 `pageSheet()`，一并修好。

附带修的真 bug：**冷启动点通知丢参数**。`flushPendingOpen()` 以前先清 `pending*` 再
`postDelayed(700ms)`，冷启动时页面还没 `onPageFinished`，那几行 `window.openNote/openClip`
落在函数还不存在的时刻，点通知什么都不发生。现在 `pageReady` 标记 + 页没好就原样保留 pending，
`onPageFinished` 再补一次。

### 里程碑勾选表

```
[x] P0 状态栏可见，无 ANR
[x] P1 亮/暗主题，默认亮色，颜色全走 CSS 变量
[x] P2 4 tab + 圆角矩形 FAB + 共用顶栏 + 组件库/动画 token
[x] P3 搜索 + 排序 + 筛选面板（三页共用，条件持久化）
[x] P4 附件页（附件模型 + 网格 + 通用文件服务）
[x] P4b 底栏 5 按钮 + 自绘对话框 + 逐级返回（主页连返两次退出）+ 页面留白 + 去过度动画
[x] P5 我的页（统计）+ 全屏设置面板（+ 改名「懒得记」、时区修复、倒计时、完成动画、新图标）
[x] P5.5 事实提取（R12）+ 日历/闹钟入口（R13-A/B，标准契约）+ logo 去白框（R14）
[~] P6.5 自研到期提醒：前台正常；常驻后台开关 + 标准电池优化引导已加，后台到点仍被厂商冻结拦下（详见 P6.5 段）
[x] P6 剪贴板前台采集 + 暂存去重 + 批量一键解析（定稿方案见 P6 段）
[x] P7a 启动器图标（gen_icon.py 一份几何 → 矢量 XML + app 内 logo，去 PNG）
[x] P7b 图标系统 + 顶栏/底栏/指标卡 + 笔记卡片/待办行图标化（去 emoji）
[x] P7c 弹层 / 空状态 / 我的页列表 / toast 图标化 + 卡片入场动效（seen 表，轮询不跳）
[x] P7d 我的页 hero + 指标卡图标 + 图表渐变柱 + 深色模式核对
[x] P7e 文档（README 重写 + CHANGELOG）+ 全量回归
[x] P8 补看错过的提醒（lastopen.txt + /api/missed + 首页横幅 + 清单）
[x] P9 用户反馈的 7 处修正（按钮居中 / 附件留白 / 每 tab 常驻面板 / 勾选框 / 图标还原 / 二级页贴顶 / 冷启动通知）
[x] P10 展开详情修 bug + 三行截断 + 展开按钮按实测高度显隐
[x] P11 截图捕获（多选监控文件夹 → 暂存区 → 合并/各存一条 → 进度层 + 屏幕常亮）
```

---

### 5.x P5.6 附带 UI 小修（用户新要求，2026-11-21）
* **切页动画取消**：`main.enter` 的整页浮现/卡片错峰动画全部移除（每次切页闪烁、从下往上跳，过度设计）；待办完成的高亮入场动画（`.todo.enter`）保留。
* **待办竖条统一占位**：所有待办行 `border-left:3px solid transparent; padding-left:8px`，重要行只改 `border-left-color:var(--bad)`——checkbox 全部左对齐，红条与 checkbox 间距 8px。
* **test.sh 修复**：图片/附件测试改放 app 私有 inbox（`/data/user/0/<pkg>/files/enote/inbox`），`/sdcard/Android/data` 被 Scoped Storage 拒读（EACCES）。

---

## 5. 测试计划（`test.sh` 逐阶段扩写）

现有断言（保留）：selftest hook（store/web/llm/ocr）、分享文本→带日期待办、分享图片→OCR+LLM、待办增删改、重新解析、`llm/test`、导出、设置回环（打码 Key 不覆盖真 Key）、app 存活无崩溃。

新增（按阶段）：

| 阶段 | 新断言 |
|---|---|
| P1 | `settings.theme=="light"`；`POST /api/theme` 切换后 `/api/state` 反映新值；`grep` 检查 ui.html 无硬编码颜色 |
| P2 | 四个 tab 的 VD 截图；FAB 坐标 tap 后弹出对应面板 |
| P3 | `/api/search` 的 q/sort/dir/filter 组合（Go 单测 + HTTP 断言各一份） |
| P4 | `/api/attachments` 计数 == 磁盘文件数；删笔记后文件消失 |
| P5 | `/api/stats` 与 `/api/state` 计数一致；设置面板保存后重启保持 |
| P6 | `/api/clip` 入队→不产生笔记→`/api/clip/parse`→产生笔记；`dumpsys accessibility` 能看到服务；开关关掉后服务消失 |
| P7 | 图标：`aapt dump badging` 确认各密度图标存在；启动器截图；`prefers-reduced-motion` 下无动画（截图对比） |

截图基线一律存 `.test/shots/`（已 gitignore），命名 `p<阶段>-<页面>-<主题>.png`。

---

## 6. 明确不做（本阶段范围外）

* 附件点击预览/打开（只留接口与 toast）。
* 端到端加密、云同步、多设备、账号体系。
* 待办到期提醒通知（P6 只做常驻通知，不做定时提醒）。
* 搜索分词/拼音/模糊匹配（先子串，够用再说）。
* 换 UI 框架（继续单文件 `go/ui.html` + 原生 CSS，不引入构建链；若 P3 之后组件明显膨胀，再评估拆成多个 JS 文件并保留 `ui.bundle.js` 打包步骤）。

---

## 7. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 后台剪贴板读不到内容（Android 10+） | R7 的"监控"效果打折 | 方案 A（元数据 + 回前台补读）；需要后台全文则上无障碍服务（§3.4 决策点 1） |
| 常驻通知被用户关掉导致服务被杀 | 剪贴板监听失效 | 通知不可完全隐藏（前台服务要求），设置里明确说明；服务被杀后 `START_STICKY` 自动重启 |
| 主题改造漏掉硬编码颜色 | 暗色下出现"白底白字" | P1 的 grep 断言 + 两主题全页截图核对 |
| 附件模型迁移丢图 | 用户图片消失 | 惰性迁移 + 双写 `imagePath`；迁移前把 `notes.json` 备份成 `notes.json.bak` |
| 分享 intent-filter 加 `*/*` 后出现在所有分享菜单 | 用户嫌吵 | 按 §3.4 决策点 3 收窄 mime |
| 无障碍服务被 ROM 杀掉 / 用户未授权 | R7 采集失效 | 服务由系统绑定，存活比普通前台服务好；UI 持续显示采集状态（“已开启/未授权”）；提供 `disableSelf()` + 重开路径；文档写清 vivo 开启路径 |
| 无障碍权限敏感（能读屏幕） | 用户不信任 | 设置页明写“只读剪贴板，不点解析不上传”，并在隐私章节说明服务声明里不开 `accessibilityEventTypes` 的屏幕内容采集 |
| 后台大量复制导致队列膨胀 | 存储/隐私 | 队列上限 200 条，先进先出；单条文本上限 20000 字；图片只存附件不重复存 base64 |
| 图标在小尺寸下发糊 | 启动器观感差 | 母图 1024 生成后缩到 48px 目测；弦数 ≤ 7，线宽 ≥ 母图 1.2%；自适应图标前景留 66dp 安全区 |
| 动画过多导致低端机卡顿 | 体验下降 | 只用 transform/opacity；stagger ≤ 8 项；`prefers-reduced-motion` 全关 |
| 单文件 `ui.html` 膨胀到难维护 | 开发变慢 | P2 拆出 `go/ui.css`（组件库）；超过 ~900 行再拆 JS，保留打包步骤 |

---

## 8. P11 截图捕获（已完成，2026-11-22）

设计与决策过程见 `docs/design-shots.md`（§8 是 15 条已确认结论）。落地要点与踩坑：

* **权限**：`READ_MEDIA_IMAGES`（13+）+ `READ_EXTERNAL_STORAGE`（maxSdk 32）。不主动弹框，
  只在首页横幅/向导里点「去授权」时才弹——避免首屏被系统对话框吓到。
* **文件夹多选**：MediaStore 枚举 `RELATIVE_PATH`（`Pictures/Screenshots/`、`DCIM/Camera/` …），
  带张数与字节数、按张数降序、可搜索；默认勾上名字/路径像截图目录的。
  不用 SAF：媒体库已经索引了共享存储里所有图片，多一条 SAF 路径只多一种"看不到文件"的故障。
* **水位**：`DATE_ADDED` 秒 + 5 分钟重叠窗口 + sha1 去重表；**首次启用不回捞**（这机器 2759 张），
  改文件夹也重置水位；回捞走「回捞最近 7 天」并二次确认。
* **分工**：OCR 只能在 Java（ML Kit），所以导入是 `Android.importShots` 发起，Go 只做暂存区
  （`shot.json`）、去重、忽略表、上限与文件生命周期。合并笔记走 `kind=images`：
  N 个附件 + OCR 文本拼接 + 一次 LLM。
* **进度层**：全屏不可点掉，文案是用户明确要求的「不要锁屏 / 不要黑屏 / 不要退出 App」，
  同时真的 `FLAG_KEEP_SCREEN_ON`；并且**一直挂到这批笔记 AI 解析结束**才收起
  （OCR + 入队只要 1 秒，收早了那句提示就是空话）。
* **踩坑**：
  * MediaProvider 的 `sortOrder` 里不能拼 `LIMIT`（`IllegalArgumentException: Invalid token LIMIT`），
    自己数到上限就停。
  * `sigOf` 忘了把 `info.shot` 算进签名：新截图只改条数时不会重绘，首页横幅压根不出现。
  * 同一屏连续 `screencap` 得到的是同一份字节，测试造图要用不同内容（否则被 sha1 去重）。
* **事故（2026-11-22）**：为了验证"初次运行引导"，我对 app 跑了 `pm clear` —— 它把
  `files/enote/*`（notes.json、附件、settings.json）全删了。教训：
  * **永远不要用 `pm clear` 重置数据来测 UI 流程**；要测首次运行就用 sig 断言 + 代码审阅，
    或者先 `/api/export` 备份再清。
  * 恢复靠的是 `.test/` 里几次早先 `/api/export` 的快照（合并去重后 72 条笔记 / 170 条待办），
    附件文件无法恢复（23 个附件全部变成"缺失文件"），API Key 也丢了（打码值不可逆）。
  * 顺带修掉了恢复过程中暴露的真 bug：`/api/settings` 部分字段 POST 会清零其它字段。
* **界面修正（用户反馈「选文件夹」页）**：确定按钮改成 `.pfoot` 固定条（文件夹/截图/剪贴板三页统一），
  底部实时显示「N 个已选 · 共 M 个」，已选的文件夹即时排到最前并上底色（重排时恢复滚动位置），
  保存后强制重建当前页 + 重算统计（并把截图开关/文件夹数纳入 `sigOf`，这类陈旧状态以后会自愈）。
* **新增 `hook jseval`（需 `files/enote/.devmode`）**：直接往 WebView 里注入 JS，结果用
  `console.log('JSEVAL …')` 落到 `files/testlog.txt`。虚拟显示的 `input tap` 太不稳，
  界面断言从此脚本化；`test.sh` 的 P11 文件夹页那一段就是这么断言的（sticky、计数、排序、返回刷新）。
* **缩略图 404 事故（用户反馈）**：`ShotStore.remove` 直接 `os.Remove` 暂存文件，而导入后
  UI 会立刻清理暂存 —— 删掉的正是刚变成附件的那几张图，笔记首页缩略图全 404。
  现在 `ShotStore.keepFn` 由 `appInit` 注入（笔记引用集合），remove/ignore/裁剪都走
  `dropUnlessKept`；`test.sh` 补了「清理暂存后 missing=0 且 /img 返回 200」的断言。
  教训：测试只数"附件条目数"是不够的，必须验证文件真的在盘上、真的能取到字节。
* **只有一张截图时只留「创建笔记」一个按钮**（用户反馈：合并/各存是一回事，两个按钮让人犹豫）。
* **测试清理误删用户笔记（真实事故）**：P11 段收尾按 `source=shot-*` 批量删笔记，把用户自己
  导入的截图笔记一起删了。现在只删 `hook shotimport` 返回的 noteIds，并断言笔记总数回到步骤开始时。
* **上游超时不该让整套测试变红**：代理偶发 500s+ 超时会让笔记停在 `raw`；`test.sh` 用
  `upstream_down()` 区分"环境问题"和"解析回归"，前者 skip 并明确说明。
* **API Key 老要重填（用户反馈）**：真因是 `settings.json` 用 `os.WriteFile` 裸写，写到一半被杀
  就留下半截 JSON → 下次启动解析失败回默认值 → key 丢。现在原子写（`.tmp` + `fsync` + `rename`）
  并留 `.bak`，`openConfig` 坏了自动退回 `.bak`；设置页也不再打码（明文 key，用户不在意）。
  测试：`go test` 的 bak 恢复/原子写两条 + `test.sh` 的"读回来 == 存进去"断言。

## P12（用户反馈三条，已完成）
* **横幅不刷新**：`searchNow()` 在搜索结果没变时短路 return，而首页横幅不在搜索结果里 →
  加 `force` 参数，页面签名变了就强制重绘。剪贴板删光、新截图扫到，都是这一个根因。
* **错过的提醒面板**：加每行 ✓ 完成 + 底部「这批我知道了」（`missedDismiss`，只清横幅不动待办）。
  面板操作逻辑 = 看上下文 / 做掉 / 承认看过，三条路各有明确后果。
* **截图要重进两次**：`EnoteApp` 注册 MediaStore `ContentObserver`（去抖 1.2s），
  截图落盘就扫，不靠 `onResume`。
* 教训：`refresh()` 不 await `searchNow()`，jseval 断言必须轮询等 DOM，不能 await 完就读。

## P12.1（提醒面板点了没反应，已完成）
* 三条都是"调了不存在的函数"：`goTab`/`goNote`/`openSheet` 都不存在，真名是
  `setTab`（读全局 tab，不接参数）/`jump`/`pageSheet`。签名测试只查函数存在，不查调用点。
* 勾 ✓ 改成复用待办页的 `.todo/.cb/.ttx` + `toggle()`，划线淡出动画一致。
* 测试改成真点击 + 断言动画 class，不再只查 DOM 结构。

## 9. P13 UI 质量重构：改用 Vue 重做界面（进行中，2026-11-23）

人类原话：项目能跑，但"总觉得 UI 不高级"；任务不是加功能，是提高代码质量，允许全部改用 Vue 重做。
Duo GOAL 双人协作（Austin 驱动 / Tony 验证），共享计划 v3 已签署。

### 9.0 盘点（双方各自复核过的数字）

* `go/ui.html` 单文件 2527 行：CSS 8–579、JS 683–2524，手写 `sigOf`（:2217）指纹防闪烁。
* **70 个内联 handler**（69 `onclick` + 1 `oninput`），全部在 JS 字符串拼接里，`index.html` 里 0 个。
  它们按 window 作用域解析函数名——P12/P12.1 的"点了没反应"就是这个模式，测试当时还全绿。
* JS 方言是 ES5 + `async`（`const/let` 0 次、箭头 4 次、`?.` 0 次）。
* CSS：38 个变量、66 处裸 hex、font-size 19 个不同值、radius 17 个、spacing 242 处 / 24 个值、
  box-shadow 24 处 / 1 个变量。**没有间距、字号、层级刻度 = "不高级"的根因。**
* 调色板是 5 处真相、3 个文件：`css/tokens.css` 明/暗两处、`index.html` 的 `<meta theme-color>`、
  `js/app.js` 的 `applyTheme()`、`Theme.java:15` 的 `BG_LIGHT/BG_DARK`。改一次背景色要同步 5 处。

### 9.1 决策

* **D1** Vue 3 全局构建 vendored 在 `go/ui/vendor/`（零构建步骤），`VENDOR.md` 记版本/sha256/升级方法，
  并 pin 语言基线 = **ES2020（Chrome 80）**。
* **D2** 拆目录：`go/ui/{index.html,css/,js/,vendor/}`；Go 侧 `//go:embed all:ui` + 显式 Content-Type + `no-store`。
* **D3** Go API 与 Java 桥零改动，只改服务方式 + 新增 `go/web_test.go`。
* **D4** 测试缝 `window.__enote = {ready, build:{sha,builtAt}, state, api, actions, dom}`；
  `render()` shim **必须返回 Promise**（Vue 是微任务刷新，同步返回会读到旧 DOM）。
* **D5** 冻结 class 名：`msrow cb pfoot ttx acard iconbtn brand justdone sheet todo`；
  `.missedb`/`.missedtop` 今天不存在，冻结成"必须继续不存在"。
* **D6** 现有 38 个 CSS 变量名**保留**（改名是纯 churn，`--d1..--d3` 55 处全在用、0 处字面时长）；
  S2 只**新增**刻度 token，`tokens.css` 头注释写 old→new 映射表。裸 hex / 裸 px 用棘轮：只许降不许升。
  新增一致性检查：`Theme.java` 的 `BG_LIGHT/BG_DARK` 必须等于 `tokens.css` 的 `--bg`（明/暗两处）。
* **D7** 高级感 = 一套间距刻度 + 一套圆角 + 阴影层级 + 字号刻度（`tabular-nums`）+ 图标尺寸统一 +
  空状态 + 骨架屏 + `:focus-visible` + safe-area + light/dark/auto 对齐 + `prefers-reduced-motion`。
  **不加 sepia**（全库 0 命中，那是加功能）。P5.6"切页不要整页入场动画"的结论保留。
* **D8** `tools/ui_sig_test.js` 活到 S6 才改名 `ui_test.js`，中途不丢防闪烁覆盖
  （S3 步骤 11 落地：84 项签名并入 `ui_test.js`，那个文件删掉，静态闸门 3 → 2）；
  三条新闸门：① 内联 handler 调的函数名必须存在 ② `test.sh` jseval 引用的全局名 ⊆ 导出表
  ③ 裸 hex 只允许在 `tokens.css`。
* **D9** ES module 化推到 S3：S1 若转 module，70 个 handler 全静默失效 = 一次性制造 70 个 P12，
  而测试全绿。`js/app.js` 头注释 + `web_test.go` 断言首页无 `type="module"`。
* **D10** 旧 WebView 要失败得响亮：feature probe + `test.sh` 打印 `navigator.userAgent`。
* **D11** 每步验收 = `GO_TEST=1 ./build.sh && ./install.sh && ./test.sh --vd` 全绿 + 截图进 `docs/shots/`；
  S2 动 CSS 前先截 7 个视图基线进 `docs/shots/before/`。

### 9.2 步骤与分工（一个文件一个 owner）

| 步 | 内容 | owner |
|---|---|---|
| S1a | vendor Vue + 目录 embed + `web_test.go` + 拆文件（行为零变化）+ 打印 UA | Austin |
| S1b | 7 视图基线截图进 `docs/shots/before/` | Tony |
| S2 | 设计系统 `tokens.css`（刻度 + 映射表 + Theme.java 一致性检查）+ tabular-nums / focus-visible / safe-area / reduced-motion | Tony |
| S3 | Vue 核心 + 转 ES module + window 导出表 + `__enote` + 闸门①② + Notes 视图 | Austin |
| S4 | Todos + Files 视图转 Vue | Austin |
| S5 | Shots + 选文件夹页转 Vue | Tony |
| S6 | Clip + Stats + Settings 转 Vue；删遗留 JS 与 `sigOf`；改名 `ui_test.js` | Tony |
| S7 | 全视图复查 + before/after 截图 + 文档 + 完整 `test.sh --vd` + hex 棘轮清零 | 双方 |

Austin 另有 `go/web.go`、`go/web_test.go`、`build.sh`、`css/views/{notes,todos,files}.css`、`__enote`、`test.sh` 的 API 用例；
Tony 另有 `css/{tokens,base,components}.css`、`css/views/{shell,shots,clip,stats,settings}.css`、基础组件、`tools/ui_test.js`、`test.sh` 的 UI/jseval 块、文档截图。

### 9.3 S1a 已完成（Austin）

* 拆分是**按原始行号的连续区间**（tokens 9–43 / base 44–261 / components 262–520 / views 521–578），
  CSS 拼接后与拆分前逐字节一致；`js/app.js` 非空行逐字节一致（1826 行，多一个空行）。按视图语义拆是 S2 的活。
* 拆分前置检查：CSS 0 处 `url()`、0 处 `@import`，JS 不含 `</script`，页面引用除 `#i-*` sprite 外全是绝对路径
  ——这三条不成立的话拆完会静默坏，先验证再动手。
* `go/web_test.go` 新增 7 组断言：首页无 `<style>`/内联 `<script>`/`type="module"`；页面引用的每个 css/js
  必须 200 且 Content-Type 正确且带 `no-store`；`/../../etc/passwd`、目录、不存在的文件必须 404；
  `contentType()` 表；vendor 的 sha256 必须等于 `VENDOR.md`；API 路由没被 `/` 吃掉。
* `test.sh` 打印设备 WebView UA（VENDOR.md 的 ES2020 基线由此核对）。
* **验收链路本身修绿**（这台设备第一次真跑 `./test.sh --vd`）：`lib/config.sh` 的 vendor 回退
  （`vendor/` 在 `.agents/skills/dev-apk-on-android/`，非交互 shell 里 `SKILL_DIR` 为空）、
  `vd.sh create` 不再拿已死的旧 display id、`am_start` 对 ShareActivity 不带 `--display`
  （root 在虚拟屏上开新任务被 SafeActivityOptions 拒）、P6.6 不再和剪贴板轮询赛跑、
  P11 去 PIL / 清暂存区 / `shot_scan` 改轮询、OCR fixture 进仓 + `tools/crop_png.py`。
  详记 CHANGELOG。验收：`GO_TEST=1 ./build.sh` + `./install.sh` + `./test.sh --vd` 全绿。

### 9.4 记账：本轮发现、后续步骤要收的账

| 项 | 归谁 | 哪步 |
|---|---|---|
| 笔记卡片预览里 `.cb` 被左边缘裁一半（明暗两档都有，基线截图里就有） | Austin | **已核销（S3 步骤 6）**：真机量出来三个站点全都没被裁，见 §9.10；S2 的 tokens/base 改动已经把它修掉了，账本条目是旧的 |
| 设备累积状态会让计数类断言假红：附件行数 ≠ 磁盘文件数（一张截图被多条笔记复用）；`pm clear` 能清但 LLM 配置也在 app prefs 里，清了必红 | Austin | 断言已改成按唯一路径数比；**已做**：S8 步骤 1 给 test.sh 加了「跑前重置数据 + 回写测试配置」（见 §9.5） |
| OCR 搜索断言只能证明「命中了」，证明不了「命中来自图片文字」（q=取快递 同时命中分享文本） | Austin | S7 前 |
| `css/views.css` 已被 S2 删除，`go/web_test.go` 的判空豁免改成按目录（`/css/views/`）而非写死文件名 | Austin | 已做 |
| S3 转 ES module 时，`window` 导出表要同步进 `ui_test.js` 闸门② | Austin + Tony | S3 |
| 闸门② 的闭集是 15 个全局（10 函数 + 5 状态），不是纯函数名；状态桥 `__enote.state` 要可写（`tab="notes"`） | Austin | S3 |
| 重置基线后 OCR 搜索断言的固定装置（`one-shot.png` 的忽略表）已随 shot.json 一起清，P11 不再依赖上轮状态 | Austin | S8 步骤 1 已做 |
| **套件最后一次剪贴板写入必须为空**：任何往剪贴板写夹具的步骤，收尾必须 `clipset ' '` + `clip/clear` 并断 `clip/list` 真的是 0。否则 app 启动扫一次剪贴板 + 前台轮询 `clipAdd` 会把残留夹具重新暂存，红的是下一轮开头的硬基线（test.sh:280 clip=1），本轮全绿 | Austin | **已做（S3 步骤 14）**：见 §9.20 ⑥（Tony 实测撞出），闸门㉑ 静态钉住两处收尾 + 断空 |

### 9.5 S8 步骤 1 已完成（Austin，D18：跑前重置数据 + 回写测试配置）

`test.sh` 新增默认开启的跑前重置，`--no-reset` 关掉。分两段，**顺序是硬要求**：

1. **文件级（`pm install` 之后、`am_start` 之前）**：删 `files/enote/shot.json`（暂存记录 +
   「永远别再提醒」表）、`shotseen.json`（「已扫过」表）、`inbox/`（暂存图）。app 只在启动时读
   这三样，启动后再删会被内存里的旧表写回来。
2. **API 级（拿到端口之后）**：抓 settings → `POST /api/clear`（笔记 + 附件文件）→
   `POST /api/clip/clear` → `POST /api/shots/remove`（全部 id）→ 原样回写 settings 并把
   `theme` 归一到 `light`（theme 用例断言默认值就是 light）。apiKey 服务端对打码值是忽略的
   （`web.go:363`），所以用户的真 key 不会被覆盖。
3. **断言基线**：`notes=0 todos=0 clip=0 theme=light base=yes att=0 shots=0`，不符就 fail。

不用 `pm clear`：LLM 的 base URL / key / 目标文件夹存在 app 私有 prefs 里，`test.sh` 全程不写它们，
清了必红，而且这是用户的真机。

重置基线当场暴露两处「靠设备历史数据才绿」的用例，都已改成自带固定装置：

* `go/stats_test.go`：`t3` 的 due 写 `T23:00`，而 overdue 是 `t.Due < now` 的字符串比较，这台机器
  Go 的 `time.Local` 是 UTC（设备本地 CST+8）→ 本地 00:00–08:00 这 8 小时里每天固定红。
  改成 `T23:59`（同一天内恒大于任何 HH:MM）。
* P8.5 提醒面板点的是 `.msrow[1]`（第二行）来验证「点整行跳笔记」，重置后只剩 1 条逾期项 →
  `row[1]` 不存在 → `jumped=0` 假红。现在用例自己 `POST /api/todo` 造 2 条已到点的待办。

验收（当时的口径，S3 步骤 11 之后签名已并入 `ui_test.js`）：`node tools/ui_test.js`（13 闸门）
+ `node tools/ui_sig_test.js`（84 项）+ `go test ./...`
+ `GO_TEST=1 ./build.sh && ./install.sh && ./test.sh --vd`（25 步）全绿。

### 9.6 S8 步骤 2 已完成（Austin + Tony，D12 原子防线 + D21 状态桥）

`index.html` 的 `<script>` 加 `type="module"`，与导出表、闸门① **同批**落地（中间态不能存在）：

* `app.js` 末尾单处对象字面量 `window.__enoteActions = { … }`，**57 个 key** =
  内联 handler 调用的 54 个 ∪ jseval 载荷独有的 `api refresh render`。紧跟
  `Object.assign(window, window.__enoteActions)` —— 这是「70 处 handler 逐字不动」的唯一办法。
* 状态桥 `window.__enote.state`：`tab S MISSED open shotSel shotList` 六个，全部 get+set
  （`tab`/`MISSED`/`shotSel` 在载荷里是整体赋值，**没 setter 就会假绿**：赋值只新建 window 上的
  同名全局变量，模块里的变量一动不动，测试全绿而界面没动）。
* `test.sh` 的 5 个 jseval 载荷改用状态桥；函数名保持裸调用（靠 `Object.assign`）。
* `go/web_test.go` 的 D9 断言**反向**：从「不许有 type="module"」改成「必须有 module +
  导出表 + `Object.assign` + 状态桥」，缺任一项判红。

双方独立扫描得到的两个结论（互为验证）：

* **strict mode 安全**：module 默认严格模式，隐式全局赋值会抛 ReferenceError。Austin 与 Tony
  各扫一遍 app.js，命中候选 6 个（`shotStartAt stopped iv stBusy prefsLoaded animLock`），
  逐个查过全是**逗号声明列表的后续名字**（如 `var shotTimer = 0, shotStartAt = 0;`），
  扫描器只抓得到 `var` 后第一个。没有真的隐式全局。
* **jseval 闭集是 16 不是 15**：Tony 的 15（10 函数 + 5 状态）漏了 `shotList`
  （`test.sh:1102` 的 `shotPick(shotList[0].id)`）。状态是 6 个。步骤 4 的闸门② 按 16 写死。

记账两条：

* 注释里不能出现 `onclick="…"` 这种字面量：`ui_sig_test.js`（和新闸门①）是按文本扫 handler 的，
  会把注释里的例子当成真 handler，报「调了不存在的函数」。已踩一次。
* **module 把 WebView 地板从 Chrome 58 抬到 61**：app.js 现在 0 处 `?.`/`??`，转 module 前实际能跑在
  Android 8.0 出厂 WebView 上；feature probe（D16）排在步骤 3，所以步骤 2→3 之间有一个
  「老 WebView 白屏无提示」的窗口。不判红（VENDOR.md 的语言基线是 ES2020/Chrome 80，61 在基线以下），
  步骤 3 落地即闭合。

步骤 2 追加（Austin + Tony 实测，两条都是「静态全绿而运行时已死」这一类）：

* **步骤 2 的验收必须包含全量 `test.sh --vd`**，静态闸门 + 签名 84 全绿不能算过。Tony 的
  scratch module 版就是这个组合：13 闸门 + 84 条全绿，P6.6 直接 exit 1。
* **D21 状态桥的落点从步骤 4 提到步骤 2**，和 module 化同批（证据同上）。步骤 4 只剩
  闸门② + `render()`→Promise + 3 处 `await`。
* **运行时防线**（`test.sh` P6.6 载荷之前）：jseval 打印 `typeof __enote` /
  `Object.keys(__enote.actions)` / `typeof window.delNote` / `typeof window.open` /
  `typeof __enote.state.tab`，断言 key 名单与 `app.js` 里的导出表**逐项相等**（名单从 app.js
  现取，不在测试里重复钉数字，两边不会漂移）。三个哨兵各盯一种失效：module 没加载（白屏）、
  `Object.assign` 没跑（70 个 handler 全废，P12 那一类）、状态桥没接上。
* **`open` 是最阴的一个**（Tony 发现）：`app.js:6` 的 `var open = {}` 在非 module 树上把原生
  `window.open` 盖掉了，所以裸 `open` 拿到的是 app 的对象；module 化后 `window.open` 恢复成
  原生函数，载荷里 `Object.keys(open).length` **恒为 0，不抛异常**，`jumped=` 断言静默变假。
  已迁移到 `__enote.state.open`，并加 `typeof window.open === "object"` 当哨兵。
* **闸门② 扫描器必须跳过字符串字面量和注释**：Tony 的扫描在 `test.sh:1045` 的
  `.pane[data-tab=mine]` 上假红（`tab` 是 CSS 选择器里的文本）。注释同一类：Austin 在 app.js
  注释里写的例子 `onclick="foo()"` 让 `ui_sig_test.js` 判红。
* **测试可追溯性**：`test.sh` 的 install 步骤打印 APK sha256 + `git rev-parse --short HEAD` +
  分支名。设备是共享的，两个 worktree 轮流装，被对方 force-stop 时日志能自证跑的是谁的树
  （本轮被对方的安装打断过两次）。

步骤 2 落地后给步骤 3/4 的硬约束（Tony 提，Austin 记）：

* **步骤 3 不许整份覆盖 `window.__enote`**：现在 app.js 末尾是
  `window.__enote = window.__enote || {}` + `actions` + `state`（六个 getter/setter）。
  D17 的 `ready / build / api / dom` 必须用 `Object.assign(window.__enote, {...})` 合并进去——
  整份赋值会把 `state` 的代理全冲掉，症状是步骤 2 那 11 处载荷集体**假绿**（赋值打到新对象，
  模块里的变量一动不动）。运行时防线里 `assert state == object` 会先红，这是哨兵该起的作用。
  同时把 `state` 的六个名字在 `go/web_test.go` 的 D9 反向断言里逐个钉住（现在只钉
  `window.__enote.state = {` 这个字面量，改名就漏）。
* **闸门② 的闭集是 16 个**（函数 10 + 状态 6，含 `shotList`），不是 plan 正文写的 10。
* **闸门② 扫描器必须跳过字符串字面量**：`test.sh` 里 `.pane[data-tab=mine]` 的 `tab` 是 CSS
  选择器文本，裸正则匹配标识符会假红（Tony 实测）。注释同一类（app.js 注释里的
  `onclick="foo()"` 让签名闸门判红过）。

### 9.7 S8 步骤 3 已完成（Austin，D16 / D17：`__enote` 测试缝 + `build.json` + feature probe）

纯增量，界面行为零变化。落地内容：

* `app.js` 末尾 `Object.assign(window.__enote, {ready, build, api, dom, probe, markReady})`
  —— **合并**，不覆盖（Tony 的硬约束）。`ready` 由 `render()` 最后一句的 `markReady()` 兑现；
  做成函数 + 可空回调是因为 `refresh()` 在模块末尾装配 `__enote` 之前就发出去了。
  `dom.main` 取 `#view`（`index.html` 里没有 `#main`，主容器是 `<main id="view">`）。
* `build.sh` 在 go build/test 之前写 `go/ui/build.json` = `{sha,builtAt,app}`，sha 带 `-dirty`
  后缀；`//go:embed all:ui` 打进二进制，`/build.json` 走 no-store；文件进 `.gitignore`
  （构建产物，否则每次构建弄脏工作区，EXECUTE 签名没法签）。
* `index.html` 内联 `<script id="probe">`（ES5、在 module 之前）：7 项特性探测（门槛 = Vue 3
  能跑的最小集，全部 ≤ module 的 Chrome 61）+ `WATCHDOG_MS = 12000` 两级看门狗 +
  capture 阶段 `window.onerror`。失效时页面画红框卡片、改 `document.title`、
  `console.log('ENOTE PROBE FAIL …')`。
* `go/web_test.go`：内联 `<script>` 白名单（只允许 `id="probe"`）+ ES5 语法断言 + 位置必须在
  module 之前；D21 六个状态名逐个钉 `get x()` / `set x(v)`；禁止 `window.__enote = {` 整份覆盖；
  新增 `TestBuildJSONServed`。
* `test.sh`：导出表闸门之后新增 `JSEVAL seam` 载荷（ready 兑现 / `build.sha` 对上刚装的这版 /
  dom 齐 / `api` 是函数 / `probe.ok` 全绿 / `moduleError` 空），install 溯源行加打 `build=<sha>@<builtAt>`。

验收（D20，当时的口径）：`node tools/ui_test.js`（14 闸门）+ `node tools/ui_sig_test.js`（84 签名）+
`go test ./...` 全绿；全量 `GO_TEST=1 ./build.sh && ./install.sh && ./test.sh --vd` 在本步 HEAD
跑完，结果记在 CHANGELOG 对应段的日志编号里。

给步骤 4 的硬约束：`render()` 改成返回 Promise 后，`markReady()` 的兑现点必须跟着挪到渲染真的
完成之后（现在在同步 `render()` 末尾）；`JSEVAL seam` 的 `ready` 断言会自动覆盖这件事。

步骤 3 落地时补的一条（真机全量首跑抓出来的）：

* **probe 的判定式本身要测**。`Reflect` 是命名空间对象（同 `Math` / `JSON`），`typeof` 是
  `'object'`；写成 `=== 'function'` 会让 probe 在 Chrome 159 上永远报缺（假红）。这类 bug 静态
  全绿看不出来，所以 `go/web_test.go` 加 `TestProbeSelfTest`：抽出探针脚本在 node `vm` 里用最小
  window/document 桩跑一遍，断言 `ok === true` 且 `missing` 为空。**给步骤 5–10 的规矩：往 probe
  加探测项，必须同时保证自测在 node 上绿**（node 与 V8 同源，特性齐全时判定必然一致）。

步骤 3 落地后给步骤 4 的三条（Tony 审 5865998ceb 提，都不阻塞，步骤 4 反正要动 `test.sh`）：

* **probe 里 `Object.entries` 那条的依据是假的**：vendored Vue 3.5.46 里 `Object.entries` **0 次**
  （它用 `Object.keys`，4 次）。功能无害（Chrome 54 ≤ module 的 61，模块能跑的 WebView 必过），
  但依据写了个不存在的依赖，按「每条断言可核」的标准要改：依据改成「版本下限哨兵」，或换成
  `Object.keys`。改完必须同时过 `TestProbeSelfTest`。
* **`go test ./...` 在干净树上必红**：`build.json` 进了 `.gitignore`，新 worktree / 新 clone 没这
  文件，`TestBuildJSONServed` 直接 404（Tony 这次是手写一个假 build.json 才跑起来的）。文件不存在
  时改成 `t.Skip("先跑 build.sh")`，文件在时格式断言照旧严格。
* **seam 有个潜在竞态**：`ready` 在首屏兑现，`build` 由独立的 `fetch('/build.json')` 填，载荷
  `await ready` 后立刻读 `E.build`，顺序没保证（实测不犯：seam 载荷是在桥载荷轮询完几秒后注入的）。
  app.js 把那个 fetch 的 promise 存成 `__enote.buildReady`，载荷里带超时 await 一下。

### 9.8 S8 步骤 4 已完成（Austin，D12b / D13：`render()` → Promise + 闸门② 闭集）

**契约先于实现动**：步骤 5-10 把视图转 Vue 之后，刷新变成微任务，「点完立刻断言 DOM」的测试载荷
必须 `await`。所以这一步先把 `render()` 的契约改成 Promise，实现仍是同步 `innerHTML` ——
`Promise.resolve()` 是真语义，不是占位；步骤 5-10 换成 `nextTick()` 时调用点一行不用改。

* `app.js`：`render()` 末尾 `markReady(); return Promise.resolve();`。`markReady()` 必须在 return
  之前（Tony 点的名）：`ready` 的语义是「首屏画完」，甩进 `.then` 就变成「首屏之后的某个微任务」，
  步骤 3 的 seam 断言 `ready@0ms` 语义就变了。`go/web_test.go` 把这两条钉住。
* 内部 16 处 `render()` 调用点**一律不 await**：Tony 逐条核过没有一处紧跟读新 DOM
  （`:1587` 后面是 `setTimeout`、`:1834` 的 `shotIntroOnce` 读 localStorage、`:309` 的
  `missedSheet` 建 sheet 不读 main）。改动面因此压到 3 处 jseval 载荷。
* 3 处载荷加 `await render()`，其中 2 处（folderSheet / shotSheet）的包装是同步 `(function(){`，
  必须连包装一起改成 `(async function(){` —— 漏改是整段载荷 SyntaxError，JSEVAL token 集体消失，
  表现为「用例没跑」而不是「用例红了」。
* **闸门② 重写**（`tools/ui_test.js`，FAST 步骤我代写，Tony 验）：抽 7 个载荷 → 剥注释/字符串/
  正则字面量 → 抽自由标识符 → 减去载荷局部名 → 断言 == 闭集（函数 10 个），状态 6 个必须只以
  `__enote.state.X` 出现。实测闭集与 Tony 独立量的完全一致：`api refresh render missedDismiss
  missedSheet folderPick folderSave folderSheet shotPick shotSheet`。
* 扫描器三条实测假阳性（都写进注释）：选择器串 `.pane[data-tab=mine]` 命中裸名 `tab`；载荷块后的
  Python（`open(sys.argv[1])`/`print`/`int`）不是 JS；正则字面量 `/\s+/g` 里的 `g`/`d`/`s` 被当标识符。
  闸门自己的防线：载荷数 < 7 判红。
* 五条反向实验逐条变红：裸写 `tab="notes"` / 删一个 `await` / 引入闭集外新全局 / 一处载荷输出文件
  改名 / 闭集里 `shotPick` 不再被引用。
* Tony 步骤 3 的三条后续全部落地：`Object.entries` 依据改成「版本下限哨兵」（实测 vendored Vue
  3.5.46：`Object.entries` 0 次、`Object.keys` 11 次）；`TestBuildJSONServed` 缺文件时 `t.Skip`；
  `__enote.buildReady` + seam 载荷带超时 await + 断言 `buildready=ok`。

**给步骤 5-10 的硬约束**：载荷里新增的全局引用必须同步改闸门② 的闭集（红字会直接说这条）；
视图转 Vue 后 `render()` 的返回值换成 `nextTick()`，`markReady()` 仍留在首屏那一次。

### 9.9 S3 步骤 5 已完成（Austin + Tony，D14：Notes 视图转 Vue + 组件模式模板）

**这一步的产物不是「Notes 页换了实现」，是一份能照抄的模式模板**，加一条能证明「行为零变化」的夹具。
步骤 6/7/9/10 是纯执行。

新增三个文件（Austin）：

* `go/ui/js/vue.js`（45 行）：装配层。`setHost(h)` 注入宿主接口（app.js 在**首次 `refresh()` 之前**调一次，
  `go/web_test.go` 钉住这个顺序）、`V = Vue.reactive({tick:0})`、`live(fn)`、`mountView`/`vuePaint`。
  混合期用「渲染计数器」而不是把 `S` 改成 reactive：八个视图共用同一个 `S`，改 reactive 是跨视图的
  大改，留到步骤 11。
* `go/ui/js/components.js`（130 行）：`StripBar` / `MissedBanner` / `ShotBanner` / `ClipBanner` /
  `NoteCard`，并注册 Tony 的 `components/empty-state.js`。
* `go/ui/js/views/notes.js`（40 行）：`NotesView`，fragment 根，顺序 = `renderNotes()` 的拼接顺序。

`app.js`：`var VUE_VIEWS = { notes: NotesView }` 注册表（**混合期唯一开关**：加一行迁移一个视图，
删一行退回字符串路径）、`render()` 按注册表分发、`setHost({...})`、`shotGo(kind)`、
`__enote.legacy = { notes: renderNotes }`（夹具缝，步骤 6/7/9/10 各加一个 tab，步骤 11 随渲染器删）、
`metaHTML`/`whereHTML`/`attachHTML` 从 `noteCard()` 抽出来给两条路径共用。
`index.html`：`<script src="/vendor/vue.global.prod.js">` 必须在 `<script type="module">` 之前
（`js/vue.js` 在模块求值时就要读 `window.Vue`），`go/web_test.go` 钉住这个顺序。

**模式模板（6/7/9/10 照抄）**

1. 视图根 `const tick = computed(() => V.tick)`，子组件一律 `:tick="tick"`。
2. 读模块状态（`S` / `MISSED` / `SHOTFLAGS` / `open`）的 computed 一律包 `live(() => …)`。
3. 结构（循环 / 条件 / 卡片骨架）用模板语法；叶子片段（图标、chip、待办行、facts）用 `v-html`
   复用现成字符串函数（`H.metaHTML` 等）——DOM 与今天逐字一致，签名测试和 CSS 选择器都不受影响。
   Tony 原话是「先包后换」，落地形态就是这条：**结构用模板，叶子用 v-html**。
4. 模板里只写 `H.名字(…)` 直调：不用 `H[expr]()`（静态抓不到，typo 就是「点了没反应」）、
   不用 `.stop` 修饰符、不用内联箭头（闸门①b/①c 会红）。
5. D15 冻结的 class 名是契约：`msrow cb pfoot ttx acard iconbtn brand justdone sheet todo`，
   `.missedb` / `.missedtop` 必须继续不存在。

**真机第一次跑就抓到的静默失效（本步最重要的发现）**：P6.6「删光剪贴板后首页横幅立刻消失」红，
红字是「删之前首页应该有剪贴板横幅: 'none'」——横幅根本没渲染。根因：组件里
`computed(() => (H.S.info && H.S.info.clip) || 0)` **没有任何响应式依赖**（`S` 是普通模块变量），
computed 永远缓存，视图永远停在首帧。视图读到 `tick` 不够，**每个读模块状态的 computed 都得依赖 tick**。
修法：`js/vue.js` 加 `export function live(fn){ return Vue.computed(function(){ V.tick; return fn() }) }`，
组件里读模块状态的 computed 全部换成 `live(() => …)`。闸门⑮ 加了静态防线：组件/视图文件里出现
`computed(` 且后 80 字符没有 `V.tick` 就判红（唯一豁免是 tick 源本身）；反向实验把 ClipBanner 的
`live(` 换回 `Vue.computed(` → 红字精确指到那一行，恢复即绿。

**夹具的坑（Austin 踩，记下来给 6/7/9/10）**：VDIFF 第一版「一条 VDIFF 也没打出来」，红字写成
「前端抛异常了？日志=[]」——不是抛异常，是**载荷根本没执行**：jseval 钩子只在 `.devmode` 存在时干活，
夹具块紧跟在上一块删 `.devmode` 之后注入。每个 jseval 块都要自己 `touch .devmode`（test.sh 里 5 处都是这个写法）。
夹具本身也加了防御：`render()` 用 `Promise.race` 兜 4s + 全程 `try/catch`，因为 Vue 分支里组件渲染抛异常时
`nextTick` 的 promise 不兑现，`await render()` 会挂死，夹具要永远给结论，不能跟着一起挂。

**Tony 半边**：闸门①b/①c（模板 `@click` 名 ⊆ 导出表，handler 总数钉 70）、DOM 逐字一致夹具、
`<empty-state>`（整块 `v-html`：标题在原实现里是原样插入的 HTML，`{{ }}` 会多一层转义）、
签名 5 处迁移改成写法无关（横幅顺序五条反向实验逐条红）、VENDOR.md 记录 Vue 的浏览器下限。

**Vue 语法下限（Tony 实测）**：vendored Vue 3.5.46 = Chrome 58（ES2015 + Proxy/Reflect/Symbol/WeakMap；
`?.` 只出现在正则字面量里、`??` 0 次、对象展开 0 次）→ `MIN_API=26` 不用动。

**闸门⑮**（`tools/ui_test.js`，Austin）：① 模板全部过 vendored Vue 的 `compile()`（在 node 里跑，
shim 必须供上 `decodeEntities` 用的那个 div，否则报 `Cannot read properties of undefined (reading '0')`）；
② 注册表里的视图必须读 `V.tick`，模板里的自定义标签必须全收 `:tick="tick"`；③ 模板 handler 名 ⊆ 导出表；
④ 组件里的 `computed(` 必须包 `live()`。

**数字**：闸门 14→15、导出表 57→58 key（+`shotGo`）、Vue 模板 6 个、模板 handler 9 个、
签名 84 项不变、`function render(){` 在 app.js 里必须**恰好一份**（函数声明提升会让后一份覆盖前一份，
Vue 分发静默失效——这条也钉进 `go/web_test.go`）。

**VDIFF 夹具跑出来的四处漂移（都是真发现，不是测试噪声）**：

1. `style="--i:0"`（字符串）对 `--i: 0;`（Vue）：`:style` 走 `el.style.setProperty`，浏览器读回来就
   是规范化后的形式。CSS 语义完全等价 → 夹具两边都过一遍 `el.style.cssText` 再比。
2. 遗留路径写 `onclick="expand('id')"`，Vue 用 `@click`（addEventListener），DOM 里根本没有
   `onclick` 属性 → 夹具不比 `on*` 属性：它们是绑定机制不是 DOM 形状，两条路径的 handler
   存在性由闸门①（onclick）与闸门①b（@click）分别验。
3. **`v-html` 只能挂在真实元素上，所以它必顶多一层包装**：`<div v-html="H.factsBlock(n)">` 比今天
   多一层 `<div>`。修法是把字符串函数拆成「内层」：新增 `factsInner(n)`（`factsBlock` 继续用它），
   模板写 `<div class="facts" v-if="facts" v-html="facts">`。**模式模板补一条：被 `v-html`
   复用的字符串函数必须返回内层 HTML，不是整块。**
4. 比的是「raw 字符串」对「收尾后的 DOM」：`syncExpand()` 会按正文高度把「展开详情」按钮设成
   `display:none`，Vue 那侧的 DOM 是收尾后的。夹具现在把遗留字符串塞进 `#view` 里的临时 pane、
   跑一遍 `__enote.afterPaint()` 再读回来比 → 新增 `__enote.afterPaint` 缝（D17，步骤 11 一起删）。

**给 6/7/9/10 的两个小坑**：jseval 载荷的中文注释里不要写反引号（闸门② 不认模板字符串，
直接判红）；夹具的 `Promise.race([render(), 兜底])` 写法闸门② 现在认（组件渲染抛异常时
`nextTick` 不兑现，`await render()` 会挂死）。

**夹具的两条边界（Tony，给 6/7/9/10 定调）**：VDIFF 比的是**规范化后相等**，不是字符串相等
（属性按名排序、空白节点丢弃、文本 trim）——CSS 和测试选择器看 tag/class/attr，不看属性顺序，
所以属性顺序变化不算漂移，不必为此退化成 `v-html`。而它不比 `on*` 属性（上面第 2 条），
所以「画出来一样」不等于「点了会动」：handler 没绑上，VDIFF 依旧绿。这两条边界由
`test.sh` 的「Notes 交互在 Vue 路径上真的生效」补齐（Tony）：真点击钉住展开 / 空态 / 三横幅 / 删除
四类交互，正是上面那个 `live()` 静默失效的靶心。八条断言逐条合成输入验过（tick 链断、
clip 横幅没渲染、删除后卡片没掉、空态没出、横幅顺序反了、载荷没跑完、无卡片空跑探测）；
`delNote` 走 `__enote.actions` 而不是裸全局，闸门② 当场把它拦下（闭集只给 10 个函数）。
视觉漂移（class 逐字相同但层叠上下文变了、组件根节点多包一层导致 margin 合并消失）由
`tools/shots_vue.sh` 截四张钉住：明 / 暗 / 空态 / 三横幅，脚本自检四张 md5 必须互不相同。

**签名断言的一条假绿（Tony 自检）**：`frag()` 写成 `new RegExp(fn + '\\(')` 是前缀匹配，
把 `factsBlock` 连调用点改名成 `factsBlockRenamed` 签名断言照样绿——等于没在断言。加 `\b` 后
改名即红、恢复即绿。同理 `ui_sig_test.js` 的失败行是 `  FAIL …`（两个前导空格），
`grep '^FAIL'` 恒为 0，判据要用 ok 计数（84 = 全过）。

**验收**：静态 15 闸门 + 84 签名 + `go test ./...` 全绿；真机 VDIFF 夹具
`same=1 len=8078`（规范化后 DOM 逐字一致）；全量 `GO_TEST=1 ./build.sh && ./install.sh && ./test.sh --vd`
见 CHANGELOG。

**状态桥闭合集 16 → 17（+`SR`，D21）**：NINT 夹具里 `S.notes=[]` + `await render()` 画不出空态，
烧了两轮真机探针才定位，根因两条，**都不是 Vue 的问题**：

1. `notesFiltered()` 的第一优先级是 `if(SR.notes) return SR.notes`（服务端搜索结果），
   夹具只改 `S.notes` 时画的是 SR 里那 2 条 —— 症状看起来像「视图的 computed 冻住了」。
2. app 每 ~2s 轮询 `/api/state` 并整体替换 `S`，载荷对 `S.notes` 的赋值活不过下一次轮询。
   实测：`S.notes=[]` 后 render，透传的 `data-list` 反而从 0 变 2（轮询把真数据灌回来了）。

夹具的正解是走 API：`api('/api/delete',{id})` 删完 → `refresh(true)` → `.empty` 出现
（真机实测 `cards=0 empty=true`），再 `api('/api/add',{text})` 建回来。`SR` 进闭合集是让夹具
能读/清它做诊断，不是让载荷靠它造空态（一样会被轮询覆盖）。

探针证据链（写下来免得下轮重烧）：给 StripBar 加临时 `:data-tick`/`:data-i` → tick 每次 render
递增 ✓、`S.info.notes=99` → `data-i` 2→99 ✓（证明 `live()` 可用）；同载荷里跑最小 Vue app
（`reactive({tick})` + `computed` + `{{c}}`）0→1→3 ✓（证明 WebView 的 Vue 响应式正常）。

**门禁自己是概率性的（两处 flake，都记在步骤 12 收）**：D20 把「完整跑全绿」当每步门禁，
门禁自己红过一次就要先花一轮排除它是不是真回归，所以先记账：

1. `test.sh:397` 直接取 `json.load(stdin)["notes"][0]["id"]`，那一刻 notes 为空 → `JSONDecodeError`，
   整轮 0 步 ok，症状是「刚开跑就炸」，很容易被当成设备/构建问题（Tony 在集成 HEAD 上第一次跑红，
   第二次同树 PASS）。前一步图片 OCR 的 llm 实测 21637ms，解析队列异步落库，所以「notes 非空」
   不是即时保证。修法：照 NINT 恢复那步轮询等 notes 非空（上限若干秒）再取 `notes[0]`。
2. P6.5 常驻后台：`am start --es hook keepalive --es arg on` 后 20s 内没等到 `hook keepalive: ` 行
   （Austin 在集成 HEAD `a1732bed59` 上第一次跑红，同树第二次 PASS）。钩子是纯原生路径
   （`MainActivity.runHook` → `KeepAlive.setEnabled` + `Reminders.sync`），本步没碰过 Java，
   红在测试等待窗口，不在被测代码。修法同 1：轮询到行出现，窗口按 `Reminders.sync` 的实测耗时放宽。

### 9.10 S3 步骤 6 已完成（Austin：Todos 视图转 Vue + `.cb` 裁切核实）

新增 `go/ui/js/views/todos.js`（`TodosView` + 子组件 `TodoRow`），注册表 `VUE_VIEWS` 加一行
`todos: TodosView`，`__enote.legacy` 加 `todos: renderTodos`。分组 / 排序 / 筛选逻辑在 Vue 里
重算一遍，叶子 HTML（`.cb` 内容、`.tx` 整块）走 `v-html` 复用 app.js 抽出来的
`cbInnerHTML()` / `todoTxHTML()` / `todoRowCls()` —— 字符串路径也改成调这同一对函数，
VDIFF 逐字比的就是这个。

**步骤 5 的用例结构上区分不了渲染路径（本步最大的发现）**：VDIFF 比的是 DOM，而两条路径的
DOM 按设计就逐字相同，所以它**无法判出走的是哪条** —— 真要是 Vue 一行没跑，VDIFF/NINT 会全绿。
落地 HEAD 上 Vue 确实跑了（`render()` 的门禁是 `VUE_VIEWS[tab]`，app.js:1317，非空就
`mountView`，没有 `vueReady()` 这种东西），但没有任何断言能证明这件事。步骤 6 补的是正向断言：
app.js 里加 `window.__enote.vue = { app:null, views:VUE_VIEWS, apps:apps, isVue:… }` 作为
**观测缝**（不是生产门禁：让生产渲染路径依赖测试缝存在与否，就是测试对象决定生产行为），
TINT 断言 `isVue(todos) === true` 且 `apps.todos` 非空。三条防线：`go/web_test.go` 断言
`VUE_VIEWS` 含 notes+todos 且 app.js 里有 `window.__enote.vue =`；闸门⑮ 新增两条静态检查 ——
视图里的 `H.xxx`（模板 + setup 全量）必须出现在 `setHost({...})` 的 key 里（Vue 读的是宿主对象，
不是 window），模板里的每个自定义标签 `<x-y>` 必须列在该视图的 `components:` 里（无全局豁免）。

**三条防线都做了反向实验**（新防线不做反向实验就只是装饰）：

1. 从 `views/todos.js` 的 `components:` 删掉 `EmptyState` →
   `FAIL 闸门⑮ Vue 装配缺失：go/ui/js/views/todos.js：模板用了 <empty-state> 但视图没在 components: 里注册`
2. 从 `setHost({...})` 删掉模板用到的 `toggle` → `FAIL 闸门⑮ 模板里的 H.xxx 不在 setHost…：toggle`；
   删掉只出现在 `setup()` 里的 `cbInnerHTML` → 同一条 FAIL 点名 `cbInnerHTML`（这就是扫整个视图文件
   而不只扫模板的理由）。
3. 把 `VUE_VIEWS` 里的 `todos` 摘掉重装到真机 → TINT 日志 `isVue=false mounted=false mounted2=false`，
   断言红在 `__enote.vue.isVue(todos) 不是 true`，而 `row=found` / `done1=true` / `moved=gone` /
   `srRows=2` / 几何全部依旧全绿 —— 直接证明「只有 isVue 能抓到走了字符串路径」。
   附带收获：`go test` 也会拦住（`web_test.go:167 VUE_VIEWS 注册表缺 notes 或 todos`），
   反向实验时要用不带 `GO_TEST=1` 的 `./build.sh` 才装得上去。

**反向实验顺手挖出闸门⑮ 自己是恒绿的**：模板 handler 那条检查的捕获组编号错位
（`m[1]` 是事件名 click/input，恒真；`m[2]` 才是 `H.` 前缀），收进集合的是「click」这种事件名；
加上过滤方向写反（`if (!host.has(n)) delete` 删的是「在集合里的」），两条合起来 = 永不会红。
修正后正向输出变成 `模板 handler 10 个全在导出表；视图里的 H.xxx 31 个全在 setHost`，上面两个
反向实验才能红。步骤 5 那批「静态防线」里还有多少是这样的恒绿，步骤 11 合并签名测试时逐条过。

**`.cb` 左边缘裁切：量出来是没裁，账本条目过期**（Tony 要求给数据不给描述）。真机 SM-X510，
WebView Chrome 159，量 `.cb::before`（真正的圆圈）左边缘 vs 父 `.todo` 的 padding-box 左边缘：

| 站点 | circleL | padBoxL0 | 差 | overflow | 结论 |
|---|---|---|---|---|---|
| 待办页列表 `.todo .cb` | 36.93 | 35.43 | +1.50 | hidden | 未裁 |
| 笔记卡片预览 `.pane[data-tab=notes] .todo .cb` | 36.93 | 35.43 | +1.50 | hidden | 未裁 |
| 逾期面板 `.msrow .cb`（P8.5 自建夹具后量） | 62.36 | 58.86 | +3.50 | hidden | 未裁 |

+1.50px 正好是 `.cb::before` 的 `left:1.5px` 内缩，即圆圈完整落在 `.todo` 的 padding-box 内。
所以本步**没有 CSS 改动**（`todos.css` / `base.css` 都没动），S2 的 tokens/base 落地时已经修掉了；
基线截图是 S1 时代拍的。几何断言进 TINT（见下），红字会直接给出 circleL / padBoxL0 / overflow。

**`test.sh` 两处结构性改动**（Austin 拥有 API/server 用例块）：

1. **VDIFF 参数化**成 `vdiff_tab()`（tab 名经 python 的 `__TAB__` 注入），调用
   `vdiff_tab notes` + `vdiff_tab todos` —— 每个视图转完 Vue 都自动获得「DOM 逐字一致」这条防线，
   不用为每个视图抄一遍 100 行。
2. 新增 **TINT** 步骤（`Todos 交互在 Vue 路径上真的生效`），钉四件事：Vue 路径是活的
   （`isVue` + `mounted` + 切 tab 后 `mounted2`）；点 `.cb` 真提交到服务端（`done` 翻转）且行从
   「未完成」列表消失（`moved=gone`、`rows1=rows0-1`）；搜索态下渲染行数 == 服务端
   `SR.todoIds` 里未完成的条数（SR 遮蔽防线，`SR` 有 setter 所以夹具能整体替换）；
   `.cb` 几何。夹具一律自建两条（`Vue 交互夹具甲/乙`）+ 开头 purge 同名残留 + 结尾按 `ok:true`
   计数删除，`cleaned==made` 断言防污染真数据。

**四个只有真机能告诉你的坑**（都是假红，逐个记下来）：

1. `/api/todo` 的删除动作是 `"delete"`，写成 `"del"` 时 `go/web.go` 的 `switch` **没有 default**，
   连响应体都不写 → 夹具永远删不掉 → 下一轮 `findByText` 命中上一轮那条已勾完的旧夹具，
   症状是 `done0=true` / `row=none`，看着完全像「Vue 渲染坏了」。
2. 夹具挂在解析未终结的笔记上会被抹掉：`go/llm.go:263` 解析完成时是 `n.Todos = nil` 整体替换。
   探针里全绿（没有解析在飞），suite 里 `done1=null rows1=0`。现在夹具先等所有笔记进
   `done/raw/error` 终态，再挂到那篇笔记上。
3. **jseval 注入的时机与日志格式**：重启后立刻注入会跑在 app.js 之前（实测
   `TINT ERR=__enote is not defined @ <anonymous>:20:17`），要等 `web: page finished` / `SELFCHECK OK`；
   日志行解析用 `re.search(r"TINT (\w+)=(.*)")`，**每行只取一个 key=value** 且 key 必须紧跟 `=`：
   `geo0=circleL=36.93 padBoxL0=35.43` 可以（key=geo0，值里再 `findall` 子键），写成
   `geo0 circleL=…` 就被解析成 key=`circleL`，几何列表永远为空（实测假红「没量到 .cb 几何」）。
   几何必须在**夹具还在 DOM 里**时量：套件前面的步骤会把待办页清空（实测 `todos=0 cbIn=0 empty=1`），
   所以量几何排在造夹具之后、点勾选之前。
4. 模块变量 `S` 由 app 的 ~2s 轮询整体替换，夹具 `api('/api/state')` 拿到的新数据不会自动进
   `S` → `render()` 画的是旧数据（`row=none`）。要显式 `__enote.state.S = st`。
5. **`GO_TEST=1 ./build.sh` 会先跑 `go test`**，测试红就不重编 APK（实测反向实验③ 第一次跑的
   是旧 APK，白测一轮）；故意装一个「坏」构建时要改用不带 `GO_TEST=1` 的 `./build.sh`。
6. **`probe.sh` 等的是 `VDIFF2 done=1`**，TINT 载荷的完成标记是 `TINT done=1`，所以探针会空等
   15s 后返回空结果（不报错）；手工跑 TINT 要自己 `sleep` + 取日志。

**闸门⑮ 的 `setHost` 检查顺带抓到两个不存在的名字**（`isOver` / `priFilter`）：写进 `setHost({...})`
会让 app.js 在模块求值时抛 `ReferenceError`，整个页面白屏（实测 `Uncaught ReferenceError: isOver
is not defined @app.js:1923`）。`views/todos.js` 也踩过两个 module 导出坑：`vue.js` 不导出
`computed`（要 `const { computed } = Vue`），`components.js` 不导出 `registerComponents`
（每个视图自己 `components: { … }` 自注册）。

**数字**：Vue 模板 6→8 个、模板 handler 9→10 个、jseval 载荷 9→10 个、VDIFF 覆盖 1→2 个 tab、
导出表 58 key 不变、闸门 15 个不变、签名 84 项不变、D15 冻结的 10 个 class 名不变。

### 9.11 步骤 6 的视觉验收被 Tony 打回一次（三条都是「验收项自己空跑」）

第一版 `tools/shots_todos.sh` 交出来的东西不算证据，三条：

1. **量不到 `.cb` 时只 warn + `return 0`** → 脚本 exit 0，而两张 `-cb.png` 根本没生成。
   裁切图就是「修 `.cb` 裁切」的证据本体，静默缺席等于验收项空跑。现在：量不到直接 `die`，
   末尾自检加一条「四张图必须存在且非空」，和「明暗两张必须不同」同级。
2. **两张图拍的是空列表**：全量测试跑完数据被重置，脚本不造夹具就拍到空态页，
   「明暗两档复查」复查的是空态（步骤 1 的 P8.5 隐式依赖设施数据，同一类坑）。现在脚本
   自己造三条 `视觉夹具` 前缀待办（逾期+high / 今天 / 已完成），截完删干净，并断言
   `made>=3`、画面 `rows>=3`。
3. **导航高亮和页面不一致**：载荷里 `tab='todos'; render()` 只换 pane，导航高亮由 `setTab()`
   写 `.tab.on` + `moveInd()`，而 `setTab` 不在导出表（步骤 5 同一个坑）。现在走真实用户
   路径点 `.tabbar .tab[data-tab=todos]`，并断言 `.tabbar .tab.on` 的 `data-tab` 就是 `todos`。
   坑：`.tabbar .tab` 的 handler 对「点当前 tab」是 early return（app.js:1885），上一轮探针
   把模块里的 `tab` 设成过 todos，直接点 todos 什么也不做 —— 所以先点「笔记」再点「待办」。

**顺带修了一个真 bug：待办页筛选面板里的「全部」是个空操作。** `prefPayload()` 把值为 `all`
的筛选项省略掉，而 `go/search.go:195` 对 todos 在 `done` 缺失时默认成 `open` —— 用户选「全部」
之后仍然只看得见未完成。修法是 `done` 的 `all` 显式发给服务端（`matchTodo` 对 `done=all`
不匹配任何 case → 不过滤，正好是「全部」的语义）。这条是截图逼出来的：要让勾选态进画面
就得选「全部」，一选就发现它不管用。

**验收图**（`docs/shots/`，`./tools/shots_todos.sh` 产出）：`vue-todos-light.png` /
`vue-todos-dark.png` + 两张 `-cb.png` 特写。画面里三个分组（已逾期·1 带红色高优先条、
今天·1、已完成·1 带勾选态）、导航高亮在「待办」、圆圈左边缘在明暗两档都完整。
脚本日志会打印 `nav=todos rows=3 theme=…` 和 `RECT dpr=2.75 x=35.6 y=243.4 w=18.0 h=18.0`，
裁切坐标由它自己量自己算，不靠人眼。

### 9.12 S3 步骤 7 已完成（Austin：Files 视图转 Vue）

`go/ui/js/views/files.js` 新增 `FilesView` + `AttachCard`，注册表加一行
`var VUE_VIEWS = { notes, todos, files: FilesView }`。沿用步骤 5/6 的模式：结构在模板里，
叶子 HTML 两条路径同源 —— app.js 里把 `renderFiles` 拆成
`fileStripInner` / `filesSkeleton` / `attachCardCls` / `attachGlyphHTML` / `attachMetaHTML` /
`attachCardHTML` 六个小函数，遗留渲染器和 Vue 组件调同一份，VDIFF 才逐字比得过。
`FA` / `q` 走 `setHost` 的 getter（传值就是装配时的快照，2s 轮询换掉 `FA` 后视图不动）。

**四条只有真跑才会撞上的事：**

1. **`setHost` 不能改成 `var HOST = {…}; setHost(HOST)`。** 闸门⑮ 的 `setHostKeys()` 认的是
   `setHost({` 这个字面量（`tools/ui_test.js:119`），改了写法它返回空数组，于是「模板里的
   `H.xxx` 全在 setHost」这条判据当场变成 40 条红。FINT 载荷要调 `filesNow()`（它不是内联
   handler，不在导出表里，加 key 就要动 Tony 的 57 键基线），所以让 `setHost(h)` 把 h 返回，
   app.js 写 `var HOST = setHost({…})`，再把 `HOST` 挂到 `__enote.vue.host` 观测缝上。
2. **`/api/attachments` 空库时 `items` 是 `null` 不是 `[]`**（Go 侧 nil slice 编码成 JSON null）。
   FINT 第一版在删除后的轮询里读 `r.items.length` 直接抛
   `Cannot read properties of null (reading 'length')`，整步红。JS 侧统一 `(r.items||[])`，
   shell 侧统一 `json.load(sys.stdin).get("items") or []`。
3. **`vdiff_tab files` 跑在空库上是空跑**：只比到 strip + 空态，145 字节，卡片网格这条主路径
   根本没进比较。现在夹具分享进来之后先跑一个 `FLOAD` 载荷（`filesNow()` 把 `FA` 真加载好，
   断言 `loaded=true` 且 `fa>=1`），再跑第二次 `vdiff_tab files` —— 这次比的是真卡片。
   （`vdiff_tab` 只调 `render()`，而 `render()` 不会去拉附件。）
4. **`class="acard" :class="cls"` 会渲染成 `class="acard acard enter"`**：`attachCardCls()`
   本身带 `acard`，Vue 把静态和动态 class 拼接，VDIFF 比 class 字符串就多一个 token。
   模板只写 `:class="cls"`。

**新增测试**：`test.sh` 的 `vdiff_tab files` + 新步骤「附件页交互在 Vue 路径上真的生效」
（FINT）。夹具是 shell 侧分享进来的一个 PDF（附件只能由分享意图产生，JS 侧没有建附件的 API），
轮询 `/api/attachments?q=` 等它出现，出现不了就 `fail`（夹具不存在 ⇒ 断言全是空跑）。
载荷断言：`isVue(files)` / 挂载 / `FA.items.length == 页面卡片数` / strip 文案含「附件 <total>」/
点卡片出「预览即将上线」toast / 点删除弹确认框并真删到服务端 / 删完卡片少一张。
夹具笔记在步骤末尾删掉，不污染后续用例。

**闸门⑮ 的一条空跑（记进步骤 11 的审计清单）**：`tools/ui_test.js:852` 的
`/template: `([\s\S]*?)`\n/` 只取每个视图文件里的**第一个** template 检查「子组件必须收
`:tick="tick"`」。todos.js 的第一个 template 是 `TodoRow`（里面没有自定义元素），所以
`<empty-state>` 没写 `:tick` 一直没被报出来。files.js 里第一个 template 是 `AttachCard`
（也没有自定义元素），同样漏。已给 files.js 的 `<empty-state>` 显式加 `:tick="tick"`。
→ 这条在 §9.13 里真的修了，而且加 `:tick` 本身是错的（EmptyState 没这个 prop）。

**验收图**（`./tools/shots_files.sh` 产出）：`docs/shots/vue-files-{light,dark}.png` +
两张 `-card.png` 卡片特写。脚本自己分享两个夹具（一个 PDF 走 glyph、一张 PNG 走缩略图），
轮询断言 `附件数>=2`，走真实导航点击并断言 `.tabbar .tab.on == files`，量不到 `.acard`
直接 `die`，末尾自检四张图存在且明暗两张不同。

### 9.13 步骤 7 被 Tony 打回一次（四条：一条真 DOM 漂移 + 三条「闸门/用例空跑」）

Tony 在 `d58baf87ed` 独立复验：静态三件套绿、真机 PASS 52 ok、VDIFF notes 8775 /
todos 4897 / files 145（骨架）/ files 503（夹具后）逐字一致、FINT 非空跑、
`shots_files.sh` 可复现、明暗四图合格。四条必修：

**① 真 DOM 漂移（不是覆盖率问题）**：`files.js` 给 `<empty-state>` 传 `:tick="tick"`，
而 `EmptyState`（Tony owner）的 props 只有 `icon/title/sub` → Vue 把它当透传属性落到根
元素。真机实测本 HEAD：Vue 路径 `<div class="empty" tick="27">`，遗留
`__enote.legacy.files()` 是 `<div class="empty">`。VDIFF 的 `ser()` 比属性，所以空态一
比就红。`notes.js` 的 `<empty-state>` 同样收 `:tick`（notes 的 VDIFF 跑在列表非空时，
所以一直没暴露）。修法：两处都去掉 `:tick`（空态文案的响应性已由 `emptyTitle: live(...)`
覆盖，tick 对它无意义）。`todos.js` 的 `<strip-bar/>` 是反向问题：StripBar **声明了**
`props: ['tick']` 却没传 → 补成 `<strip-bar :tick="tick"/>`。

**② `vdiff_tab files` 从没比过空态**：第一遍跑在 `FA.loaded=false` → 两条路径都画骨架屏
（实测 `hasSkel=1 hasEmpty=0`，145 字节），第二遍有 items → 比网格。空态分支（恰好是 ①
的现场）从没进过比较。修法：FINT 删完夹具后 `FA` 正好是 `loaded=true` + `items=[]`，加
FEMPTY 载荷断言 `loaded=true`、`fa=0`、页面有 `.empty`、没有 `.skel`、`.empty` 上没有
`tick` 属性，再跑第三遍 `vdiff_tab files`。顺带修掉 `test.sh` 里「第一遍比到 strip +
空态」这句错的注释。

**③ 闸门⑮ 对本步骤主体是空跑的**（Tony 的反向实验：删 `attach-card` 的 `:tick` → 绿；
删注册表里的 `files: FilesView` → 绿，只把打印变成「注册表 2」）。两处修：
* `tools/ui_test.js:851` 的非全局 `/template: `([\s\S]*?)`\n/` 换成 `matchAll` 扫视图文件
  里的全部模板（files.js 之前查的是 `AttachCard`，`FilesView` 整段没查；todos.js 同理）。
* tick 规则改成**双向**并按组件 props 判定：扫 `js/**` 里每个 `export const X = {…}` 的
  `props`，声明了 `tick` 的元素必须收 `:tick="tick"`，没声明的**禁止**收（收了就透传成
  DOM 属性 → 与遗留渲染漂移）。这条同时覆盖 ① 的两个方向。
* 注册表完整性：视图文件里 `export const *View` 必须逐个出现在 `VUE_VIEWS` 里，删掉
  `files: FilesView` 现在会红（症状是「视图存在但永远不会被挂载」）。

四条反向实验（都在本 HEAD 实测，闸门必须红）：删 `attach-card` 的 `:tick` → 红；注册表删
`files: FilesView` → 红；给 `<empty-state>` 加回 `:tick` → 红；`todos.js` 的 `<strip-bar>`
去掉 `:tick` → 红。复原后绿，输出改为
「Vue 模板 10 个编译通过；注册表 3 视图的 tick 链完整（扫 5 个模板，组件 tick prop 7 个）…」。

**④ `tools/shots_files.sh` 提交成 100644**：`./tools/shots_files.sh` 直接 Permission
denied（其余 shots 脚本是 100755）。`chmod 755` 并把 mode 一起提交。

**顺带记入步骤 11/13 的账**（Tony 提，不阻塞本步）：shots 脚本的「明暗两张 md5 不同」自检
因状态栏时钟恒真；`prefPayload` 的 `done=all` 缺客户端回归测试；§9.10 那批「永远绿」静态
闸门复查。

### 9.14 S3 步骤 8 已完成（Tony + Austin：截图暂存页 + 选文件夹页 + 导入进度层转 Vue）

分工（Austin 提议、Tony 接受）：app.js 全归 Tony（弹层分发、`setHost`、状态桥、进度层
状态），Austin 保留 `test.sh` 的 `vdiff_sheet` 夹具与交互用例，`go/web_test.go` 归 Austin
（Tony 回退自己那份以免合并冲突）。

**落地的东西**
* `go/ui/js/vue.js`：`mountSheet(name, el, def)`（先 unmount 同名）/ `unmountSheet` /
  `sheetApps` / `sheetPaint()`（`V.tick++` + `Vue.nextTick()`，返回 Promise）。
* `go/ui/js/views/shots.js`：`ShotItem` / `ShotsView` / `ShotProgress`；
  `go/ui/js/views/folders.js`：`FolderRow` / `FoldersView`（搜索框过滤改成 computed，
  遗留是 `display:none`，节点级差异，VDIFF 比的是未过滤态）。
* `app.js`：`VUE_SHEETS = { shots, folders, progress }`、`pageSheetVue(name, title)`、
  `shotSheet()`/`folderSheet()` 分发、`SHOTPROG`（reactive，计时器留在 app.js，因为
  `shotOvlSub` 是 Java 侧回调写的全局函数）、`folderRows()` 抽成唯一排序规则、
  `__enote.vue.{sheets,isVueSheet,folderPaint,shotPaint,host}`、
  `__enote.state` 加 `folderAll/folderSel/folderQ`（三处名单同步：app.js /
  `go/web_test.go` / `tools/ui_test.js` 闸门②）。
* `index.html`：body 级空容器 `<div id="shotOvlRoot"></div>`（无样式；组件根带 `v-if`，
  未挂载时零残留，不会留一层透明遮罩吃掉点击）。

**验收**：`test.sh --vd` EXIT=0 / 59 ok。VDIFF 新增四遍全 `same=1`：shots grid 979 /
shots empty 719 / folders fake 1222 / folders empty 552。`tools/shots_vue.sh` 扩到 8 张
（新增 `vue-shots-light` / `vue-shots-dark` / `vue-folders-light` / `vue-progress`，
夹具走真 `/api/shots/add`，脚本自校验 8 图互不相同）。

**四个真 bug（都是被新用例抓出来的，不是审查看出来的）**
1. **模板用 `H.xxx` 的组件必须在 `setup()` 返回里暴露 `H`**。模板表达式编译成
   `_ctx.H.xxx(...)`，`setup` 没返回 `H` 时渲染期不碰它就静默过，点一下才抛
   `TypeError: Cannot read properties of undefined (reading 'shotSelAll')`。
   `ShotsView` / `FoldersView` 都只把 `H` 用在 handler 里 → 全选/全不选/只选截图目录/
   搜索框全部点了没反应，而 VDIFF、签名 84 项、闸门⑮ 全绿。闸门⑮ 加静态检查（模板用了
   `H.` 的组件必须暴露 `H`），反向实验：删 `ShotItem` 的 `H` → 红，删 `FoldersView` 的
   `H` → 红。
2. **`closeSheet()` 的 110ms 收尾会 unmount 刚重开的弹层**（Austin 审查指出）。加
   `sheetGen` 世代号：`pageSheet`/`pageSheetVue`/`sheet` 各自 bump，迟到的定时器发现
   世代变了就什么都不做。
3. **`folders.js` 搜索框的 `:value="fq"`**：Vue 把 value 写成 DOM 属性，`innerHTML` 多一个
   `value=""` → VDIFF `folders fake` 在 input 那一字节红。输入节点是静态的，重画不重建它，
   不需要受控。
4. **闸门② 看不见 heredoc 载荷**：载荷提取只匹配 `python -c '…sys.argv[1]…'`，
   `js = r'''…'''` 写法（截图页/笔记页交互用例）完全在视野外——闭集加新名字时报「没人引用」
   就是这个漏网。现在两种写法都扫（12 → 15 个载荷），闭集补 `closeSheet`/`folderFilter`/
   `shotOverlay`/`shotOvlSub`，报错文案里的计数改成动态。

**两条「用例自己空跑」**（Tony 加，都是真机量出来的）
* 文件夹页「勾选后滚动位置不跳」在真机上是空跑：只有 3 个目录，页面根本滚不动
  （`scrollable=0`）。改成用状态桥注 40 个假目录把页面撑高（`fakescroll=1` 断言夹具真的
  生效），滚到中间勾一个，容差一行高（~57px）——Chrome 的 scroll anchoring 会主动调
  `scrollTop` 让可见内容不动，真机实测 delta=58px；遗留路径是「记住 scrollTop 再放回」，
  数值不动、可见内容跳一行。两者都不该出现的是「跳回顶部」（innerHTML 重建的旧病）。
* 文件夹页原来全是直接调函数（`folderPick`/`folderFilter`），测不到模板里的 `H.xxx`
  （就是 bug 1 的现场）。补真点击 全选/全不选，断言 `allSel == rows0`、`noneSel == 0`。
* 进度层补覆盖：`shotOverlay`/`shotOvlSub` 进导出表（真跑一次 AI 解析要几十秒且依赖 LLM，
  用例直接调入/出口函数稳定得多），断言挂 body 级、活过 `closeSheet()`、副标题实时更新、
  关掉后 `#shotOvl` 零残留且从 `__enote.vue.sheets` 里 unmount。

**记入后续步骤的账**：文件夹页底部计数在窄屏会折行（`1 个已选 · 共 3 个` 的「个」掉到第二
行，DOM 与遗留逐字相同 → 不是本步回归，步骤 13 打磨）；`pageSheetVue` 只 unmount 同名
sheet，Vue-in-Vue 入口出现时（步骤 9/10）再补全量 unmount。

### 9.15 S3 步骤 9 已完成（Austin：剪贴板暂存页转 Vue）

分工（Tony 的开工契约）：这一步 app.js 破例授权给 Austin（步骤 8 约定 app.js 归 Tony），
`css/views/clip.css` 归 Tony，视觉侧（`tools/shots_vue.sh` 的 clip 图 + `docs/shots` 出图）
Tony 接。契约要求：导出 `ClipItem` + `ClipSheetView`、模块变量叫 `clipList`、
`__enote.legacy.clip` 挂加载完的 DOM、全选/全不选给稳定 id。全部照做。

**落地的东西**
* `go/ui/js/views/clip.js`：`ClipItem`（props `tick`/`x`，返回 `H`）+ `ClipSheetView`
  （三根节点：`.cliptop` / `#clipList` / `.pfoot`）；`VUE_SHEETS` 加 `clip: ClipSheetView`；
  `clipSheet()` 分发到 `pageSheetVue`；`closeSheet()` 收尾补 `unmountSheet('clip')`。
* app.js 侧新增与 Vue 共用的叶子函数（`clipItemCls` / `clipPrevText` / `clipThumbText` /
  `clipMetaText` / `clipItemHTML` / `clipListHTML` / `clipCountHTML` / `clipParseText` /
  `clipSheetHTML`），模块变量 `clipList` + `clipLoading` + `clipError`，状态桥 10→12 名
  （三处名单同步），`__enote.vue.clipPaint` / `__enote.legacy.clip` 两条缝。
* 稳定 id：`#clipSelAll`/`#clipSelNone`、`#shotSelAll`/`#shotSelNone`、
  `#folderSelAll`/`#folderSelNone`、`#clipDelSel`/`#clipRaw`/`#clipParseBtn`；test.sh 里
  四处按下标选按钮换成 id（folders 交互用例 2 处、截图页 SIT 2 处、CIT 2 处）。
* VDIFF 6 弹层遍（新增 clip grid / clip empty）+ CIT 真点击用例。

**三个真 bug（都是新用例/VDIFF 抓出来的）**
1. **剪贴板页每条的删除按钮从来没生效过**：遗留字符串
   `onclick="clipDel(event," + JSON.stringify(id) + ")"` 双引号套双引号属性，浏览器在第一个
   内层引号截断 → `onclick="clipDel(event,"`（半个表达式，点一下抛 SyntaxError）+ 一个以 id
   命名的野属性。VDIFF 比属性时以「野属性」现形（`17954494784061717mmy")"`）。改单引号插值。
2. **`loadClips()` 在空列表分支提前 return**，`clipSel` 里上一批的 id 不清理（计数以页面条目
   为准所以看不出来，`clipDelSel` 会去删已经不存在的 id）。
3. **遗留 `clipPick` 给 `.clicb` 加 `on`** 是空操作（CSS 只有 `.clipitem.on .clicb`），
   Vue 路径没有它 → 两条路径 DOM 差一个类名。删掉。

**夹具的三个坑（真机跑出来的，不是审查看出来的）**
* `go/clip.go:124`「同来源 5s 内 → 覆盖最新一条」：钩子写进来的 app 都是 `hook`，1s 连发
  三条塌成一条（第一次真机跑 fail 在 `剪贴板夹具只到 1 条`）。三条夹具改成间隔 6s。
* `/api/clip/clear` 后前台轮询会立刻把系统剪贴板上那条旧文本重新暂存 → 空态那一遍前先把
  剪贴板写成空格（P6.5 已踩过，这次是同一个坑的第二处）。
* 计数条初始不是「0 条已选」：`clipSel` 的冻结语义是首次见到某 id **默认选中**，所以刚
  加载完是「N 条已选 · 共 N 条」、主按钮带条数。CIT 第一版按「默认全不选」写断言，真机
  跑出来才红。三条夹具的 6s 间隔 = `go/clip.go:124` 的 5s 去抖 + 1s 余量，给套件加约 12s。

**验收**：静态三件套全绿（ui_test 15 闸门 / 签名 84 项 / `go test` ok）；`test.sh --vd`
EXIT=0，clip grid / clip empty 两遍 `same=1`，CIT 真点击全链通过（开页默认全选、点一条取消
那一条、全不选/全选、主按钮文案随勾选数收敛、单条删除行数与勾选数同步 -1、删除所选后
就地换空态）。反向实验六条：五条会红，`__enote.legacy.clip` 缺失在全绿 → 本步把
`vdiff_*` / CIT / SIT 的 `skip` 分支改成判红后，该实验变红（已重跑）。

**记入后续步骤的账**
* 步骤 11：删遗留 JS 时要把 VDIFF 整套一起删（`skip` 分支已在本步改成 fail，遗留渲染器
  删干净前不会静默空跑；步骤 11 删基准时连 `vdiff_tab` / `vdiff_sheet` 一起删）。
* 步骤 11：`clipParse` 走真 LLM（几十秒且依赖 key），CIT 只测到按钮文案与勾选联动，
  「一键解析 N 条」真解析路径仍无客户端回归。

### 9.16 S3 步骤 10 已完成（Austin：我的页（tab）+ 设置页（弹层）转 Vue）

分工（Tony 的开工契约）：这一步 app.js 归 Austin，`css/views/stats.css` /
`css/views/settings.css` 归 Tony，视觉出图（`tools/shots_vue.sh`）Tony 接、夹具 Austin 出。
契约要求：我的页是 **tab** → `VUE_VIEWS`，设置页是 **弹层** → `VUE_SHEETS`；图表做成子组件
（props 带 `tick`）；不改 `pageSheet()` 的契约；`$('#panel').dataset.kind='settings'` 必须保留
（CSS 钩子）；`__enote.legacy.mine` / `.settings` 基准；状态桥三处名单同步；VDIFF 加
`vdiff_tab mine` + `vdiff_sheet settings`；skip 分支判红。全部照做。

**落地的东西**
* `go/ui/js/views/stats.js`：`StatsStat`（props `tick`/`i`/`v`/`label`/`icon`/`hot`，class 由
  `H.statCls` 算）+ `StatsChart`（props `tick`/`days`，柱高与入场延迟在组件里算）+
  `StatsLi`（图标行，`emits:['go']`）+ `StatsView`（骨架屏 / 六格 / 近 7 天 / 笔记状态 /
  常见标签 / 截图捕获 / 六行入口 / 运行信息）。
* `go/ui/js/views/settings.js`：`SettingsSheetView` 九段（提醒 / 后台 / 外观 / AI 模型 /
  采集 / 本地 OCR / 数据 / 运行状态 / 用法）。输入框用 `:value.attr`（`:value` 走 DOM
  property，innerHTML 序列化出来没有 value 属性，遗留字符串有 → VDIFF 红），值一律 `x || ''`
  （遗留 `esc(undefined)` 得到 `value=""`，`.attr` 遇 null 会 removeAttribute）。
* `settingsSheet()` 变分发器（Vue 走 `pageSheetVue('settings','设置')`）；`settingsRefresh()`
  在 Vue 路径改成 `sheetPaint()` + 滚位还原（重建 DOM 会把正在输入的字符清掉，设置页是全站
  唯一有六个输入框的页面）；`closeSheet()` 补 `unmountSheet('settings')`。
* 两条路径共用的叶子函数：`statsHeroInner`/`statsHeroHTML`、`statsNotesCardHTML`、
  `statsRunRowsHTML`/`statsRunInnerHTML`/`statsRunCardHTML`、`statCls`/`statHTML`/`liHTML`、
  `ocrReadyHTML`、`chartHTML`、`settingsCollectHTML`、`settingsOcrCardHTML`、
  `settingsUsageHTML`、`settingsKeepAliveNoteHTML`、`settingsDataCardHTML`、
  `settingsRunCardHTML`；遗留基准挂 `__enote.legacy.mine` / `.settings`，新增
  `__enote.clearSeen`（入场动画 seen 的一次性状态，两条路径必须从同一状态出发）。
* 状态桥加 `ST`（闭集 22→23 名，app.js / `go/web_test.go` / `tools/ui_test.js` 三处同步）；
  导出表 60→69 key。
* **新闸门①d**：handler 字符串参数（`liHTML(…, 'settingsSheet()')` 这类把 handler 当字符串
  传进叶子函数的写法）里的调用名必须在导出表 —— 闸门① 只扫 `onclick="…"` 字面量，这类写法
  完全在它的视野外（本步扫到 68 处）。
* **闸门⑮ 新增**：`components: { A, B }` 里的每个名字必须在同文件声明或 import 进来。

**三个真 bug**
1. **我的页四行的 handler 从步骤 2 起就是野名字**：`settingsSheet` / `scanShotsNow` /
   `rescanShots` / `clearShots` 不在导出表（「设置 / 现在扫描一次 / 回捞最近 7 天 / 清空截图
   暂存」点了没反应，控制台一行 ReferenceError）。
2. **`exportJSON` 从来没定义过**：设置页「导出 JSON」与我的页那一行调的是一个不存在的名字
   （HEAD 里 `grep -c exportJSON` = 0），module 加载时导出表求值直接抛 ReferenceError →
   整页 JS 死在首屏。静态闸门全绿，真机跑出来才看见。
3. **`components:` 里留了已删除定义的引用**（`StatsKv`）：同样是整模块 ReferenceError、页面
   白屏。代价是两次完整真机跑，所以闸门⑮ 加了上面那条检查（反向实验：加回 `StatsKv` 引用
   → 闸门红）。

**VDIFF 的文本节点切分规则**（本步踩满，写进 `views/stats.js` 文件头）
序列化器逐文本节点 trim 后拼接，所以遗留的 `'已排定 '+remindPending+' 条 · …'`（三个节点 →
「已排定12条 · …」）与模板里一个插值 `{{ notifySub }}`（一个节点 → 「已排定 12 条 · …」）
结构上比不过。做法：数据卡 / 运行状态卡 / 保活长说明整块 v-html 复用叶子函数；提醒卡副标题、
常见标签 chip 按遗留的拼接切分写多个插值。

**VDIFF 归一化新增两处「绘制时机」差异**（都是真机跑出来的偶发红）：`enter`（一次性入场动画
标记，`enterCls` 只在 id 首次出现时给）从 class 里剔掉再比 —— 它的有无取决于两条路径谁先画、
后台轮询有没有在中间插一次重绘，是时机不是 DOM 形状（第一次真机跑就红在 `card enter` vs
`card`）；空的 `style` 属性与没有 `style` 属性等价（`syncExpand` 设过 display 再清掉，Vue 那侧
留下 `style=""`）。动画本身由 CSS 与视觉截图覆盖。

**夹具的两个坑（真机跑出来的，不是审查看出来的）**
* `Pictures/enote-test` 的 MediaStore 行不随 root 的 `rm` 消失，旧行 `date_added` 是上次跑的
  时间，扫描按 `rangeDays=1` 过滤 → 跑满 24h 后两张测试图刚好掉出窗口，`added=0` 假红
  （本步验收第一次跑踩到，距上次绿跑 24h01m）。夹具现在先 `content delete` 删行。
* `"$PY" -c '…'` 的脚本在 shell 单引号参数里，python 里写 `''` 会被 shell 吃掉 →
  SyntaxError（`vdiff_tab` 的断言脚本第一版就是这么红的）。
* `statsNow()` 的 `stBusy` 互斥标志会挡掉后续所有调用（一次在飞的请求卡住就永久挡），套件里
  前一步刚清过库（`clearAllNotes` 置 ST=null），点「我的」tab 不取统计 → 我的页停在骨架屏 →
  「我的页上没有设置行」。SET 用例现在直接 `await api("/api/stats")` 注入状态桥（tab 仍真点）。
* 我的页 hero 的探针第一版读 `.hver`（版本号那一行，加载前后文本一样），断言「未加载那一遍必须
  含『正在统计』」永远红 —— 「正在统计…」在 `.hstats` 里。探针选错元素 = 断言恒假。

**截图脚本的六个坑（`tools/shots_vue.sh` 步骤 10 段，全部真机踩过）**
* ST 夹具必须是完整 `/api/stats` 形状：少 `ai` 时 `renderMine` 读 `s.ai.calls` 抛异常，
  截图停在上一页（第一版 stats 图其实是附件页）。
* `setTheme("dark")` 会让 Activity 走 night mode 重建、WebView 重新加载，**同一载荷里后面的
  语句随旧页面一起丢掉** —— 暗色设置页拍成「整屏糊掉、面板不在上面」。主题改成单独一发
  （`settheme` 函数）+ 等 2.5s。
* 重载之后 `.sheet.on .panel` 的入场过渡有概率不启动，面板停在初始态 → `SHEETON` 摘掉 `on`
  再强制回流挂回去，过渡一定重跑。
* toast 是 `setTheme` 之后异步弹的，清 toast 必须放载荷**末尾**（放开头等于没清）。
* `setTab` 没导出（导出它要动步骤 6 的基线），tabbar 高亮用 `MINEON` 直接改 class。
* 脚本开头加 `am force-stop`：上一轮把 app 留在主屏时 `am start --display` 只回一句
  「delivered to currently running top-most instance」，app 不动，整轮截图全是桌面
  （症状：唯一图片数 3/4 然后 die）。`SHOT_WAIT=3`：`am start` 立刻返回，载荷在 app 里异步跑。

**闸门①e（Tony 的要求）**：导出表的右值必须是 app.js 里真存在的标识符。`exportJSON` 那笔说明
缺的不是那一个名字，是这条检查本身 —— 闸门① 只查「handler 名 ⊆ 导出表 key」，表体里
`exportJSON,` 的右值没人查，`node --check` 不查未定义标识符，于是「闸门全绿 + 真机全绿」的
历史提交里带着一个首屏 ReferenceError：**静态层对 module 求值期是盲的**。新闸门解析表体，凡
右值是裸标识符（简写 `{ api }` 与 `{ api: api }`）必须有 `function`/`var`/`let`/`const`/`class`/
`import` 声明（含顶层解构），否则列出名字 FAIL。反向实验：表里加一行 `foo: notDefinedFn` → 红。
这条给步骤 11 的「恒绿闸门审计」当证据。

**验收**
* 静态：`node tools/ui_test.js` 20 项全绿（新增闸门①d、①e 与闸门⑮ 的 components 名检查）；
  `node tools/ui_sig_test.js` 84 项 ok；`(cd go && go test ./...)` ok；`sh -n test.sh`；
  `node --check` 逐个新 JS。
* 真机：`GO_TEST=1 ./build.sh && ./install.sh && sh $TMPDIR/restart.sh && ./test.sh --vd`
  全绿（套件项数见 CHANGELOG 数字行）。本步新增的三遍都在绿跑里出过数：
  `vdiff_tab mine` 未加载 `isvue=1 stats=0 skel=1 same=1`、夹具遍 `stats=6 chips=2 same=1 len=7079`；
  `vdiff_sheet settings form` `isvue=1 mounted=1 sinputs=6 ssegn=3 ssw=2 skv=10 sacts=3
  kind=settings same=1 len=3881`；SET 用例 26 个探针全过（含 `closeBtn=1 closed=1 notesKept=1
  themeRestored=1`）。
* 反向实验七条（见 CHANGELOG）：三条闸门红 + 一条 go test FAIL + 三条真机红（`exportJSON`
  未定义、`StatsKv` 引用、`closed=0` 的按钮选择器写错）。
* 视觉：`tools/shots_vue.sh` 14 张（新增 `vue-stats-light/dark`、`vue-settings-light/dark`，
  步骤 10 四张唯一数 4/4），图归 Tony 审。

**记入后续步骤的账**
* 步骤 11（已做，见 9.17）：删遗留渲染器时连 VDIFF 的基准与 `vdiff_tab`/`vdiff_sheet` 一起删
  （基准没了就是恒绿闸门），`tools/ui_sig_test.js` 的 84 项签名并进 `ui_test.js` 后删掉那个文件；
  「恒绿闸门审计」把 `exportJSON` 这笔当证据（静态层对 module 求值期是盲的 → 闸门①e 补上）。
* 步骤 11：`clipParse` 走真 LLM（几十秒且依赖 key），CIT 只测到按钮文案与勾选联动，
  「一键解析 N 条」真解析路径与 `clipError` 分支仍无客户端回归。
* 步骤 12：OCR 搜索断言收紧（现在只断言命中数，不断言命中内容）。
* 步骤 13：hex 8→0、px 57→0 的棘轮收尾 —— **扫描范围要一起扩到 `js/**`**（闸门③ 只扫
  `go/ui/css/**`，Vue 模板里的内联 style 现在看不见，见 9.17）；截图夹具 vds-a/vds-b 用同一段
  字节导致「两张图」在像素上不可分（步骤 11 已改成各自 `make_test_png.py` 现造）。

### 9.17 S3 步骤 11 已完成（Austin：删光遗留 JS 与 sigOf，静态闸门 3→2）

**删掉的东西**（这一步只做删除与合并，不加功能）
* `go/ui/js/app.js` **2499 → 1986 行**（−513）：`render()` 变成 Vue-only（注册表里没有的 tab
  直接 `console.error` + `markReady()`），`shotSheet`/`loadShots`/`shotPick`/`shotSelAll`、
  `folderSheet`/`loadFolders`/`folderPick`/`folderSelAll`/`folderPickShots`/`folderFilter`、
  `clipSheet`/`loadClips`/`clipPick`/`clipSelAll`、`settingsSheet`/`settingsRefresh` 里的
  `VUE_SHEETS.*` 分支全部拆掉（`settingsRefresh()` 现在就是 `return sheetPaint()`）；
  `__enote.legacy`（VDIFF 的基准缝）与 `afterPaint` 整块删除，导出表 69 → 67 key
  （`renderMineHTML` / `settingsHTML` 随实现一起没）。
* **47 个只有死代码引用的函数**分两批删（可达性不动点扫描：根 = 导出表 ∪ `setHost` ∪
  内联 handler ∪ 模板里的 `H.xxx` ∪ 顶层语句；注释里的名字算引用，所以只会漏删不会多删）：
  `buildPage` `shotCountLabel` `openTodoFromMissed` `missedBanner` `shotBanner`
  `folderListHTML` `folderSheetHTML` `folderCountHTML` `folderRows` `folderSelCount`
  `clipBanner` `clipPrevHTML` `clipThumbHTML` `clipMetaHTML` `clipItemHTML` `clipListHTML`
  `clipSheetHTML` `renderNotes` `renderTodos` `renderFiles` `renderMine` `renderSettings`
  `fileStrip` `filesSkeleton` `attachCardHTML` `statsHeroHTML` `statsRunCardHTML`
  `chartHTML` `statHTML` `settingsHTML` `shotGridHTML` `shotSheetHTML` `shotCountHTML`
  `clipCountHTML` 等；`setHost` 同步摘掉 `chartHTML` / `statsRunCardHTML` 两个叶子
  （**`clipCountHTML` 必须留**：`views/clip.js` 的 `countHtml: live(() => H.clipCountHTML())`
  还在用，删了闸门⑮ 立刻红 —— 这条是反向实验验出来的）。
* **`sigOf` → `stateSig` + `SIG_SKIP` 排除表**（契约翻转，见下）。
* `test.sh` **2733 → 2351 行**（−382）、`step` 34 → 30：VDIFF 整段（两个 step + `vdiff_tab`
  + `vdiff_sheet` + 全部调用）删除，剪贴板页的 VDIFF 三步合并成「夹具 + 真点击交互」一步，
  附件页两次 `vdiff_tab files` 删除（夹具/空态的 DOM 断言保留成独立断言），
  设置页载荷的 `legacy=` 探针与 `assert d["legacy"]=="1"` 随缝一起删。
* `tools/ui_sig_test.js`（645 行、84 项）**删除**，签名段整体并入 `tools/ui_test.js`
  （1066 → 1679 行）；`test.sh` 里两个 node 步骤合成一步
  「ui: 静态闸门（轮询指纹 / 内联 handler 存在性 / 调色板一致性 / hex·px 棘轮）」
  → **静态闸门从三份减到两份**（`ui_test.js` + `go test`）。

**契约翻转：手工挑字段 → 整份序列化 + 排除表**
原 `sigOf` 手工挑要参与指纹的字段，漏一个就是静默不重绘（踩过 `info.shot` 漏了 →
首页横幅永不出现）。`stateSig` 反过来：`JSON.stringify([notes, info(去掉排除表), settings,
截图开关])`，只维护一张 `SIG_SKIP = {uptimeS, tz, go, dir}` 排除表。代价是「列表不展示的
字段变了会多画一次」——多画一次是可见的、Vue 的 patch 很便宜；漏字段的不重绘是静默的。
`/api/state` 里 `uptimeS`/`queue`/`clip`/`shot`/`server`/`go`/`tz`/`ocrReady`/`dir` 九个字段
只有 `shot`/`server`/`ocrReady`/`queue` 参与界面，其余进排除表。

**`go/web_test.go` 的遗留禁令**（新增，防「删掉的死代码被谁救回来」）：
`TestIndexServedFromDirectory` 断言 app.js 里不得出现 `function buildPage` / `buildPage(tab)`
/ `function sigOf` / `__enote.legacy` / `legacy: {`。

**19 条反向实验全红得对**（`.test/s11_neg.sh`，脚本开头一次性备份 10 个文件到 `$TMPDIR/s11neg`，
`trap ... EXIT` 恢复，绝不用 `git checkout`）：签名段 6 条（排除表去掉 uptimeS / 清空排除表 /
指纹不含 notes / 不含 settings / 不含截图开关 / 不含 info）、`go test` 禁令 3 条（sigOf 回来 /
legacy 缝回来 / `buildPage(tab)` 回来）、结构闸门 10 条（载荷调闭集外的 `settingsSheet` /
导出表右值不存在 / 内联 handler 指向不存在的函数 / 模板 handler 总数掉到基线下（须删 2 个，
删 1 个刚好等于基线 73）/ 模板用 `setHost` 外的名字 / css 裸 hex / css 裸 px / 顶部 banner
顺序 / 组件没暴露 `H`）。**其中「指纹不含截图开关」第一版没抓到**：签名段根本没有 SHOTFLAGS
的行为断言（`SHOTFLAGS` 只是被 eval 的 `stateSig` 闭包到的一个夹具常量）—— 补了三条
（文件夹数变化要重绘 / 开关变化要重绘 / 改回来指纹也改回来）才红得对。

**本步查出的两处静态层能力边界（记进步骤 13）**
1. **闸门③ 的 hex/px 棘轮只扫 `go/ui/css/**`**：Vue 模板与 app.js 字符串里的内联
   `style="color:#123456"` / `width:999px` 它完全看不见（实验验出：模板里加裸 hex/px 闸门全绿）。
   步骤 13 要把 hex 8→0、px 57→0 收尾，扫描范围必须一起扩到 `js/**`，否则「棘轮归零」是假的。
2. **组件里把 `live(() => …)` 换成普通函数，静态闸门全绿**（真机那条交互用例才抓得到）：
   computed 没依赖就永远缓存，症状是「点了没反应」。闸门⑮ 只查「渲染路径引用了 tick」，
   一个组件里剩一个 `live` 就满足。

**Tony 审计清单（步骤 8–10 的账，本步记账）**
* 恒绿闸门审计以那 19 条反向实验为证据；`exportJSON` 那笔证明**静态层对 module 求值期是盲的**
  （闸门①e 已补）。
* `prefPayload` 的 `done:'all'` 分支没有客户端回归（只有 Go 侧测到）。
* 断言里应显式写出 `src` / `status` / `pri` / `kind`，不要只断言数量。（步骤 12 收了按钮文案那一半，
  步骤 14 的 §9.20 ② 收完 `kind` / `src` / `status`。）
* 闸门⑮ 的 tick 扫描本步已扩到 `js/**` 全部模板（含 `components.js`）：扫的模板 20 → **25**。
* `tools/shots_*.sh` 的 md5 唯一数自检不得空过：已核实 `[ "$n" -ge 4 ] || die`，glob 不匹配时
  `n=0` 会 die，不是空过。
* 截图夹具 `vds-a.png` / `vds-b.png` 以前都 `cp` 同一个 `$IMG`（`.test/ocr-test.png`）→
  字节相同，「两张图」在像素上不可分。本步改成各自用 `tools/make_test_png.py` 现造
  （掺随机噪点带 → 字节必不同）。
* SIT 里 `q()[0].click()` 这类索引选择器应换成稳定 id（步骤 12/13 顺手做）。

**本步 HEAD 的验证**：`node tools/ui_test.js` 111 ok / 0 FAIL、`(cd go && go test ./...)` ok、
`node --check go/ui/js/app.js` + `bash -n test.sh` ok、`.test/s11_neg.sh` 19 红得对 / 0 没抓到；
真机 `GO_TEST=1 ./build.sh && ./install.sh && sh $TMPDIR/restart.sh && ./test.sh --vd`
**30 步全绿**（EXIT=0，0 FAIL，0 skip；`  ok` 行 69 → 146，因为静态闸门步骤现在把 111 项
node 断言逐行内联打印，删掉的 VDIFF 三步 + 两次 `vdiff_tab files` 共 −14 项真机断言）。

**Tony 审查打回一次：真机套件两次跑一次红一次绿（764686b525，同一 apk 同一设备）**
红的那次是附件页交互用例：`test.sh` 断言 `FA.loaded 仍是 false：filesNow() 没拉到数据`
（日志 `$TMPDIR/t11v.log` 末尾）。根因在测试而不在产品：附件页那三块载荷都是**单发一次
`await filesNow()` + 固定 sleep 就直接断言**，而 `app.js` 的 `filesNow()` 用
`var my = ++searchSeq` / `if(my !== searchSeq) return` 丢弃过期结果 —— `searchSeq` 是**服务端
搜索共用的序号**，套件里前后步骤都在 `am start`、切 tab、写数据，只要期间 app 自己触发了一次
refresh/搜索，测试 await 的那次结果就被整次丢掉，`FA.loaded` 永远停在 false。绿的那次只是
没撞上。已修：FLOAD / FINT / FEMPTY 三块都改成轮询（照剪贴板横幅那条的写法，最多 12 次、
每次 250ms，每次重新发起 `filesNow()`，轮询到目标状态才继续；超时才 fail，并把 `tries=`
打进日志和断言消息，红的时候能一眼看出是「没拉到」还是「拉到了但 DOM 不对」）。

**「单发 await + 固定 sleep 再断言」这一族的审计（步骤 12 一次性收）**
标准写法是 test.sh:819 剪贴板横幅那条（`while(i<12){ await refresh(true); if(...) return i;
await sleep(250); i++; }`）；下面是本步 HEAD 剩下的同类，按危险程度排：
1. **文件夹弹层（test.sh:1180–1183）**：`folderSheet()` 后固定 `sleep(400)`，然后
   `rows()[0].getAttribute("data-path")`（1190 行）直接取第一行 —— 服务端文件夹列表慢一点就是
   `Cannot read properties of undefined` 载荷抛异常，红得没有信息量。
2. **截图弹层（test.sh:1339–1354）**：`shotSheet()` 后固定 `setTimeout(...,1200)`，然后
   `__enote.state.shotList[0].id`（1349 行）直接取 —— 同上（夹具是刚 share 进去的，最容易慢）。
3. **设置页 SET（test.sh:1602–1653）**：点击后固定 `sleep(400)`~`sleep(900)` 再断言，
   保存/开关是服务端往返，慢设备上是假红；没有任何轮询。
4. **TINT（test.sh:2036 / 2047）**：`toggle` 后固定 `sleep(1700)`（LLM 往返），网络慢必假红。
5. **NINT（test.sh:1871 / 1877）**：`await A.refresh(true); await sleep(500)` 与一处轮询混用，
   轮询那条（`cards()<n0`）是好的，固定 sleep 那两条同类。
6. **SIT（test.sh:1726）**：列表到位用了轮询（好），但点击后是固定 300ms；`q()[0]` 这类索引
   选择器另记（见上面的审计清单）。
**轮询闸门不是恒绿（`.test/s11_flake_neg.sh`）**：把 `app.js` 的 `filesNow()` 里
`loaded:true` 改成 `loaded:false`（服务端拉到了数据但 `FA.loaded` 永远是 false，正是竞态的表现），
真机套件必须红，而且红在「filesNow() 轮询 12 次没拉到数据」这条消息上 —— 实测
`AssertionError: FA.loaded 仍是 false：filesNow() 轮询 12 次没拉到数据`，EXIT=1。脚本开头一次性
备份 `app.js` 到 `$TMPDIR/s11fix`、`trap EXIT` 恢复，不用 `git checkout`。

产品侧同一类（**记进步骤 13**）：`filesNow()` 的 `searchSeq` 与 `statsNow()` 的 `stBusy` 都是
「一次在飞请求被抢占/卡住 → 这一页此后不再刷新」，用户侧症状是附件页/我的页停在骨架屏，
只能切走再切回来。测试侧轮询只是把症状盖住，产品侧要单独修（抢占后允许重试 / `stBusy` 加超时）。

### 9.18 S3 步骤 12 已完成（Austin：OCR 搜索断言收紧 + 「单发 await + 固定 sleep 再断言」整族换轮询）

**为什么先收紧搜索断言**：搜索用例的关键词是 `取快递`，OCR 坏掉也照样绿 —— 分享图片时 LLM 会把
图上的字回抄进标题/正文/待办（实测 title `取快递取件码 U7VQH4QM`、todo `取快递（取件码：…）`），
「命中」根本不证明本地 OCR 路径工作过。断言必须**只能由图片文字满足**。

**新步骤「share 现造的随机串图 → 本地 OCR 逐字读出」（test.sh:415）**
* 图不来自仓库，是 app 自己在 WebView 里用 canvas 现画的：1200×320 白底，`bold 100px sans-serif`
  一行「取快递 + 8 位随机串」，再加一行 48px 说明文字。随机串字符集
  `ACDEFGHJKLMNRTUVWXY34679` —— 去掉 OCR 易混的 0/O、1/I/l、2/Z、5/S、8/B，**也去掉 Q**：
  真机第二遍跑到 `RS=HEQKYTE4`，本地 OCR 读出 `HEOKYTE4`（84px 下 Q 的尾巴丢了，Q 与 O 不可分），
  同一轮把字号从 84px 提到 100px、画布从 900×300 加宽到 1200×320。逐字比对才有意义。
* PNG 的 base64 走 testlog 分片回传（logcat 单行上限约 4KB，1200 字符一片，实测 34276 字符 /
  29 片），python 侧拼片 + 校验 `len=` 与 PNG magic，落盘 `.test/ocr-rand.png`（已加 .gitignore），
  拷进 inbox 后走 ShareActivity 分享 —— 与用户真实路径一致。
* 断言 `source=='share-image' && ocrMs>0 && 随机串 in ocrText`：逐字读出才算过。
  实测 canvas 32086 字节的图、OCR 26 字符 / 394ms。
* 载荷用 `ENOTE_RS` 环境变量注入随机串（shell 单引号里的 `$VAR` 不展开），载荷行以
  `' > "$TMPDIR/jsocr.json"` 结尾，闸门② 才扫得到它。

**搜索断言收紧成三条 + 一条反向对照（全在服务端字段归属上）**
* `q=<随机串>&src=text` → **0 命中**
* `q=<随机串>&src=image` → **恰好 1 条**，且 `where` 标签必须是 `来自图片文字`
  （`go/search.go:60-68` 的字段标签，`来自图片文字` = `n.OCRText`）
* `q=<对照组随机串>`（同一张图上没有的串）→ **0 命中**：反向对照，证明搜索不是「搜什么都命中」
* 为什么不断言「关键词不在正文」：实测做不到（LLM 回抄）。可证的是**字段归属**：同一个词
  `src=text` 查不到、`src=image` 查到并标为 `来自图片文字`。
  §9.17 审计「断言里应显式写出 src / status / pri / kind，不要只断言数量」这条一并收掉。

**「单发 await + 固定 sleep 再断言」整族换轮询（§9.17 审计 1–6 全部收掉）**
* 55 处替换（`.test/s12_poll_a.py` 23 处 / `.test/s12_poll_b.py` 31 处 / `.test/s12_poll_c.py` 1 处），
  覆盖文件夹弹层、剪贴板弹层、截图弹层、截图夹具载荷、设置页 SET、Notes NINT、Todos TINT、
  附件页 FINT、错过的提醒面板。统一助手
  `poll(f,n,ms)`（**必须 `await f()`**：NINT 传的是 async 谓词，不 await 时 Promise 恒真，轮询第一次就返回）；
  每处打出 `tXxx=` 的尝试次数，红的时候能一眼分清「目标状态没到」和「到得慢」。
* **目标状态必须和它下面那条断言同源**，两次真机假红都是这条：
  1. 错过的提醒面板轮询 `open` 状态 —— 状态先变、Vue 的 patch 在下一拍，于是
     `sheet=true` 红在「跳笔记之后面板没关掉」；改成轮询「open 增加 **且** `#sheet` 的 on 类摘掉」。
  2. 设置页轮询「toast 非空」—— 上一条用例切主题的 toast 要挂 ~2s 才自己收，轮询立刻满足，
     断言读到旧文案红在「点保存没得到「已保存」（toast='主题：亮色'）」；改成轮询「文案里出现
     已保存」。附件页预览 toast 同理（轮询 on 类 + 文案含「预览即将上线」）。
* 转换器都是原子的（锚点全部命中才写文件，每处 `count==1`）。踩到的锚点坑：末行是**半行**的锚点
  （`L("toast="` 这种后面还有代码）不能带结尾换行 —— 第一版带了，把 NINT 的一行注释劈成两行，
  靠闸门② 编译载荷才抓到；两个转换器都加了 `align()` 自动剥掉。
* 固定 sleep 剩下的都是**轮询循环体内**的 `await sleep(...)` 与探针链的 `setTimeout(probe,…)`，
  不是「睡一觉再断言」。

**闸门② 的载荷提取补盲**：正则以前只认 `)}))'` 紧跟的写法，canvas 载荷是 `.replace(...)` 形式，
扫不到就等于不编译（16 个载荷只守 15 个）。现在两种都扫：**jseval 载荷 15 → 16、闸门⑯ 的
jseval 调用点 13 → 14**。

**两条反向实验**
* `.test/s12_neg.sh`：把画进图的随机串换成固定串（断言仍用本次随机串）→ 套件必须红在
  「OCR 没能在现造的图里读出 …」。实测 EXIT=1，红在该行；脚本用 `$TMPDIR/s12neg/test.sh.bak`
  备份/还原，不用 `git checkout`。
* `.test/s12_poll_neg.sh`：把产品侧 `toggleAI` 的「翻转 useAI」半句去掉（DOM 的 on 类照旧变，
  只有状态桥不动）→ `tFlip` 轮询必须超时（`tFlip=-1`）、`aiFlip` 必须为 0，套件必须红在
  「点启用 AI 开关后 class 与 settings.useAI 没一起翻」。app.js 是 go:embed 进二进制的，
  脚本前后各 build + install 一次，跑完把干净 apk 装回设备。

**本步 HEAD 的验证**
* `node tools/ui_test.js` **111 ok / 0 FAIL**（jseval 载荷 16、闸门⑯ 的 jseval 调用点 14、
  裸 hex 8 ≤ 8、裸 px 57 ≤ 57）、`(cd go && go test ./...)` ok、`bash -n test.sh` ok。
* 真机 `./test.sh --skip-build --vd` **连续三次全绿**（`$TMPDIR/t12e.log`、`t12f.log`、`t12g.log`，
  都是 EXIT=0，`  ok` 146 → **149**：新步骤 1 行 + 随机串搜索断言 1 行 + 对照组 1 行。
  前两次是「轮询目标状态」修完之后，第三次是 `notes[0]` 竞态修完之后）。
* 轮询尝试次数都在个位数（`tRows=1 tPaint=0 tAll=1 tNone=1 tFake=1 tBack=1 tJump=1 tAnim=0
  tGone=4 tDismiss=0 tList=1`）—— 轮询比原来的固定 sleep 更快，不是靠多等换稳定。
* 反向实验：`.test/s12_neg.sh` 把画进图的随机串换成固定串 → 套件红在
  「OCR 没能在现造的图里读出 CRW9XRGX」（EXIT=1，test.sh 自动还原）。
* 外层等 `done=1` 的循环上限从 20–60 放宽到 90–120（成功即 break，正常路径一秒都不多等）：
  载荷内部换轮询后最坏耗时变长，实测把 `toggleAI` 的翻转去掉，`tFlip`/`tFlipBack` 各超时 10s，
  套件红在「SET 载荷没跑完」这种没有信息量的行上；放宽之后红在该红的断言。
* `.test/s12_poll_neg.sh` 的产物：`tFlip=-1`、`aiFlip=0`，套件红在
  「点启用 AI 开关后 class 与 settings.useAI 没一起翻」（EXIT=1，实验脚本退出码 0）。
  app.js 是 go:embed 进二进制的，脚本前后各 build + install 一次，跑完把干净 apk 装回设备。
* **本步自己引入的竞态**（负向实验连撞两次）：新步骤刚 share 的图 OCR 先回、LLM 还在解析，
  解析回来整份重写 todos，`todo add / toggle / delete` 用例取的是 `notes[0]`，
  于是红在「the toggled todo is not what we wrote」。改成取 `status=="done"` 的那条笔记。
  教训：**新增一条会产生笔记的步骤，等于把后面所有 `notes[0]` 的语义换掉了**。

### 9.19 S3 步骤 13 已完成（Austin：竞态与超时、棘轮清零 + 闸门③ 扩到 js、sheet 生命周期、窄屏计数）

**这一步收的是 §9.17/§9.18 明写「记进步骤 13」的四笔账**，加一笔测试侧的收尾。四笔都是
「闸门还在、账本已经不管这一页」那一类：不是新 bug，是防线的覆盖范围落后于代码形态。

**① 产品侧竞态：一页一序号 + 请求超时 + 骨架屏可重试（`dec562b`）**

`filesNow()` 用服务端搜索共用的 `searchSeq` 做抢占判定 —— 笔记页搜索一在飞，附件页这次请求的
结果就被整次丢掉（`if(my !== searchSeq) return`），`FA.loaded` 永远 `false`，附件页停在骨架屏，
只能切走再切回来。`statsNow()` 的 `stBusy` 同类：它没有超时，一次永不返回的 fetch（真机撞过：
WebView 进后台再回来，在飞的 fetch 永不 resolve）把我的页永久钉在骨架屏。§9.18 的测试侧轮询
只是把症状盖住，这一步修根因：

* `filesSeq`（附件页自己的序号），`filesNow()` 不再碰 `searchSeq`；`searchNow()` 继续用 `searchSeq`。
* 新增 `apiTimeout(path, body, ms)`（`REQ_TIMEOUT_MS = 12000`）：超时只放弃等待，**不取消** fetch
  （结果被丢弃即可，序号判定照旧有效），三个页面数据源（`filesNow`/`statsNow`/`searchNow`）都改走它。
* 失败要留下可观测状态：`FA.error = errText(e)`（`'加载超时'`/`'加载失败'`）、`stErr`、`srErr`；
  骨架屏上给出文案 + 「立即重试」按钮（`H.filesNow()` / `H.statsNow()` / `H.searchNow(true)`），
  附件页另加自动重试 `filesRetry < 2`（退避 1.5s/3s）。`stBusy` 加 `stSince` 时间戳兜底：
  超过 `REQ_TIMEOUT_MS + 2000` 就允许下一次，卡死不再永久。
* **闸门⑰**（`tools/ui_test.js`）钉住这三条不变量：函数体用 `body('async function filesNow(){')`
  切片（签名改了就直接报「闸门⑰ 找不到 filesNow()」，不许静默空跑），检查 `++filesSeq` /
  不出现 `searchSeq` / 走 `apiTimeout` / `error:errText(e)` / `setTimeout(filesNow`，
  以及三个模板里 error 状态可见可点。
* **真机 FPRE**（`test.sh`，接在 FLOAD 之后）：附件页请求在飞时并发发起笔记页搜索，断言
  `FA.loaded=='true'` 且 `fa=='0'`。目标状态与断言同源：夹具是 `vue-files-fixture.pdf`，
  所以 `kind=image` 一定 0 条；被抢占时 FA 停在上一份（`loaded=true, fa=1`）或停在骨架屏
  （`loaded=false`）。**反向实验验过**：把 `filesNow` 改回 `++searchSeq`/`if(my !== searchSeq)`，
  重新 build + install，探针给出 `before=0 after=0 loaded=false`（永久骨架屏），断言必红。
  第一版夹具类型猜错（以为夹具是 png，实际是 pdf）→ 真机红在「FA 里是上一份结果（fa=1）」，
  探针量出 `pdfitems=1 allitems=1 pngitems=0` 才定下用 `kind=image`。

**② 棘轮清零：hex 8→0、px 57→0，闸门③ 扫描范围扩到 `js/**`（`1e8dac1`）**

Vue 把结构搬进 js 之后，新样式越来越多写在 `style="…"` / `:style="'…'"` 里，而闸门③ 只扫
`go/ui/css/**` —— 内联样式完全在账本之外。

* 闸门③ 现在把 `js/**`（vendor 除外）里 `style="…"` / `:style="'…'"` 的**内容**抽出来一起计数。
  只抽 style 属性，不整扫 js：整扫会把 `$('#fab')` 当成颜色（实测假阳性 `#fab`）。
  两条假绿自检：没扫到 js 文件、抽出来的 style 里一个 `var(--` 也没有 → 报红。
* 迁移由 `.test/s13ratchet.py` 做（锚点计数式，全部命中才写文件，11 个文件）。css 8 处 hex +
  57 处 px、js 内联 48 处 px 全部上刻度；刻度外的值就近归档：`9px→--s2`、`10px→--s2`、
  `11px→--s3`（padding）/`--r2`（radius）、`13px→--s3`、`13.5px→--fs-md`、`12.5px→--fs-sm`、
  `14.5px→--fs-base`、`23px→--fs-xl`、`38px→--fs-2xl`、`44px→--fs-display`、`15px/11px→--r2`、
  `19px→--r3`、`2px/3px/5px→--r1`（细条上半径自动夹到高度一半，视觉不变）、`1px→--hair`、
  `26px→--s5`、`56px→--s6`。新增 token：`--clear-bottom:104px`（body 96 与 #list 104 是同一个
  意思两个数，统一取大的）、`--on-solid:#ffffff`（彩色底上的白，明暗两档都是白）、
  `--mask-opaque:#000000`（mask-image 的几何参数，暗色下也必须是纯黑）。
* `.sheet .panel>h2` 的 `padding-right:38px` → `calc(var(--s6) + var(--s3))`（44px）：关闭按钮占
  `right:10px` + 32px = 42px，原来 38px 就已经会让标题钻到按钮底下。
* **闸门④ 把 app.js 的 meta theme-color 切换值纳入调色板一致性**（第 6 处调色板副本）：
  找不到那句 `mc.setAttribute('content', t === 'dark' ? …)` 就报「闸门④ 在假绿」。
* 三条签名断言改成 token 形式（页面留白 / 胶囊同高 / 待办竖条占位），迁移前后都绿。

**③ sheet 生命周期：开/关弹层都全量拆（`vue.js` + `app.js`）**

`pageSheetVue` 会把 `.panel` 的 innerHTML 整块换掉，而它只拆同名 sheet（`mountSheet` 里那句
`unmountSheet(name)`）—— 开过剪贴板页再开设置页，剪贴板那个 app 实例连同 effect / computed
缓存全留在表里，根节点已是游离节点，渲染永远到不了它。`closeSheet` 那边更糟：手写四个名字
（`shots/folders/clip/settings`），新增 sheet 忘了加就是静默泄漏。DOM 上看不出、截图上看不出，
只有 mount 表知道。

* `vue.js` 新增 `unmountAllSheets(keep)`：遍历 `sheetApps` 全拆，`keep` 是例外名单。
  进度层必须活过弹层（`shotsImported` 会先 `closeSheet` 再等 AI 解析完），它挂在 body 级的
  `#shotOvlRoot` 而不是 `.panel` 里，所以两处调用都是 `unmountAllSheets(['progress'])`。
* **闸门⑱** 钉住：`pageSheetVue` 与 `closeSheet` 都必须调 `unmountAllSheets(['progress'])`，
  且两处都不许再出现硬编码的 `unmountSheet('x')` 名单；找不到这两个函数就报「闸门⑱ 在假绿」。
* **真机 SLEAK**：`clipSheet()` → `settingsSheet()` 之后断言
  `Object.keys(__enote.vue.sheets) === 'settings'`（剪贴板那个必须已被拆），`closeSheet()` 之后
  断言表为空。反向实验：把 `pageSheetVue` 换回 `unmountSheet(name)` → 闸门⑱ 立刻红。

**④ 文件夹页底部计数的窄屏形状（步骤 8 记账）**

`.pfoot` 是 `display:flex`，`.count` 写着 `flex:1;min-width:0` —— 窄屏下它被压到比自己的文字还窄，
于是在「个已选 · 共」中间断行，按钮往上挤，看起来像坏了。现在 `.pfoot` 允许 `flex-wrap:wrap`，
`.count` 去掉 `min-width:0` 并加 `white-space:nowrap`：计数整条不许断，挤不下就让按钮连同 `.sp`
整条掉到第二行。真机实测（面板宽度探针）：300px 时 `countH=22`（行高 17，仍是一行）、
260px 时 `footH` 57→87（按钮换行、计数完整不裁不重叠）。`test.sh` 的文件夹页用例加了四条窄屏
断言（计数一行 / 不被裁 / 按钮不出条 / 不重叠），阈值取行高 1.6 倍：一行实测 21~22px，两行 40px+。

**④ 闸门⑮ 补 live()/普通函数双向契约（`287f4aa`）**

§9.18 记的这条：把 `H.xxx` 的 `live(() => …)` 换成普通函数 `() => …`，所有静态闸门全绿，
而模板按属性读它时渲染出的是函数源码（Vue 只对 computed ref 解包），用户侧就是
「点了没反应」/ 页面上出现一串 `() => …`。现在两个方向都钉：① setup() 返回里是普通函数
的名字，模板里必须以调用形式用；② 是 live()/computed 的名字，模板里不许当函数调
（computed 已解包，调它抛 not a function）。两个方向各做一次反向实验（notes.js 的
`srErr` 换普通函数 / 模板写成 `srErr()`），都红。

写这条闸门时先踩到**它自己的假绿**：组件扫描只认 `export const X = {…};`，而四个 tab 视图
是 `export default {…}`（文件以 `\n}` 结尾、无分号），一个也没扫到 —— 第一版反向实验
实测全绿才发现。现在两种写法都认，大括号用计数取平衡体（非贪婪正则会断在第一个嵌套 `}`），
一个组件也没扫到就报「闸门⑮ 在假绿」。

**⑤ 待办页筛选三态真点击回归（`3c026cf`）**

`prefPayload` 里 done 的「全部」特例（`PREF_KEYS.forEach` 里 `k === 'done'` 那个分支）
以前只有服务端覆盖：`search?tab=todos&done=all` 绿着，客户端这条路径没人点过。特例被删掉时
服务端给 todos 默认成 open，筛选面板里的「全部」就是个空操作。NIT 加第 5 段：造第三条夹具
并勾成已完成，真点击「状态」分组的 全部 / 已完成 seg（找不到按钮直接报「面板结构变了」，
不许空跑），断言三态：全部 = 未完成夹具在 + 已完成夹具也在；已完成 = 只有已完成夹具；
`resetPrefs` 之后回到「未完成」默认筛选（不恢复会污染后面所有用例看到的列表）。
闸门② 闭集加 `sortSheet` / `resetPrefs`（都是导出表里的 DOM handler）。

**⑥ `--tile-h:96px`（Tony 审查提出）**

附件缩略图方块高度原来在 `.athumb`（图片）与 `.aglyph`（文档图标底）各写一份 96px；
附件页是 grid、item 默认 stretch，两个数一旦分叉就是图文卡高度不齐。它跟 `--clear-bottom`
（内容让开 nav+fab 的底部留白）是两个概念，焊在一起会变成「改 fab 留白连带改附件卡高度」。

**⑦ `--toast-bottom:96px`（Tony 设备实测后定）**

`#toast` 的 `bottom:calc(96px + env(safe-area-inset-bottom))` 看着和 body 原来的 96px 同源，
实测是两个量：toast 底边距视口底 89.6px、tabbar 顶边 69.4px、body padding-bottom 104px。
toast 的约束是「让开 tabbar + 余量」，`--clear-bottom` 是「内容让开 nav+fab」；并进后者会把
toast 抬 8px、与最后一行内容的重叠从 ~23px 变 ~31px，还把浮层高度焊到内容 padding 上。

**⑧ 闸门⑲：弹层底部条的两种布局形态（Tony 审查提出）**

步骤 13 给 `.pfoot` 加的 `flex-wrap` 对 clip / shots 两个弹层**完全没生效** —— 它们的模板写的是
`<div class="pfoot" style="display:block">`，内联样式覆盖了 `.pfoot{display:flex}`。这不是 bug：
那两个弹层的计数是独立 block div，天然独占一行，走 flex 反而会让计数和三个按钮挤一行。
问题是「谁删掉这行内联样式」看不见差别（全宽下两种布局都放得下，窄屏才咬人），测试也不会红。
闸门⑲ 钉住四个 `.pfoot`：clip / shots 必须带 `display:block`，folders / 提醒面板必须不带；
反向实验（删掉 clip.js 那行内联样式）实测红。两个模板里各补一行注释说明为什么。

**⑨ 导出表补 `sortSheet`，闸门② 把闭集与导出表求交（Tony 定位）**

第 ⑤ 条的用例在真机上红：设备日志 `TINT ERR=sortSheet is not defined @ <anonymous>:158:7`。
`sortSheet` 是模块私有函数，靠 `$('#sortBtn').onclick = sortSheet` 挂到 DOM 上，从来不在
`window.__enoteActions` 里 —— 闸门① 只扇内联 `onclick="…"` 与 handler 字符串参数，这种
「DOM 赋值挂上去的函数」它管不到。闸门② 也抓不到：它只做两向检查（载荷引用 ⊆ 闭集、闭集 ⊆
引用），**从不把 `CLOSED_FN` 与闸门① 解析出的导出表求交**，「闭集里写了个导出表没有的名字」
正好落在盲区 —— 静态全绿，真机才红。现在补 `CLOSED_FN ⊆ 导出表`，红时列出缺的名字；反向实验
（导出表删掉 `sortSheet`）实测静态红。

同一轮还红在夹具计数：`L("made=…")` 写死 2，而第 ⑤ 条又加了一条夹具丙，`cleaned` 数的是
`fx.length=3` → 「造 2 删 3」。计数改成 `fx.length`，另加 `madeOK` 断言，断言不再依赖硬编码数字。

**跑全量验收时的设施约束（Tony 定位，步骤 13 踩过两次）**

`test.sh --vd` 开头抓一次 VD display id，`am_start` 会在 Permission Denial / does not exist
时重新解析并更新 `VDID`；但 **jseval 走的是 app 进程里的日志 hook，不认 display**。所以
「`ERROR: jseval 没跑完`」这种红通常是设施问题而不是产品问题：跑测期间另一个 agent 对同一个
包 `pm install`（app 进程被换掉）或 VD 被重建，在飞的载荷就永远不打印 done token。
全量验收期间不要并发 install；红了先看现场打印的 `--- per-display focus ---` 里目标 display
上还有没有本 app 的窗口。实测签名（Tony 抓到）：那一轮 VD id 已漂到 190，focus 打印显示
enote 在 **display 0**、VD 190 上是 launcher —— `am start --display` 落空时就是这个样子。
jseval 不认 display，所以载荷照样跑完、用例照样绿；红的时候这条现场是唯一能一眼分清
「jseval 真挂了」和「display 没了」的证据。

**记进步骤 14 的账**（步骤 14 已收，见 §9.20）

* SIT 里还有 `q()[0]` 这类索引选择器，DOM 顺序一变就测到别的元素；换成稳定 id。
* 断言要显式写出 `src`/`status`/`pri`/`kind`，不要只断言数量（§9.17 审计条目，步骤 12 收了一半）。
* `clipParse` 的真 LLM 路径与 `clipError` 分支没有客户端回归（现在只在 Go 侧测）。
* 260px 面板下 clip 弹层三个按钮文字被裁（「原样存为笔记」两侧切掉）：clip.js 给按钮写了内联
  `flex:1`/`flex:1.2`，`.btn` 左右 padding 16px 且没有 `min-width:0`。全宽实测三按钮一行放得下
  （footW=369、btnOverflow=0），只在 <320 CSS px 才咬人（Tony 审查记的 nit，非回归）。

## 9.20 步骤 14：稳定 id 定位、显式字段断言、clipParse 客户端回归、260px 底部按钮

§9.19 记进步骤 14 的四笔账全部收掉，另加一笔跑测设施账（它会让整族断言永远不可能通过）。

**① 索引选择器 → 稳定 id**

CIT（剪贴板弹层交互）与 SIT（截图弹层交互）以前都靠 `q()[0].click()` 点第一条。这类位置索引
的失效方式是**静默的**：列表加个表头、排序规则变了、上面多一条横幅，`[0]` 就指向别的条目，
点击照样有反应、计数照样变，断言全绿而测的已经不是目标条目。现在条目模板带稳定 id：

* `ClipItem` 根节点 `:id="'clipitem-'+x.id"`（`go/ui/js/views/clip.js`）
* `ShotItem` 根节点 `:id="'shotitem-'+x.id"`（`go/ui/js/views/shots.js`）
* `NoteCard` 本来就有 `:id="'n'+n.id"`（`go/ui/js/components.js`），这次开始用它定位

id 由服务端给的 `x.id` 派生，与 DOM 顺序无关。载荷侧统一走 `document.getElementById`，
并且**把「找不到」打成 token 输出**（`item0=found` / `no`），python 侧断言它必须是 `found`
—— 找不到元素时点击是空操作，不打印就是空跑。闸门⑳ 钉两侧：模板里那句 `:id` 在、
`test.sh` 里那串前缀在，任一侧被删掉就红（只删一侧时另一侧的 `getElementById` 永远返回 null）。

**② 断言显式写出 `kind` / `src` / `status`，不只断言数量**

§9.17 审计那条「断言要显式写出 `src`/`status`/`pri`/`kind`」在步骤 12 只收了按钮文案那一半。
这一轮收剩下两半：

* 剪贴板条目：断 `kind0`（夹具是 text）、`.cliprev` 文本 = state 里那条 `text` 的前 220 字、
  `.climthumb` 不出现、`.clipmeta` 含来源 app。`kind=image` 那一支真机夹具进不去（钩子只写文本），
  换成注入 `E.state.clipList=[IMG]` + `E.vue.clipPaint()` 走组件的输入路径，断缩略图文案是
  「图片 · <name>」（`clipThumbText` 的 name 那一半；剪贴板里的图片没有真缩略图）、不画文本预览、
  meta 带来源 app，画完换回夹具列表（`tBack` 断言它真换回，否则后面的删除断言在空跑）。
* 笔记卡片：NINT 恢复笔记后按稳定 id 找到卡片，断第一个 `.chip` 的文案 = `source` 经
  `srcChip` 映射的结果、第二个 = `status` 经 `statusChip` 映射的结果（done 那支断 `✦ AI` 前缀）。
  python 侧的映射表是 app.js 那两个函数的抄写，三处（app.js / 测试表 / 真机 DOM）对不上就红。

只数条数时这些失效全绿：`srcChip` 全画「手动」、`statusChip` 全画空、三条夹具全画成缩略图。

**③ clipParse 的三条客户端分支（原样存为笔记 / 解析失败 / clipError）**

步骤 11 删掉遗留字符串渲染器之后，这两支连「与遗留渲染器共用一份字符串」那层间接保证都没了。
进不去的原因一直是「fetch 在 WebView 里，测试侧没有让 Go 报错的通道」（步骤 11 原话：
「要补得先做注入假 fetch」）。这一轮补的是**产品侧的失败注入缝**而不是假 fetch：

```js
var API_FAIL = '';
async function api(path, body){
  if(API_FAIL && String(path).indexOf(API_FAIL) >= 0) throw new Error('injected failure: ' + path);
  …
}
// 文件末尾：__enote.test = { get failApi(){…}, set failApi(v){ API_FAIL = v || '' } }
```

默认空串 = 生产路径零影响；只认显式赋值。新步骤（`step "剪贴板导入的三条客户端分支…"`）用它跑四段：

1. **原样存为笔记**（`#clipRaw`，`raw:true`）：toast「已存 N 条笔记」→ 弹层关掉且 Vue 实例卸载 →
   服务端多出 N 条笔记，且 `source=="clipboard-text"`、`status=="raw"`、正文含那条剪贴板文本、
   `todos` 为空（证明真没调 LLM）→ 暂存区清空。
2. **解析失败**（注入 `/api/clip/parse` 抛）：toast「解析失败」，**弹层不关、勾选不丢、暂存区不消费**，
   注入那次没建笔记。清掉注入再点一次才得到「已入队解析 N 条」。
3. **一键解析（真 LLM）**：入队后按笔记 id 轮询到 `status=="done"` 且 `aiModel` 非空（`need_ai`
   门控，没 key 时 loud skip）。
4. **clipError**（注入 `/api/clip/list` 抛）：重开弹层 → `#clipList .empty` 出「加载失败」、
   `__enote.vue.host.clipError` 记下原因、条目数 0；清掉注入再开一次列表回来（失败不是终态）。

产品侧同批改动（两条都是这一步抓出来的真 bug）：

1. `clipParse(ai)` 以前不 catch 异常，`r.ok===false` 也不看，失败时照样
   `closeSheet()` + `clipSel = {}` —— 用户要点两次才能重试，第二次还得重开弹层重勾一遍。
   现在 catch 住、toast 出原因、**保持弹层与勾选**并 return。
2. `loadClips` 的 catch 只写 `clipError`，不落下 `clipLoading`；而模板的三态判定是
   `v-if="loading"` 优先于 `v-else-if="err"` —— 加载失败时界面永远停在「加载中…」，
   「加载失败」那一支是**死代码**（截图页的 `loadShots` 一直是两个一起写的）。
   只测 Go 侧时这层根本看不出来：Go 确实返了错，前端确实记下了错，而用户看到的是永久骨架屏。

**④ 260px 面板下弹层底部按钮裁字**

`.btn` 是 `white-space:nowrap` + `overflow:hidden`。flex 项的自动最小尺寸（`min-width:auto`）
**在 `overflow` 不是 `visible` 时退化成 0**，所以 clip.js 写的内联 `flex:1`/`flex:1.2` 让按钮可以
缩到比自己的文字还窄，多出来的部分直接裁掉 —— 260px 面板下「原样存为笔记」两侧被切。
修法是显式把下限要回来，并让整行允许换行：

```css
.pfoot .btnrow{display:flex;gap:var(--s2);flex-wrap:wrap}
.pfoot .btnrow .btn{min-width:max-content}
```

clip.js / shots.js 的按钮行换成 `class="btnrow"`（内联 `flex:1` 保留，它现在只决定相对宽度）。
真机断言：把弹层压到 260px，三个按钮逐个量 `scrollWidth <= clientWidth`，并断 `flex-wrap:wrap`、
按钮数 = 3、文案含「原样存为笔记」（选择器失联时它是 0，不是「全没裁」）。

**⑤ 跑测设施：重置之后 `useAI` 是关的，整族 AI 断言永远不可能通过**

本轮的基线跑测红在「the shared text note was never parsed」。查下来设备 `settings.json` 里
`useAI:false`（多半是某次设置页测试中途被打断留下的），笔记全停在 `status:"raw"`，
而 `llm/test` 是 ok=1 —— 于是所有「等 LLM 解析完」的断言必红，红得完全不像设施问题。
`test.sh` 的重置段以前只清数据不动设置。现在重置时把 `useAI` 归位成 `true`（baseUrl + model
齐备时），基线打印带 `ai=yes`，基线断言不满足时单独给一条「重置后 useAI 仍是关闭…」的红话；
`ai_step_unhappy` 补第三支：`--no-reset` 跑测时 AI 开关是关的，loud skip 而不是判红。

**⑥ 跨轮泄漏：套件最后一次剪贴板写入必须是空（Tony 实测撞出来的）**

本步是全套最后一个往系统剪贴板写夹具文本的地方（`clipset "加载失败夹具 $CLIPFIX2"`），
base 的 clip 段以 `clipset ' '` 收尾（test.sh:1880），新 step 排在它后面，把那个收尾顶掉了。
因果链：剪贴板留着非空文本 → app 启动扫一次剪贴板、前台还有轮询会 `clipAdd` →
`/api/clip/clear` 确实把 `Clips` 置 nil 并 save（`go/clip.go:229`），但几秒内那条文本又被
重新暂存 → 下一轮的硬基线（test.sh:280「重置后基线不对 … clip=1」）必红。实测残留：
`{"text":"加载失败夹具 1795530583","app":"hook","createdAt":"2026-11-24T22:37:14"}`。

这类泄漏的坑人在**它不在本轮红**：写夹具的那一轮全绿，红的是下一轮开头一条与本步完全无关的
基线断言，看上去像设施抖动。修法（test.sh 新 step 末尾）：`clipset ' '` → `sleep 2`（等前台轮询
吃掉它，Go 侧 TrimSpace 后为空 → clipAdd 直接拒）→ `clip/clear` → `sleep 2` → **再读一次
`clip/list` 断它真的是 0**，不等就红在「本步收尾后剪贴板暂存区不是 0」—— 把跨轮泄漏变成
本轮末尾的红。规则记进 §9.4：**任何往剪贴板写夹具的步骤，收尾必须自己清空并断空**。

修这个的第一版写法自己中了自己的招：那段注释写成了 C 风格块注释。test.sh 是 `sh` 跑的，
行首的斜杠星是命令（glob）不是注释，test.sh:14 的 `set -eu` 下直接 **127 退出**，而
`bash -n` 完全看不出来（语法合法）—— 真跑到那行才炸，而且炸在套件最后几分钟，后面的收尾
与自证一条都不执行。新增闸门㉑：禁止 test.sh 行首出现斜杠星（JS 载荷里的都是缩进的），
同时钉住两处 `clipset ' '` 收尾与「本步收尾后剪贴板暂存区不是 0」那条断言 —— 这类坑靠
`bash -n` 守不住，只能静态扫。

**反向实验**

`.test/s14_neg.sh`（四条，逐条实测红）：

* `a` 把 `clip.js` 的 `:id="'clipitem-'+x.id"` 改成固定串 → 闸门⑳ 红（
  「列表条目的稳定 id 定位断了」）。
四条都实测过，红话逐条抄在这里（`$TMPDIR/s14neg/run-{b,c,d}.log`，实验脚本每次跑完会把干净
apk 装回去，所以四条互不污染）：

* `b` 删掉 `.pfoot .btnrow .btn` 的 `min-width:max-content` →
  `AssertionError: 260px 面板下底部按钮文字被裁（scrollWidth > clientWidth，实际 1,1,1）`。
  三个按钮的 `scrollWidth > clientWidth` 全为 1，正是用户截图里「原样存为笔记」两侧被切。
* `c` 去掉 `clipParse` 的 catch（回到步骤 14 之前：fetch 抛错没人接）→
  `AssertionError: 注入失败后没出「解析失败」的 toast（tFail=-1）：fetch 抛错时 clipParse 没有反馈`。
* `d` 删掉 `loadClips` catch 里的 `clipLoading = false` →
  `AssertionError: 注入 /api/clip/list 失败后没出「加载失败」空态（tErr=-1）：clipError 那一支断了`
  —— 这条就是上面那个死代码修复被回退后的样子，证明回归真的能守住它。

两条静态反向实验（闸门㉑，秒级，不用真机）：

* `e` 把收尾那段注释改成行首斜杠星 → `FAIL test.sh 顶层注释风格 / 剪贴板跳轮收尾断了：
  test.sh:2221 行首是 /* —— sh 里这是命令不是注释，set -eu 下 127 退出（bash -n 看不出来）`。
* `f` 把断空那行改成 `|| true` → `FAIL …：剪贴板夹具步的收尾没断空（找不到「本步收尾后
  剪贴板暂存区不是 0」）：泄漏会躲过本轮，红在下一轮的硬基线`。

**验收**：`node tools/ui_test.js` **118 ok / 0 FAIL**（新增闸门⑳㉑，㉑ 扫仓库全部 41 个 `.sh`）、
`(cd go && go test ./...)` ok、`bash -n test.sh` ok、`GO_TEST=1 ./build.sh && ./install.sh && ./test.sh --vd` 全绿
（交付 HEAD 上重跑：`sh ./test.sh --skip-build --vd` → `$TMPDIR/s14_head_green.log`：
0 FAIL / 0 ERROR，真机 `  ok` 156→**162**，step 32→**33**，`test.sh` 2800→**3294** 行）。
六条反向实验逐条实测红（见上）。

> 真机 `  ok` 这条计数会**随 AI 解析分支 ±1**：`test.sh:2140` 的 `ai_step_unhappy` 只在「笔记
> 停在 `status:raw`、需要补一次解析」时多打一条 ok（21:41 那次是 161，23:08 这次是 162）。
> 对数字时先确认走的是哪一支，不要把它当成回归。

## 9.21 Vue 迁移现状盘点（回答用户 2026-11-24 的提问，Tony 逐条核过）

用户问：「现在这个系统是不是已经由 Vue 替代了原来的纯手工撰写 WebView？」一句话答案：
**页面级的手工字符串渲染器（`*HTML()` / `render*`）已经整批删掉，那部分确实被 Vue 替代了；
没被替代的是外壳骨架与叶子 HTML 片段；WebView 宿主（Go 服务 + JS 桥 + 原生转发）与 Vue 无关，
一直是自研。** 下面每条都给了可自查的位置，数字是 `main = f6657f3` 上实测的。

**已被 Vue 接管**

* 注册表 `go/ui/js/app.js:1181` / `:1186`：`VUE_VIEWS = {notes, todos, files, mine}` +
  `VUE_SHEETS = {shots, folders, progress, clip, settings}` —— **4 个 tab + 4 个弹层 +
  1 个 body 级进度层**（`progress` 按 `app.js:1182-1185` 自己的注释「不是弹层而是 body 级的
  进度层」，共用 `mountSheet` 那张表），共用同一张注册表。
* `app.js:1203` 起 `render()` 只有 Vue 一条路径：注册表里没有的 tab 直接 `console.error`。
* 删除发生在 S3 步骤 11（§9.17）：`app.js` 2499→1986 行（−513）、47 个 HTML 字符串渲染函数
  分两批删、`__enote.legacy` 双路径基准缝删除、VDIFF 整段与 `tools/ui_sig_test.js`（645 行 /
  84 项签名）删除。
* Vue 是 vendored 全局构建 `go/ui/vendor/vue.global.prod.js`（v3.5.46，零构建步骤）；
  `index.html:232` 的 vendor 必须排在 `:233` 的 `type=module` 之前，`go/web_test.go:181-182`
  钉顺序、`:318-331` 钉 vendor sha256 与 `VENDOR.md` 一致。
* 闸门⑮ 实跑：Vue 视图 8 个、22 个模板过 vendored Vue 的 `compile()`（扫 25 个模板）、
  模板 handler 36 个全在导出表、视图里的 `H.xxx` 114 个全在 `setHost`。

**没被 Vue 接管（三条硬证据）**

> 2026-11-24 更新：下面的第 1、3 条已被 §9.22（S3 步骤 15）作废 —— 外壳（topbar / tabbar+fab /
> 弹层宿主 / 对话框 / toast）已转 Vue。第 2 条（Vue 只挂 pane 与弹层 body）现在多了外壳五个
> 挂载点。第 4 段「叶子片段仍是手工 HTML 字符串」仍然成立，是步骤 16 的活。本节按原样保留，
> 它是步骤 15 动工前的现状快照。


1. 外壳骨架是静态 HTML：`index.html:100-125` 的 topbar、搜索框、tabbar、fab、`#sheet`/`#panel`、
   自绘对话框、toast 全是静态标记；整个 `index.html` 里 Vue 指令只出现 1 次，还是 127 行注释里
   的文字，不是真指令。
2. Vue app 的挂载范围只有 tab 的 pane 与弹层 body（`go/ui/js/vue.js:25-29` 的 `mountView`、
   `:43-48` 的 `mountSheet`），外壳不在任何 Vue app 的根里。
3. 外壳由命令式 JS 驱动：`toast()` 用 `innerHTML` + `classList`（`app.js:120-122`）、开弹层
   `$('#sheet').classList.add('on')`（`:1436` / `:1453`）、主题切
   `document.documentElement.classList`（`:102-107`）。

**叶子片段仍是手工 HTML 字符串**（这是混合模式，规则写在 `go/ui/js/components.js` 顶部注释，
不是漏迁）：经 `v-html` 插入的分布是 `js/components.js` 19 处、`js/views/stats.js` 10 处、
`js/views/settings.js` 8 处（`app.js` 自己那 6 处 `v-html` 全是注释：815 / 970 / 1127 / 1311 /
1378，正是这套混合的现场说明）；这些片段带内联 `onclick` 走 window 全局函数而不是 Vue 的
`@click`（`app.js` 里 33 处，如 `onclick="folderPick('...')"`），`app.js` 里还留着 20 个
`function *HTML(` 叶子构造器。闸门报的「handler 总数 77（内联 31 + Vue 模板 46）」就是这个
混合状态。所以「`app.js` 2065 行的主体是数据/状态/API/事件」这句必须连着下半句读：**里面
仍住着那 20 个叶子片段字符串构造器与 33 处内联 `onclick`**，说它「不是渲染」是错的。

**用户可自查的两条判据**

```sh
grep -c 'v-html' go/ui/js/*.js go/ui/js/views/*.js   # 叶子片段还挂在模板上的位置
grep -c 'onclick=' go/ui/js/app.js                  # 内联 handler（走 window 全局，不是 @click）
```

## 9.22 S3 步骤 15 已完成（Austin：外壳转 Vue —— topbar / tabbar+fab / 弹层宿主 / 对话框 / toast）

**做了什么**：P13 剩下的最后一块手工区（§9.21 的「没被 Vue 接管」三条硬证据里的第 1、3 条）
搬进 Vue。新增 `go/ui/js/shell.js`（156 行）：一张 `shell` reactive 状态表 + 五个组件
（`TopBar` `TabBar` `SheetHost` `DialogHost` `ToastHost`）+ `mountShell()`。
`index.html` 237→224 行：静态外壳标记换成挂载点；`app.js` 2065→2122 行：
`toast()` `paintStatus()` `dialog()` `closeDlg()` `sheet()` `pageSheet()` `pageSheetVue()`
`closeSheet()` `setTab()` `moveInd()` 从命令式 DOM 写改成写 `shell` 这张表。

**外壳状态是 reactive 的，不是 tick 拉模型**。视图层（步骤 5-11）读的是 `V.tick` 计数，
因为 `S` / `MISSED` 这些是会被整体赋值的普通 `var`；外壳状态本来就是 `reactive()` 对象，
`shell.sheet.on = true` 一行，DOM 自己跟上，不需要 tick。这是数据层响应式在本项目第一次落地。

**挂载点分两类，理由记下来（下次包壳会踩同一个坑）**：

* 在流内的（`.topbar` 是 `position:sticky`、`.tabbar` 是 `position:fixed`）**挂在原元素上**，
  Vue 只渲染它们的内容。包一层 div 会让 sticky 的包含块变成那层 div（高度就是它自己），
  顶栏会跟着内容一起滚走 —— 布局上肉眼可见，但静态闸门看不见。
* 浮层（`.sheet` / `.dlg` / `#toast` 都是 `position:fixed`）挂在 body 级 `*Root` 容器里。
  Vue 的模板根元素是挂载点的**子节点**，`:class="{on:…}"` 绑不到挂载点自身，所以
  「显隐」这个类必须落在模板里的元素上，容器本身不带 class。

**顶栏显隐（我的页不显示顶栏）从 JS 写 style 换成 `body[data-tab]` + CSS**
（`css/views/shell.css` 加一条 `body[data-tab="mine"] .topbar{display:none}`）：
它是「当前在哪个页签」的纯函数，写在 CSS 里就少一处 JS 会漏同步的地方。选择器比
`components.css` 的 `.topbar` 更具体，层叠必赢，与闸门⑦（同一选择器+属性只能有一个家）不冲突。

**顺手修掉一个泄漏**：`sheet()`（字符串弹层）以前直接换 `.panel` 的 `innerHTML`，上一个 Vue
弹层的根节点就此游离 —— 与步骤 13 在 `pageSheetVue` 修掉的是同一个泄漏，只是这条路径没人查。
现在 `sheet()` / `pageSheet()` / `pageSheetVue()` / `closeSheet()` 四个入口都走
`unmountAllSheets(['progress'])`（闸门⑱ 的名单只有一份，进度层是例外）。

**测试契约**：产出的 DOM 逐字保持（id、class、元素顺序、内联 style）。三处契约跟着搬了扫描源：

* `tools/ui_test.js` 的「『记一笔』在底栏第三格（5 个按钮）」原来扫 `index.html` 的
  `<nav class="tabbar">`，现在扫 `shell.js` 的 `TabBar` 模板 —— 契约不变（fab 夹在 todos
  与 files 之间），只是真相换了个地方。
* `__enote.dom` 的五个元素从「模块求值期取一次」改成 getter：外壳节点是挂载之后才出现的，
  取一次存下来拿到的全是 `null`（`test.sh` 的 seam 用例读 `d.main.id` 会红）。
* `app.js` 新增 HOST 键 `brandGo tabPick fabAct searchInput searchClear closeSheet sortSheet
  dlgOk dlgCancel`（闸门⑮ 逐个查模板里的 `H.xxx` 在不在 `setHost`）。

**踩的坑（值得记）：`import { nextTick } from './vue.js'` 而 vue.js 没导出它**。
`vue.js` 内部一直是直接调 `Vue.nextTick()`，从没导出过这个名字；`app.js` import 它是
**module 解析期** SyntaxError —— 整份 `app.js` 一行都不执行，页面整块空白。旧闸门全绿：
`node --check` 只看单文件语法，闸门①⑮ 只看字符串契约，`go test` 不看前端。真机上是
启动自检的 probe 报「模块解析/加载失败：Uncaught SyntaxError … does not provide an export
named 'nextTick'」才看得见，而 probe 之后还要跑到 P6.6 才报红 —— 一次 build + install +
两分钟跑测才换到一句人话。

补法：**闸门㉒** 扫 `go/ui/js/**` 全部模块的具名 import，逐个查目标文件真导出了那个名字
（`export const/let/var/function/class`、`export { … }`、`export default` 三种写法都认），
顺带查相对路径的文件存在。反向实验实测红：把 `export const nextTick` 的 `export` 删掉 →
「app.js import 的 nextTick 不是 ./vue.js 的导出（module 解析期 SyntaxError → 整份脚本不执行、
页面空白）」；还原用的是备份文件，不是 `git checkout`（§9.19 那条教训）。

**数字**：闸门 116 → **119** 项全绿（新增 ㉒ import/export 一致性，13 个模块 67 处具名 import）；
handler 总数 77 → 88（内联 29 + Vue 模板 59，基线 73）；Vue 模板 22 → 27 个（扫描 25 → 30）；
视图里的 `H.xxx` 114 → 123 个全在 `setHost`；`index.html` 里 Vue 指令 0 处 → 外壳 5 个组件、
`index.html` 只剩挂载点。

**验收**：`node tools/ui_test.js` **119 项全绿**；`GO_TEST=1 ./build.sh`（含 `go test ./...`）绿；
`./install.sh` Success；`./test.sh --vd` **163 项 ok、0 FAIL、PASS**（基线 162，多的那条是闸门㉒）。

**真机验收抓到的两个问题（静态闸门全绿也拦不住）**：

1. **`#panel` 的 `data-kind` CSS 钩子断了**。步骤 15 之前面板是 `index.html` 里的常驻元素，
   `settingsSheet()` 里 `$('#panel').dataset.kind='settings'` 直接写 DOM 就行；面板归 Vue 之后
   它随弹层开合被创建/销毁，写在旧节点上的属性跟着节点一起没了 —— 设置页样式全丢
   （`test.sh`：「`#panel` dataset.kind 不是 settings（CSS 钩子断了）」）。
   补法：钩子进状态。`shell.sheet.kind` + `pageSheetVue(name, title, kind)` +
   SheetHost 上 `:data-kind="s.sheet.kind || null"`（空串时 Vue 不写属性，DOM 与迁移前一致）；
   `pageSheet`/`sheet` 开页时清成 `''`；`settingsRefresh()` 改读 `shell.sheet.kind`。
   **教训：凡是「调用方直接写 Vue 拥有的节点」的地方，都要改成写状态**，`dataset` 也算。
2. **CPAI（剪贴板一键解析）那一次是设备侧的 WebView JS 线程挂死**，不是这次改动：
   载荷停在 `failOff=` 之后，之后 6 分钟 app 的 2s 轮询一条都没打到 Go 服务，
   进程 CPU 0%、Java 主线程在 looper 里空转（`debuggerd -b` 看过），新送 jseval 也不执行。
   冷启动 app 重跑就绿。记在这里是为了下次别把它当成 Vue 的锅。

**顺带修的字符串弹层时序**：`sheet()` / `pageSheet()` 现在返回 `nextTick(...)`，
`missedSheet`/`sortSheet`/`showLog`/`showDebug`/`addSheet`/`addTodoSheet` 把那个 promise 传出去。
DOM 是 Vue 在 nextTick 画的，测试里 `missedSheet(); assert(有 .msrow)` 会读到空
（真机报「面板里没有行」）；`test.sh` 五处调用点跟着改成 `await`。

## 9.23 S3 步骤 16a 已完成（Austin：叶子 HTML 字符串 → 真组件，`v-html` 在核心视图清零）

**做什么**：步骤 5~10 混合期留下的最后一块非 Vue 代码是「叶子 HTML 字符串」——`app.js` 里的
`srcChip / statusChip / metaHTML / whereHTML / attachHTML / factsInner / factsBlock /
cbInnerHTML / todoTxHTML / todoRow / remindBtns / noteCard` 十二个函数，Vue 模板用 `v-html`
把它们插进去。当时必须这样：字符串渲染器与 Vue 两条路径要产出逐字一致的 DOM，叶子 HTML 只能有一份。
步骤 11 删掉遗留渲染器之后只剩 Vue 一条路径，字符串函数就纯属负担了：

* 模板里看不见真实 DOM —— 闸门⑮ 编译模板时那块结构是**一个字符串**，卡片少个 `.facts`、
  待办行少个 `.remind` 它都看不见；
* 事件写成字符串里的内联 `onclick="toCalendar('a','b',event)"`，绕过闸门①b（Vue 模板 handler）
  与闸门⑮（`H.xxx ⊆ setHost`），正是 P12「点了没反应」那一类；
* 每次重绘整段 `innerHTML`，`tickCD()` 那种「就地改 textContent」的小优化跟它抢同一个节点。

**新增 `go/ui/js/components/leaf.js`（13 个组件）**：`Ico`（sprite 图标，`<ico n="x" cls="s"/>`
≡ `ic('x','s')`）、`SrcChip`、`StatusChip`、`NoteMeta`、`NoteHits`、`NoteAttach`、`NoteFacts`、
`CdChip`、`RemindBtns`、`TodoDue`、`TodoPriChips`、`TodoTx`（待办页文字块）、
`TodoRowCompact`（笔记卡里的紧凑待办行）。消费方全部改成组件标签：
`components.js` 的 `NoteCard`（`<note-meta>/<note-hits>/<note-attach>/<note-facts>/
<todo-row-compact>` + `.acts` 五个按钮的图标）、`StripBar`/`MissedBanner`/`ShotBanner`/
`ClipBanner`（四个横幅的图标，`v-html` 里的 `&quot;` 转义一起没了）、
`views/todos.js` 的 `TodoRow`（`<ico>` + `<todo-tx>`）与 `.sec` 分组标题。
`app.js` 删掉 109 行；HOST 去掉这十二个名字，补上组件要读的算法
`now cdCls cdText toCalendar toAlarm`（`cdChip` 留着，字符串弹层 `missedSheet` 还在用）。

**三条翻译规则（写进 leaf.js 文件头）**：类名冻结（D15）要求 DOM 逐字一致，Vue 的
`whitespace:'condense'` 与字符串拼接有两处系统性差异 —— 元素之间的纯空白节点被删（原字符串里
那个字面空格要用 `{{ ' ' }}` 显式写出来），元素与文本之间的空格会保留成一个空格
（`ic('clock','s')+' '+fmtTime(...)` 直接写 `/> {{ … }}` 即可）；原来返回空串的条件分支
（`statusChip` / `cdChip` / `remindBtns`）在 Vue 里是注释节点，`v-html` 时代那里是空串 ——
注释节点不产生元素，等价。

**闸门⑮ 的一个坑**：它每个文件只取**第一处** `components: {…}` 当整份文件的注册表。
`leaf.js` 里最早用到子组件的 `CdChip` 定义在 `RemindBtns`/`TodoDue` 之前，那里写全量名单会撞
TDZ（速记属性是求值期读的）→ 全量名单写在文件头注释里（闸门扫字符串，注释也算），运行时每个
组件仍各自注册自己模板里用到的那些。`components.js` / `views/todos.js` 同理。
另一条：注释里不能出现 `components: {…}` 这种字面量（它会被当成注册表并查 `…` 有没有声明），
也不能出现 `` `srcChip()` `` 这种「整串是一个调用」的反引号串 —— 闸门①d 扫的就是这个形状。

**签名断言跟着搬**（`tools/ui_test.js`）：「关键信息」查 `<note-facts>` + `.facts/.fh/.fq/.fa`，
「写入系统日历 / 设为闹钟」查 `name: 'RemindBtns'` + `v-if="t.due && !t.done"` +
两处 `<remind-btns`。契约是「这块 DOM 真的在模板里」，字符串形态与组件形态都认。

**DOM 等价性怎么验的（VDIFF 在步骤 11 删了，没有逐字基准）**：新增两个开发期工具
`.test/probe_dom.sh` + `.test/dom_equiv.js`。前者把一份固定数据（`.test/equiv_note.json`：
带 facts、两个待办、两个标签、两个附件的笔记）注入真机 `S`/`SR` 并渲染，抓回三块 DOM
（笔记卡、卡内紧凑待办行、待办页 `.ttx`）；后者用 `git show HEAD:go/ui/js/app.js` 把**迁移前**
那批字符串函数抽出来在 node 里跑同一份数据，逐字比。归一化只允许四类，且每类都写了理由：
Vue 的 `<!---->` 占位注释、标签间空白、CSSOM 对 `style` 的序列化（`--i:0` → `--i: 0;`）、
以及「内联 `onclick` 属性消失」这条本次有意改动。结果：**三块全部逐字一致**
（卡 2495 字节 / 紧凑行 651 / `.ttx` 454）。
顺带修了探针本身：`am start` 从 Termux 直接发会被 Android 16 的后台启动限制挡掉
（logcat 里 `Background activity launch blocked`，`am` 自己还打印 `Starting: Intent`，看着像成功），
改成 `asroot_global "am start …"`，与 `test.sh` 的载荷通道一致。

**数字**：视图模板里的 `v-html` 从 60+ 降到 **51**（`notes.js`/`todos.js`/`components.js` 三个文件
已清零，剩下的在 `stats.js` 10 / `settings.js` 8 / `clip.js` 5 / `files.js` 5 / `app.js` 4 等
字符串弹层与统计页里）；`ic()` 调用 52 → 6（全在字符串弹层）；内联 `onclick` 21 处（全在
`app.js` 的字符串弹层：`sortSheet`/`missedSheet`/`addSheet`/`addTodoSheet`/`showLog`/`showDebug`）；
handler 总数 82（内联 19 + Vue 模板 63，基线 73）；导出表 68 个 key；闸门 **119** 项。

**验收**：`node tools/ui_test.js` **119 项全绿**；`GO_TEST=1 ./build.sh`（含 `go test ./...`）绿；
`./install.sh` Success；`./test.sh --vd` **163 项 ok、0 FAIL、PASS**（与步骤 15 基线逐条相同）；
`.test/dom_equiv.js` 三块 DOM 逐字一致。

**下一步（16b/16c）**：`stats.js`/`settings.js`/`files.js`/`clip.js` 的叶子片段（`kvHTML`、
`liHTML`、`statsNotesCardHTML`、`settingsCollectHTML` 等 15 个函数）→ 组件；然后把六个字符串
弹层翻成 Vue 弹层，删掉 SheetHost 的 `mode:'html'` 分支和最后 21 处内联 `onclick`。

## 9.24 S3 步骤 16b 已完成（Austin：统计页 / 设置页 / 附件页 / 剪贴板页 / 截图页 / 文件夹页的叶子字符串 → 真组件）

**做了什么**：16a 把核心视图（笔记卡、待办行）翻成真组件，剩下六个视图与两处弹层还在把
HTML 片段交给 `app.js` 的 `*HTML` 字符串函数、模板里一个 `v-html` 插进去。那些字符串函数是
步骤 10 的产物，当时的理由是「两条渲染路径共用同一份字符串，零漂移面」；步骤 11 删掉遗留渲染器
之后只剩 Vue 一条路径，理由消失，负担留下（同 9.23 的三条：模板里看不见结构、事件写成字符串里的
内联 `onclick`、整段 `innerHTML` 重画）。

**新增 `go/ui/js/components/blocks.js`（6 个整块组件）**：`StatsHero`（含 `.hero` 外壳）、
`StatsNotesCard`、`StatsRunCard`、`SettingsDataCard`、`SettingsRunCard`、`SettingsOcrCard`。
`leaf.js` 加 6 个叶子：`KvRow`（设置页/我的页满屏的 `.kv` 行）、`OcrReady`（OCR 就绪胶囊）、
`FileStrip`（附件页统计条）、`AttachGlyph` / `AttachMeta`（附件卡图标块与元信息行）、
`ClipCount`（剪贴板弹层底部计数条）。消费方：`views/stats.js`、`views/settings.js`、
`views/files.js`、`views/clip.js` 全部改成组件标签；`views/folders.js` / `views/shots.js`
的勾选框图标与底部计数条（`#folderCount` / `#shotFoot`）也一并从 `v-html` 搬进模板。

**`app.js` 删掉 17 个字符串函数**（`statsHeroInner` `statsNotesCardHTML` `ocrReadyHTML`
`statsRunRowsHTML` `statsRunInnerHTML` `kvHTML` `liHTML` `settingsDataCardHTML`
`settingsRunCardHTML` `settingsCollectHTML` `settingsOcrCardHTML` `settingsUsageHTML`
`settingsKeepAliveNoteHTML` `clipCountHTML` `fileStripInner` `attachMetaHTML`
`attachGlyphHTML`，净 −114 行），HOST 去掉这 17 个名字，加一个 `attachGlyphName(a)`
（原 `attachGlyphHTML` 只做「按 kind 查图标名再包 `ic()`」，前半是算法、后半是模板，
现在前半留作函数、后半是 `<ico :n="…"/>`）。设置页的采集卡与用法卡是纯静态文本，直接写进
模板，`v-html` 归零。

**`KvRow` 的三种形态（这一处返工了一次）**：迁移前的 `.kv` 行有三种拼法 —— 值是纯文本
（`esc(x)`）、值是带样式的元素（`<span style="color:var(--acc2)">…</span>`）、值是富文本
（`<b style="color:var(--bad)">`、OCR 胶囊）。第一版让插槽套在值 span 里面，DOM 多出一层
`<span>`，等价性工具立刻抓到（`<span><span>7</span></span>` vs `<span>7</span>`）。
现在三个分支各自直接当那个值 span：`vstyle`（样式落在值自己身上）/ 默认插槽（富文本）/
`v`（HTML 字符串，`v-html`）。教训：**插槽不是免费的**，它插进哪里就多一层什么。

**DOM 等价性（16b 版工具）**：`.test/probe_dom2_setup.sh` 分享一张 PDF 进来造真附件，
`.test/probe_dom2.sh` 读真机同一份状态（`ST` / `S.info` / `FA` / `clipList` / `clipSel`）
并抓 13 块 DOM，`.test/dom_equiv2.js` 用 `git show HEAD:go/ui/js/app.js` 抽出迁移前那批
字符串函数、在 node 里跑同一份状态逐字比。归一化在 16a 的四条之外加两条，都写了理由：
`style` 属性文本（遗留是字符串 innerHTML，Vue 解成对象再写 `el.style.cssText`，浏览器重序列化成
`margin-top: var(--s0);`，计算样式相同）、`uptimeS`（状态是探针开头 dump 的，DOM 是几秒后抓的，
秒数必然差）。探针自己的坑：`byText(".card", "Go 服务")` 会命中「设置 / 运行日志」那张卡
（它的副标题里有「Go 服务、解析队列、OCR 状态」），选择器要挑只出现在目标块里的字面量；
两次 dump 用同一个 key 会被 `Object.assign` 后者覆盖（我的页与设置页都叫 `runCard`）。
结果：**13 块全部逐字一致**（hero 469 B / 笔记状态卡 306 / 我的页运行卡 333 / 附件统计条 43 /
元信息行 46 / 图标块 81 / 剪贴板计数条 83 / 采集卡 332 / OCR 卡 307 / 数据卡 527 /
设置运行卡 401 / 用法卡 222 / 保活长说明 236）。

**数字**：模板里的 `v-html=` 属性从 **33 降到 7** —— 剩下的是 `shell.js` 三处（fab 图标、
弹层 `.pbody`、`.panel`，16c 处理弹层那两处）、`empty-state.js` 一处（Tony owner，按设计）、
`leaf.js` 一处（`KvRow` 的 `v` 兜底）、`shots.js` 一处（进度层 `warn` 是服务端 HTML 串）、
`app.js` 一处是注释。`ic()` 调用 app.js 27 处（全在字符串弹层）；内联 `onclick` 21 处（同样
全在 `app.js` 的六个字符串弹层）；handler 总数 81（内联 13 + Vue 模板 68，基线 73）；
导出表 68 个 key；闸门 **119** 项。

**验收**：`node tools/ui_test.js` **119 项全绿**；`GO_TEST=1 ./build.sh`（含 `go test ./...`）绿；
`./install.sh` Success；`./test.sh --vd` **163 项 ok、0 FAIL、PASS**（与步骤 15/16a 基线逐条相同）；
`.test/dom_equiv2.js` 13 块 DOM 逐字一致。

**下一步（16c）**：六个字符串弹层（`sortSheet` `missedSheet` `addSheet` `addTodoSheet`
`showLog` `showDebug`）翻成 Vue 弹层，删掉 `SheetHost` 的 `mode:'html'` 分支与最后 21 处内联
`onclick`，闸门① 的内联基线随之从 13 降到 0。

## 9.25 S3 步骤 16c 已完成（六个「字符串弹层」→ 真组件：排序筛选 / 错过的提醒 / 记一笔 / 添加待办 / 运行日志 / AI 调用记录）

**做了什么**：新建 `go/ui/js/views/sheets.js`（162 行，6 个组件），把 app.js 里最后一批
HTML 字符串弹层翻成真组件，并把弹层开合收敛成一条路径。

* `SortSheetView`（页面形态）：`group()` 的「label + .seg 按钮组」变成 `groups` computed，
  按钮文案是「图标 + 文字」的 HTML，所以按钮体走 `v-html="o[1]"`（迁移前是字符串原样插入）。
  `setPref` / `resetPrefs` / `closeSheet` 的副作用一个字没动 —— test.sh 的排序页用例是真点
  那些按钮（`#sheet label` 精确匹配文案 → `nextElementSibling` 找 `.seg` → 按 textContent 找按钮）。
* `MissedSheetView`（页面形态）：行结构复用待办页的 `.todo/.cb/.ttx`（类名冻结 D15），
  倒计时条用 `<cd-chip :tick="tick" :t="t"/>`，空态用 `<empty-state>`（它没有 tick prop，
  禁止收 `:tick`，收了会透传成 DOM 属性）。✓ 的划线动画仍是 `toggle()` 直接往行元素加类，
  Vue 在动画那 900ms 里不重绘（`animLock` 挡着轮询），所以与迁移前一致。
* `AddSheetView` / `AddTodoSheetView` / `LogSheetView` / `DebugSheetView`（卡片形态）：
  后两个的数据由 `showLog()` / `showDebug()` 取好经 HOST 的 `logData` / `debugData` getter
  递进去 —— 组件里自己 fetch 会变成「先弹出一个空的再填」，那是行为改动，不是重构。
  `AddTodoSheetView` 的 `nid` 走 `H.sheetArg`（`mountSheet` 只挂不传 props）。
* `shell.js`：`SheetHost` 删掉 `mode:'html'` 分支与 `v-html="s.sheet.html"`，页面形态固定
  `<div class="pbody" id="sheetBody">`，卡片形态固定 `.grip + .pclose + #sheetBody`；
  `shell.sheet` 少掉 `mode` / `html` 两个字段。app.js 侧 `pageSheet()` 与 `sheet()` 删掉，
  新增 `sheetVue(name, full)`，`pageSheetVue()` 改为返回 nextTick 的 Promise（D13：
  调用方 `await sortSheet()` 完才断言得到新 DOM）。
* 删掉的死代码：`pageSheet` `sheet` `group` `cdChip`（`clip` 留着，经 `H.clipText` 给
  AI 调用记录做 200 字截断）。app.js 1917 → 1864 行。
* CSS 一处：`.sheet .panel>h2` 补成 `.sheet .panel>h2, .sheet #sheetBody>h2` —— 卡片弹层的
  内容现在多包在 `#sheetBody` 里（这是与迁移前唯一的结构差别），不补标题会钻到 ✕ 底下。

**闸门跟着改**（都是「被迁移搬走了」而不是「契约失效」）：
闸门⑲ 的 `.pfoot` 表单名单里 `go/ui/js/app.js` → `go/ui/js/views/sheets.js`；
四条签名断言换锚点：`pclose`（改读 shell.js 的模板）、`cdChip(` 计数（改读 leaf.js 的
`<cd-chip>` 两处）、`function pageSheet(title, html)`（改钉 `function sheetVue(name, full)`）、
错过的提醒的跳转（`onclick="jump(\''+t.nid` → `@click.prevent="H.jump(t.nid)"`）。
闸门⑮ 自动覆盖新文件：57 个模板编译、11 个弹层注册表、`H.xxx` 124 个全在 setHost、
模板用 H 的 20 个组件全在 setup() 返回里暴露 H。

**等价性怎么证的**：`.test/probe_sheets.sh` 在真机上依次打开九个场景（排序页三个 tab、
记一笔、添加待办、运行日志、AI 调用记录、错过的提醒 + 空态），dump `#sheetBody.innerHTML`、
`.panel` 的 class/data-kind，以及旧函数需要的同一份输入（`P()` 的每 tab prefs、`MISSED`、
`logData`、`debugData`）；`.test/dom_equiv3.js` 从 `git show HEAD:go/ui/js/app.js` 抠出被删掉
的字符串函数在沙箱里跑（`sheet`/`pageSheet` 换成捕获函数，`api` 换成 dump 的那份真数据），
归一化后逐字比。结果：**9/9 全部一致**。归一化只加了一条：`esc()` 把 `"` 转成 `&quot;`
再塞进 innerHTML，Vue 的 `{{ }}` 写 textContent、序列化回来 `"` 保持原样 —— 两边
textContent 相同，只是转义写法不同。

**数字**：内联 `onclick` 从 21 处降到 **1** 处（app.js:649 的截图导入「选文件夹」浮层，
不是弹层，16d 处理）；handler 总数 81（内联 1 + Vue 模板 80，基线 73）；模板里的
`v-html=` 属性 7 → **6**（shell.js fab 图标、empty-state 的标题、KvRow 的 `v` 兜底、
shots.js 进度层的服务端 warn 串、sheets.js 排序按钮、app.js 一处是注释）；
`VUE_SHEETS` 11 条；闸门 **119** 项。

**验收**：`node tools/ui_test.js` **119 项全绿**；`GO_TEST=1 ./build.sh`（含 `go test ./...`）绿；
`./install.sh` Success；`./test.sh --vd` **163 项 ok、0 FAIL、PASS**（与步骤 15/16a/16b 基线逐条相同）；
`.test/dom_equiv3.js` 9 个弹层场景 DOM 逐字一致。

**下一步（16d，可选）**：剩下最后一处内联 handler 是 app.js 的截图导入「选文件夹」浮层
（`#folderOvl`，命令式 innerHTML），以及 `shotOverlay` 进度层里剩下的字符串（`.owarn` 是
服务端 HTML）。P13 的「手工 WebView 代码」到这里只剩这两小块 + `index.html` 的静态骨架。

## 9.26 S3 步骤 16d 已完成（Austin：最后一批字符串 → 真模板，`v-html` 与内联 `onclick` 双双归零）

**做了什么**（六块，全是「把字符串 HTML 翻成模板」，没有新行为、没有新 class）：

1. **删死代码簇**：`folderRender` / `folderCountLabel` / `emptyState`（步骤 16c 删掉
   `folderRows` / `folderCountHTML` 之后它们已无人调用，真机 probe 一调就抛 ReferenceError）。
   `emptyState` 里那句 `onclick="sheetMsg(...)"` 是全项目**最后一处内联 handler** —— 它跟着一起没了。
2. **删字符串回退分支**：`shotOverlay` / `shotOvlSub` 里 `if(VUE_SHEETS.progress){...}` 之后的
   那两段 innerHTML 代码永远跑不到（注册表恒为真），连带死变量 `SHOTOVL_TEXT` 一起删。
   计时器留在 app.js（它是行为不是视图）。app.js **1864 → 1796 行**。
3. **fab 图标**：`FABS` 以前存 `ic('plus','l')` 那串 SVG 字符串（TabBar 用 v-html 直插），
   现在只存图标名，shell.js 的 TabBar 模板画 `<span class="fico"><ico :n="s.fab.icon" cls="l"/></span>`。
4. **`<empty-state>`**：内部片段成真模板（`<ico :n="icon"/>` + `{{ title }}` + `v-if` 的 `.esub`）。
   字符串版里标题是**原样插入**的 HTML，逐个查过全部 7 个调用方（notes / todos / files / clip /
   shots / folders / sheets）传的都是纯文本字面量，所以 `{{ }}`（textContent）与 v-html 等价。
   注释里写明：以后谁要往 title 里塞 HTML，加插槽，别把 v-html 请回来。
5. **KvRow 的 `v` 分支**：`v-html="v"` → `{{ v }}`。调用方只有 blocks.js 的统计/运行信息卡与
   settings.js 的采集卡，传的是数字与中文字面量。
6. **进度层 `.owarn`**：`warn` 字符串（`ic('alert') + 固定文案`）→ 模板里写死 `<ico n="alert"/>` + 文案。
   顺带删掉 `ShotProgress` 的 `warn` computed。
7. **排序筛选按钮**（最后一个 v-html）：选项从 `[值, HTML]` 改成 `[值, 图标名, 文案]`，
   模板 `<ico v-if="o[1]" :n="o[1]"/>{{ o[2] }}`。没有图标的筛选项多出一个 v-if 的注释节点
   `<!---->` —— 它不是元素，textContent、布局、点击都一致。

模板里的 `v-html=` 属性 **6 → 0**。

**真机抓到一个真 bug（这一节是这一步的重点）**：给进度层加 `<ico>` 时只加了文件头注释里的
注册表，没加组件自己的 `components: { Ico }` → Vue 运行时只 `console.warn(Failed to resolve
component: ico)`，然后渲染出一个**裸 `<ico n="alert">` 元素**：图标位置空着，页面不报错。
根因是闸门⑮ 的注册表是「每个文件一份」（文件头注释那行 `components: { ... }`），
而 Vue 认的是**组件自己的** `components` 选项，两者可以不一致。新增闸门㉔ 钉住这个缝：
扫 29 个组件，模板里用到的自定义标签（带连字符的 ∪ 不在原生标签表里的单词标签，本项目只有
`<ico>`）必须出现在该组件自己的 `components` 里。反向验证：把 `components: { Ico }` 从
ShotProgress 删掉 → 闸门㉔ 立刻红并点名 `views/shots.js 的 ShotProgress 模板用了 <ico> 但自己没声明`。

**新增闸门㉓**：扫 59 个组件模板，`v-html` 必须为 0（只扫模板字面量，注释里提 v-html 不算）。
反向实验：把 leaf.js 的 KvRow 改回 `v-html="v"` → 立刻红并点名 leaf.js。

**等价性怎么证的**：`.test/probe_sheets.sh` 加了四个夹具点（fab 在笔记页/附件页的 `.fico`、
进度层的 `.owarn` 与整张 `.ovlcard`，进度层用 `Vue.createApp(VUE_SHEETS.progress)` 现场挂到
`#shotOvlRoot` 并直接写 `host.SHOTPROG`），`.test/dom_equiv3.js` 扩到 **13 例**（9 个弹层 +
fab 两个 tab + 进度层两块）全部逐字一致。因为 16d 动了 KvRow 与 EmptyState，步骤 16b/16a 的
两套也重跑：`.test/dom_equiv2.js` **13 块**、`.test/dom_equiv.js` **3 块**全部一致。
三个工具的旧侧基线不再写 `HEAD`（HEAD 一路在动，这一步第一次跑就撞上「HEAD 里找不到 cdChip」），
改成钉死在「那批字符串函数被删掉之前的最后一版」：16d→`cf69909`、16b→`bd91977`、16a→`98915cc`，
`BASE` 环境变量可覆盖。

**数字**：内联 `onclick` **0**（步骤 15 之前是 21）；模板里的 `v-html=` **0**；handler 总数 80
（全部在 Vue 模板里，基线 73）；导出表 68 个 key；闸门 **121** 项（+2）；app.js 1796 行。

**验收**：`node tools/ui_test.js` **121 项全绿**；`GO_TEST=1 ./build.sh`（含 `go test ./...`）绿；
`./install.sh` Success；`./test.sh --vd` **165 项 ok、0 FAIL、PASS**（步骤 15/16a/16b/16c 是 163，
多出的 2 项是 fab 图标与进度层的新断言）；DOM 等价性 13 + 13 + 3 = **29 例逐字一致**。

**P13 的「手工 WebView 代码」到此清零**：`go/ui/js/` 里没有字符串拼 HTML 的渲染器，
`index.html` 剩下的是图标 sprite（`<use>` 的引用源，必须是静态标记）、五个挂载容器、
以及 probe 兜底面板（刻意用裸 JS 写：Vue 起不来时它要能画出来告诉你是怎么回事）。

## 9.27 S4 步骤 17a 已完成（调试基建：Vue 的 dev 构建 + `?vue=dev` + Chrome inspect）

**为什么开新阶段**：用户问「Vue 到底有什么好处，装都装了怎么用起来」。先做了盘点，
`go/ui/js/` 里的 Vue 原语使用量是：

```
live() 120 处   computed 16 处   reactive 3 处
watch 0   ref 2   provide/inject 0   onMounted 0   $emit 2
<transition> 0   <Teleport> 0   插槽 0
H.xxx 125 个不同引用（宿主上帝对象）
```

也就是说只用了 Vue 的「模板 + 组件」这一层，响应式那层被 `live()` 的 `V.tick++` 大锤绕过了
（120 处 `live()` vs 3 处 `reactive`）。新阶段 P14 的顺序按性价比排：
①调试基建 → ②真响应式删 tick → ③`<Transition>` 动画 → ④`<Teleport>` 弹层宿主 →
⑤provide/inject 替掉 `H` → ⑥Vant 局部接入（像素会变，开工前问用户）。

**17a 做了什么**（①，为后面五条铺路）：

* vendor Vue 的 **dev 构建** `vue.global.js`（612 KB，同版本 3.5.46，sha256 记进 VENDOR.md
  新增的表）。prod 构建里 `__VUE_DEVTOOLS_GLOBAL_HOOK__` 出现 **0 次**（编译期剪掉），dev 版 1 次
  —— 这是「调试必须换文件、不是加开关」的实测根据，`go/web_test.go` 钉住这条。
* `index.html` 新增 `id="vue-select"` 内联脚本：`?vue=dev` 或 localStorage `enote.vue=dev`
  时加载 dev 版，否则 prod。用 `document.write` 在解析期同步插入，保证早于
  `<script type=module>`（`js/vue.js` 模块求值时就要拿到 `window.Vue`）。
* `MainActivity`：`WebView.setWebContentsDebuggingEnabled(true)`（Chrome `chrome://inspect`
  的入口），并在私有目录里有 `enote/.vuedev` 时给 URL 拼上 `?vue=dev`。
  **开关刻意与 jseval 的 `.devmode` 分开**：测试工具每次运行都会创建 `.devmode`，共用一个文件
  等于 `test.sh` 跑的是 dev 版 Vue，那 165 项基线（含时序敏感的契约）就没得比了。
* 为什么值得多带 612 KB：运行时警告只在 dev 版里。步骤 16d 真机抓到的裸 `<ico>` 在 prod 里
  完全静默（Vue 只 `console.warn`），而 `MainActivity.onConsoleMessage` 把 console 全写进
  `testlog.txt`。真机验证：dev 模式下 probe 挂一个未注册标签，日志立刻出现
  `[Vue warn]: Failed to resolve component: nosuchtag`。
* README 新增 §5.2：两条进 dev 模式的路、`adb connect 127.0.0.1:5555`（root 下
  `setprop service.adb.tcp.port 5555`）+ `chrome://inspect` + Vue Devtools 扩展的步骤。
  设备事实核过：装了 `com.android.chrome`，Termux 里没有 adb（`pkg install android-tools` 可装），
  unpkg 可达。

**闸门跟着加**：
* `ui_test.js` 新增闸门㉕（共 122 项）：选择器在 module 之前、两个构建都在 VENDOR.md 登记且文件
  存在、Java 开了 `setWebContentsDebuggingEnabled(true)` 且开关文件是 `enote/.vuedev`、README 写了
  `?vue=dev`。
* `go/web_test.go`：`TestVendorHashMatchesDoc` 从「单文件」改成逐文件核对（VENDOR.md 里每个
  `| 文件 |` + `| sha256 |` 条目都查），并钉住「dev 有 devtools hook、prod 没有」。
* 首页内联脚本白名单从 1 个（`id="probe"`）放宽到 2 个（加 `id="vue-select"`），
  ES5 检查对两个都跑 —— 它同样在 module 之前、同样要在旧引擎上解析得动。

**验收**：`ui_test.js` **122 项全绿**；`GO_TEST=1 ./build.sh` 绿；`./install.sh` Success；
真机双模式各测一次：生产 `vue.global.prod.js` / `__VUE_DEV__=false` / 4 个 tab，
dev `vue.global.js` / `__VUE_DEV__=true` / 4 个 tab，dev 启动时 testlog 出现
`You are running a development build of Vue.`；`./test.sh --vd` **166 ok / 0 FAIL / PASS**（基线 165，多出的 1 项是 vendor 逐文件核对拆出来的）。

### 9.28 步骤 17b：真响应式第 1 片 —— clip 页摘掉 V.tick（2026-11-25）

- **为什么**：17a 把「看得见」补齐，17b 补「响应式」——今天 120 个 `live()` 是「每次 render() 全量重算」
  的翻译，不是 Vue 的依赖追踪。第一片挑 clip 页：它是唯一一份「状态在 app.js 模块变量里、
  组件靠 getter 读」的页，改动面最小，且步骤 9 的交互用例（勾选、解析、删除）正好能证明
  「没有 tick 也更新」。
- **状态**：`clipSel/clipList/clipLoading/clipError` 四个模块变量 → `var CLIP = Vue.reactive({sel:{},list:[],loading:false,error:''})`。
  对外两个面（`setHost` 的 getter、`__enote.state` 的 getter/setter）保持原名字，测试与组件都不用改。
  `loadClips()` 里的 `sheetPaint()` 删掉（返回 `Promise.resolve()`），`clipPick`/`clipSelAll` 的
  `sheetPaint()` 也删掉——它们只改 CLIP，Vue 自己会重画。
- **组件**：`views/clip.js` 的 12 个 `live(...)` 全换成裸 `computed(...)`；`ClipCount`（clip 页脚）
  从 `components/leaf.js` 搬进 `views/clip.js`（leaf.js 是通用组件库，页脚只服务这一页，
  留在通用库里等于逼着通用库认识页内状态）；`ClipItem` 的 `tick` prop 删掉。
- **闸门 ⑮ 改成白名单制**：`REACTIVE_FILES` 里的文件必须用裸 `computed`（不许 `live(`），
  其余文件仍强制 `computed` 包在 `live()` 里。这样迁移期两种写法各自的约束都还在，
  迁完的文件不会悄悄退回 tick 驱动。clip 页的签名断言同步改成 `CLIP.sel = keep`。
- **三个诊断缝**（都留在生产里，各一行）：`window.__enoteAppLoads`（app.js 被求值几次）、
  `window.__enoteVtick()`（读 V.tick）、`mountSheet` 记 `window.__enoteSheet={name,app}`
  （`app._instance.scope.active` 是「响应式更新能不能到达这个弹层」的唯一判据）。
  这次靠它们排掉了「app.js 被求值两次 → 模块状态两份」这个假说（实测 loads=1）。
- **两个坑（都写进 CHANGELOG）**：
  1. **夹具要写 `window.__enote.state`，不是 `window.__enoteActions`。** 导出表上的
     `clipList`/`clipSel` 是**快照数据属性**（装配时取一次值），赋值只落在 window 上；
     状态桥 `__enote.state.*` 才是带 setter 的活口。写错的症状是「赋值读回来是对的、
     界面永远不动」，本轮在这里烧了十几轮探针。
  2. **dev 构建会渲染 `<!--v-if-->` 注释节点**（prod 是 `<!---->`），DOM 等价工具的归一化只删
     `<!---->`，所以跑 `.test/dom_equiv*.js` 前必须 `rm enote/.vuedev`（本轮 4 项「不一致」全是这个）。
- **响应式证明**（`.test/probe_react.sh`，一行版）：注入 2 条 → 列表渲染出来；点 `#clipitem-a2`
  → `.clipitem.on` 1→2、页脚「1 条已选」→「2 条已选」，全程 `tick 9→9` 一动没动。
- 验收：`node tools/ui_test.js` 122 检查全绿；`GO_TEST=1 ./build.sh`；`./install.sh` Success；
  `./test.sh --vd` **166 项全绿**；`.test/dom_equiv3.js`（13 项）/ `dom_equiv2.js` / `dom_equiv.js`
  三套 DOM 等价全部一致（prod 模式下）。
### 9.29 步骤 17c：真响应式第 2 片 —— 文件夹页（2026-11-25）

- `folderSel/folderAll/folderQ` → `var FOLD = Vue.reactive({sel:{},all:[],q:''})`；
  `views/folders.js` 的 8 个 `live()` 换成裸 `computed()`；`loadFolders()` 返回
  `Promise.resolve()`，`folderPick`/`folderSelAll`/`folderPickShots`/`folderFilter` 的
  `sheetPaint()` 全删（它们只改 FOLD）。
- 改名踩到的坑：正则把 `setHost` / `__enote.state` 里的 **getter 名**也改了
  （`get FOLD.all(){…}` 是语法错误），闸门 ⑮ 直接报「folderSel folderAll 不在 setHost」——
  闸门先于真机抓到，这是它该有的样子。对外名字（`folderSel`/`folderAll`/`folderQ`）必须原样保留。
- 真机证明：注入 2 个目录 → 2 行画出来；点一行 → `.frow.on` 0→1、页脚「0 个已选」→「1 个已选」，
  `tick 7→7` 没动。
- 顺手修了 DOM 等价探针的一个老脆弱点：`probe_sheets.sh` 的第一个用例（排序页·笔记）不设置 tab，
  跑在热 app 上会继承上一轮停在的 tab（本轮症状是「排序页·笔记」画出附件页的排序项）。
  现在第一步显式 `__enote.state.tab = "notes"; await render()`。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项、`.test/dom_equiv3.js` 13 项全绿。
### 9.30 步骤 17d：真响应式第 3 片 —— 截图页（2026-11-25）

- `shotSel/shotList/shotLoading/shotError` → `var SHOTS = Vue.reactive({sel,list,loading,error})`；
  `views/shots.js` 的 13 个 `live()` 换成裸 `computed()`；`loadShots()` 返回 `Promise.resolve()`，
  `shotPick`/`shotSelAll` 的 `sheetPaint()` 删掉。
- `SHOTFLAGS` **没**进来：它是 `Android.shotFlags()` 的整包返回、读它的是「我的」页（还没迁），
  整对象 reactive 化要连 `shotFlags()` 的回调一起动，留到 stats 那片。
- 闸门签名跟着迁移走：`只选一张时只显示「创建笔记」一个按钮` 的签名从
  `one: live(...)` 改成 `one: (live|computed)(...)`——迁移期两种写法都认，迁完的文件不会漏网。
- 真机证明：注入 2 张 → 2 格画出来；点一张 → `.shotitem.on` 0→1、主按钮变成「创建笔记」
  （`selCount<=1` 的分支），`tick 6→6` 没动。
- 一次 OCR flake：`test.sh --vd` 第一次跑在「OCR 没能在现造的图里读出 VVVFEVMY」上 ERROR 中止，
  重跑 166 项全绿。OCR 是本地 tesseract 路径，与本轮改动无关（本轮只动 JS）。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项、`.test/dom_equiv3.js` 13 项全绿。
### 9.31 步骤 17e：状态层全部 reactive 化（视图还没摘 tick）（2026-11-25）

- 目标：把剩下的模块状态都变成 `Vue.reactive`，这样 `live()`（= `computed(tick + fn)`）除了 tick
  依赖之外也**开始真正追踪依赖**——状态先响应式化是安全的，视图可以之后逐页摘 tick。
- 两种写法：
  - **原地 reassign**（`prefs` / `SR` / `FA`）：`var X = Vue.reactive({...})`，整包赋值改成
    `reassign(X, {...})`（同一个 proxy 上先删键再写键）。读侧一个字不用改，真值性也不变。
  - **`{v: 初值}` 容器**（`MISSED` / `ST` / `SHOTFLAGS` / `LOGDATA` / `DEBUGDATA`）：这些初值是
    `null`，代码里到处是 `if(!ST) return`，直接给对象会让真值性变味，所以套一层 `{v:…}`：
    读 `ST.v`、写 `ST.v = …`，整包赋值可追踪，真值性逐字不变。
  - 对外的两个面（`setHost` 的 getter、`__enote.state` 的 getter/setter）名字全部不变，
    夹具与组件零改动。
- 改名踩的坑：`MISSED` 这类整词替换会连 `get MISSED(){` / `set MISSED(v){` 一起改坏
  （`get MISSED.v(){` 是语法错误），要逐条修回；`var A = …, B = …` 一行里两个变量也会被改坏。
  `node --input-type=module --check` 是最快的兜底（比跑真机快两个数量级）。
- 闸门 mock 跟着换形状：轮询指纹用例里的 `SHOTFLAGS` mock 改成 `{v:{…}}`，三处 mutation 同步。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项全绿（视图仍走 tick，行为零变化）。
### 9.32 步骤 17f：`H` 暴露的标量接上响应式（镜像盒子）（2026-11-25）

- `tab` / `q` / `open` / `remindPending` / `stErr` / `srErr` / `SHEETARG` 是普通模块变量，
  组件通过 `H.tab` 读它们时 Vue 追踪不到（整包赋值换的是引用）。`tab` 有 64 处引用、`q` 32 处，
  整词改名的风险大于收益，所以用**镜像盒子**：原变量照旧用，赋值处走 `syncBox(盒子, 值)` 同步一份，
  组件读盒子。同步只有一条路（手写第二遍迟早漏一处，漏了就是「数据换了界面不动」）。
- 对象型的 `open` 让原变量直接指向盒子里的 proxy（`var open = OPENB.v`），逐键改也追踪得到。
- **声明顺序是硬要求**：盒子必须在第一次读它之前建好。踩过：盒子放在文件中部，而
  `var tab = TAB.v` 在第 32 行，`var` 提升让 `TAB` 那一刻是 undefined → 整份 app.js 抛
  TypeError → 页面全白（真机日志 `Cannot read properties of undefined (reading 'v')`）。
  这类错静态闸门全绿、真机整页空白，只有 `node --input-type=module --check` + 真机探针能兜住。
- 闸门签名跟着改 4 处（都保留旧写法兼容）：错过的提醒跳转、statsNow 的 stErr、
  `var tab = 'notes', open = {}` 的声明断言、轮询指纹 mock。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项全绿。
### 9.33 步骤 17g：全部视图与组件摘掉 tick（真响应式落地）（2026-11-25）

- 把 `notes/todos/stats/settings/sheets/files/leaf/components/blocks` 里的 `live(fn)` 全换成
  裸 `computed(fn)`，并删掉 `var t = H.tick.v;` 这类「假依赖」行。闸门⑮ 白名单从 3 个文件扩到 12 个。
- **踩坑 1：`live(` → `computed(` 是字符串替换，会咬到标识符**。`toggleKeepAlive(` 变成
  `toggleKeepAcomputed(`（闸门㉑ 抓到模板里引用了不存在的 handler）。
- **踩坑 2：`computed` 不是全局**。各视图文件靠文件顶上的 `const { computed } = Vue` 拿到它，
  `components/leaf.js` 只 import 了 `live`，替换后 `computed` 是 undefined → setup 抛错 →
  组件渲染时 `f.length` 报 `Cannot read properties of undefined (reading 'length')`。
- **踩坑 3：computed 返回容器本身 = 永远不重渲染**。`computed(() => H.FA)` 每次返回同一个 proxy，
  `reassign(FA, …)` 原地改键时 computed 重算但值没变，Vue 判定「没变化」直接跳过渲染
  （症状：附件页顶部条永远停在旧数字）。解法：返回派生快照 `computed(() => ({ total: H.FA.total, … }))`
  或浅拷贝 `{ ...H.S.info }`。踩到的 5 处：FileStrip、files.js、settings.js ×2、stats.js、components.js。
- **诊断缝（永久保留）**：`mountView` / `mountSheet` 都挂 `app.config.errorHandler`，
  打印 `[组件名 @出错阶段] + 栈前 4 行`。Vue 默认只打 message，踩过之后才知道栈才是有用的那半。
  另加 `window.addEventListener('error'/'unhandledrejection')` 打印栈。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项全绿、三套 DOM 等价全部一致。
### 9.34 步骤 17h：删掉 `live()`，tick 降级为「原生状态纪元号」（2026-11-25）

- `live()` 与它的 12 个 import 全删；闸门⑮ 的白名单作废，改成两条正向契约：
  1. 视图/组件文件里不许再出现 `live(`（出现就是退回「靠 V.tick 全量失效」的老路）；
  2. `computed(() => H.容器)` 直接返回**原地改键**那批容器（S / SR / FA / prefs / SHOTPROG /
     SHOTS / CLIP / FOLD / open）直接红 —— 原地改键时 computed 值没变，Vue 跳过渲染。
     `ST` / `MISSED` / `SHOTFLAGS` / `LOGDATA` / `DEBUGDATA` 是 `{v:}` 容器且整包赋值，
     每次都是新对象，返回它本身没问题，所以不在名单里。
  闸门自己也要反向验证：临时注入一个 `computed(() => H.FA)` 确认它会红（第一次注入没红，
  因为 `matchAll` 只有一个捕获组却写了 `m[2]` —— 闸门在假绿）。
- 反向验证当场抓到一个存量真 bug：`ShotProgress` 的 `P: computed(() => H.SHOTPROG)`，
  `SHOTPROG.secs` 每秒逐键 +1，而 computed 返回容器本身 → 秒表会冻在第一个数。
  改成 `computed(() => ({ ...H.SHOTPROG }))`，同时删掉 `shotTimer` / `shotOvlSub` 里的
  `sheetPaint()`（reactive 赋值自己就触发重算）。
- `V.tick` 不删，语义降级为**原生状态纪元号**：`notifyGranted()` / `keepAliveOn()` /
  `batteryIgnoring()` 是 Android 桥的「拉」式只读接口，本身不可观察。settings.js 里那 6 个
  computed 显式读 `V.tick.v`（`const nat = computed(() => V.tick.v)`），
  `settingsRefresh()` 在 `onAppResume` / `notifyResult` 里 bump 一次。
- 验收：122 静态检查、build/install、`./test.sh --vd` 166 项全绿、三套 DOM 等价全部一致。


### 9.35 步骤 17i：`<Transition>` 接管弹层开合（删掉 `.closing` + `setTimeout(110)` + `sheetGen` 收场守卫）（2026-11-25）

- 动机：`closeSheet()` 里那套「加 `.closing` 类 → `setTimeout(110)` 拆 app → `sheetGen` 号防
  迟到的回调把新弹层拆掉」是手写的动画状态机，三处（CSS 类、定时器、序号守卫）必须同步，
  少一处就是「弹层空白且点了没反应」这种查起来很贵的症状。
- 做法：`SheetHost` 的根节点 `.sheet` 改成 `v-if="s.sheet.on"`（`class="sheet on"` 写死，
  不再 `:class="{on:…}"` —— 元素只在开着时存在，绑上去等于 leave 第一帧就把 `display:flex` 抹掉），
  外面套 `<transition>`，`@after-leave="H.sheetLeft"` 里 `unmountAllSheets(['progress'])`。
  `closeSheet()` 从此只有一句 `shell.sheet.on = false`；`shell.sheet.closing` 与
  `sheetGen` 的收场侧守卫一起删（`sheetGen` 只剩「开」这一侧要防：连点两下、开 A 立刻改开 B
  时迟到的 `nextTick` 回调会把上一个弹层的组件挂进新面板）。
- **CSS 模式的 `<Transition>` 在真机上会卡死**（这一条是验收逼出来的，不是设计时想到的）：
  Vue 的 CSS 过渡用 `requestAnimationFrame` 推进状态机，页面不可见时 rAF 被挂起 → leave
  永不落地 → 弹层关不掉、`@after-leave` 不调用、sheet 的 app 也不拆（泄漏）。
  `test.sh` 的剪贴板 raw 用例（虚拟屏 + 物理屏关）稳定复现：`DBG close` 之后 30 秒没有
  `DBG sheetLeft`，`CPRAW mounted=1`。改成 **JS 钩子模式**（`:css="false"` +
  `@enter` / `@leave` / `@leave-cancelled`），`shLeave` 自己加 leave 类、用 `setTimeout` 收尾
  （后台页的 `setTimeout` 会被节流到 1 秒，但它会跑），时长仍从 CSS 读
  （`getComputedStyle(el).transitionDuration`，样式表依旧是唯一时长来源）。
  `:css="false"` 时 Vue 不给类记账，所以 leave 被取消（关掉立刻重开）要自己抹类。
- CSS：leave 类加在根元素上，所以面板那条是后代选择器
  `.sheet.sh-leave-active .panel{animation:down …}`（特异度 0,2,1 压过 base.css 的
  `.sheet .panel{animation:up}`）；遮罩自己加一条 `transition:opacity var(--d1)`。
  可见差别只有一条：遮罩现在跟着淡出 110ms，以前是瞬间消失。`prefers-reduced-motion`
  把动画时长归零 → `leaveMs()` 读到 0 → 20ms 后收尾，动效开关照旧生效。
- 测试侧适配（`#sheet` 从常驻节点变成随开合创建/销毁）：D17 测缝载荷先开一个弹层再读
  `__enote.dom.sheet` / `panel`（契约是「getter 能拿到活的节点」），读完关掉；
  1047 行的 `!q("#sheet").classList.contains("on")` 改成 null 安全的 `!q("#sheet.on")`。
- 闸门⑱ 扩了 5 条：`:css="false"`、`@leave="shLeave"`、`setTimeout(done`、
  配对的 `shLeaveCancel`、CSS 选择器必须是 `.sheet.sh-leave-active .panel`。
  反向验证：把 `:css="false"` 删掉，闸门立刻红。
- 验收：122 静态检查、build/install、`./test.sh --vd` **166 项全绿 PASS**、三套 DOM 等价
  全部一致（dom_equiv3 / dom_equiv2 / dom_equiv 454 B todoTx）、真机 leave 中段探针
  `op=0.07 panelAnim=down panelDur=0.11s`（遮罩淡出 + 面板下滑，与迁移前一致）。

### 9.36 步骤 17j：进度层搬进外壳树的 `<Teleport>`（删掉第四个 app 与 `['progress']` 例外名单）（2026-11-25）

- 动机：截图导入进度层是页面上最后一个「命令式挂出来的 Vue app」——`shotOverlay(true,…)`
  里 `createApp(ShotProgress).mount(#shotOvlRoot)`，`shotOverlay(false)` 里 `unmount()`。
  它存在的唯一理由是「进度层要活过 `closeSheet()`」（`shotsImported` 之后 AI 解析还在跑，
  而 `closeSheet` 会把 `.panel` 的内容整块换掉），靠的是物理位置（不在 `.panel` 里）。
  代价是一整圈特例：`unmountAllSheets(['progress'])` 三处调用点、`VUE_SHEETS.progress`
  注册项、`shotOverlay` 里的 mount/unmount、组件上残留的 `props:['tick']`。
- 做法：`SheetHost` 模板尾部加
  `<teleport to="#shotOvlRoot"><shot-progress/></teleport>`。进度层从此是**外壳树的普通子组件**，
  弹层的开合与它无关；开关只剩 `SHOTPROG.on` 上的 `v-if`。DOM 落点与层叠零变化
  （teleport 送到同一个 body 级容器，dom_equiv3 的「进度层整张卡」逐字一致）。
- 连带删掉：`unmountAllSheets` 的 `keep` 参数（三处调用点变成 `unmountAllSheets()`）、
  `VUE_SHEETS.progress`（`go/web_test.go` 的注册表断言同步）、`shotOverlay` 里的
  mount/unmount、`ShotProgress` 的 `props:['tick']`（17g 之后没人传这个 prop）。
- 闸门⑮ 立刻抓到真问题：它每个文件只取**第一处** `components:` 当整份文件的名单，
  shell.js 的第一处是 TabBar 的 `{ Ico }`，于是 `<shot-progress>` 判为未注册
  （prod 构建下未注册组件只 warn，症状是整块 DOM 直接没）。按项目惯例在文件头补
  `components: { Ico, ShotProgress }` 这行全量名单。
- 闸门⑱ 扩 4 条：`<teleport to="#shotOvlRoot"><shot-progress/></teleport>` 必须在 SheetHost 里、
  SheetHost 自己声明 `ShotProgress`、`unmountAllSheets` 不许再带例外名单、
  `progress` 不许回到 `VUE_SHEETS`。反向验证：把 teleport 删掉立刻红。
- 测试侧：`test.sh` 的 `ovlMounted` / `ovlUnmounted` 从「查 `__enote.vue.sheets.progress`」
  改成查 DOM（`#shotOvlRoot .ovl` 的有无），并新增 `ovlReg == 0`：进度层不许出现在 sheet
  注册表里 —— 出现了就意味着 `closeSheet` 的 `unmountAllSheets()` 会把它拆掉。
  `.test/probe_sheets.sh` 也不再自己 `createApp`，直接置 `SHOTPROG.on` 走真路径。
- 验收：122 静态检查、build/install、`./test.sh --vd` **166 项全绿 PASS**、三套 DOM 等价
  全部一致、真机探针 `ovl=1 reg=0` → `afterClose=1 sheet=0` → `gone=0`
  （渲染出来、不在 sheet 表里、活过弹层关闭、关掉后零残留）。

### 9.37 步骤 17k：宿主接口 H 改走 provide/inject（组件不再 import 模块级 H）（2026-11-25）

- 动机：13 个组件文件都 `import { H } from './vue.js'`，而 `H` 是 vue.js 里的**模块级 `let`**，
  由 app.js 在模块初始化期 `setHost({...})` 赋值。组件对此一无所知，只能赌「我 mount 的时候
  它已经装好了」。这份隐式依赖还堵死了拆 god-object 的路：123 个 `H.xxx` 想按用途拆成
  细粒度 provider，组件就得逐个改 import。
- 做法：`vue.js` 加 `HOST_KEY` + `withHost(app)`（`app.provide('H', H)`），三个挂载点
  （`mountView` / `mountSheet` / shell.js 的 `mount`）各调一次；组件里
  `const H = inject('H')` 写在 setup 体首行，模板一行不改（模板里的 `H.xxx` 读的仍是
  setup 返回的那个 `H`）。共 47 处 setup 改造，13 个文件的 import 行去掉 `H`、
  解构行加 `inject`。
- 收益：依赖摆到明面上 —— 装配哪个 app 的人负责提供宿主一目了然；测试可以 `provide`
  一个假宿主只挂单个组件；后续拆 H 只动三个挂载点。
- 改造是脚本做的（`.test/to_inject.py`）：先做一遍注释/字符串掩码，再配对括号找 setup 体，
  只对**引用了 H** 的 setup 注入（单行体插 `const H = inject('H');`，多行体按原缩进换行）。
  掩码这步是必须的：`setup(` 在注释里也出现（「setup() 返回里暴露 H」），不掩码会把注释
  当代码配对括号，直接 unbalanced。
- 闸门⑮ 扩 3 条：a) 组件文件不许再 `import { … H … }`；b) setup 里出现 `H` 就必须
  `inject('H')`（漏了是 ReferenceError，整模块不执行 = 白屏）；c) 三个挂载点必须
  `withHost(app)`（漏了 inject 拿到 undefined，模板里 `H.xxx` 全炸）。三条都反向验证过。
- 验收：122 静态检查、GO_TEST=1 ./build.sh、./install.sh Success、`./test.sh --vd`
  **166 项全绿 PASS**（第一次跑撞到一个 OCR 环境抖动：随机串 `FVWADDRT` 被读成
  `FWADDRT`，与本次改动无关，重跑即过）、三套 DOM 等价全部一致。

### 9.38 步骤 17l：删掉 tick prop 管道（b5 之后的收尾）

17h 删了 `live()` 之后，`tick` prop 就只剩管道没有读者：29 处 `:tick="tick"`、21 个组件
声明 `props: ['tick', …]`、13 处 setup 返回里的 `tick: computed(() => V.tick)` —— 全链路
没有任何一处读 `props.tick`。它现在的唯一作用是让每个组件多一个 prop、让每个模板多一个
绑定，并且让「响应式」看起来仍然依赖一个手动纪元号。

删完之后：状态是 reactive 的，computed 读到谁就订阅谁；父组件重渲染时 props 变了子组件
才跟着重渲染 —— 这正是 Vue 的默认语义，不需要额外的信号。

改动（脚本 `.test/drop_tick.py --apply`，11 文件 56 增 74 删）：
- 模板：29 处 ` :tick="tick"` 全删。
- props：`props: ['tick', X]` → `props: [X]`；`props: ['tick']` 整行删（组件变成无 props）。
- setup：`tick: computed(() => V.tick)` 与 `const tick = computed(() => V.tick)` 全删，
  return 对象里的 `tick` 条目一并删。
- import：文件里不再读 `V.tick` 的，从 `../vue.js` 的 import 里摘掉 `V`（8 个文件）。
  **app.js 的宿主对象里还写着 `V: V`** —— 摘掉 import 之后整模块 ReferenceError、页面白屏，
  静态闸门全绿，是真机跑测试才抓到的（见下面的闸门补强）。`H.V` 全项目无人读，删掉这一项。
- 保留：`V.tick` 本身、`sheetPaint()`/`vuePaint()` 的 bump、`window.__enoteVtick`、
  settings.js 的 `const nat = computed(() => V.tick.v)`（通知权限/常驻后台/电池优化是
  Android 桥的「拉」式只读接口，只能靠纪元号失效）。
- 注释同步：components.js 骨架第 4 条、views/notes.js 骨架第 1–2 条、todos/files/folders/
  shots/stats/sheets/settings 各段「computed 不依赖 tick 就永远缓存」的老说法改成
  「读的是 reactive 容器，整包赋值即失效」；test.sh 里 11 处「tick 链断了」改「响应式链断了」。

闸门（仍是 122 项，改规则不加项）：
- ⑮ 的 tick 规则**反转**：以前是双向契约（声明了必须收、没声明禁止收），现在两边都禁止 ——
  组件声明 `tick` prop 红、模板出现 `:tick` 红。两条都反向验证（加回 `<strip-bar :tick="tick">`
  与给 StripBar 加 `props: ['tick']` 各红一次）。
- ①c「视图文件必须引用 tick」失去对象，改成「视图文件必须出现 `computed()`」——
  同一个前提的现代写法：模块状态只有经 computed() 读才会被渲染 effect 追踪。
- 新增一条（17l 自己踩的坑）：代码里用 `V`（`V.` 属性访问或 `{ V }` 速记）却没从 vue.js
  import 它 → 红。反向验证：给 leaf.js 加一行 `const zz = V.tick;` 立刻红。

验收：122 静态检查、`GO_TEST=1 ./build.sh`、`./install.sh` Success、`./test.sh --vd`
**164 项全绿 PASS**、三套 DOM 等价（dom_equiv3 / dom_equiv2 / dom_equiv）全部一致
（卡片 2495 B、todoRow 651 B、todoTx 454 B 逐字未变）。

### 9.39 步骤 17m：宿主接口按 app 收窄（HOST_KEYS 表）

17k 把 `import { H }` 换成 `inject('H')` 之后，剩下的问题是**每个 app 都拿到全量宿主**：
`setHost` 那张表 132 个 key，而每个 app 的组件树真正读到的只有 0–27 个，其中 **93 个 key
全项目只有一个 app 用**（`clipParse` 只有 clip 弹层读、`reocr` 只有笔记卡读）。全量下发的
后果是拼错的 key 撞上别的域的名字也能跑：笔记模板里写 `H.clipParse()` 静态检查过得去
（「在 setHost 里」）、运行时也返回一个函数，只有画出来的东西不对。

现在每个 app 只拿到自己那棵树读到的那些：

- `app.js` 新增 `var HOST_KEYS = { 'view:notes': [...], 'sheet:clip': [...], 'shell:topbar': [...], … }`
  （19 个 app：4 视图 + 10 弹层 + 5 外壳），由 `.test/host_split.py --emit` 从组件注册表算出来：
  每个 app 根沿 `components: { A, B }` 取传递闭包，∪ 其中出现的 `H.xxx`。
- `vue.js` 新增 `narrowHost(keys)`（**逐 key 搬 property descriptor**，不是 `Object.assign`：
  `S` / `tab` / `MISSED.v` 这些是「会被整体赋值」的 var，宿主里是 getter，展开求值一次就永远
  读旧引用 —— 与 SHOTS.list / FA 那条教训同源）+ `setHostKeys(table)` + `hostFor(appId)`；
  `withHost(app, host)` 多一个可选参数，三个挂载点改成 `withHost(app, hostFor('view:' + tab))` /
  `hostFor('sheet:' + name)` / shell.js 的 `hostFor('shell:' + id)`。
- 组件模板与 setup **一行没改**：局部名还叫 `H`，只是它 inject 到的对象变窄了 → DOM 逐字不变。
- `setHost(HOST)` 仍是全量：测试缝 `__enote.vue.host.X` 要能读任意 key。

闸门⑮ 新增三向核对（仍 122 项，反向验证 5 次）：表里的 key 必须真在宿主对象上（拼错 → 红）；
组件树里读到的必须在表里（漏一个 = 运行时 undefined、那一片渲染成空 → 红）；表里不许列这棵树
没读的 key、不许有没挂载点的 app（清单在骗人 → 红）。挂载点必须调用 `withHost(app, hostFor(...))`，
只写 `withHost(app)`（全量）也算红。

验收：122 静态检查、`GO_TEST=1 ./build.sh`、`./install.sh` Success、`./test.sh --vd`
**164 项全绿 PASS**、三套 DOM 等价全部一致（卡片 2495 B、todoRow 651 B、todoTx 454 B 逐字未变）。

## 9.40 P14 S5：引入 Vant 4（用户批准：减少手搓 UI 的不确定性）

P14 路线图第⑥项（§9.27），全程唯一会改像素的一项。用户 2026-11-25 批准：
「同意引入 vant，减少自己手搓 ui 的不确定性」。

### 引入前实测的依赖事实（把包下下来扫，不是查文档）

| 项 | 实测 |
|---|---|
| 版本 | vant 4.10.2（npm latest），UMD 全局构建 `lib/vant.min.js` 245,846 B（gzip 80,005）+ `lib/index.css` 199,570 B（gzip 52,773） |
| 装配 | UMD 取全局 `Vue`（就是 vendored 那份），全局名小写 `vant`，根导出有 `install` → `app.use(vant)` 注册 ~70 个 `van-*` 组件；真机验证：`<van-button>` 渲染出 `<button class="van-button van-button--primary">` |
| 语言基线 | `?.` 2 次命中都是 `? .5 :` 三元（假阳性）；`??` `Proxy` `BigInt` `Object.fromEntries` `queueMicrotask` 全 0；有箭头函数 1619、`class` 4（ES2015）→ **在 VENDOR.md 的 ES2020 基线内，`MIN_API=26` 不用抬** |
| CSS 现代特性 | `:is(` `:where(` `:has(` `@supports` `aspect-ratio` `backdrop-filter` 全 0；`gap:` 2、`env(safe-area` 3 |
| 全局选择器 | 非 `.van-*` 的只有 `:root`/`:host`（2557 个 `--van-*` 变量，与我们的 `--sheet-h` 等不撞名）、`html{-webkit-tap-highlight-color:transparent}`（tokens.css 的 `*{}` 已覆盖）、`a{text-decoration:none}`、`input,button,textarea{color:inherit;font:inherit}`、`ol,ul{margin:0;padding:0;list-style:none}` |
| z-index | Vant 从 2001 自增（`useGlobalZIndex`），我们是 55/60/70/90 → **同一层交互不能混用**：弹层换成 `van-popup` 后 toast 也必须换，否则自研 toast 掉到 Vant 遮罩下面 |
| 体积 | base.apk 341 KB → 不变（Vant 进 `libenote.so`：7,773,768 → 8,223,208 B，+449 KB 原始 / ~130 KB 压缩） |

### 步骤 18a：vendor + 注册，像素零变化

- `go/ui/vendor/vant.min.js` + `vant.css`（整文件 vendor，VENDOR.md 记 sha256/来源/许可/大小）；
  `go/web_test.go` 的 `TestVendorHashMatchesDoc` 版本串检查按文件分流（Vue 查 `vue v3.5.46`、
  vant.min.js 查 `4.10.2` 与 `van-popup`/`van-toast`、vant.css 查 `--van-` 与 `.van-popup`），
  并新增两条 index.html 装配断言：`vant.min.js` 在 `<script type=module>` 之前、
  `vant.css` 在我们的 CSS 之前。
- `index.html`：`<link href="/vendor/vant.css">` 放在 `tokens.css` **之前**（平手时我们的设计系统赢），
  `<script src="/vendor/vant.min.js">` 放在 Vue 之后、module 之前。
- `vue.js`：`withHost()` 里 `if (Vant) app.use(Vant)`（一处覆盖 19 个 app；node 沙箱里没 window.vant 就跳过）。
- **中和 Vant 的三条全局规则**：`base.css` 显式写回现状 `button,input,textarea{font-family:Arial;line-height:normal}`
  与 `a{text-decoration:underline}`。这不是洁癖 —— 真机 computed style 对比（基线 vs 装 Vant）实测
  **9 处差异**，全来自 Vant 的 `font:inherit`：`#fab`/`.btn`/`.tabbar .tab`/首个 `button` 的
  font-family 从 Arial 变继承、line-height 从 normal 变 px。中和后重测：**4 页 + 设置弹层、
  20 个选择器 × 13 个属性，逐字节相同**（`.test/p18all.js` + `.test/all_base.txt`/`all_vant.txt`）。
- 闸门：⑦ 的 ok 行加「Vant 的三条全局规则已被 base.css 写回现状」，⑮ 加 `app.use(Vant)`/`window.vant`
  两条装配断言（仍 122 项，两条都反向验证过）。

### 后续步骤（每步单独提交、单独全套验收）

| 步 | 内容 | 像素影响 |
|---|---|---|
| 18b | `ToastHost` → `van-toast` | toast 样式/时长/位置 |
| 18c | `DialogHost` → `van-dialog` | 确认框 |
| 18d | `SheetHost` → `van-popup` | 弹层外壳（`.sheet`/`.panel`/`.grip`）；`#sheetBody` 内容不动 → dom_equiv3 仍逐字比 |
| 18e | 设置页开关 → `van-switch`、骨架屏 → `van-skeleton`、提醒时间 → `van-picker` | 局部 |

纪律：没动的页面 DOM 必须逐字不变（三套 DOM 等价工具是机器保证）；动过的容器重建基线并逐屏截图；
D5/D15 的类名冻结只对**被 Vant 取代的那片**解冻，其余照旧。

**步骤 18b：`ToastHost` → `van-toast`（2026-11-25，全绿）**

先量再动：Vant 的 toast 是 `van-popup van-toast van-toast--bottom van-toast--text`，尺寸/圆角/内距/
位置全部走 `--van-toast-*` CSS 变量（`vant.css:1483` 起），所以旧 `#toast` 的每个值都能一一对上：

| 旧 `#toast` | Vant 变量 | 实测值 |
|---|---|---|
| `background:var(--toast-bg)` | `--van-toast-background` | `rgb(19,26,36)` = `#131a24` |
| `color:var(--toast-fg)` | `--van-toast-text-color` | `rgb(255,255,255)` |
| `font-size:var(--fs-md)` | `--van-toast-font-size` | `14.04px`（13px × 系统字号） |
| `border-radius:var(--r1)` | `--van-toast-radius` | `8px` |
| `padding:var(--s2) var(--s4)` | `--van-toast-text-padding` | `8px 16px` |
| `bottom:calc(var(--toast-bottom) + safe-area)` | `--van-toast-position-bottom-distance` | `96px + env(safe-area-inset-bottom)` |
| `min-width:0` | `--van-toast-text-min-width` | `0`（Vant 默认 96px，会撑宽） |
| `max-width:86vw` | `--van-toast-max-width` | `86vw` |

映射表放在 `tokens.css` 的 `:root` 里（`--toast-*` 定义之后），注释写明「Vant 只认 `--van-*`，
这张表是它和 D6 刻度之间唯一的桥」。`base.css` 删掉 `#toast{}` / `#toast .ic` / `#toast.on` 三条，
只留 `.enote-toast{font-weight:500;box-shadow:…}`（Vant 没有阴影这个维度）。

**行为留在 JS 里**：`app.js toast()` 的 2.2s 定时、200ms 串行队列、`S.toast.on/msg` 三个状态一个没动，
模板换成 `<van-toast v-model:show :duration="0" position="bottom" :message>`。
`:duration="0"` 是关键：Vant 默认 2000ms 自动关，会和 app.js 的 2200ms 定时器抢着关，谁后到谁赢。

**DOM 形状变了（这是本次唯一的像素外变化）**：`<div id="toast" class="on">文案</div>` →
`<div id="toast" class="van-popup … van-toast--text enote-toast"><div class="van-toast__text">文案</div></div>`，
**没弹时节点整个不存在**（旧版是常驻 + 切 `.on`）。z-index 从 90 跳到 Vant 全局 2001。
消费方只有 test.sh 四处：`toastTxt()` 两处（去掉 `.on` 判定，节点存在即弹出）、
设置页保存轮询（加 null 保护）、附件页预览 toast（`tst()` 改成节点存在性）。
测试缝那条（`__enote` 暴露面）顺手补了真弹一次 toast 再断言，否则 `toast` 这个键在不在都过。
`window.__enote.toast` 加进测试缝（app.js），探针不必再手改 `S.toast`。

闸门两处跟着改：⑩ 闲置 token 棘轮现在把 `vendor/*.css` 也当「用的人」扫（`--van-toast-*` 的消费方
就是 vant.css，只扫自己人会把它报成闲置；Vant 自己的 2557 个定义只进 used 不进 defined）；
⑮ 的自定义标签注册表检查放行 `van-*`（走 `app.use(Vant)`，不是 `app.component`，上面两条断言在守）。

验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、`./test.sh --vd` **164 ok / 0 FAIL / PASS**、
三套 DOM 等价工具全部一致（卡片 2495 B、todoRow 651 B、todoTx 454 B、进度层、设置页 236 B 逐字未动）。
设备实测（探针读计算样式）：上表八项全部命中；后台屏截图（记一笔空文本保存）toast 位置、圆角、
配色、阴影与旧版一致，仍在 tabbar 上方。

**步骤 18c：`DialogHost` → `van-dialog`（2026-11-25，全绿）**

结构：标题走 `#title` 插槽（内容仍是 `<h3 id="dlgT">`）、按钮走 `#footer` 插槽（`.dacts` +
`.btn` / `.btn.pri` / `.btn.dg` 原样保留，闸门⑥ 钉的就是 `.dacts .btn{`），Vant 自己那对平铺
文字按钮用 `:show-confirm-button="false"` + `:show-cancel-button="false"` 关掉。读渲染函数确认的
两件事（文档里没写）：footer 插槽**无条件渲染**，不受这两个开关影响；`close-on-click-overlay`
在 van-dialog 里默认 **false**，旧版点遮罩是取消的（`@click.self`），必须显式打开，
并接 `@click-overlay="H.dlgCancel()"`（Vant 自己只把 show 置 false，不会调 onCancel 回调）。

映射表（`tokens.css`，紧跟 18b 的 toast 表）：

| 旧 `.dlg` / `.dbox` | Vant 变量 / 我们的类 | 说明 |
|---|---|---|
| `max-width:400px` + 遮罩 `padding:var(--s5)` | `--van-dialog-width` **和** `--van-dialog-small-screen-width` = `min(400px, calc(100% - var(--s5) * 2))` | 只给前者会在窄屏被 `@media (max-width:320px)` 覆盖 |
| `background:var(--card)` | `--van-dialog-background` | |
| `border-radius:var(--r3)` | `--van-dialog-radius` | Vant 默认 16px |
| 标题 `font-size:var(--fs-lg)` / 行高继承 body | `--van-dialog-font-size:var(--fs-lg)`、`--van-dialog-header-line-height:1.55`、`--van-dialog-header-padding-top:0` | 1.55 就是 base.css 的 body 行高，h3 继承它才是旧版实测的 28.46px |
| 正文 `padding:var(--s4)`、`margin-top:var(--s2)`、`color:var(--dim)` | `--van-dialog-message-padding`、`--van-dialog-has-title-message-padding-top`、`--van-dialog-has-title-message-text-color` | |
| 遮罩 `rgba(0,0,0,.45)` | `--van-overlay-background` | **全局**：18d 换 sheet 时要单独覆盖（旧 `.sheet` 遮罩是 `.5`） |
| 阴影、边框 | `.enote-dialog`（components.css） | Vant 没有这两个维度 |
| 标题色 | `.enote-dialog .van-dialog__header{color:var(--fg)}` | Vant 写死 `var(--van-text-color)` = `#323233`，深色主题下会糊 |

真机计算样式对比（`.test/p18dlg.js` + `.test/dlgcmp.py`，基线 `.test/dlg_base_clean.txt`）：
**正文 / 取消 / 确定 / 标题 零差异**；盒子那几处是定位方式换了（fixed + transform 居中 vs flex 居中），
视觉 top 546.6px vs 546.5px；遮罩只差 z-index（50 → Vant 全局 2001，Vant 的弹层从 2001 起递增，
我们的 tabbar 30 / sheet 40 / toast 90 那套层级以后要整体迁，不要混用）。后台屏截图核对通过。

**踩出来的大坑：Vue 的 `<Transition>` 在不可见窗口上永不结束。** 第一版装完，`test.sh --vd` 从 164
掉到 155，症状是「对话框弹出来看不见、点取消关不掉」。根因不在我们的 CSS：`van-popup` 的显隐是
Vue 的 `<Transition>` 驱动的，`enter()` 与 `leave()` 都在 `nextFrame`（双 `requestAnimationFrame`）
里起跳。Chrome 不给「不可见窗口」出帧 → rAF 不跑 → `enter-from` 类永不摘除
（`van-dialog-bounce-enter-from{opacity:0}` 永久留着 → 弹层全透明），`leave()` 永不结束
（`display:none` 永不落下 → 关不掉、遮罩留在屏上）。真机前台不受影响，虚拟屏必踩，
息屏时后台弹出的对话框是同一类场景。探针实测（`.test/p18vd2.js` 读 leave 期间的计算样式）：
`animDur=0s animName=none transDur=0s op=1 disp=` —— CSS 时长已经归零，节点仍然关不掉，
因为 Vue 连 `getTransitionInfo` 都放在 `nextFrame` 里，量到 0 也照样先进 rAF 回调。

改法：显隐退回 **`v-if` + `:show="true"`**（`ToastHost` 同步改，18b 是同一隐患）。「对话框在不在」
是状态的纯函数：创建即可见、销毁即消失，Vant 那些 `van-fade-*` / `van-dialog-bounce-*` /
`van-popup-slide-*` 类一个都不出现（`transitionAppear` 默认 false，挂载不走 appear 过渡），
入场动效由 `.enote-dialog` / `.enote-toast` 上的 `pop` 关键帧提供（CSS 动画走合成器，不经过 Vue）。
代价：节点随开合创建/销毁，静息态没有 `#dlg` / `#toast` —— 测缝契约改成「先弹一个再读」
（新增 `seam dlgseen=1` 断言），与 17i 的 `#sheet`、18b 的 `#toast` 完全同构。
`views/shell.css` 与 `js/shell.js` 各留一段注释，防止以后有人把 v-if 改回 `v-model:show`。

test.sh：三处对话框轮询（设置页清空、笔记删除、附件删除）从「`.on` 类」改成「`offsetParent`
可见性」判定 —— 对旧实现和新实现都成立；测缝补开合一次对话框。闸门两处：⑥ 的选择器
`.dlg .dacts .btn{` → `.dacts .btn{`；「var() 解析不了」那条现在把 `vendor/*.css` 的 `--van-*`
定义也算进 defined 集合（否则 `var(--van-text-color)` 被报成整条声明失效）。

验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、`./test.sh --vd` **164 ok / 0 FAIL / PASS**、
三套 DOM 等价工具全部一致（卡片 2495 B、todoRow 651 B、todoTx 454 B、进度层、设置页 236 B 逐字未动）。

**步骤 18d：`SheetHost` → `van-popup`（2026-11-25，全绿）**

分工变了：定位（fixed 贴底、宽 100%）、遮罩、滚动锁定（`useLockScroll`）、z-index 分层归 Vant；
`.sheet` 只剩「宽屏上把面板居中」+ 面板自己的样式 + 入场动画。类名契约一个没动：`#sheet` 上的
`.on` / `.page`、`#panel`、`#sheetBody`、`.grip`、`.pclose` 全在 —— test.sh 的 8 处 `#sheet.on`
选择器、闸门⑥ 的 `.sheet`、闸门⑦ 的 CASCADE 基线全部照旧。

| 旧 `.sheet`（base.css） | 现在 | 说明 |
|---|---|---|
| `position:fixed;inset:0;z-index:40` | `.van-popup.van-popup--bottom`（Vant） | z-index 由 Vant 全局计数器给，从 2001 起每开一个 +1 |
| `display:none` / `.on{display:flex}` | `v-if`（节点在不在）+ `.sheet{display:flex}` | 与 18b/18c 同一个理由：Vue 的 `<Transition>` 靠双 rAF 排程 |
| `background:rgba(10,16,26,.42)` + `backdrop-filter:blur(6px)` | `.sheet-ovl`（挂在 Vant 的 `.van-overlay` 上，`overlay-class` 送进去） | 配色与毛玻璃逐字未动 |
| `.sheet.closing .panel{animation:down}` | 同名同规则，`.closing` 由 `closeSheet` 的定时器挂/摘 | 17i 的 `<transition :css="false">` JS 钩子整批退役 |
| （无） | `.sheet{background:transparent;overflow:visible}` | `.van-popup` 自带白底与 `overflow-y:auto`：白底会在面板圆角外露出一圈，overflow 会裁掉面板往上散的阴影 |
| （无） | `.sheet.page{height:100%}` | 全屏页形态要根节点撑满 |

**遮罩是唯一的例外**：Vant 的 Overlay 组件自带 `<Transition appear>`（不受我们的 v-if 影响），
挂载时挂 `van-fade-appear-from{opacity:0}`，摘这个类同样要等一次 rAF —— 不可见窗口上遮罩会永久
透明。`views/shell.css` 加一条 `.van-overlay.van-fade-enter-from,.van-overlay.van-fade-appear-from
{opacity:1}` 钉死：迁移前遮罩是瞬间出现的（`display:none→flex` 不触发 transition），「不淡入」
本来就是现状，特异度 (0,2,0) 压过 Vant 的 (0,1,0)。

**收场动画回到「JS 加类」**：`shell.sheet` 新增 `mounted`（节点在不在）与 `on`（看不看得见）分离。
`closeSheet()` = `on=false`（挂 `.closing` 播动画）+ `setTimeout(cssMs('--d1')+20)` 摘节点，
摘节点时 van-popup 的 `@vue:unmounted` → `sheetLeft()` 拆弹层内容的 app（闸门⑱ 的契约从
`@after-leave` 换成 `@vue:unmounted`，并新增「不许再用 `<transition>`」「时长必须从样式表读」
「摘节点的定时器必须带状态守卫」三条）。定时器在后台标签页被节流到 1s，但它会跑；CSS 动画走
合成器，不受影响 —— 这正是 17i 当初选 JS 钩子的理由，现在连 Vue 的过渡组件都不用了。

踩到的坑：`cssMs` 第一版把 `getPropertyValue('--d1')` 的 `"110ms"` 当秒乘了 1000 → 110 秒后才摘
节点，`test.sh --vd` 报「关掉弹层之后还有 sheet 活着（sheets=settings）」。CSS 时长带单位，
`parseFloat("110ms")` 给的就是毫秒数，必须认后缀。

z-index：进度层 `.ovl` 从 80 提到 **9000**（旧版是 80 > sheet 40，进度层必须压在弹层之上；
Vant 的 popup 从 2001 起递增，固定层级的东西只能站到它上面，不能混着排）。

设备实测（`.test/p18sheet.js` / `.test/p18card.js` 读计算样式，基线 = `git stash` 出 18c 的构建）：
**page 形态的 `#sheet .panel` / `.phead` / `.pbody` / `.btn`、卡片形态的 `#sheet .panel` / `.grip` /
`.pclose` / `#sheetBody` 全部逐字一致**；`#sheet` 根节点只差遮罩搬走（`background`/`backdrop-filter`
→ `.van-overlay`）、z-index 40→2001、`max-height:100%`（Vant 自带）与根节点从满屏盒变成贴底的
内容盒（透明 + `overflow:visible`，视觉零差别）；关掉之后节点与遮罩都无残留。后台屏截图（运行日志
卡片弹层）核对通过。

验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、`./test.sh --vd` **164 ok / 0 FAIL / PASS**、
三套 DOM 等价工具全部一致（卡片 2495 B、todoRow 651 B、todoTx 454 B、进度层、设置页 236 B 逐字未动）。

**步骤 18e：`van-switch` + `van-skeleton`（van-picker 判定为不适用）（2026-11-25，全绿）**

这是 ⑥ 的收尾：剩下三个 Vant 组件里，`van-switch` 换设置页两个开关，`van-skeleton` 换附件页与
我的页的骨架屏，`van-picker` 没有落点（见末尾的判定）。

**开关：状态重新变成唯一来源。** 旧写法是「像素与状态各改各的」：`onclick="toggleAI(this)"` 把
元素递进函数，函数里 `el.classList.toggle('on')` / `el.className='sw' + (on?' on':'')` 先乐观改
类名，500ms 后再 `settingsRefresh()` 校准。现在 `:model-value` 读状态、`@update:model-value` 写
状态，类名是状态的纯函数（`keepSwCls` / `aiSwCls` 拼 `'sw' + (on?' on':'')`，test.sh 断言的
`on` 类名契约不变），`toggleKeepAlive()` / `applyKeepAlive(on)` / `toggleAI()` 三个 handler 的
元素参数与两处 DOM 写操作一起删掉，乐观那一步交给 computed（`applyKeepAlive` 里立刻
`settingsRefresh()`，500ms 那次校准保留）。顺带白拿 `role="switch"` + `aria-checked` + `tabindex`。

尺寸映射是这一步全部的技术含量：Vant 的开关**全部由 font-size 驱动** —— 高 = `1em + 4px`、
宽 = `1.8em + 4px`、圆点 = `1em`、位移 = 宽 − 圆点 − 4px。旧 `.sw` 是 46×26（不是 2:1），所以
`--van-switch-size:22px`（高正好 26px）+ `--van-switch-width:46px`（位移自动算成 46−22−4 = 20px，
与旧版 `left:3px→23px` 逐字相同）。圆点 22px（旧版 20px）是这一步唯一的像素差，两边都垂直居中。
`base.css` 的三条 `.sw` 规则只剩两条：`flex:0 0 46px`（`.setrow` 给开关留的宽度，删了整行会挤）
和 `transition-timing-function:var(--ease)`（Vant 的轨道 transition 没写 timing-function、圆点写死
`cubic-bezier(.3,1.05,.4,1.05)` 回弹，旧版两处都是 `var(--ease)`）。`.sw.dis{opacity:.45}` 是死代码
（JS 与 test.sh 都不挂这个类），删掉，禁用态改由 `--van-switch-disabled-opacity` 给。

**骨架屏：`.skel` 的三种高度按位置补。** Vant 的骨架是「标题 + 一排等高段落」，我们是
120 / 14 / 10 px 三档，所以 `components.css` 用 `:nth-child` / `:last-child` 把高度与圆角补回来，
动画保留我们自己的渐变扫过（`shim`）而不是 Vant 的整块 blink。`:animate="false"` 是必需的：
Vant 的 `van-skeleton--animate` 会给根节点挂一个 opacity 呼吸动画（实测 opacity 在 0.73~1 之间跳），
与 shim 叠在一起就是双重动画。`.skel` 类名留在根节点（test.sh 用它判定「还在加载」）。

**闸门两处**：常驻后台那条签名断言（`function toggleKeepAlive(el)`）改成新签名，并加两条
「DOM 写操作不许回来」的负断言（`applyKeepAlive(on)` 里必须能看到 `settingsRefresh()`、
`el.className='sw'` 必须不存在）；闸门㉔（组件模板里的自定义标签必须在自己的 `components:` 里
声明）加 `van-*` 豁免 —— 与闸门⑮ 同源：Vant 走 `app.use(Vant)` 全局注册，那条断言在闸门⑮
里钉着，两处豁免必须成对出现，否则一边改另一边假绿。

**van-picker 判定：不适用。** 计划里写它对应「时间选择器」，但 app 里没有 app 内的时间选择器：
添加待办的日期/时间是原生 `<input type="date">` / `<input type="time">`（`views/sheets.js:131`），
点开的是**系统**控件（Android 原生日历/时钟弹窗）。换成 `van-picker` 是换交互（滚轮 vs 系统弹窗），
不是换实现，属于「新增功能」，而 ⑥ 的边界是「只用 Vant 重写已有 UI」。所以本步不动它，
`van-picker` 随 `app.use(Vant)` 一起可用，将来要做「app 内滚轮选时间」时直接取用。

设备实测（`.test/p18sw.js` 读计算样式，基线 = `git stash` 出 18d 的构建，比对器 `.test/cmp_sw.js`）：
开关轨道（46×26、`--grip`/`--acc2`、`background-color 0.18s`）、圆点（22px、白、无阴影、
位移 20px、`var(--ease)`）、开/关两态与「点一下翻转」全部对齐；骨架屏三条（120/14/10 px、
圆角 12/8/8、margin 8/8/0、宽度 100%/100%/45%、渐变与 shim 动画）**逐字一致**。
四条允许的结构性等价（同一个像素的两种写法，写在比对器里）：轨道圆角 999px→22px（26px 高的盒子上
两者都 ≥ 半高，都是胶囊）、圆点圆角 50%→100%（正方形上等价）、位移 `transition:left`→
`transition:transform`、轨道 `transition-property:background`→`background-color`（只有颜色在变）。
类名从 `sw on` 变成 `van-switch van-switch--on sw on`（Vant 的类在前，我们的在后，`on` 契约不变）。
我的页骨架屏（同一套 CSS 的两行变体）在探针里抓不到：本机 `/api/stats` 往返 < 16ms，加载帧
观察不到（`__enote.ST=null` 之后 rAF 里已经画完），附件页那一页的三行变体已逐字覆盖同一批规则。

顺手修了探针一处污染：`.test/probe_sheets.sh` 读 `fab_notes` 前必须 `tabPick("files")` 再
`tabPick("notes")` 走一趟 —— `tabPick` 对「已经在的页签」是早退（app.js:1565 只滚回顶部），
上一支探针停在附件页时 fab 不会被重写，症状是 `dom_equiv3` 的「fab 图标 · 笔记页」抓到 `#i-clip`。

验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、`./test.sh --vd` **164 ok / 0 FAIL / PASS**、
三套 DOM 等价工具全部一致（卡片 2495 B、todoRow 651 B、todoTx 454 B、进度层、设置页 236 B 逐字未动）。
设置页开关与附件页骨架屏各有一张 VD 截图核对（`.test/shot_18e_settings.png` / `.test/shot_18e_skel.png`）。

## 9.41 P14 S6：全项目最后一处 innerHTML 字符串渲染换成响应式模板（步骤 19）

P14 路线图 ①–⑥ 走完（⑥ Vant 见 §9.40）之后继续「优化代码质量」。扫下来剩下的最大一块
字符串 HTML 是设置页「测试连接」的结果区：`testLLM()` 拼字符串 + `esc()` 写
`$('#llmOut').innerHTML`，是全项目最后一处 `innerHTML=` 赋值（其余命中全在注释里）。
它与闸门㉓ 已经钉死的 v-html 是同一个面：字符串 HTML 绕过模板编译（闸门⑮）、绕过
handler 扫描（闸门①），`esc()` 漏一个就是 XSS 面。

**改法**：app.js 加一个 `var LLMTEST = Vue.reactive({ v: null })`（整包赋值，所以宿主侧是
getter，同 `LOGDATA` / `DEBUGDATA`），`testLLM()` 只写状态：

```js
async function testLLM(){
  LLMTEST.v = {busy:true};
  var r = await api('/api/llm/test',{});
  LLMTEST.v = {busy:false, ok:!!r.ok, ms:r.ms, httpCode:r.httpCode, reply:r.reply, error:r.error};
}
```

`settings.js` 的模板画三态（未测 = 空、连接中 = `<span class="spin">` + 文本、结果 = 一行结论
+ `<br>` + 回复/错误原文），转义交给插值（textContent），`esc()` 不再需要。宿主接口加
`get llmTest()`，`HOST_KEYS['sheet:settings']` 21 → 22 个 key（闸门⑮ 的越界检查会红）。

**闸门㉓ 扩一半**：原来只扫组件模板里的 `v-html`，现在同时扫 `go/ui/js/**.js`（剔注释后）里的
`.innerHTML =` / `.outerHTML =` 赋值，ok 行改成「v-html 归零，JS 里 innerHTML 赋值归零」。
反向实验：往 app.js 塞一行 `x.innerHTML='<b>hi</b>'` → 立刻红并点名 app.js。闸门总数仍 122。

设备 A/B（`.test/p19llm.js` 读 `#llmOut` 的 outerHTML，基线 = `git stash` 出 18e 的构建，
比对器 `.test/cmp_llm.js`）：连接中态与结果态**逐字一致**，未测态只差 v-if 的注释占位
`<!---->`（不产生元素，三套 DOM 等价工具的归一化也吃它）。结果行的 `style` 属性文本从
`margin-top:var(--s2)` 变成 `margin-top: var(--s2);` —— 旧版是 innerHTML 解析保留原文，
Vue 写 `el.style.cssText` 后浏览器重序列化，计算样式相同（步骤 16b 记过同一条）。
大模型回复文本与耗时每次不同，比对器把这两处归一化成占位。设置页结果区有一张 VD 截图核对。

验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、`./test.sh --vd` **164 ok / 0 FAIL / PASS**、
三套 DOM 等价工具全部一致（卡片 2495 B、todoRow 651 B、todoTx 454 B、进度层、设置页 236 B 逐字未动）。

## 9.42 P14 S6：设置页六个输入框的值搬进状态（步骤 20）

步骤 19 之后继续。`saveSettings()` 是全站最后一处「把 DOM 当用户输入的真相源」：
`$('#sUrl').value.trim()` 连读五个输入框，Vue 那一侧完全看不见正在打的东西。后果都写在
旧注释里——`settingsRefresh()` 专门警告「重建会把输入框里正在打的字清掉」，夹具想改一个
字段只能写 DOM，探针也读不到表单当前值。

**改法**：app.js 加 `var SFORM = Vue.reactive({ v: null })` + `formFill()`（从 `S.settings`
灌初值，打开设置页时调用，保存成功后用服务端回包重灌）+ `formInput(k, v)`（逐键写）。
`settings.js` 的六个输入框改成 `:value.attr="f.xxx" @input="H.formInput('xxx', $event.target.value)"`，
`f` 是 `computed(() => H.SFORM || {…默认值})`。宿主接口加 `get SFORM()` / `formInput`，
`HOST_KEYS['sheet:settings']` 22 → 24 个 key。

**为什么不用 `v-model`**：`v-model` 写的是 DOM property，序列化出来没有 `value` 属性，而
`#sUrl` 的 value 属性是 test.sh 钉住的契约（`urlAttr=1`，它同时保证「新建 input 的初值从
属性来，保存不会存空值」）。`:value.attr` + `@input` 是同样的双向效果、属性真的在 DOM 上。

**顺带修掉的**：`settingsRefresh()` 那条「重建会吞字」的注释过时了（值在 SFORM 里，重建不丢），
注释改成真原因——重建会打断 Android 输入法的组合中状态（拼音打一半被吞）。

设备验证（`.test/p20form.js`）：打开设置页 → 往 `#sModel` 写值并派发 `input` →
`__enote.vue.host.SFORM.model` 立刻是 `probe-model`、`value` 属性跟着变 → `saveSettings()`
存进去（toast「已保存」、`S.settings.model` 回读一致）→ 关掉重开显示保存值 → 复原为 `exec`。
DOM A/B（`.test/p20dom.js`，基线 = `git stash` 出步骤 19 的构建）：六个输入框的 outerHTML、
`#sUrl` 的七项计算样式与盒子矩形**逐字一致**（91/63/32/32/30/30 B、计算样式 157 B、`711x41@56,629`）。

验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、`./test.sh --vd` **164 ok / 0 FAIL / PASS**
（第一轮撞上既有的 OCR 抖动块，重跑绿）、三套 DOM 等价工具全部一致。

## 9.43 P14 S6：记一笔 / 添加待办两个弹层的表单值搬进状态（步骤 21）

步骤 20 之后继续。剩下「把 DOM 当用户输入真相源」的地方只剩两个弹层：`addNote()` 读
`$('#addText').value`，`addTodo()` 读 `$('#tText')/#tDate/#tTime/#tPri` 四个。

**改法**：app.js 加 `var FORMS = Vue.reactive({ v: { add: null, todo: null } })` +
`formSet(name, k, v)`；`addSheet()` 灌 `{text:''}`，`addTodoSheet(nid)` 灌
`{text:'',date:'',time:'',pri:'normal'}`（两个弹层每次都是新建，不需要从服务端灌）；
`addNote()` / `addTodo()` 读 `FORMS.v.add` / `FORMS.v.todo`。模板侧 textarea / 三个 input
用 `:value="f.x" @input="H.formSet(...)"`，select 用 `@change`。宿主接口加
`get FORMS()` / `formSet`，`HOST_KEYS` 的 `sheet:add` 2 → 4、`sheet:addtodo` 2 → 4。

**与设置页（步骤 20）的差别**：这里用 `:value`（DOM property）而不是 `:value.attr`——
这些元素今天 DOM 上没有 value 属性，写 property 保持序列化不变；设置页那六个必须写属性
（test.sh 钉住 `#sUrl` 的 value 属性）。

**踩到的新坑（Vue 3.5 行为，记下来）**：`:value` 在 Vue 3.5 里不只是写 property——
`patchProp` 走 prop 路径之后会紧跟一次 `patchAttr`（`vendor/vue.global.js:12276`：
`patchDOMProp(...)` 之后 `if (key === "value" || "checked" || "selected") patchAttr(...)`），
所以绑定之后 DOM 上真的多出 `value=""`（input/textarea）与 `value="normal"`（select）。
浏览器自己不会这么干（探针实测 `document.createElement("input").value=""` 序列化无属性）。
它是默认值、与 property 相同，行为不变，但 DOM 序列化变了，于是：
`.test/dom_equiv3.js` 加一条归一化（只剥 input/textarea/select 自己开标签上的 value，
option 的 value 有意义，不能碰）。

设备验证（`.test/p21form.js` / `.test/p21verify.js`）：记一笔输入 → `FORMS.add.text` 同步 →
保存后笔记出现（标题「步骤 21 探针笔记」，AI 解析成功）；添加待办输入事项 + 日期 2030-01-02 +
时间 03:04 + 优先级 high → `FORMS.todo` 四项全对 → 卡片里出现「步骤 21 探针待办 … 03:04 … 重要」
→ 删笔记级联删待办（探针数据自清理）。DOM A/B（`.test/p21dom.js` + `.test/cmp_f21.js`，
基线 = `git stash` 出步骤 20 的构建）：五个元素的 outerHTML、八项计算样式与盒子矩形、
select 的 selectedIndex/value **17 项全部逐字一致**（按上面那条归一化）。

验收：122 闸门、`GO_TEST=1 ./build.sh`、`./install.sh`、`./test.sh --vd` **164 ok / 0 FAIL / PASS**、
三套 DOM 等价工具全部一致；记一笔弹层一张 VD 截图核对（`.test/shot_21_add.png`）。
