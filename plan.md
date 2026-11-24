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
* 断言里应显式写出 `src` / `status` / `pri` / `kind`，不要只断言数量。
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

**记进步骤 14 的账**

* 闸门⑮ 的弱点：把 `H.xxx` 的 `live(() => …)` 换成普通函数，所有静态闸门全绿，而 computed 永久
  缓存 → 用户侧「点了没反应」。需要一条能区分「computed 的 getter」与「普通函数」的检查。
* SIT 里还有 `q()[0]` 这类索引选择器，DOM 顺序一变就测到别的元素；换成稳定 id。
* `prefPayload` 的 `done:'all'` 只有服务端覆盖，客户端（待办页筛选）没有回归。
* 断言要显式写出 `src`/`status`/`pri`/`kind`，不要只断言数量（§9.17 审计条目，步骤 12 收了一半）。
* `clipParse` 的真 LLM 路径与 `clipError` 分支没有客户端回归（现在只在 Go 侧测）。
