# 0.3.3

## Input and display failures found by a real regression run

* `scripts/vd.sh` - **`vd.sh text` was broken**: it ran `input text -d <id> '…'`, but `-d` is a
  flag of `input` itself, so `text` swallowed it and `sendText()` died with
  `NullPointerException: Attempt to get length of null array`. Now `input -d <id> text '…'`.
* `references/virtual-display.md` - Input section rewritten: `-d` goes before the command; the
  touch sources tolerate it after the source name, `text` does not. `input text` only knows ASCII,
  so CJK either throws or silently types nothing - type an ASCII marker, or set the Chinese value
  through the app's own HTTP API.
* `references/virtual-display.md` - new note **The display dies with the phone's screen**: a
  display created in an earlier session stays `Display State=OFF` even after `power 2`; a
  multi-minute unattended run ends with blank shots and a test hook that never fires. Recreate it
  (never just re-power it) and hold `/sys/power/wake_lock` for the duration.
* Troubleshooting table: two new rows (blank run after the screen slept, `input text` typing
  nothing / NPE).

# 0.3.2

## Background-display gotchas (found while driving a 4-tab WebView UI for hours)

* `references/virtual-display.md` - new section **Creating the display: the device must be AWAKE**:
  `setOverrideDisplayState` returns OK but is ignored when the display is created during doze, so
  `Display State=OFF` sticks and every shot is black; wake (`input keyevent 224`),
  `wm dismiss-keyguard`, then `destroy && create`.
* `references/virtual-display.md` - new section **Driving the app on the background display**: the
  system nav-bar strip swallows taps at the bottom of the VD (tap the upper part of a tab bar),
  `am start --display` never moves a running activity (force-stop first), `KEYCODE_BACK` closes the
  app and leaves the launcher focused (blank shots), VD shots do not composite the system status
  bar, and Termux has no writable `/tmp`.
* Troubleshooting table: five new rows for the symptoms above.

# 0.3.1

## Packaging fixes (found while shipping a 9 MB asset model and prebuilt `.so` libraries)

* `scripts/build.sh` - assets are zipped as `assets/...`, i.e. the directory itself, not its
  contents. The old `(cd assets && zip -r ../apk/unaligned.apk .)` put files at the archive root,
  so every `AssetManager.open("...")` threw `FileNotFoundException` at runtime while
  `unzip -l` looked fine.
* `scripts/build.sh` - prebuilt native libraries in `jniLibs/<abi>/*.so` are staged into
  `out/apk/lib/<abi>/` and zipped. Only the library built by the script itself (`out/native/`)
  used to be packaged, so a vendored `.so` (offline OCR engine) was silently absent from the apk
  and `System.loadLibrary` failed.
* `references/build.md` - the packaging section states both rules (the `assets/` prefix, staging
  `lib/<abi>/`) and the `unzip -l` checks that prove them.
* `references/pitfalls.md` - three new entries: #34 assets prefix, #35 prebuilt `.so` missing from
  the apk, #36 ANR from a hook that does its work on the main thread.

# 0.3.0

## Go as the business layer (cgo + JNI, built on the phone)

Business code can now be written in **Go**: `go build -buildmode=c-shared` produces
`lib<name>.so`, `build.sh` zips it into `lib/arm64-v8a/`, Java loads it with
`System.loadLibrary` and calls it through `native` methods. No NDK, no Android SDK, no
gomobile, no PC - Termux's go is preconfigured for `GOOS=android GOARCH=arm64 CGO_ENABLED=1`
and `ndk-sysroot` supplies `jni.h`.

* `scripts/new-go-project.sh` - scaffolds a Go project: `go/main.go` (business logic + JNI
  bridge with C helpers, panic guards, async callbacks), `go/web.go` (net/http server + HTML
  page for a WebView UI), `go/bin/` (pure-Go binary shipped as a `.so` and exec'd by Java),
  a thin `MainActivity.java`, `go test` wiring, and the manifest switches
  (`extractNativeLibs`, `usesCleartextTraffic`, `INTERNET`).
* `scripts/build.sh` - builds `go/` when `go/go.mod` exists (`GO_DIR`, `GO_LIB`, `GO_BIN`,
  `GO_BIN_DIR`, `GO_BIN_FLAGS`, `GO_LDFLAGS`, `GO_FLAGS`, `GO_TEST=1`), maps `GOARCH` to an ABI
  directory, warns when the manifest lacks `extractNativeLibs="true"`. `GO_LIB=` (set but
  empty) skips the JNI library and builds only the executable. Projects without a `go/` dir
  build exactly as before.
* `references/go-native.md` - the rules measured on device: JNI naming, cgo cannot call
  `JNIEnv`'s function table, a Go panic reaching the JVM SIGABRTs the app, global refs +
  `AttachCurrentThread` for goroutines that outlive a call, ~0.3 µs per JNI crossing, arm64
  only, gomobile unusable on device, plus size/startup/memory/throughput measurements
  (Go: 832 KB apk, +18 MB PSS, fib(28) 1.4 ms vs Java 131 ms).
* Verified end to end on device: scaffold → `GO_TEST=1 build.sh` → install → `test.sh` PASS,
  with hooks for concurrency (8 Java threads), async Go→Java callback, WebView UI over the Go
  HTTP server, and `Runtime.exec` of a pure-Go binary.
* **Wails v3 works on the phone** in server mode: `go install .../cmd/wails3` builds the CLI on
  device, `wails3 generate bindings` generates the JS bindings on device, and
  `go build -tags server` (`GO_BIN_FLAGS`) yields a 11.7 MB binary that serves the frontend and
  its bound Go services on 127.0.0.1. Java exec's it from `nativeLibraryDir`, reads the
  `SERVER URL:` it prints, and shows it in a WebView - verified: JS → `App.Fib(28)` → 1 ms →
  `window.Android` → Java, 17 ms from exec to listening. `mygo` needs go >= 1.27 and a desktop
  GUI backend, so it cannot run here. `new-go-project.sh --wails` scaffolds it (templates
  `templates/go/wails/`), and the scaffolded `test.sh` asserts the JS → Go → Java round trip.

# 0.2.0

## Background virtual display: debug without stealing the phone

`am start` used to take over the panel, so a long test made the phone unusable. With root the app
can now run on a virtual display that nothing mirrors: it renders, takes injected touches, can be
screenshotted, and keeps running with the screen off, while display 0 keeps showing whatever you
had open.

* `vendor/vd/Vd.java` - a ~300-line daemon run through `app_process` that owns the
  `VirtualDisplay`, captures it through an `ImageReader` and answers commands from a file
  (`shot`, `size`, `rotate`, `power`, `ping`, `quit`). Prebuilt to `vendor/vd/vd.jar` (7 KB),
  rebuildable with `scripts/vd-build.sh`.
* `scripts/vd.sh` - the driver: `create [WxH@dpi]`, `destroy`, `status`, `id`, `size`, `shot`,
  `tap`, `swipe`, `key`, `text`, `launch`, `rotate`, `log`. Tap coordinates are screenshot
  pixels; the driver inverts the shot rotation.
* Display flag values move between Android versions (`TRUSTED` is `0x40` on 10-13, `0x400` on
  16), so they are read from the framework by name at runtime instead of being hard-coded.
* A display in its own display group starts OFF and renders nothing; the daemon sets a power
  override (`setOverrideDisplayState`, with fallbacks, since `setVirtualDisplayState` is gone on
  Android 16), which is also what keeps the app rendering with the panel off.
* Landscape apps are drawn rotated inside the display's base buffer and `Display.getRotation()`
  reports 0 for them, so the rotation is read from the app window transform in `dumpsys input`
  and undone: shots come out upright and taps line up.
* Wired into the normal flow: `install.sh --bg`, `screen.sh --vd`, `test.sh --vd`, and
  `probe.sh` now reports focus per display (the app on 131, Termux on 0).
* `settings put global overlay_display_devices` documented as the no-daemon fallback (leaves a
  thumbnail on the panel); without root `vd.sh` exits 3 with a message.
* Verified on Android 16 (vivo V2366HA, KernelSU): create -> launch -> shot -> tap -> screen-off
  rendering -> destroy, with the plant game and a scaffolded test app.

## Fixed

* The app popped up on the user's screen when the display was released: a display that disappears
  does not take its apps with it, the system *moves* them to the default display (measured:
  display 0 went from `com.termux` to `com.android.settings/.Settings`). The display is now
  created with `DESTROY_CONTENT_ON_REMOVAL`, so the app dies with the display. Selfcheck asserts
  the app is not in the foreground after `destroy`.
* `vd.sh status` printed nothing under "your screen is showing": the awk pattern required a
  trailing space after `mDisplayId=0`, and that line usually ends right there. Selfcheck now
  asserts that line is non-empty, so the regression cannot come back.

# 0.1.0

First public version, extracted from private experiments building games and utilities on a
phone with Termux. Everything below was verified on-device with `scripts/selfcheck.sh`.

## Build

* One pipeline for all five steps: aapt2 compile/link, javac (JDK 21, `-source/-target 8` with
  a `android.jar` bootclasspath), d8 from a vendored R8, zip, apksigner v1+v2+v3.
* API levels live in `app.env` and are passed to `aapt2 link`; the template manifest carries no
  `<uses-sdk>`, so the two cannot drift.
* Termux `d8` is never used: it is R8 3.3 and dies on `NestMembers` from anonymous classes.
* The Termux JDK startup abort (`PerfettoTrace`) is repaired by generating a stub jar from the
  device's own `libperfetto_framework_jni.so`, then wrapping every JDK tool's bootclasspath.
  Both 64- and 32-bit library paths are probed.

## Toolchain

* Fully offline: `vendor/` ships `android-33-android.jar` (27 MB) and a repacked R8 (11 MB,
  `resources/` stripped - verified to dex) with `SHA256SUMS` and `MANIFEST.md`. Only
  `pkg install` needs the network.
* `verify-vendor.sh` checks size, checksum, that `D8.class` and the framework resources are
  present, and dexes a real class. `selfcheck.sh` runs scaffold -> build -> install -> test.
* Applying a different api level, R8 version or key is done with environment variables; no
  script edits.

## Install / launch

* Root: stage the apk in `/data/local/tmp`, `pm install -r -g`, HOME-then-start for Android 14+,
  and a retry that disables OEM package verifiers when the install hangs on a dialog.
* No root: `termux-open` with one tap, and a clear statement of what cannot be verified.
* One root abstraction (`lib/root.sh`) for `su` / `sudo` / already-root / none, including the
  global mount namespace where app data is only visible - for reads *and* writes.

## Testing

* Test hooks: intent extras for cold starts, a polled `files/testhook` file for a warm app.
* The app writes its own `files/testlog.txt`; assertions poll that file instead of logcat,
  which is evicted by system noise on busy phones.
* `probe.sh` reports foreground state from two sources (`dumpsys window`, then
  `dumpsys activity activities`) and prints the crash buffer.
* `screen.sh` turns a screenshot into ASCII art for models that cannot see images.
* `test.sh` exits 3 ("skipped") instead of failing when there is no root.

## Compared to the private version

* Every hard-coded path, package name, device name and download url is gone; all tunables are
  in `lib/config.sh` and documented in the reference files.
* Duplicated documentation was merged; `vendor/MANIFEST.md` exists now; the scaffold copies
  exactly the scripts the docs promise.
* The 67 MB platform zip is no longer shipped (the extracted jar is).
* Added `selfcheck.sh`, `verify-vendor.sh`, `APK_NO_ROOT` and the no-root code paths.
