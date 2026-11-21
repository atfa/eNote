# The on-device toolchain

Nothing here needs a PC, the Android SDK manager, or Gradle. Five tools and one jar.

```sh
pkg install openjdk-21 aapt2 aapt apksigner zip unzip python
```

| tool | job | notes |
|---|---|---|
| `aapt2` | compile + link resources, write the binary manifest | Termux package, native aarch64 |
| `aapt` | `dump badging` (report package/label/launchable activity) | used for the build summary |
| `javac` | `.java` -> `.class` against `android.jar` | openjdk-21, needs the Perfetto stub |
| `d8` | `.class` -> `classes.dex` | from `vendor/r8-*.jar`, **never** Termux's `d8` |
| `apksigner` | sign v1+v2+v3 | Termux package |
| `zip` | put `classes.dex` (+ assets) into the linked apk | no `zipalign` on device |

`setup-toolchain.sh` installs the jars and the JDK fix; `build.sh` in a project runs the five
steps below. Read this when you need to change a step, not to run it.

## 1. Resources

```sh
aapt2 compile --dir res -o out/res.zip                 # skip if res/ is empty
aapt2 link -o out/apk/base.apk -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 33 \
  --auto-add-overlay --java out/gen out/res.zip
```

* Compiled resources are **positional arguments**; `-R` does not exist in aapt2.
* `--java out/gen` writes `R.java`; it has to be compiled together with the sources.
* min/target sdk are given here, which is why the scaffold's manifest has no `<uses-sdk>`.
  One source of truth (`app.env`), and `aapt dump badging` shows the api levels actually used.
* `-I` must be a real `android.jar` **with** `resources.arsc` and `res/`. A jar stripped of the
  framework resources links nothing: `error: attribute android:versionCode not found`. The
  device's own `/system/framework/framework-res.apk` is not accepted either
  (`error: failed to load include path ...`).

## 2. Compile

```sh
javac -nowarn -source 8 -target 8 -bootclasspath "$ANDROID_JAR" \
      -classpath "$ANDROID_JAR" -d out/classes @out/sources.txt
```

* `--release 8` does not work together with `-bootclasspath` (JDK 21: "option --release
  cannot be used together with --bootclasspath"), and `-target 11` alone leaves the class file
  at JDK 21 major version with `NestMembers` attributes that Termux's d8 chokes on.
* `-source 8 -target 8` plus a `android.jar` bootclasspath is the combination that works and
  keeps the dex small.

## 3. Dex

```sh
java -cp "$R8_JAR" com.android.tools.r8.D8 --release --lib "$ANDROID_JAR" \
     --min-api 24 --output out/dex $(find out/classes -name '*.class')
```

Termux's `d8` is R8 3.3 and crashes on anonymous inner classes with
`NullPointerException: Cannot invoke "String.length()" because ... is null` - the class file
carries a `NestMembers` attribute from JDK 11+ that it does not understand. The vendored R8
runs on the same JVM and handles it.

R8 (as opposed to D8) shrinking is not used by default. If you want `--minify`, take the
upstream jar unchanged (see `vendor/MANIFEST.md`) - the bundled one has R8's rule files stripped.

## 4. Package

```sh
cp out/apk/base.apk out/apk/unaligned.apk
(cd out/dex && zip -q -X -j ../apk/unaligned.apk classes.dex)
zip -q -X -r out/apk/unaligned.apk assets        # if assets/ is not empty
```

Zip the `assets` *directory*, from the project root: `AssetManager` looks up the literal path
`assets/foo.bin`, so `(cd assets && zip -r ../apk/unaligned.apk .)` stores `foo.bin` at the
archive root and every lookup fails at runtime with `FileNotFoundException`.

Native libraries need the archive path `lib/<abi>/<name>.so`, so stage them first (the Go build
writes them to `out/native/`, prebuilt ones live in `jniLibs/<abi>/`):

```sh
mkdir -p out/apk/lib/arm64-v8a
cp out/native/*.so jniLibs/arm64-v8a/*.so out/apk/lib/arm64-v8a/
(cd out/apk && zip -q -X -r ../apk/unaligned.apk lib/arm64-v8a)
```

There is no `zipalign` in Termux and none is needed for a pure Java/Kotlin apk. With native
libraries, either align with a Java/python tool or set `android:extractNativeLibs="true"` in
the manifest.

## 5. Sign

```sh
keytool -genkeypair -keystore ~/.android/debug.keystore -alias androiddebugkey \
  -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Android Debug,O=Android,C=US"
apksigner sign --ks ~/.android/debug.keystore --ks-pass pass:android \
  --key-pass pass:android --out app.apk out/apk/unaligned.apk
```

The scaffold signs with the debug key. For a real release, generate a key with your own
password and point `ANDROID_KEYSTORE` / `ANDROID_KS_ALIAS` / `ANDROID_KS_PASS` at it, or run
`apksigner sign --ks <key>` by hand after `./build.sh`.

## The Termux JDK aborts at startup (PerfettoTrace)

Symptom, on any tool except `java -version`:

```
Native registration unable to find class
'com/android/internal/dev/perfetto/sdk/PerfettoTrace'; aborting...
Unable to register perfetto native methods.
```
exit code 134, even for `javac -version`.

Cause: Termux's OpenJDK is a native Android binary. Its JNI `OnLoad` (from the system's
`libperfetto_framework_jni.so`) registers natives for a class that only exists in the Android
framework. `RegisterNatives` is all-or-nothing, so the JVM aborts.

Fix, done by `setup-toolchain.sh`:

```sh
python3 fix-termux-javac.py ~/android-tools/perfetto-stub.jar   # stub classes from the .so
sh wrap-termux-jdk.sh                                          # bootclasspath for every tool
javac -version && jar --version                                # must both print a version
```

`fix-termux-javac.py` reads the class names and the exact native method signatures out of the
device's own library (paths: `/system/lib64/`, `/system/lib/`, plus the `art` apex; override
with `PERFETTO_JNI_LIB`), so the stub matches the installed Android build. Run both scripts
again after `pkg upgrade` (it restores the `$PREFIX/etc/alternatives` symlinks) and after a
ROM update. `libperfetto` refactoring in a future Android release can change the class name -
then the stub must be regenerated, which is exactly what the script does.

## Kotlin, native code, Gradle

* Kotlin: `pkg install kotlin`, `kotlinc -classpath "$ANDROID_JAR" -d out/classes src/...`,
  then feed the classes to d8 as usual.
* Rust: `pkg install rust-std-aarch64-linux-android ndk-sysroot`, build a `.so`, ship it under
  `assets/` and unpack it at first start, or inside the apk under `lib/<abi>/` with
  `extractNativeLibs="true"`.
* Gradle/AGP on device works but needs `android.aapt2FromMavenOverride=$PREFIX/bin/aapt2`
  and `zipAlignEnabled = false` (Google's build-tools binaries are glibc x86_64). It is slow
  and RAM-hungry; for multi-module projects build in CI and `termux-open` the artifact.
