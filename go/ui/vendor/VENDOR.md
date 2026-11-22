# vendored：Vue 3

| | |
|---|---|
| 文件 | `vue.global.prod.js` |
| 版本 | 3.5.46 |
| 来源 | https://unpkg.com/vue@3.5.46/dist/vue.global.prod.js |
| 许可 | MIT（(c) 2018-present Yuxi (Evan) You and Vue contributors） |
| 大小 | 174,069 字节 |
| sha256 | `c2e4b888ecbb12c7b24fd5e8bf65483ceaab73c37b79402f7968023977ed3e81` |

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
