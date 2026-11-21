# Go as the business layer of an APK (built on the phone)

Business logic in **Go**, compiled on the device into `lib<name>.so`, loaded by a thin Java
shell with `System.loadLibrary`. No Gradle, no Android Studio, no NDK, no gomobile, no PC.

Measured on this device (Termux, go1.26.4, Android 16/arm64, KernelSU root):

| | pure Java baseline | Go business layer |
|---|---|---|
| apk size (hello + benchmark) | 21 KB | 832 KB (1.58 MB stripped `.so`, compressed in apk) |
| + `net/http` (WebView variant) | – | 3.26 MB (6.16 MB `.so`) |
| installed native libs | – | 7.6 MB extracted (`extractNativeLibs="true"`) |
| cold start `am start -W` (median of 5) | 222 ms | 240 ms |
| `System.loadLibrary` | – | 0.8–3 ms |
| total PSS after start | 66 MB | 77 MB |
| `fib(28)` | 131 ms | 1.4–2.9 ms |
| fan-out 200k items, 8 workers | 831 ms | 150–420 ms |
| 50k string appends | 2.0 ms | 5–17 ms |
| one Java→Go call | 106 ns (Java call) | 370 ns |
| `go build -buildmode=c-shared` | – | 0.3 s warm, 2.7 s cold |

Go wins big on compute (AOT-compiled, no JIT warmup), loses on APK size and a few MB of RSS.
Java wins on string/`StringBuilder` churn.

## Quick start

```sh
S=<this skill>/scripts
sh $S/setup-toolchain.sh
sh $S/new-go-project.sh $HOME/apps/goapp com.example.goapp "Go App" goapp
cd $HOME/apps/goapp && GO_TEST=1 ./build.sh && ./install.sh && ./test.sh
```

`new-go-project.sh` scaffolds: `go/main.go` (business logic + JNI bridge), `go/web.go`
(`net/http` server + HTML page for a WebView UI), `go/bin/` (pure-Go binary, no cgo),
a thin `MainActivity.java`, the manifest switches, and the `GO_*` keys in `app.env`.
Hooks to drive it: `--es hook async|threads|webtest|web|exec`.

Requirements: `pkg install golang` (Termux's go is preconfigured for
`GOOS=android GOARCH=arm64 CGO_ENABLED=1 CC=aarch64-linux-android-clang`), `ndk-sysroot`
(provides `$PREFIX/include/jni.h`), and the normal toolchain from `setup-toolchain.sh`.
No `ANDROID_HOME`, no NDK download, no `gomobile`.

## The three build modes, and when to use each

| mode | command | use for |
|---|---|---|
| `c-shared` (the default here) | `go build -buildmode=c-shared -o libX.so .` | the app's business layer, called from Java over JNI |
| plain binary | `go build -o x .` (static, 0 `NEEDED`) | shipped as `lib/arm64-v8a/libx.so`, `Runtime.exec`'d from Java - total isolation, pipes for IPC |
| `gomobile bind` | needs `$ANDROID_HOME` + a real NDK | **not usable on the phone**: the NDK ships x86_64-linux toolchains, which cannot run on an arm64 device |

`c-shared` output needs only `liblog.so`, `libdl.so`, `libc.so` - all public system libs, so
the app does not depend on Termux. The `RUNPATH` pointing into `$PREFIX/lib` is inert: the app
uid cannot read Termux's data dir, so the loader falls back to the system libs.

## Rules for the JNI layer (each one measured)

1. **Export JNI-named symbols directly.** `//export Java_com_example_goapp_MainActivity_nativeAdd`
   is what the runtime resolves for `native int nativeAdd(int,int)` in
   `com.example.goapp.MainActivity`. No C shim, no `RegisterNatives`.
   Package and method names must contain **no underscores** (they need `_1` mangling);
   `new-go-project.sh` refuses such packages.
2. **cgo cannot call `JNIEnv`'s function-pointer table** from Go
   (`env.NewStringUTF undefined`): `JNIEnv` is `const struct JNINativeInterface*`, so cgo
   generates no methods. Wrap the few JNI calls you need as `static` C helpers in the cgo
   preamble (`(*env)->NewStringUTF(env, s)`). The template ships `jNewString`, `jGetChars`,
   `jRelChars`, `jisNull`, `jCallOnGoCallback`, `jNewGlobalRef`, `jGetJavaVM`, `jAttach`, `jDetach`.
3. **cgo `//export` rejects `_` as a parameter name** (`error: redefinition of parameter '_'`).
   Name every parameter, even unused ones (`env *C.JNIEnv, cls C.jclass`).
4. **A Go panic that reaches the JVM kills the process** (SIGABRT, `DEBUG` tombstone); Java
   cannot catch it. Every export must `recover()` - use the `guard()` helper in the template.
   Verified: unrecovered panic in a goroutine → `pidof` empty, tombstone in the `crash` buffer.
5. **A goroutine that outlives the JNI call needs a global ref.** A `jobject` local reference
   dies with the call: `NewGlobalRef` first, `DeleteGlobalRef` before detaching.
6. **A Go-created thread must be attached to the JVM** before touching `JNIEnv`:
   `GetJavaVM` → `AttachCurrentThread` → use → `DeleteGlobalRef(jenv, …)` → `DetachCurrentThread`.
   Getting this order wrong aborts with
   `JNI DETECTED ERROR IN APPLICATION: a thread (tid N) is making JNI calls without being attached`.
7. **Batch the calls.** One crossing costs ~260 ns (370 ns vs a 106 ns Java call): fine per
   user action, fatal per pixel. Pass a slice/JSON, not a loop of single-value calls.
   String round-trip: ~45 µs for the first call, µs-scale after.
8. **Run native calls off the main thread** - a JNI call that blocks the UI thread for 5 s is
   an ANR. The template runs its battery on a worker thread.
9. **Concurrent calls from many Java threads are fine** (measured: 8 threads × `fib(22)`,
   8/8 correct); the Go runtime handles the threading, no `LockOSThread` needed.
10. **Go writes files itself**: pass `getFilesDir()` as a string and use `os.WriteFile` -
    no Java file plumbing needed.
11. **`android.jar` has no `LambdaMetafactory`**, so the Java shell cannot use lambdas or
    method references (`javac -source 8 -bootclasspath android.jar` fails with
    `cannot find symbol ... method metafactory`). Anonymous inner classes only - and that is
    already required by rule 1 of the skill (d8/R8 + anonymous classes).

## Packaging rules (skill-specific)

* `android:extractNativeLibs="true"` on `<application>` - there is **no zipalign on device**,
  and an unaligned compressed `.so` cannot be mapped in place. `build.sh` warns if it is missing.
* The `.so` goes in at `lib/arm64-v8a/lib<name>.so` (`zip -X -r`, stored/deflated is fine with
  `extractNativeLibs="true"`), then sign with `apksigner` as usual.
* `GOARCH` decides the ABI: `arm64`→`arm64-v8a`, `arm`→`armeabi-v7a`, `amd64`→`x86_64`.
  **Only the device's own ABI is buildable on the phone**: cross-ABI with cgo fails
  (`clang: error: unsupported option '-mno-thumb'`), and pure-Go cross-compiling to
  android/arm, amd64, 386 fails with `requires external (cgo) linking`. Multi-ABI needs a
  real NDK on a PC.
* Ship a plain Go binary as `lib<abi>/lib<name>.so` to get it extracted into
  `getApplicationInfo().nativeLibraryDir`, where it is executable - that is how the `exec`
  variant works (no JNI, no shared address space, exit codes and pipes as IPC).

## The WebView variant (business logic 100 % Go)

`go/web.go` starts `net/http` on `127.0.0.1:0` and serves an HTML page plus a JSON API;
`GoWebViewActivity` loads the URL and exposes `window.Android.fromWeb(...)` back into Java.
Measured: server up in ~1 ms, page finished in ~300 ms, JS→Go→Java callback delivered.
Needs `INTERNET` permission and `android:usesCleartextTraffic="true"` (plain http on
localhost; Android blocks cleartext by default).

Verified end to end: `web: server at http://127.0.0.1:44003/` → `web: page finished` →
`check webview: js says benchmark ok 141 bytes`.

## What is not possible

* **No Java at all**: Android instantiates an Activity *class*, so one Java/Kotlin class is
  unavoidable. The minimum is a ~60-line shell (View + lifecycle + `loadLibrary`); everything
  else can be Go, including drawing (Go can do everything C can via JNI `Surface` locking).
* **Kotlin**: same story as Java, `kotlinc` on device, then d8.
* **gomobile**: `gomobile bind` fails on the phone - it demands
  `$ANDROID_HOME/ndk[-bundle]/meta/platforms.json` and a real SDK layout
  (`platforms/android-XX/android.jar`, `build-tools/XX/aapt`), and the NDK's prebuilt
  clang is x86_64-linux. Plain `go build -buildmode=c-shared` needs none of that.

## Wails v3 as the business layer (server mode)

Wails v3.1.0 compiles on the phone and runs in Android `server` mode: a headless HTTP server
that serves the frontend and exposes bound Go services to JS. No NDK, no npm, no `wails3
build` - its embed is `//go:embed all:frontend/dist`, so a plain `go build` picks the
frontend up.

```sh
pkg install nodejs-lts            # only needed for `wails3 generate bindings`
go install github.com/wailsapp/wails/v3/cmd/wails3@latest    # builds on the phone, ~2 min
cd go && GOFLAGS=-mod=mod go mod tidy        # android needs coder/websocket, x/sys, x/term
wails3 generate bindings -b -d frontend/dist/wailsjs .       # JS bindings, generated on device
GOOS=android GOARCH=arm64 CGO_ENABLED=0 go build -tags server -trimpath -ldflags="-s -w" -o app .
```

Packaging: ship the binary as `lib/<abi>/lib<name>.so` - `build.sh` does it with
`GO_BIN=<name>`, `GO_BIN_DIR=<dir>`, `GO_BIN_FLAGS='-tags server'`. Java `ProcessBuilder`
exec's it from `nativeLibraryDir`, reads the `SERVER URL:` line from stdout and loads it in a
WebView; `window.Android` is the way back.

* `Server{Host:"127.0.0.1", Port:0}` makes wails pick a free port; print the URL yourself
  after `application.New()` (Java parses it, never hardcode a port).
* JS → Go goes to `POST /wails/runtime` with
  `{"object":0,"method":0,"args":{"methodID":<id>,"args":[…],"call-id":"c1"}}` - curl-able,
  the method IDs are in the generated `wailsjs/.../app.js`.
* Measured on a vivo arm64 phone: 11.7 MB binary (frontend embedded), 17 ms from exec to
  listening, page + service round trip ~1 s, `fib(28)` from JS in 2 ms (Java: 131 ms).
* `wails3 tool doctor` warns about missing webkit2gtk/gtk4 - harmless on Android.
* **mygo** (mygo.run) needs go >= 1.27 and a desktop GUI backend (purego + AT-SPI + X11):
  no Android support, and Termux's go cannot download a toolchain (`android/arm64` is not a
  released Go build), so it is not usable on device.

## Debugging tips

* Go's `os.Stderr` inside an app goes nowhere visible; log to logcat via a JNI callback, or
  write to a file under `getFilesDir()` and read it with `su --mount-master`.
* A missing JNI symbol kills the calling thread **silently** (`UnsatisfiedLinkError` in a
  bare `Thread`). Wrap hook bodies in `try { … } catch (Throwable t) { note(...) }`, and
  check with `nm -D --defined-only out/native/libX.so | grep Java_`.
* `build.sh` failing in a pipeline leaves the **previous** apk on disk: check the apk
  timestamp before concluding "the new build does not work".
* `GO_TEST=1 ./build.sh` runs `go test ./...` first - the pure-Go half of `go/main.go` is
  unit-testable, and `go test` itself runs on the device (the test binary is android/arm64).
