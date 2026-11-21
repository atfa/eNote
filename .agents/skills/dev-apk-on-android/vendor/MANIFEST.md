# vendor/ - what is in here, where it came from, how to refresh it

Everything needed to build an APK offline lives in this directory. `setup-toolchain.sh`
verifies each file against `SHA256SUMS` and copies it into place; it never downloads
anything when these files are present.

Total: ~38 MB (2 files). `git clone` and the first `setup-toolchain.sh` need no network.

| file | size | sha256 (this copy) | installed to |
|---|---|---|---|
| `android-33-android.jar` | 27 MB | `14261d28...0c25fe7` | `$ANDROID_HOME/platforms/android-33/android.jar` |
| `r8-8.13.25.jar` | 11 MB | `77f98a0a...d7be6e3` | `$ANDROID_TOOLS/r8.jar` (the dexer, called as `D8`) |

`SHA256SUMS` is what the scripts verify - run `sh scripts/verify-vendor.sh` to check both.

## android-33-android.jar

Upstream: `android-33-platform.zip` (67 MB, sha256 `f851b13f...8c07bc8`) from
<https://dl.google.com/android/repository/platform-33_r02.zip>, entry `android-33/android.jar`.
The 67 MB zip is **not** shipped: it only exists to produce this jar.

`android.jar` is used for three different jobs and the full jar is required for the first:

* `aapt2 link -I` - needs the framework **resource table** (`resources.arsc` + `res/`), so a
  "classes only" jar is not enough. Measured: stripping `res/`, `resources.arsc`, `assets/`
  shrinks it to 4.8 MB but `aapt2 link` then fails with
  `error: attribute android:versionCode not found`. Points to note if you ever try to slim it.
* `javac -bootclasspath` - only the class files matter.
* `d8 --lib` - only the class files matter.

Also rejected as an aapt2 include path: the device's own
`/system/framework/framework-res.apk` (`error: failed to load include path ...`), so the jar
cannot be replaced by something already on the phone.

## r8-8.13.25.jar

Upstream: <https://maven.google.com/com/android/tools/r8/8.13.25/r8-8.13.25.jar>
(18,273,598 bytes, sha256 `0d4f2f68...1cea03d`).

This copy is a repack: the `resources/` directory (6.7 MB of R8's own `.json`/rule data,
only used by R8 shrinking, not by D8 dexing) was dropped. Verified: `D8 --release --lib
android.jar --min-api 24` produces a working `classes.dex` from this jar.
Recreate with:

```sh
python3 - <<'PY'
import zipfile, shutil
z = zipfile.ZipFile("r8-8.13.25.orig.jar")
with zipfile.ZipFile("r8-8.13.25.jar", "w", zipfile.ZIP_DEFLATED, compresslevel=9) as w:
    for i in z.infolist():
        if not i.filename.startswith("resources/"):
            w.writestr(i.filename, z.read(i.filename))
PY
```

Do not strip `com/android/tools/r8/internal/` (7 MB): it holds the relocated guava/gson the
dexer actually links against. If you need full R8 shrinking (`-minify`), take the upstream
jar unchanged and set `R8_JAR` to it.

## Adding another API level

Only API 33 is bundled. For e.g. API 35:

```sh
curl -fL -o vendor/android-35-android.jar \
  https://dl.google.com/android/repository/platform-35_r0X.zip   # unzip, take android.jar
APK_API=35 sh scripts/setup-toolchain.sh          # installs it + checks aapt2/javac/d8
cd vendor && sha256sum android-35-android.jar >> SHA256SUMS
```

`setup-toolchain.sh` is written for any `APK_API` whose `android-<API>-android.jar` is in
`vendor/`; it refuses with a clear message when the jar is missing instead of downloading.

## Refreshing the dexer

`R8VER=8.14.0 sh scripts/setup-toolchain.sh` downloads a new R8 into `vendor/` and appends it
to `SHA256SUMS`. Our trimmed copy is only used when the file is already present, so picking a
new version works without touching any script.
