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
