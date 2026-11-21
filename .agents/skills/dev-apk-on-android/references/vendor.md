# The offline toolchain in `vendor/`

This skill builds with **no download**. The two binaries it needs ship inside it:

```
vendor/android-33-android.jar   27 MB   -> $ANDROID_HOME/platforms/android-33/android.jar
vendor/r8-8.13.25.jar           11 MB   -> $ANDROID_TOOLS/r8.jar            (D8)
vendor/SHA256SUMS                      verified by setup-toolchain.sh
vendor/MANIFEST.md                     upstream urls, hashes, how to rebuild the repack
```

`setup-toolchain.sh` verifies each file, copies it into place and stops. That makes a fresh
phone work offline after one `pkg install`, and makes a re-run of the setup take well under a
second.

## What still needs the network

Only the Termux packages, and only on a fresh install:

```sh
pkg install openjdk-21 aapt2 aapt apksigner zip unzip python
```

There is no way to bundle those: `aapt2` and `apksigner` are native aarch64 Termux packages,
and the JDK is ~200 MB. If they are already installed, the whole skill runs offline.

## Why the 27 MB jar is not slimmed

`android.jar` is used three times, and one of those uses needs the framework **resource
table**:

| step | needs |
|---|---|
| `aapt2 link -I` | classes + `resources.arsc` + `res/` (measured: a classes-only jar fails with `attribute android:versionCode not found`) |
| `javac -bootclasspath` | classes only |
| `d8 --lib` | classes only |

Stripping `res/` + `resources.arsc` + `assets/` shrinks it to 4.8 MB but breaks aapt2, so the
full jar is the only copy that works for all three. The device's own
`/system/framework/framework-res.apk` is rejected by aapt2 as an include path, so it cannot
replace the jar either. The 67 MB platform zip that the jar comes from is **not** shipped - it
only exists to produce this file.

The dexer *is* slimmed: R8's own `resources/` (6.7 MB of rule/json data, unused by D8) was
removed, 18.3 MB -> 11.4 MB, verified by `scripts/verify-vendor.sh` which dexes a class with
the bundled jar every time it runs.

## Another API level

```sh
curl -fL -o /tmp/platform-35.zip https://dl.google.com/android/repository/platform-35_r0X.zip
unzip -j /tmp/platform-35.zip '*/android.jar' -d vendor && \
  mv vendor/android.jar vendor/android-35-android.jar
(cd vendor && sha256sum android-35-android.jar >> SHA256SUMS)
PLATFORM_API=35 sh scripts/setup-toolchain.sh
```

`setup-toolchain.sh` installs whatever `vendor/android-<API>-android.jar` exists and refuses
with a clear message when it does not. A project picks its api level in `app.env`
(`PLATFORM_API=${PLATFORM_API:-35}`), so one phone can build for several levels.

## A different / newer dexer

```sh
R8VER=8.14.0 sh scripts/setup-toolchain.sh      # downloads into vendor/, appends to SHA256SUMS
R8_JAR=/path/to/r8.jar ./build.sh               # or point a single build at another jar
```

The bundled jar has R8's shrinking resources stripped - it is a D8 dexer. If you need
`--minify`/`--release` shrinking, take the upstream jar unchanged (see `vendor/MANIFEST.md`)
and set `R8_JAR` to it.

## Keeping it honest

```sh
sh scripts/verify-vendor.sh     # sizes, sha256, D8 present, framework resources present, real dex
sh scripts/selfcheck.sh         # scaffold -> build -> install -> test, then clean up
```

`verify-vendor.sh` is the cheap check (seconds, no device state touched). `selfcheck.sh` is the
full one: it uses its own package name (`dev.selfcheck.sample`), uninstalls it afterwards, and
skips install/test when there is no root. Run both before tagging a release.
