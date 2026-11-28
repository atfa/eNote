# Go 工具链 / 构建验证备忘（2026-11-28 踩坑记录）

未来在这个仓库（eNote，Termux Android 上 Go + WebView 的 app）里跑 Go 构建或测试前，
先读这份。正文是一个今天实际踩过的坑和标准解法。

## 症状：非 root 会话里 `go` 命令全挂

在普通 Termux 会话（`u0_a724`，非 root）里，`/usr/bin/go`（symlink 到
`/data/data/com.termux/files/usr/lib/go/bin/go`）**任何**命令都失败：

- `go version` → `go: cannot find GOROOT directory: 'go' binary is trimmed and GOROOT is not set`
- 设了 `GOROOT=/data/data/com.termux/files/usr/lib/go` 后 → `go /data/data/.../bin/go: unknown command`
  （注意：它把 argv[0] 自己当成了命令名，后面参数全被吞掉，退出码 2）
- 试过 `env -i`、`GOTOOLCHAIN=local`、`GOFLAGS`、`exec -a` 各种组合，都救不回来

**不要在这个方向上浪费时间**（上一轮就耗了很久）。`dpkg -V golang` 能过，
但二进制在该环境下就是不可用——这与 env 无关。

## 结论与标准解法：切 root

root 下 Go 完全正常：

```
$ su -c '.../go version'
go version go1.27.4 android/arm64
```

仓库的标准流程本来就要求 root：`out/native/libenote.so` 就是 root 构建的，
`build.sh` / `test.sh` 也都默认 root 跑。所以一切 Go 验证一律走 root。

### 标准验证命令（一次跑完）

```bash
su -c 'export PATH=/data/data/com.termux/files/usr/bin:$PATH \
  HOME=/data/data/com.termux/files/home \
  GOROOT=/data/data/com.termux/files/usr/lib/go GOTOOLCHAIN=local; \
  cd /data/data/com.termux/files/home/eNote/go \
  && go build -buildvcs=false ./... \
  && go vet   -buildvcs=false ./... \
  && go test  -buildvcs=false ./...'
```

要点：

1. **`-buildvcs=false` 必须加**：root 下 git VCS stamping 报
   `error obtaining VCS status: exit status 128`（safe.directory / 权限），跳过即可。
2. **go.mod 在 `go/` 子目录**，必须在 `go/` 里 build / vet / test；
   在仓库根跑会报 `directory prefix . does not contain main module`。
3. 完整 APK：root 下 `bash ./build.sh`（**必须 bash，不要 `sh build.sh`**），
   内部会 cgo 编 `libenote.so` → javac → d8 → aapt2 → 签名 → `enote.apk`。
4. `go test` 会在 `go/` 下生成 `lastopen.txt`（运行时状态，已 gitignore）。

## 同一台机器上别的坑（都是环境问题，不是回归）

1. **`tools/ui_test.js` 报 `EACCES out/gen`**：root 构建的 `out/` 普通用户不可读，
   先 `su -c 'chmod -R a+rX out'` 再以普通用户跑 node。
2. **test.sh 里 `am` 被 Termux wrapper 吞掉**：PATH 的前一截是 Termux 的 `am`
  （只打印 usage），加 `am start` 全部静默失败。把 `/system/bin` 放 PATH 前面
  或在 su 内用 `/system/bin/am`。`test.sh --skip-build --no-reset` 全套跑通过一次。
3. **设备 `settings.provider=chatgpt` 时**，curl 不带 `X-eNote-Session` 头调
   `/api/voice` / `/api/add` 等 `requireInferenceSession` 路由 → 403
   `Open this page in eNote`。HEAD 时代就这样，不是本次改动引入的回归
   （test.sh 没做 chatgpt 适配）。
4. **`test.sh --no-reset`** 会因设备累积状态 / 未配 AI key 跳过部分用例（计数类可能假红）；
   默认 `--reset` 会清空真机笔记数据（保留 settings），真机要跑验收请用 `--no-reset`。

## 验证结果快照（2026-11-28）

- `go build / vet / test`：全部通过（`ok dev.xduo.enote 2.043s`）
- `bash ./build.sh`：成功，`enote.apk`（87.6MB，v1+v2+v3 签名）
- `tools/ui_test.js`：闸门㉖（记一笔圆钮/统一草稿）PASS；4 个 FAIL 与 HEAD worktree
  完全一致（OpenAI 导出表 ×3 + 设置全屏面板契约），非本任务引入
- `test.sh --skip-build --no-reset`：store/web/llm/ocr/stt hooks 全 ok；
  唯一红点 `POST /api/voice failed` 即上文第 3 条（chatgpt provider + 无会话头）