# P11 设计：截图捕获（自动扫描新截图 → 暂存区 → 一次导入笔记）

> 状态：**已实现**（2026-11-22，P11 落地，`test.sh` P11 段 + `go test` + `ui_test` 全绿；
> 当时的静态检查叫 `ui_sig_test.js`，S6 步骤 11 已并入 `tools/ui_test.js`）。
> 实现与本文的差异只有两处，都是落地时按代码结构定的：
> 1. 没有 `/api/shots/import`——OCR 只能在 Java 侧（ML Kit）做，导入由 `Android.importShots`
>    发起，Go 只负责暂存/去重/忽略表（多图合并走 `kind=images` 入队）。
> 2. 文件夹列表不走 SAF（§2 已说明理由），全部来自 MediaStore 枚举。
> 踩坑与验收细节见 `CHANGELOG.md` 的 P11 段和 `plan.md` §8。

## 1. 目标

1. 每次打开 app（`onResume`）时，发现**用户选定的监控文件夹**里新增的图片（默认就是截图目录）。
2. 记住「上次扫到的位置」（水位），下次只报新增的，不重复 nag。
3. 首页顶部出现提示条：「发现 3 张新截图 · 整理 ›」。
4. 点进去是页内弹层：缩略图网格 + 多选，两种导入方式：
   * **合并成一条笔记**：N 张图 = 一条笔记，N 个附件，OCR 文本合并后只调一次 LLM；
   * **各存一条**：N 张图 = N 条笔记（各自 OCR + 解析）。
5. **首次运行**引导用户选监控文件夹（可多选，默认勾选截图目录），设置页随时可改。
6. **处理期间**显示醒目的进度提示 + 屏幕常亮，明确告诉用户不要黑屏、不要退出 app。

## 2. 非目标（明确不做）

* 不删原图——监控文件夹只读。
* 不做后台常驻扫描（只在打开 app 时扫）。
* 不做云同步/相册浏览；不做视频（`.gif` 当图片，视频忽略）。
* **不用 SAF 目录选择器**：MediaStore 会索引共享存储里的所有图片，用户想监控任何图片文件夹
  （微信图片、下载、自定义目录）都能在文件夹列表里勾上；再引一条 SAF 路径只会多一套代码、
  多一种"文件看不见"的故障模式（某些 ROM 的 SAF provider 不给 DCIM）。

## 3. 数据流

```
用户选定的监控文件夹（MediaStore 的 RELATIVE_PATH 前缀，可多个）
   │  系统截图/存图入库
   ▼
Shots.java 扫描            ← 水位 lastAdded(ms) + sha1 去重表 + 文件夹白名单
   │  复制文件到 files/enote/inbox/shot-*
   ▼
POST /api/shots/add        ← Go 侧 shotStore 再按 sha1 + path 去重
   ▼
shot.json（暂存区）  ⇄  /api/shots/list | import | remove | ignore
   ▼
首页 banner → 截图页 → 导入（merge/split/raw）→ 现有 pipeline（enqueue）
```

### 3.1 监控文件夹（多选，P11 的核心改动）

用户不需要记住 `Pictures/Screenshots` 这种路径，配置存在 `shared_prefs/shots.xml`：

```xml
<set name="folders">
  <string>Pictures/Screenshots</string>
  <string>DCIM/Screenshots</string>
  <string>Pictures/WeiXin</string>
</set>
```

* 文件夹列表由 **MediaStore 枚举**得到（`RELATIVE_PATH` 聚合 + 图片张数 + 总字节），
  所以魔改 ROM 把截图放哪都能被列出来（这台机器是 `Pictures/Screenshots`，AOSP 是
  `DCIM/Screenshots`，都在列表里）。
* 扫描条件：`RELATIVE_PATH IN (选中前缀) …` 逐文件夹查，或 `RELATIVE_PATH LIKE 'x/%'`；
  同时在 Java 侧保留 bucket 名兜底（`BUCKET_DISPLAY_NAME IN ('Screenshots','截图','截屏')`），
  命中即算截图类，用于**默认勾选**。
* 空文件夹/被删除的文件夹：扫描时忽略，设置页标灰「文件夹已不存在」。

### 3.2 水位与去重（防止 2834 张历史糊上来）

* 水位 `lastAdded`（毫秒）存 `shared_prefs/shots.xml`。
* **首次启用**（`lastAdded` 不存在）：水位 = 现在，**不回捞历史**。
* 每次扫描取 `DATE_ADDED > lastAdded - 5min`（重叠窗口容忍入库延迟/时钟抖动），
  真正去重靠 sha1。
* sha1 去重表存 `files/enote/shots.json`（最近 500 条）：改名、移动、重复入库都不会再报。
* 扫描成功后 `lastAdded = max(dateAdded)`；**改了监控文件夹也会把水位重置为现在**
  （否则新加进来的老文件夹会一次性倒出几百张），并提示「已开始监控 N 个文件夹，只看之后的新图」。

### 3.3 为什么复制文件而不是存 URI

* MediaStore 的 URI 依赖权限与用户后续删除；删了原图笔记里的附件就变红块。
* 现有 `/img`、`/file`、OCR 只认 app 私有目录里的真实文件路径。
* 代价是磁盘双份 → 我的页显示「截图暂存占用 12.4 MB」，导入后可清空。

复制命名：`inbox/shot-<dateAdded>-<sha1前8位>.<ext>`。

### 3.4 标题

LLM 生成；未配置 AI 或失败 → `截图 N 张 · 11-22 10:12`。

### 3.5 导入期间的长时间任务

`split` 模式 N 张 = N 次 LLM（单次约 10–16 秒），耗时可能几分钟。因此：

* 用户选完点导入时，先弹**确认**：「将生成 N 条笔记，需要 N 次 AI 调用，可能要 N×15 秒」；
  N > 5 时按钮文案强调「这会产生 N 条笔记」，默认聚焦「取消」。
* 导入过程显示**不可关掉的进度层**（§5.5）。
* Java 侧在处理期间给窗口加 `FLAG_KEEP_SCREEN_ON`，结束/失败时清掉——
  **真的别黑屏**，而不只是嘴上说。

## 4. API（新增，全部 JSON）

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| GET | `/api/shots/list` | – | `{ok, shots:[{id,path,name,mime,size,dateAdded,createdAt}], total, bytes, watermark}` |
| POST | `/api/shots/add` | `{shots:[{path,name,mime,size,dateAdded}]}` | `{ok, added, skipped}` |
| POST | `/api/shots/import` | `{ids:[], mode:"merge"\|"split", raw:bool}` | `{ok, notes:[ids], noteId?, error?}` |
| POST | `/api/shots/remove` | `{ids:[]}` | `{ok, removed}` |
| POST | `/api/shots/ignore` | `{ids:[]}` | `{ok, ignored}`（进永久忽略表并删暂存文件） |
| GET | `/shotimg?id=` | – | 暂存图原图（缩略图由 CSS 缩放，不生成缩略文件） |

文件夹相关（不走 HTTP，走 JS bridge —— 它们是 Java 侧的状态）：

| bridge | 说明 |
|---|---|
| `Android.shotState()` | `{enabled, granted, folders:[{path,count,bytes,shot}], watermark}` |
| `Android.listImageFolders()` | MediaStore 枚举 `[{path,count,bytes,shot}]`（需权限） |
| `Android.askMedia()` | 申请 `READ_MEDIA_IMAGES` |
| `Android.setShotFolders(json)` | 保存多选文件夹 + 重置水位 |
| `Android.scanShots(force)` | 立即扫一次（返回新增条数） |
| `Android.keepScreenOn(bool)` | 导入期间保持常亮 |

导入语义：

* `merge`：一条 Note，`Attachments` = 全部 N 张，`ImagePath/ImageName` 双写首图（兼容老路径），
  `OCRText` = N 张 OCR 用 `\n\n---\n\n` 拼接，**只调一次 LLM**，`source=shot-merge`。
* `split`：N 条 Note，逐个 `enqueue`，`source=shot-single`。
* `raw=true`：不调 LLM，OCR 文本存成 `status=raw`。

## 5. UI

### 5.1 首页 banner

```
┌──────────────────────────────────────────┐
│ [图片图标]  发现 3 张新截图               整理 › │
│            截图 · 10:02、10:15、10:31      │
└──────────────────────────────────────────┘
```

* 顺序：`missedBanner()` → `shotBanner()` → `clipBanner()`。
* 三种状态：
  1. **未开启**（首次安装/从未配置）：「自动收集新截图」+「开启 ›」→ 走 §5.4 向导；
  2. **有新增**：上面的样子；
  3. **已开启但没权限/文件夹为空**：「需要允许读取照片才能自动发现截图」+「去授权」，
     点击后才弹系统框（不主动弹，避免首屏惊吓）。
* 无新增且已开启 → banner 不出现。

### 5.2 截图页（`pageSheet`，与剪贴板暂存页同构）

```
‹ 新截图                              已选 2/3
[全选] [全不选]                    [清空暂存]
┌────────┬────────┬────────┐
│ ▣ 图1  │  ▢ 图2  │  ▢ 图3  │   3 列网格，选中盖品牌色边框 + 勾选角标
├────────┴────────┴────────┤
│ 10:02 · 1240×2700         │
└──────────────────────────┘
[ 合并成一条笔记 ]（主按钮）
[ 各存一条 ]  [ 原样存为笔记 ]  [ 忽略所选 ]
```

* 点按 = 切换选中；长按 = 全屏预览（复用现有 viewer）。
* 附件顺序 = 时间升序（不做拖动，§8-12）。

### 5.3 我的页「截图捕获」组

| 行 | 控件 |
|---|---|
| 截图捕获 | 开关（开 → 检查权限 → 授权后进文件夹选择） |
| 监控文件夹 | 「3 个 ›」点击进 §5.4 的文件夹选择（可随时改） |
| 权限状态 | 未授权 / 已授权 / 被永久拒绝（带「去设置」） |
| 扫描范围 | 最近 1 天 / 7 天 / 30 天（只影响「重新扫描历史」） |
| 重新扫描历史 | 按钮 + 二次确认（可能一次冒出上百张） |
| 暂存占用 | `12.4 MB · 9 张`，带「清空」 |

### 5.4 文件夹选择（首次向导 + 设置页共用同一个 sheet）

```
‹ 选择监控文件夹                    已选 3 个
[全选] [全不选]                  [只选截图目录]
🔍 搜索文件夹
┌──────────────────────────────────────────┐
│ ▣ 截图         Pictures/Screenshots  2834 张 │
│ ▣ 截屏         DCIM/Screenshots        12 张 │
│ ▢ 相机         DCIM/Camera            512 张 │
│ ▢ 微信图片     Pictures/WeiXin       1204 张 │
└──────────────────────────────────────────┘
已选 3 个 · 最近 30 天 1,203 张新图
[ 开始监控 ]
```

* 首次路径：开启开关 → 申请权限 → 直接进这个 sheet，**默认勾选**名字/路径像截图的文件夹
  （`Screenshots`/`截图`/`截屏`/`ScrShots`），其它默认不勾。
* 列表按张数降序，带搜索框（2834 张的机器上文件夹可能几十个）。
* 保存时把水位重置为现在，并 toast「已开始监控 3 个文件夹，只看之后的新图」。

### 5.5 导入进度层（用户明确要求"醒目"）

```
┌────────────────────────────────┐
│         ⟳ （渐变进度环）          │
│    正在处理 3/10 张截图           │
│                                │
│  ⚠ 请保持屏幕常亮，不要锁屏      │  ← 醒目：warn 色 + 加粗
│  ⚠ 也不要退出 App 或切到后台     │
│                                │
│  AI 正在解析，单张约 10–16 秒…    │
└────────────────────────────────┘
```

* 全屏遮罩 + `pointer-events` 拦截，不可点掉（没有关闭按钮）。
* 文案分两层：上面是加粗的黄色/红色警示（就是用户要的那句），下面是灰色进度说明。
* 进度 = 已完成笔记数 / 总数，来自现有 `busy` 轮询（1.5 秒一次）。
* 同时 `Android.keepScreenOn(true)`；完成、失败、用户返回（`onResume` 兜底）都清掉。

## 6. 边界情况

| 场景 | 处理 |
|---|---|
| 用户删了原图 | 暂存副本仍在，不受影响 |
| 同一张图被改名/移动 | sha1 命中，不再报 |
| 一次新增 300 张 | 单次入暂存上限 50，banner「发现 50+ 张新截图」，其余下次继续 |
| 权限中途被撤销 | 扫描直接返回，banner 切成"去授权"态 |
| 监控文件夹被删除 | 设置页标灰「文件夹已不存在」，扫描跳过 |
| 新增文件夹 | 水位重置为现在（不倒历史），toast 说明 |
| 未配置 AI | merge/split 仍可用（走 raw），提示「未配置 AI，已原样存为笔记」 |
| 图片格式与扩展名不符 | 按扩展名兜底；OCR 失败标 `error`，不崩 |
| 重复点导入 | 导入后即从暂存区删除，第二次收到空 ids 直接报错 |
| 磁盘写满 | 复制失败的那张跳过并记日志 |
| 导入中用户按返回 | 进度层拦不住系统返回键 → `onBackPressed` 里处理：不允许关闭，弹「正在处理，请稍等」 |

## 7. 测试计划（`test.sh` P11 段）

1. 造 2 张图到 `/sdcard/Pictures/Screenshots/`，广播 `MEDIA_SCANNER_SCAN_FILE`，`sleep 2`。
2. `am start … --es hook shotscan --es arg '{"force":true,"folders":["Pictures/Screenshots"]}'`
3. 断言 `/api/shots/list` 含这 2 张（按 name）。
4. `POST /api/shots/import {ids:[t1,t2], mode:"merge"}` → 1 条笔记、`attachments.length==2`、
   `source=="shot-merge"`。
5. 再造 1 张 → 扫描 → `mode:"split"` → 新增 1 条笔记、附件 1 个。
6. 幂等：再扫同一区间 → `added==0`。
7. 忽略：`/api/shots/ignore` 后重扫不出现。
8. 多文件夹：`shotscan` 传两个文件夹，断言两个目录的图都被收。
9. 清理：删测试图、删测试笔记、恢复水位与文件夹配置。

`go test`：`shots_test.go` 锁定水位边界（`dateAdded==watermark` 不重复、5 分钟重叠窗口、
上限 50、sha1 去重、忽略表永久生效、空文件/坏图跳过）。

`tools/ui_test.js` 的签名段：banner 顺序 `missed→shot→clip`、截图页三按钮、进度层警示文案
（含「不要锁屏」「不要退出」关键词）、文件夹 sheet 结构。

## 8. 已确认的决策（2026-11-22）

| # | 结论 |
|---|---|
| 1 | 接受 `READ_MEDIA_IMAGES`；不主动弹框，banner/向导里点了才弹 |
| 2 | 只扫用户选定的监控文件夹（默认勾选截图类） |
| 3 | 复制副本进私有目录 |
| 4 | 首次授权不回捞历史；提供「重新扫描最近 1/7/30 天」+ 二次确认 |
| 5 | 单次暂存上限 50 |
| 6 | 合并模式：逐张 OCR + **一次** LLM |
| 7 | 不发通知，只在首页 banner |
| 8 | 不做后台扫描，只在打开 app 时扫 |
| 9 | 「忽略」= 永久不再提醒；另有「清空暂存」 |
| 10 | banner 顺序 `错过提醒 → 新截图 → 剪贴板` |
| 11 | `source=shot-merge` / `shot-single`，来源胶囊显示「截图」 |
| 12 | 不做拖动排序，按时间升序 |
| 13 | **（新增）监控文件夹可多选**，首次运行引导选择，设置页可改 |
| 14 | **（新增）处理期间显示醒目提示：请保持屏幕常亮、不要黑屏、不要退出 App**，并真的加 `FLAG_KEEP_SCREEN_ON` |
| 15 | 超过 5 张走"各存一条"时二次确认（会产生 N 次 AI 调用） |

## 9. 明确不做

* 后台/定时扫描、通知推送。
* SAF 目录选择器（见 §2 理由）。
* 视频、动图之外的媒体。
* 拖动排序、缩略图文件缓存（CSS 缩放足够）。

## 10. 实现顺序

1. `AndroidManifest.xml`：`READ_MEDIA_IMAGES` + `READ_EXTERNAL_STORAGE(maxSdk=32)`。
2. `Shots.java`：文件夹枚举、多选配置读写、水位、sha1、复制、扫描；`keepScreenOn`；
   bridge 方法（§4 表）；hook `shotscan`/`shotfolders`（供 `test.sh` 用）。
3. `go/shots.go` + `shots_test.go`：store、去重、list/add/import/remove/ignore。
4. 路由 `/api/shots/*` + `/shotimg`。
5. `ui.html`：`shotBanner()`、`shotSheet()`、`folderSheet()`、`importShots(mode)`、
   进度层 `progressOverlay()`、我的页那一组开关。
6. `test.sh` P11 段 + `ui_test.js` 签名断言。
7. `plan.md` / `CHANGELOG.md` / README「已知限制」更新（权限说明、文件夹选择、vivo 路径差异）。
