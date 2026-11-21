# eNote — 分享即笔记

一个装在 Android 手机上的笔记 + 待办：把任何文字或图片**分享**给 eNote，它先在本地做 OCR，
再交给自己的大模型（BYOK）整理成「标题 / 正文 / 标签 / 带截止时间的待办」。
全部构建、签名、安装、测试都在这台手机的 Termux 里完成，没有 PC、没有 Gradle、没有 Android Studio。

包名 `dev.xduo.enote`，标签 `eNote`，minSdk 26，targetSdk 33，arm64-v8a，APK ≈ 13.7 MB。

---

## 1. 快速开始

```bash
cd ~/eNote
GO_TEST=1 ./build.sh      # 编译 Go（含单元测试）+ javac + d8 + aapt2 + 签名 → enote.apk
./install.sh              # pm install -g 并启动
./test.sh                 # 端到端验收测试（需要 root）
./test.sh --vd            # 同上，但跑在隐形后台屏上，手机面板归你
```

脚本都是 bash/sh，**必须写成 `./build.sh`**，不要 `sh build.sh`。
工具链（android-33 jar、签名密钥）由 `dev-apk-on-android` skill 统一维护，不在本项目里。

`app.env` 是唯一的配置入口：包名、Activity、API 级别、APK 名、Go 模块目录与 `.so` 名字。

## 2. 用法

**分享（主路径）**：任何 App 里点分享 → 选 `eNote`。

| 分享内容 | 发生什么 |
| --- | --- |
| 纯文本 / 链接 | 立刻落库为「排队中」，后台交给大模型解析 |
| 单张 / 多张图片 | 先**在本机** OCR（vivo 离线引擎），只有识别出的文字会发给大模型，图片本身从不上传 |

图片走 `SEND` / `SEND_MULTIPLE` / `VIEW` 三种 intent，所以相册、微信、浏览器都能分享进来。

**App 内**：底部四个标签 笔记 / 待办 / ➕ / 设置。

* ➕「记一笔」：粘贴文字直接解析，或「选图片（本机 OCR）」从相册挑一张。
* 笔记卡片：勾选待办、展开详情、`重新解析`、`重新识别图片`、`+ 待办`、`删除`。
* 待办页按 今天 / 明天 / 无日期 / 已完成 分组，红色左边框 = 高优先级，逾期数字在顶栏。
* 设置页：API Base URL、Key、模型名、超时、max tokens、温度、`测试连接`，以及本地 OCR 引擎状态。
  Key 明文存在 `files/enote/settings.json`，接口返回时打码成「前 4 + … + 后 4」，回传打码值不会覆盖真 Key。

默认不预置大模型（仓库里不带任何端点）：装好后在设置里填 API Base URL / Key / 模型名，任何
OpenAI 兼容服务都行（本地 llama.cpp、litellm、云端 API），`测试连接` 会直接显示模型首句回复。
没填地址时分享的内容原样入库（状态 `raw`），之后随时可以 `重新解析`。

## 3. 架构

```
Java 壳 (src/dev/xduo/enote/)                Go 业务层 (go/, 编成 libenote.so)
  EnoteApp     启动 Go、初始化 OCR      ┌──  main.go      JNI 入口 + 生命周期
  OcrHelper    vivo 离线 OCR            │   app.go        全局状态
  ShareActivity 接收分享 intent         │   store.go      notes.json 读写
  MainActivity WebView 容器            ├──  pipeline.go  队列 + worker + 解析
  Bridge       JNI + WebView 桥        │   llm.go        OpenAI 兼容客户端 + 调用记录
                ↑ window.Android       │   config.go     settings.json + 日志
                └──────────────────────┴──  web.go       127.0.0.1 HTTP + ui.html
```

* 界面是**一个内嵌 HTML**（`go/ui.html`，`go:embed`），由 Go 的 HTTP 服务在 `127.0.0.1:<随机端口>` 上提供，
  WebView 加载它。UI ↔ Go 只走 HTTP，JNI 面积极小（7 个导出函数）。
* **OCR 在 Java 侧、入库前完成**：`ShareActivity` / 图片选择器 / `重新识别图片` 都会先跑 OCR，
  把识别文本连同图片路径一起交给 Go 的 `enqueue`。Go 的 worker 从不回调 Java，所以不会有跨语言死锁。
* 解析失败不丢数据：LLM 挂了就把原文存成 `raw` / `error` 状态，卡片上给「重新解析」按钮。
* 图片原件永远保留在 `files/enote/inbox/`。

数据文件（`/data/data/dev.xduo.enote/files/enote/`）：

| 文件 | 内容 |
| --- | --- |
| `notes.json` | 全部笔记与待办（单文件，原子写） |
| `settings.json` | BYOK 配置（Key 明文） |
| `inbox/` | 收到的图片原件 |
| `enote.log` | 业务日志（`./log.sh enote`） |

OCR 引擎：`assets/mdl_ocr/`（9 MB 模型）+ `jniLibs/arm64-v8a/libocr_general.so`、`libvcap_core.so`、
`libvcap_opencl.so`（6.7 MB），来自 `~/ocr` 的 vivo 离线识别 SDK，CPU 推理，一张证书约 150–320 ms。

## 4. 本地 HTTP API

服务只监听 `127.0.0.1`，端口在日志里（Termux 里可直接 curl，无需 root）：

```bash
P=$(su --mount-master -c "grep -o '127.0.0.1:[0-9]*' \
     /data/data/dev.xduo.enote/files/enote/enote.log" | tail -1 | cut -d: -f2)
curl -s "http://127.0.0.1:$P/api/state" | python3 -m json.tool
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | `{info, notes, settings, ok}`，UI 每 1.8 s 轮询它 |
| GET | `/api/note?id=` | 单条笔记全文 |
| POST | `/api/add` | `{text}` 或 `{path,name}` → 排队 |
| POST | `/api/reparse` | `{id}` 用已存的原文重新解析 |
| POST | `/api/delete` | `{id}` |
| POST | `/api/todo` | `{action: add\|toggle\|delete, noteId, text, due, priority, todoId}` |
| GET/POST | `/api/settings` | 读（Key 打码）/ 写（传打码值则保留真 Key） |
| POST | `/api/llm/test` | 连通性测试，返回 `{ok, httpCode, ms, reply}` |
| GET | `/api/llmlog` | 最近的大模型调用（模型、耗时、HTTP 码、输入、原始返回） |
| GET | `/api/log` | 最近的业务日志 |
| GET | `/api/export` | 全部笔记的 JSON 数组（备份用） |
| GET | `/img?id=` | 笔记里的图片 |

## 5. 无头测试（手机照常能用）

手机是你在用的，所以测试跑在**隐形后台屏**上：

```bash
./vd.sh create            # 建一块 1080x2400 的虚拟屏（一次即可）
./vd.sh launch            # 把 eNote 开在那块屏上
./vd.sh shot out.png      # 截图（1080x2400）
./vd.sh tap 540 1200      # 点击；swipe X1 Y1 X2 Y2 MS 同理
./vd.sh destroy           # 用完销毁
```

`./test.sh` 的验收链路（每一步都断言，任何一步失败就打印 Go 日志 + App 日志 + `probe.sh` 后退出）：

1. `GO_TEST=1 ./build.sh` → 安装 → 启动 → 等 HTTP 服务起来
2. `selftest` hook：存储读写、Web 首页、真实大模型调用、OCR 引擎就绪
3. 分享文本 → 轮询到 `status=done`，且至少一个待办带截止时间
4. 分享图片（`file://` 放进 App 外部目录 + `chown`）→ 轮询到 OCR 字数 > 0 且解析完成
5. 待办 add / toggle / delete 往返
6. `reparse` + `llm/test` + `export`
7. 设置往返（打码 Key 不覆盖真 Key）
8. `probe.sh`：进程活着、无 crash

```bash
./test.sh                 # 完整跑（含构建）
./test.sh --skip-build    # 用现成的 enote.apk
./test.sh --clean         # 跑完卸载
./test.sh --vd            # 后台屏（推荐：不打扰你用手机）
```

手工驱动（root）：

```bash
# 分享文本
su -c "am start -n dev.xduo.enote/.ShareActivity -a android.intent.action.SEND \
  -t text/plain --es android.intent.extra.TEXT '买牛奶和鸡蛋；晚上8点开周会'"
# 分享图片（目录要先 chown 给 App 的 uid）
su -c "am start -n dev.xduo.enote/.ShareActivity -a android.intent.action.SEND \
  -t 'image/*' --eu android.intent.extra.STREAM file:///sdcard/Android/data/dev.xduo.enote/files/ocr-test.png"
# 自测 hook（文本模式：selftest / status / enqueue）
su -c "am start -n dev.xduo.enote/.MainActivity --es hook selftest --es arg '{\"mode\":\"all\"}'"
```

注意：`am` 的 extra 键名必须大写（`android.intent.extra.TEXT`）；读 App 数据要用
`su --mount-master -c "..."`（普通 `su -c` 看到的是影子 `/data/data`）；logcat 默认被系统静音，
App 自己写 `files/enote/enote.log`。

## 6. 已知限制（MVP）

* 没有通知栏提醒，待办只在 App 里看；没有本地推送。
* 只导出（`/api/export`），没有导入；没有多设备同步。
* API Key 明文存在 `files/`（App 私有目录，未加密）。
* 一次只解析一张图片；`SEND_MULTIPLE` 会拆成多条笔记。
* 分享 URL 按纯文本处理，不抓网页正文。
* 只打包 arm64-v8a。

## 7. 文件结构

```
app.env                 配置（包名 / Activity / Go 模块 / so 名）
AndroidManifest.xml     分享 intent-filter、singleTop、明文流量
build.sh                Go → .so → javac → d8 → aapt2 → zipalign → apksigner
install.sh              pm install -g（--bg 用后台屏）
test.sh                 端到端验收测试（见上）
vd.sh / screen.sh / probe.sh / log.sh    后台屏、截图、存活检查、日志
src/dev/xduo/enote/     Java 壳（5 个类）+ com/vivo/aiocr/general（OCR SDK 封装）
go/                     Go 业务层 + ui.html（内嵌 UI）
assets/mdl_ocr/         OCR 模型（9 MB）
jniLibs/arm64-v8a/      OCR 引擎 .so（6.7 MB）
vendor/                 从 ~/ocr 拷来的 SDK jar 与头文件
.agents/skills/         构建这套 APK 的技能（上游 github.com/atfa/dev-apk-on-android）
```

`assets/mdl_ocr/`（9 MB）和 `jniLibs/arm64-v8a/`（6.7 MB）是从手机上的 vivo 离线 OCR 引擎
（`~/ocr`）里拷出来的官方文件，不是本项目编译产物，clone 下来直接能构建。

## 8. 踩过的坑（给未来的自己）

* `build.sh` 打 assets 必须在项目根目录 `zip -r out.apk assets`，进目录里 zip 会得到没有
  `assets/` 前缀的路径，运行时 `FileNotFoundException: mdl_ocr/det_model.vaimlite`。
* `jniLibs/<abi>/*.so` 不会自动进 APK，要显式复制成 `lib/<abi>/*.so`，否则
  `dlopen failed: library "libvcap_core.so" not found`。
* 测试 hook 里同步调用大模型（10 s）会卡住主线程 → ANR 被系统杀掉，hook 一律起线程。
* POSIX `sh` 里 `echo "$json"` 会展开 `\n`，把 JSON 打碎，用 `printf '%s'`。
* `am start` 送到已在前台的实例时不会重建 Activity，所以要实现 `onNewIntent` + `launchMode="singleTop"`。
