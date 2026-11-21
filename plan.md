# eNote 开发计划 v2：界面重构 + 附件页 + 剪贴板收集 + 明暗主题

> 状态：**计划，未开发**。本文档写给下一台开发设备（或下一个我）。
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
| **R7** | 加通知权限、常驻通知、监控剪贴板；复制的文字+图片先暂存不解析；打开 app 后批量勾选、一键解析 | 前台服务 + 常驻通知；剪贴板监听；暂存队列（文字/图片）；批量勾选 UI；批量入队解析 |
| **R8** | 明暗主题切换，默认亮色 | CSS 变量双主题；`theme` 设置项（light/dark/auto）；状态栏 + `theme-color` 同步；默认 light |

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

2. **剪贴板（R7，最大的坑）**：Android 10（API 29）起，**非前台应用读不到剪贴板内容**——`getPrimaryClip()` 在后台返回被裁剪的占位内容，**前台服务不豁免**（豁免对象只有输入法和无障碍服务）。可行的三种方案：

   | 方案 | 做法 | 代价 |
   |---|---|---|
   | **A（推荐）** | 前台服务常驻 + `addPrimaryClipChangedListener` 只记"变化事件 + `ClipDescription` 元数据（mime、条目数、时间、`hasImage()`）"；**内容在 app 回到前台时补读**（drain 队列）；常驻通知带"查看剪贴板"动作，点它把 app 拉到前台即触发补读 | 用户复制后如果从不打开 app，内容不会被抓（后台只能拿到元数据） |
   | B | 无障碍服务读取，后台可读全文 | 要用户去设置里开"无障碍"权限，路径深、解释成本高 |
   | C | 不做监听，常驻通知上放"粘贴一条"按钮，点击→前台→读剪贴板 | 最省，但违背"监控剪贴板"的原意 |

   图片剪贴板：`ClipDescription.hasImage()`（API 24+）可判断；相册/微信复制出来的图常是 `content://`，要 `takePersistableUriPermission` 才能长期读，拿不到权限时降级为"只记元数据 + 提示用户手动添加"。
   实现纪律：**用 listener，不要轮询剪贴板**（轮询费电且 Android 12+ 会弹"来自 XX 的粘贴"提示，很吵）。

3. **通知（R7）**：targetSdk 33 → `POST_NOTIFICATIONS` 是运行时权限，必须 `requestPermissions`；常驻通知需要前台服务（`FOREGROUND_SERVICE` 权限 + 通知渠道 `IMPORTANCE_LOW`，别响铃）。若以后把 targetSdk 升到 34+，前台服务必须声明 `foregroundServiceType`（`specialUse` 最贴合），现在先留注释。

4. **主题（R8）**：现在是硬编码深色（`go/ui.html:8-13` 的 `:root`）。做法：`:root` 放**亮色**（默认），`html[data-theme=dark]` 覆盖；`<meta name=theme-color>` 与状态栏图标由 Java 侧同步（`Bridge.setTheme(mode)`）。`auto` 用 CSS `prefers-color-scheme` + Java 侧 `UiModeManager` 双向同步。**所有颜色必须走变量**，任何硬编码 `#0b0f14` 都是 bug——这条要写进验收。

5. **附件（R4）**：现在一条笔记最多一张图（`Note.ImagePath`）。泛化成 `Note.Attachments[]`，兼容策略选**惰性迁移**：加载时若 `imagePath` 非空且 `attachments` 为空，就合成一条附件记录；写入时双写（`imagePath` 保留），这样旧读取路径（`/img?id=`、卡片缩略图）不用一起改。分享接收的 intent-filter 若要收任意文件，加 `<data android:mimeType="*/*" />` 的 SEND —— 这会让 eNote 出现在**所有**分享菜单里，是产品决策（见 §3.4）。

6. **搜索（R3）**：中文不做分词，直接大小写不敏感子串匹配（title/content/rawText/ocrText/tags/todos 全参与），数据量级（几百条）线性扫完全够，别引入 boltdb/sqlite。

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

Java 侧新增：`ClipService`（前台服务，常驻通知，clip listener）、`NotificationCh`（渠道）、`Bridge.setTheme(mode)`、`Bridge.drainClipboard()`。

### 3.4 需要用户拍板的问题（开发前问一次，别猜）

1. **剪贴板方案选 A / B / C？**（§3.2 表；默认建议 A：后台只记元数据，回前台补读内容）
2. 常驻通知**默认开还是默认关**？可否在设置里彻底关闭？（默认建议：开，设置里可关）
3. 附件分享入口要不要 `*/*`（出现在所有分享菜单，包括 PDF/文档/音频）？还是先只加 `application/pdf` + `text/*`？
4. 附件页要不要"从文件管理器添加"入口（现在只有图片选择器）？
5. 主题要不要"跟随系统"选项（用户只说了明暗切换 + 默认亮色）？（默认建议：提供 light/dark/auto 三档，默认 light）
6. 搜索要不要搜 OCR 原文（`ocrText`）？搜了会命中大量身份证/证书里的噪声文字。（默认建议：搜，但结果里标注来源为"图片文字"）
7. 待办页顶栏的搜索/筛选是否要包含"已完成"？（默认建议：默认筛选=未完成，面板里可勾选已完成）

---

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

### P2 外壳重构（R2a + R2b + R6 骨架）
* nav 改 4 tab：`笔记 待办 附件 我的`；`设置` tab 移除（临时把设置挂在"我的"页顶部，P5 完成）。
* FAB 从 nav 里拿出来：`position:fixed; right:16px; bottom:calc(84px + env(safe-area-inset-bottom))`，**圆角矩形**（`border-radius:16px`，带图标+文字"新建"），随页面语义变文案/动作；滚动时轻微缩小（纯 CSS，别加 JS 动画库）。
* 顶栏组件化：`topbar(mode)` 生成 `icon + 搜索框 + 排序筛选按钮`，笔记/待办/附件三页共用；"我的"页用独立 header（P5）。
* 现有 `renderSettings()` 保留但只从"我的"进入，保证阶段结束时功能不丢。
* 验收：4 个 tab 可切换且各自内容正确；FAB 在四页语义正确（笔记=记一笔 / 待办=加待办 / 附件=添加文件 / 我的=无 FAB）；FAB 不遮挡列表最后一项（列表底部 padding 计算）；`test.sh` 加断言：`/api/state` 正常 + VD 上 tap 四个 tab 后截图。

### P3 搜索 + 排序 + 筛选（R3）
* 后端 `/api/search`（§3.3），Go 单元测试覆盖：中文子串、tag 命中、todo 文本命中、各 sort、各 filter、dir。
* 前端：搜索框防抖 250ms；排序筛选按钮弹**浮动面板**（复用 `.sheet`/panel 组件），面板内容 = 排序字段 + 升降序 + 筛选 chips（来源、状态、有无附件、有无未完成待办、标签、日期范围）；按钮上显示"已启用 N 项筛选"徽标；条件写进 `settings.ui.<page>`，切页/重启后记忆。
* 空结果态、搜索中态、命中关键词高亮。
* 验收：`test.sh` 加：写入 3 条测试笔记 → `/api/search?q=牛奶&sort=created&dir=desc` 命中 1 条；`filter=hasFile` 命中图片笔记；`due=overdue` 命中逾期项；UI 上 tap 搜索→输入→tap 筛选→勾选→截图。

### P4 附件页（R4）
* 数据：`Note.Attachments[]`（`ID,NoteID,Name,MIME,Size,Path,CreatedAt,Source`）+ 惰性迁移（§3.2.5）；`Store.remove` 从删单图改成遍历删附件文件（现有逻辑在 `go/store.go` 的 `remove`，已实现单图删除，扩展成遍历）。
* 后端：`/api/attachments`、`/file?id=`；分享接收扩展 mime（按 §3.4 第 3 条的答复）；`Bridge.pickFile()`（`ACTION_OPEN_DOCUMENT`，取 persistable 权限）。
* 前端：网格视图（图片=缩略图卡片，其他=类型图标 + 文件名 + 大小 + 日期），点击**暂不打开**（点击给 toast "预览即将上线"），长按/卡片菜单可"跳到所属笔记"和"删除附件"；顶栏排序筛选组件作用于本页（按大小/名称/时间/类型）。
* 验收：分享一张图 + 分享一段文本 → 附件页只多一条；`/api/attachments` 数量与磁盘文件数一致；删除笔记后附件文件从磁盘消失（`su --mount-master` 数文件）；截图网格页（图片卡 + 非图片卡）。

### P5 我的页 + 设置面板（R5 + R6）
* `/api/stats`；我的页独立视觉：头像区（应用图标 + 本地数据摘要）、统计卡片（笔记/待办/附件/AI 调用）、近 7 天柱状（纯 CSS）、入口列表（设置、主题、AI 调用记录、导出、导入、关于）。
* 设置改成**全屏面板**（从"我的"进入），分组：AI（端点/Key/模型/超时/maxTokens/温度/开关 + 测试连接）、外观（主题三档）、采集（剪贴板监听开关，P6 后启用）、OCR（引擎状态、重新识别）、数据（导出/导入/清空）。
* 删掉 P1 的临时调试入口（长按品牌字切换主题）。
* 验收：`/api/stats` 数字与 `/api/state` 一致；设置面板保存后重启 app 保持；主题在设置里切换即时生效；截图（我的页 light + dark、设置面板）。

### P6 剪贴板收集 + 常驻通知 + 批量解析（R7）— 最大，独立发布
* 权限：`POST_NOTIFICATIONS` 运行时申请（Android 13+）、`FOREGROUND_SERVICE`；首次进入"我的"页时引导开启（一次性说明为什么需要常驻通知）。
* `ClipService`：前台服务 + 常驻通知（`IMPORTANCE_LOW`，不响铃），通知内容 = "已暂存 N 条 · 点按查看"，动作按钮 = 打开 app。
* 监听：`addPrimaryClipChangedListener` → 记录元数据（时间、mime、条目数、`hasImage()`、文本长度）；**内容在 app 回前台时补读**（方案 A）；图片 clip 拷进 `attachments/`（`content://` 取 persistable 权限，失败降级为元数据）。
* 去重：与上一条内容 hash 相同则跳过；同一来源 5 秒内多次变化只留最后一条。
* 暂存区 UI：笔记页顶部出现"剪贴板 N 条待处理"横幅 → 进入批量勾选页（全选/反选、逐条预览、显示来源与时间）→ **一键解析**（`/api/clip/parse` 批量入队，复用现有 ingest 队列，状态沿用 `queued→parsing→done`）；也提供"原样存为笔记"（不调 LLM，省 token）。
* 隐私纪律：**未点"解析"之前，剪贴板内容绝不发到大模型**；设置页明确写出这一点。
* 验收：`am broadcast`/手动复制文字与图片 → 队列出现 N 条且未产生笔记（`/api/state` 笔记数不变）→ 勾选 2 条 → 一键解析 → 生成 2 条笔记且 `source=clip-text`/`clip-image`；`test.sh` 加 `/api/clip` 全链路断言；常驻通知在通知栏可见（截图）；关闭开关后服务停止（`dumpsys activity services` 无 ClipService）。

### P7 收尾打磨
* 状态栏/导航栏颜色随主题；FAB 与 sheet 的动效统一（150ms，`prefers-reduced-motion` 降级）；列表长文截断、无障碍（tab 的 `aria-label`、点击目标 ≥44px）。
* `README.md` 更新（新界面截图、剪贴板说明、权限说明）、`CHANGELOG.md`、`test.sh` 全量回归。
* 可选（有余力再做）：导入 JSON、待办到期提醒通知、附件预览。

### 里程碑勾选表

```
[ ] P0 状态栏可见，无 ANR
[ ] P1 亮/暗主题，默认亮色，颜色全走 CSS 变量
[ ] P2 4 tab + 圆角矩形 FAB + 共用顶栏骨架
[ ] P3 搜索 + 排序 + 筛选面板（三页共用，条件持久化）
[ ] P4 附件页（附件模型 + 网格 + 通用文件服务）
[ ] P5 我的页（统计）+ 全屏设置面板
[ ] P6 常驻通知 + 剪贴板暂存 + 批量一键解析
[ ] P7 打磨 + 文档 + 全量回归
```

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
| P6 | `/api/clip` 入队→不产生笔记→`/api/clip/parse`→产生笔记；`clipWatch=false` 后服务不在 `dumpsys activity services` |

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
| 单文件 `ui.html` 膨胀到难维护 | 开发变慢 | P2 时按 `topbar/nav/sheet/render` 分区注释；超过 ~900 行就拆文件（保留打包步骤） |
