---
name: dev-apk-on-android
description: Build, sign, install and drive Android APKs entirely on the Android phone from Termux - no PC, no Android Studio, no Gradle. Use when asked to write an Android app, compile Java or Go business code into an .apk, sign it, install or launch it on this device, drive it from a shell script, run it on an invisible background display so the phone stays usable while debugging, or when an on-device build fails (aapt2, d8/R8, javac aborting, pm install hanging, zipalign, cgo -buildmode=c-shared, JNI exports).
license: MIT
compatibility: Android 7+ (minSdk 24), Termux arm64/armv7 with aapt2 + apksigner + openjdk-21; root (Magisk/KernelSU/sudo) optional - it upgrades install/verify from manual to automatic
metadata:
  offline: "yes - the 38 MB toolchain ships in vendor/, no download after the first pkg install"
  platforms: android
---

# Build an Android APK on the phone

Everything - edit, compile, dex, package, sign, install, launch, verify - happens on the
device. The on-device toolchain is `aapt2`/`apksigner` from Termux plus one Java jar.

```
resources  aapt2 compile / aapt2 link        Termux package, native aarch64
sources    javac -source 8 -target 8         openjdk-21 + -bootclasspath android.jar
classes    d8                                vendor/r8-*.jar (NOT Termux `d8`)
business   go build -buildmode=c-shared      optional Go layer, cgo, no NDK (references/go-native.md)
package    zip classes.dex (+ lib/<abi>/*.so) into the linked apk
sign       apksigner v1+v2+v3                ~/.android/debug.keystore
install    pm install -r -g (root)  |  termux-open (one tap, no root)
verify     dumpsys / logcat / the app's own files/testlog.txt
```

## Quick start

```sh
S=<this skill>/scripts
sh $S/setup-toolchain.sh                                   # offline: verifies + installs vendor/
sh $S/new-project.sh $HOME/apps/myapp com.example.myapp "My App"
cd $HOME/apps/myapp && ./build.sh && ./install.sh && ./test.sh
```

Business logic in **Go** instead of Java (cgo + JNI, the `.so` is built on the phone, no NDK,
no gomobile) - rules, gotchas and measurements: `references/go-native.md`:

```sh
sh $S/new-go-project.sh $HOME/apps/goapp com.example.goapp "Go App" goapp
cd $HOME/apps/goapp && GO_TEST=1 ./build.sh && ./install.sh && ./test.sh
```

Business logic as **Wails v3 services** with an HTML/JS UI (Go server on 127.0.0.1, WebView as
the screen, Java ~90 lines of plumbing; needs `pkg install nodejs-lts` + `go install
.../cmd/wails3` once, network):

```sh
sh $S/new-go-project.sh --wails $HOME/apps/wails com.example.wails "Wails App" wails
cd $HOME/apps/wails/go && GOFLAGS=-mod=mod go get github.com/wailsapp/wails/v3@latest \
  && GOFLAGS=-mod=mod go mod tidy
wails3 generate bindings -b -d frontend/dist/wailsjs .    # JS bindings, on device
B=$(find frontend/dist/wailsjs -name index.js -not -path '*/events/*' | head -1 | sed 's|frontend/dist/||')
sed -i "s|__BINDINGS__|./$B|" frontend/dist/index.html
cd $HOME/apps/wails && ./build.sh && ./install.sh && ./test.sh
```

`new-project.sh` copies everything a project needs (scripts + lib/ + templates), so the
project keeps working even if this skill is moved or deleted. Its `README.md` lists the
files. `./build.sh` is bash - never call it as `sh build.sh`.

## Go or Java? The user's word decides

Say it in the request - "用 Go 开发一个计算器", "用 Java 写个 X", "用 Wails 做 X" - that is the
whole incantation; no flags, no template names:

| user says | what the skill does |
|---|---|
| 用 **Go** 开发 X | `new-go-project.sh`: logic in `go/main.go` (Go), Java is a ~90-line shell |
| 用 **Java** 开发 X | `new-project.sh`: everything in Java (the default when nothing is said) |
| 用 **Wails** 开发 X | Go project whose `go/` is a Wails v3 server: `GO_BIN_FLAGS='-tags server'` (`references/go-native.md`) |
| "给现有 app 加个 Go 模块" | drop a `go/` dir into it - `build.sh` picks it up automatically |

Cost of Go (measured, arm64 phone): apk 21 KB -> 832 KB, installed +7.6 MB, cold start +20 ms,
one JNI call ~370 ns. Win: 50-100x on CPU-heavy and fan-out work (fib(28): 1.6 ms vs 131 ms;
200k tasks: 150 ms vs 831 ms), goroutines, and the whole Go stdlib (net/http, database/sql,
encoding/json) inside the apk. Full numbers, rules and gotchas: `references/go-native.md`.

## Verify what you built, not what you assume

A model cannot look at a screenshot, and logcat is unreliable on a busy phone. Make the app
write its state to `files/testlog.txt` (the template Activity does) and read that file back:

```sh
./probe.sh com.example.myapp        # foreground? crashed? (root)
./screen.sh 60                      # screenshot -> ASCII art (root)
./log.sh mytag                      # logcat lines, when logcat is readable
su --mount-master -c "cat /data/data/com.example.myapp/files/testlog.txt"
```

Drive the app through hooks instead of taps: `am start ... --es hook ping` for cold starts and
a `files/testhook` file for a warm app (Android 14+ drops the extras when the activity is
already on top). Details and the fail-modes of this harness: `references/testing.md`.

## Debug it on a display nobody can see (root)

`am start` normally steals the panel, so a long test makes the phone unusable. With root, put
the app on a **virtual display** that nothing mirrors - the app runs, renders, takes touches and
can be screenshotted while you keep using the phone (screen off, even):

```sh
sh $S/vd.sh create                        # background display: 131 (1080x2400@440)
sh $S/vd.sh launch com.example.myapp/.MainActivity
sh $S/vd.sh shot /tmp/app.png             # upright PNG, panel untouched
sh $S/vd.sh tap 540 1200                  # screenshot pixels
./install.sh --bg ; ./screen.sh --vd 60 ; ./test.sh --vd    # same thing, wired in
sh $S/vd.sh destroy
```

A small `app_process` daemon (`vendor/vd/Vd.java`, prebuilt to `vendor/vd/vd.jar`) owns the
display; `scripts/vd.sh` drives it over a command file. Rotation is detected from the app
window transform and undone, so shots are upright and taps use shot coordinates. Without root
`vd.sh` exits 3 with a message; `settings put global overlay_display_devices "1080x2400/440"`
is the no-daemon fallback (it leaves a thumbnail on the panel). Flags, rotation mapping, the
screen-off behaviour and the troubleshooting table: `references/virtual-display.md`.

## Rules that break on-device builds

1. **Never use Termux's `d8`** for JDK-compiled classes: it is R8 3.3 and dies with
   `NullPointerException: Cannot invoke "String.length()"` on anonymous classes (JDK 11+
   `NestMembers`). Always `java -cp <r8.jar> com.android.tools.r8.D8`.
2. **javac flags**: JDK 21 rejects `--release`/`-target 11` together with `-bootclasspath`.
   Use `-source 8 -target 8 -bootclasspath android.jar`.
3. **`aapt2 link` needs the full `android.jar`** because it resolves `@android:` resources from
   the framework resource table. A "classes only" jar links nothing (measured: silently fails
   with `attribute android:versionCode not found`).
4. **`aapt2 link` takes compiled resources as positional args**, not `-R`:
   `aapt2 link -o base.apk -I android.jar --manifest AndroidManifest.xml res.zip --java gen/`.
5. **javac dies with exit 134** and `Native registration unable to find class ...
   PerfettoTrace` until the Perfetto stub is in place - that is the broken Termux JDK, not your
   code. `setup-toolchain.sh` fixes it; `java -version` working proves nothing.
6. **No `zipalign` on device.** A pure Java/Kotlin APK installs fine unaligned. With native
   libs set `android:extractNativeLibs="true"`.
7. **Non-root `pm install` is dead on Android 11+** (`SecurityException: user -1`). Use root,
   or `termux-open app.apk` and tap Install once.
8. **Stage the apk in `/data/local/tmp`** before `pm install`: `system_server` opens the file
   and cannot read `/data/data/com.termux/...`.
9. **Go business code: `go build -buildmode=c-shared` + JNI.** Termux's go is preconfigured
   for `GOOS=android GOARCH=arm64 CGO_ENABLED=1`, so a cgo `.so` builds on the phone with no
   NDK. Export JNI-named symbols (`//export Java_com_example_app_MainActivity_nativeAdd`);
   cgo cannot call `JNIEnv`'s function table, so wrap JNI calls in `static` C helpers; every
   export must `recover()` (a Go panic that reaches the JVM SIGABRTs the whole app); a
   goroutine that outlives the call needs `NewGlobalRef` + `AttachCurrentThread` and must
   delete its global ref before detaching; the manifest needs `android:extractNativeLibs="true"`
   (no zipalign on device); arm64 only, and `gomobile` is not usable on device. See
   `references/go-native.md`.

`references/pitfalls.md` has the full list with the exact error text; read it when a step
fails. `references/build.md` explains the toolchain, `references/install.md` the install and
launch traps, `references/vendor.md` the bundled binaries.

## Root is optional

| step | with root | without root |
|---|---|---|
| build, sign | yes | yes |
| install | `pm install -r -g` + `am start`, unattended | `termux-open`, one tap |
| probe / logcat / screencap | yes | not available |
| background virtual display (`vd.sh`) | yes | not available (settings overlay is) |
| automated acceptance test | yes | builds, installs, then stops |

Every script degrades with a message instead of failing: `test.sh` exits 3 ("skipped") when
there is no root, so a CI-ish loop can tell "not verified" from "failed". `APK_NO_ROOT=1`
forces the fallback path for testing.

## A scaffolded project

```
AndroidManifest.xml   no <uses-sdk>: minSdk/targetSdk are passed by build.sh
app.env               APP_PACKAGE / ACTIVITY / APK_NAME / TAG / PLATFORM_API / MIN_API
src/<pkg path>/       Java sources
res/                  resources (launcher icons: $PY gen_icon.py A)
assets/               packaged as-is
lib/                  config.sh + root.sh shared by the copied scripts
vendor/vd/vd.jar      background-display daemon (prebuilt, 7 KB) + Vd.java
build.sh install.sh test.sh probe.sh log.sh screen.sh vd.sh
```

A Go project (`new-go-project.sh`) adds `go/` (module: `main.go` business logic + JNI bridge,
`web.go` net/http + HTML for a WebView UI, `bin/` pure-Go exec'able binary) and the `GO_DIR` /
`GO_LIB` / `GO_BIN` / `GO_LDFLAGS` keys in `app.env`; `build.sh` builds them into
`lib/arm64-v8a/` automatically when `go/go.mod` exists.

`app.env` is the single source of truth for api levels; an environment variable wins over it,
e.g. `PLATFORM_API=34 ./build.sh` as soon as `vendor/android-34-android.jar` exists.

## Offline, and changing versions

`vendor/` ships the two jars (38 MB) with `SHA256SUMS`; `setup-toolchain.sh` verifies and
copies them into `$ANDROID_HOME` / `$ANDROID_TOOLS` and never downloads when they are there.
Only `pkg install` needs the network, and only on a fresh Termux. Only API 33 is bundled -
`vendor/MANIFEST.md` shows how to add another API level or a newer R8 in two commands.

## Not covered here

Kotlin (`kotlinc` in the Termux repo, then feed `.class` to d8), Rust/NDK (ship a `.so` and set
`extractNativeLibs`), multi-ABI native libs (on-device Go is arm64 only), `gomobile` (needs an
SDK + NDK layout the phone does not have), and Gradle/AGP on device (works, but needs
`android.aapt2FromMavenOverride=$PREFIX/bin/aapt2` and `zipAlignEnabled = false`). For large
multi-module projects, build in CI and `termux-open` the artifact.

Go as the business layer **is** covered: `references/go-native.md`, Wails v3 server mode
included; `mygo` is not (it needs go >= 1.27 and a desktop GUI backend).
