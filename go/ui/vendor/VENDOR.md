# vendored：Vue 3

两个构建都在包里，同一版本，来源同一处。`go/web_test.go` 的 `TestVendorHashMatchesDoc`
逐文件核对下面两张表的 sha256（第三方整文件不许被手改）。

## 生产构建（页面默认加载）

| | |
|---|---|
| 文件 | `vue.global.prod.js` |
| 版本 | 3.5.46 |
| 来源 | https://unpkg.com/vue@3.5.46/dist/vue.global.prod.js |
| 许可 | MIT（(c) 2018-present Yuxi (Evan) You and Vue contributors） |
| 大小 | 174,069 字节 |
| sha256 | `c2e4b888ecbb12c7b24fd5e8bf65483ceaab73c37b79402f7968023977ed3e81` |

## 调试构建（`?vue=dev` 时加载，见 README §5.2）

| | |
|---|---|
| 文件 | `vue.global.js` |
| 版本 | 3.5.46 |
| 来源 | https://unpkg.com/vue@3.5.46/dist/vue.global.js |
| 许可 | MIT（同上） |
| 大小 | 612,551 字节 |
| sha256 | `0f9a092ad87f4e7a2b37c3fb5aa425b34dcd6ceef24070baf0d05e54353e980c` |

为什么要多带这 612 KB：prod 构建里 `__VUE_DEVTOOLS_GLOBAL_HOOK__` 出现 **0 次**（编译期被剪掉），
所以 Chrome 的 Vue Devtools 扩展在 prod 下什么也看不见；dev 构建出现 1 次。更值钱的是**运行时警告**：
步骤 16d 真机抓到的裸 `<ico>`（组件没声明 `components`）在 prod 里完全静默，dev 版会
`console.warn(Failed to resolve component: ico)`，而 `MainActivity.onConsoleMessage` 把 console
全写进 `testlog.txt`。开关与用法见 README §5.2；`go/web_test.go` 钉住「dev 有 hook、prod 没有」。

升级时两个文件一起换（版本号必须一致，`TestVendorHashMatchesDoc` 会查），两条命令：

```sh
curl -s -o go/ui/vendor/vue.global.prod.js https://unpkg.com/vue@<版本>/dist/vue.global.prod.js
curl -s -o go/ui/vendor/vue.global.js       https://unpkg.com/vue@<版本>/dist/vue.global.js
sha256sum go/ui/vendor/vue.global*.js   # 输出抄进上面两张表
```


# vendored：Vant 4（组件库）

P14 S5 引入（用户批准：减少手搓 UI 的不确定性）。**只 vendor 全局构建的两个整文件**，
与 Vue 一样零构建链：`vant.min.js` 是 UMD，取全局 `Vue`（就是上面那份 vendored Vue），
`app.use(vant)` 之后 `van-popup` / `van-toast` / `van-dialog` 这些标签直接可用。

## 组件与样式（页面默认加载）

| | |
|---|---|
| 文件 | `vant.min.js` |
| 版本 | 4.10.2 |
| 来源 | https://unpkg.com/vant@4.10.2/lib/vant.min.js |
| 许可 | MIT（Copyright (c) 2016-present Youzan） |
| 大小 | 245,846 字节（gzip 9 -9 后 80,005） |
| sha256 | `96bfc28a2855699d78b709b185f2e1c35ed68eefe17d8e3f98c4d5d9d43b8f82` |

| | |
|---|---|
| 文件 | `vant.css` |
| 版本 | 4.10.2（同一个包里的 `lib/index.css`，改名以便与 js 同版本号对齐） |
| 来源 | https://unpkg.com/vant@4.10.2/lib/index.css |
| 许可 | MIT（同上） |
| 大小 | 199,570 字节（gzip 9 -9 后 52,773） |
| sha256 | `e636877ff4af7aa30336252bc9ab25afd91beb1f621436d234e239d9de90382a` |

### 引入前实测的三件事（不是查文档，是把包下下来扫）

| 项 | 实测结果 |
|---|---|
| 语言基线 | `?.` 2 次命中都是 `? .5 :` 三元（**假阳性**，与 Vue 那次的结论同源）；`??` 0、`Proxy` 0、`BigInt` 0、`Object.fromEntries` 0、`queueMicrotask` 0；有箭头函数 1619 与 `class` 4（ES2015）→ **在下面的 ES2020 基线内，`MIN_API=26` 不用抬** |
| CSS 现代特性 | `:is(` `:where(` `:has(` `@supports` `aspect-ratio` `backdrop-filter` 全部 **0**；`gap:` 2、`env(safe-area` 3 |
| 全局选择器 | 非 `.van-*` 的只有 `:root`/`:host`（2557 个 `--van-*` 变量，与我们的 `--sheet-h` 等命名空间不撞）、`html{-webkit-tap-highlight-color:transparent}`（`tokens.css` 的 `*{}` 已覆盖）、`a{text-decoration:none}`（全站 2 个 `<a href="#">`，我们的 `.ttx small a` 特异性更高）。**加载顺序：vant.css 在我们的 CSS 之前**，平手时我们的赢 |

z-index：Vant 从 2001 起自增（`useGlobalZIndex`），我们的尺度是 `--z-index:55 / --z-topbar:60 /
--z-tabbar:70 / --z-toast:90`。所以**同一层交互不能混用**：弹层换成 `van-popup` 之后，
toast 也必须换成 `van-toast`（后创建的 z-index 更大，天然在上面），否则自研 toast 会掉到
Vant 遮罩下面。

升级：两条 curl + 改上面两张表的 sha256/大小/版本，然后 `GO_TEST=1 ./build.sh`
（`TestVendorHashMatchesDoc` 会逐文件核对，Vant 的 JS 查 `4.10.2` 版本串、CSS 查 `--van-` 前缀）。

## 为什么 vendor 而不是 npm

本项目**全程在 Android 手机的 Termux 里构建**：没有 PC、没有 Gradle、没有 npm、没有 bundler
（见 `README.md` 第 1 节与 `plan.md` §0）。`vue.global.prod.js` 是自带**模板编译器**的全局构建，
页面里直接 `<script src="/vendor/vue.global.prod.js">` 就能用 `template:` 字符串，
所以引入 Vue 不需要给项目加一条构建链。

编译器确实在内，已实测（升级后请重跑这条）：

```sh
node -e 'const fs=require("fs"),vm=require("vm");const ctx={window:{},document:{createElement:()=>({style:{}}),querySelector:()=>null},console};ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync("go/ui/vendor/vue.global.prod.js","utf8")+"\nglobalThis.__V=Vue;",ctx);console.log(ctx.__V.version, typeof ctx.__V.compile)'
# 期望输出：3.5.46 function
```

如果哪天换成 `vue.runtime.global.prod.js`（体积小一半），模板字符串会静默不编译，
页面变成空白 + 一条 Vue 警告——所以这条检查是必要的，不是形式主义。

## 语言基线（pin 在这里，不要散落在代码注释里）

**ES2020（Chrome 80）**。

* `app.env` 的 `MIN_API=26` → Android 8.0 出厂 WebView 是 58/59。
* ES module 语法要 Chrome 61+，可选链 `?.` / 空值合并 `??` 要 Chrome 80。
* 拆分前的 `go/ui.html` 是 ES5 风格（`const`/`let` 0 次、箭头函数 4 次、`?.` 0 次）+ `async/await`，
  所以基线是**被这次重构抬上来的**，不是既成事实。
* `test.sh` 会打印设备 `navigator.userAgent`，设备 WebView 版本以那里为准。
* `js/main.js` 启动做 feature probe，不满足就渲染可读的"WebView 太旧"页面，不白屏（D10）。

### Vue 自身要什么（实测，不是猜）

转 Vue 前先把这条钉死，因为 `MIN_API=26` → Android 8.0 出厂 WebView 是 58，Vue 要是比它新，
整个 app 在老机器上直接白屏，比今天差。

| 特性 | 出现 | 判定 |
|---|---|---|
| 可选链 `?.` | 1 次 | **假阳性**：在正则字面量 `/\?.*$/` 里，不是语法 |
| 空值合并 `??` | 0 次 | — |
| 对象字面量展开 `{...x}` | **0 次** | 77 次 `...` 全是形参 `(...a)` 46 + 数组展开 `[...x]` 13，ES2015 |
| `globalThis` | 2 次 | 在 `"u">typeof globalThis?globalThis:…self…window…global` 的 typeof 守卫里，Chrome 58 走 fallback |
| `BigInt` | 1 次 | 在字符串白名单里（`…,Intl,BigInt,console,…`），不是真用法 |
| `Proxy` / `Reflect` / `Symbol` / `WeakMap` | 6 / 14 / 87 / 20 次 | 全 ≤ Chrome 49 |

**结论：Vue 3.5.46 global 构建在 Chrome 58 上能解析能跑，`MIN_API=26` 不用抬。**
真实下限 = ES2015 + Proxy/Reflect/Symbol/WeakMap，全部 ≤ Chrome 49，低于我们的 ES2020 基线。
D16 的 feature probe 已经覆盖 Proxy / Reflect / Symbol / Promise，正好是 Vue 的依赖集，
所以 probe 顺带就是 Vue 的守门人——升级 Vue 时如果引入新依赖（`?.`、`Object.fromEntries`、
`queueMicrotask`），probe 必须同步加项，否则老 WebView 上是一句 `Vue is not defined`。

## 升级步骤

```sh
V=3.5.47                                   # 目标版本
curl -sL -o go/ui/vendor/vue.global.prod.js https://unpkg.com/vue@$V/dist/vue.global.prod.js
sha256sum go/ui/vendor/vue.global.prod.js  # 更新本文件的 sha256 与版本
GO_TEST=1 ./build.sh && ./install.sh && ./test.sh --vd
```

## 规则

* `go/ui/vendor/` 里的文件**不参与** `tools/ui_test.js` 的静态检查（裸 hex / 裸 px / handler 存在性），
  第三方代码不是我们的设计系统。
* 只放**整文件 vendor**，不要手改；改动一律在 `go/ui/js/` 里包一层。
