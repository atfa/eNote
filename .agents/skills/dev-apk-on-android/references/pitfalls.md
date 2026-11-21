# Pitfalls: symptom -> cause -> fix

Every entry below is a failure that was actually hit building and testing apks on a phone.
Read the symptom column first: that is what you will see.

## Toolchain

### 1. `NullPointerException: Cannot invoke "String.length()" ...` in d8

Termux's `d8` is R8 3.3. It does not understand the `NestMembers`/`NestHost` attributes that a
JDK 11+ compiler puts in the class file for nested classes, and crashes on the first anonymous
inner class. Fix: dex with the vendored R8 -
`java -cp $ANDROID_TOOLS/r8.jar com.android.tools.r8.D8 --release --lib $ANDROID_JAR ...`.

### 2. `error: option --release cannot be used together with --bootclasspath`

JDK 21 refuses the pair. Fix: `-source 8 -target 8 -bootclasspath android.jar -classpath
android.jar`. Do not raise `-target` without a matching `android.jar`: the classes then carry
JDK-21 attributes and d8 fails as in #1.

### 3. `aapt2 link`: `error: unknown option '-R'`

aapt2 takes compiled resources as positional arguments:
`aapt2 link -o base.apk -I android.jar --manifest AndroidManifest.xml res.zip --java gen`.

### 4. `attribute android:versionCode not found` (or `@mipmap/... not found`) from aapt2

The `-I` jar is not a full framework jar: it is missing `resources.arsc`/`res/`, so no
`android:` attribute resolves. Fix: use the real `android.jar` (the vendored one has them). A
"classes only" jar is fine for javac and d8 but never for aapt2. The device's
`/system/framework/framework-res.apk` is not accepted either (`failed to load include path`).

### 5. `package R does not exist`

`aapt2 link --java out/gen` produced `R.java`, but the javac source list only walked `src/`.
Fix: compile `find src out/gen -name '*.java'`.

### 6. `zipalign: command not found`

There is no zipalign in Termux. A pure Java/Kotlin apk installs unealigned. With native libs
either align with a java/python tool or set `android:extractNativeLibs="true"`.

### 7. Google build-tools binaries do not run (`cannot execute: required file not found`)

The SDK's `aapt2`/`zipalign`/`adb` are glibc x86_64 binaries. On device, use the Termux
packages instead; with Gradle set `android.aapt2FromMavenOverride=$PREFIX/bin/aapt2` and
`zipAlignEnabled = false`.

### 8. javac/jar/keytool exit 134: `Native registration unable to find class ... PerfettoTrace`

The Termux JDK is broken until the stub is on its boot classpath - it is not a code error, and
`java -version` succeeding proves nothing. Fix: `fix-termux-javac.py` + `wrap-termux-jdk.sh`
(run by `setup-toolchain.sh`). Re-run them after `pkg upgrade` and after a ROM update.
See `build.md`.

### 9. `Could not find or load main class com.android.tools.r8.D8` / bad dexer jar

The r8 jar is truncated or an HTML error page from a failed download.
`sh scripts/verify-vendor.sh` checks size, sha256 and that `D8.class` is present.

## Install and launch

### 10. Non-root `pm install`: `SecurityException: ... does not have permission INSTALL_PACKAGES`

Expected on Android 11+; it is not fixable from an app uid. Use root `pm install`, or
`termux-open app.apk` and tap Install once.

### 11. `pm install` as root prints nothing and never returns

An OEM package verifier (Play Protect on One UI and others) is waiting for a human tap;
Android 16 removed `--disable-verification`. Fix: `silent-install.sh` (the `settings put`
block in `install.md`), then retry. Also stage the apk under `/data/local/tmp` - `pm install`
fails or hangs when system_server cannot read the path.

### 12. The hook file "exists" but the app never reacts; its log looks empty

`su -c` is showing a **shadow** `/data/data` (seen with KernelSU). Fix: use the global
namespace for app data, both directions:
`su --mount-master -c "cat /data/data/<pkg>/files/testlog.txt"` (`asroot_global`).

### 13. SharedPreferences silently stops saving (`commit()` returns false, no log)

Root created `/data/user/0/<pkg>` (or `files/`) before the app did. The owner/label is wrong
and `pm install -r` does not fix it. Fix: never `mkdir` inside an app's data dir as root;
recover with `pm uninstall` + `pm install`.

### 14. The app cannot read a root-written file

Root's umask gives `0600`, or the file landed in the shadow namespace. Fix: write with
`asroot_global` and `chmod 644`.

### 15. `am start` does nothing: `Activity not started, its current task has been brought to the front`

Android 14+ blocks activity starts from a background shell, and drops the extras when the task
is already in front. Fix: `input keyevent KEYCODE_HOME` first, then `am start`; and use the
file hook for a warm app.

### 16. The app opens in a small window and taps land somewhere else

Vendor freeform modes (`mWindowingMode=vivofreeform`) and desktop/tablet windowing put the app
in a resizable window, so `input tap` screen coordinates differ from view coordinates in both
axes. Fix: `android:resizeableActivity="false"`, and compute taps from the app's own
`getLocationOnScreen()` output.

### 17. `pm uninstall` "succeeds" but the app is still there

A multiprofile device (work profile, second space, "dual messenger") added a second user. Fix:
`pm list users`, then `pm uninstall --user 0 <pkg>` / `pm install --user 0`.

## Testing a running app

### 18. `logcat` shows none of the app's lines a few seconds later

The ring buffer was flooded by system noise (MIUI, sensors, audio HAL) and evicted.
`logcat -G 16M` helps a little; the reliable channel is a file the app writes itself
(`files/testlog.txt`), read as root in the global namespace.

### 19. The app is "in the foreground" but hooks do nothing

No surface means no render loop: the screen is off, or the activity is paused behind a dialog.
Fix: `input keyevent KEYCODE_WAKEUP`, `svc power stayon true`, close dialogs, then retry.

### 20. `dumpsys window` returns nothing while the app is clearly in front

Under memory pressure dumpsys truncates. Fix: also query
`dumpsys activity activities | grep mResumedActivity` (`probe.sh`), or trust the app's own
"answered a hook N seconds ago".

### 21. The test script dies with no output

`set -eu` plus `X=$(readlog | grep foo)` - grep returning 1 aborts the script. Fix: append
`|| true`, or wrap in `if`.

### 22. The test passes without the action happening

The log was cleared before the action, so a stale line from a previous run satisfied the
check. Fix: clear after the action, and poll for the line rather than sleeping once.

### 23. BACK does nothing / the activity closes without running the handler

A SurfaceView is not focusable by default, so key events never reach its `onKeyUp`. Fix:
handle BACK in the Activity (`onKeyDown`/`onBackPressed`).

### 24. `run-as: /data/user has wrong owner`

`run-as` is unusable on userdebug/factory ROMs. Fix: read app files as root in the global
namespace (`su --mount-master`), or have the app expose what you need through a hook.

## Virtual display

### 25. `ERR no frame (is the display showing anything?)`

A virtual display created with `OWN_DISPLAY_GROUP` starts in a display group whose power state
is OFF, and an OFF display renders nothing - `createVirtualDisplay` succeeds, the app launches,
and every capture is empty. Fix: set a power override after creating it
(`DisplayManager.setOverrideDisplayState(id, 2)`), which is what `vd.sh` does at startup. It is
also what keeps the app rendering while the panel is off.

### 26. The display is created but is not trusted / does not take focus the way you asked

Flag values move between Android versions - `VIRTUAL_DISPLAY_FLAG_TRUSTED` is `0x40` on 10-13
and `0x400` on 16, and several names appear or disappear between releases. Hard-coded numbers
silently mean a different flag. Fix: read them from the framework by name at runtime
(`DisplayManager.class.getField(name)`), as `vendor/vd/Vd.java` does.

### 27. The `app_process` daemon hangs forever at startup

`ActivityThread.systemMain().getSystemContext()` never returns in a process with no Looper - the
process just sits there until it is killed (exit 137). Fix: `Looper.prepareMainLooper()` first.

### 28. Shots of a landscape app come out sideways and taps are transposed

SurfaceFlinger renders into the display's **base** (natural) size, so a landscape app is drawn
rotated inside a portrait buffer, and `Display.getRotation()` reports 0 for it. Fix: read the
app window's transform from `dumpsys input` (`transform (ROT_270)`) and rotate the shot the
other way; `vd.sh launch` does it and maps tap coordinates through it.

### 29. `Unknown command: touchscreen`

`input -d 131 touchscreen tap x y` is the wrong order - the input source goes **before** `-d`:
`input touchscreen -d 131 tap x y`.

### 30. The tap is accepted and nothing happens

It landed outside the window's `touchableRegion` (measured: `touchableRegion=[0,0][1080,1080]`
on a 1080x2400 display), and input to a rotated window has rotated bounds. Fix: check
`su -c "dumpsys input"` under `Display: <id>`, and give `vd.sh` screenshot coordinates, which it
maps for you.

### 31. `IllegalStateException: buffer is inaccessible`, or a PNG that will not decode

The `ImageReader` buffer is closed by the time you read it, and a screenshot written straight to
its final name is read while still being written. Fix: copy the pixels under the same lock that
closes the image, and write to `.tmp` then rename; the driver polls for the file.

### 32. `NoSuchMethodException: setVirtualDisplayState`

That API does not exist on Android 16 (on `DisplayManager` or `DisplayManagerGlobal`). Fix: probe
`setOverrideDisplayState` → `setForceDisplayStateOn` → `DisplayManagerGlobal.requestDisplayPower`,
in that order.

### 33. The app pops up on the user's screen when you release the display

A display that disappears does not take its apps with it: the system **moves** the tasks to the
default display, so `vd.sh destroy` throws the app in front of the user (measured: display 0 went
from `com.termux` to `com.android.settings/.Settings`, and the Bluetooth page appeared). Fix:
create the display with `VIRTUAL_DISPLAY_FLAG_DESTROY_CONTENT_ON_REMOVAL`, which finishes the
apps instead of relocating them - `vd.sh` sets it.

## Packaging

### 34. `FileNotFoundException: assets/...` at runtime, although the file is inside the apk

The packaging step zipped the *contents* of `assets/` (`(cd assets && zip -r ../apk/unaligned.apk .)`),
which stores `model.bin` at the archive root. `AssetManager.open("mdl/model.bin")` looks up the
literal path `assets/mdl/model.bin`, so every lookup fails - and `unzip -l` looks fine at a glance.
Fix: zip the directory itself from the project root, `zip -q -X -r out/apk/unaligned.apk assets`,
and verify with `unzip -l out/apk/unaligned.apk | grep '^.*assets/'`.

### 35. `UnsatisfiedLinkError: dlopen failed: library "libfoo.so" not found` for a prebuilt `.so`

`build.sh` packaged only the library it built itself (from `out/native/`); a `.so` shipped in the
project's `jniLibs/<abi>/` was never added to the apk, so `System.loadLibrary("foo")` failed even
though the file sat in the project. Fix: stage `jniLibs/<abi>/*.so` into `out/apk/lib/<abi>/` and
zip that directory - the archive path must be exactly `lib/<abi>/<name>.so` - then confirm with
`unzip -l app.apk | grep 'lib/'`.

## Hooks driven from adb

### 36. ANR right after `am start --es hook ...`, app is killed with "user request after error"

A hook that runs its work on the activity's main thread blocks the UI for the whole call - a
request to a local LLM endpoint easily takes 10 s - and the system kills the app with
`ANR in <pkg> ... Waited 5002ms for FocusEvent(hasFocus=true)` (see `dumpsys dropbox --print`).
The hook itself still returns its result, so the driver sees the answer and the app dies
afterwards. Fix: run hook work on a worker thread and return from `onCreate`/`onNewIntent`
immediately; report progress through the app's own log file, which is what the driver polls.
