#!/usr/bin/env bash
# Build, package and sign an APK on the phone: aapt2 -> javac -> d8(R8) -> zip -> apksigner.
# Config: ./app.env next to this script (created by new-project.sh).
#   ./build.sh                    (bash - never "sh build.sh")
#   R8_JAR=~/r8-full.jar ./build.sh   use a different dexer
set -euo pipefail
cd "$(dirname "$0")"
# app.env first: it decides PLATFORM_API, which is what $ANDROID_JAR is derived from.
[ -f app.env ] || { echo "ERROR: no app.env here (run new-project.sh)" >&2; exit 1; }
. ./app.env
LIB="$PWD/lib"; [ -f "$LIB/common.sh" ] || LIB="$PWD/../lib"
. "$LIB/common.sh"
load_app_env "$PWD"

OUT=out
rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/apk"

need aapt2 aapt2
[ -f "$ANDROID_JAR" ] || die "missing $ANDROID_JAR - run scripts/setup-toolchain.sh"

echo "==> aapt2 compile (resources)"
LINK_RES=
if [ -d res ] && [ -n "$(ls -A res 2>/dev/null)" ]; then
  aapt2 compile --dir res -o "$OUT/res.zip"
  LINK_RES=$OUT/res.zip
fi

echo "==> aapt2 link (binary manifest + R.java, API $PLATFORM_API, min $MIN_API)"
# The manifest carries no <uses-sdk>: the api levels are passed here, so app.env is the
# single source of truth and the two cannot drift apart.
aapt2 link -o "$OUT/apk/base.apk" -I "$ANDROID_JAR" --manifest AndroidManifest.xml \
  --min-sdk-version "$MIN_API" --target-sdk-version "$PLATFORM_API" \
  --auto-add-overlay --java "$OUT/gen" $LINK_RES

echo "==> javac"
find src "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
[ -s "$OUT/sources.txt" ] || die "no .java files under src/"
javac -nowarn -Xlint:-options -source 8 -target 8 \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" "@$OUT/sources.txt"
find "$OUT/classes" -name '*.class' -print -quit | grep -q . || die "javac produced no classes"

echo "==> d8 (.class -> classes.dex)"
# Termux's own `d8` is R8 3.3 and dies on JDK-11+ NestMembers (anonymous classes).
if [ -f "$R8_JAR" ]; then
  DEXER=(java -cp "$R8_JAR" com.android.tools.r8.D8)
elif command -v d8 >/dev/null 2>&1; then
  DEXER=(d8); warn "using Termux d8 - it crashes on anonymous classes; set R8_JAR"
else
  die "no dexer: $R8_JAR missing and d8 not installed"
fi
"${DEXER[@]}" --release --lib "$ANDROID_JAR" --min-api "$MIN_API" --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

# --- Go native layer (optional) -----------------------------------------------------
# If go/ holds a cgo module, it is built with -buildmode=c-shared into
# lib/<abi>/lib$GO_LIB.so inside the apk; Java loads it with System.loadLibrary("$GO_LIB").
# Termux's go is preconfigured for GOOS=android GOARCH=arm64 CGO_ENABLED=1, so no NDK and no
# cross-toolchain is needed for this phone's own ABI. See references/go-native.md.
GO_DIR=${GO_DIR:-go}
if [ "${GO_LIB+set}" != set ]; then GO_LIB=app; fi   # set-but-empty GO_LIB = no JNI library
GO_BIN=${GO_BIN:-bin}
GO_BIN_DIR=${GO_BIN_DIR:-bin}
GO_LDFLAGS=${GO_LDFLAGS:--s -w}
GO_FLAGS=${GO_FLAGS:-}
GO_BIN_FLAGS=${GO_BIN_FLAGS:-}
# D17：build.json 是「WebView 里跑的就是刚装的这版」的凭据。设备是共享的（两个 worktree
# 轮流装），光看日志对不上号；测试拿这里的 sha 和页面里 __enote.build.sha 逐项比。
# sha 带 -dirty 后缀：本轮多次全量跑在未提交的树上，不标出来就是谎话。
# 必须在 go build / go test 之前写：ui/build.json 是 //go:embed all:ui 打进二进制的。
# 每次构建都变 → 进 .gitignore，不然每次构建都把工作区弄脏。
if [ -d "$GO_DIR/ui" ]; then
  BUILD_SHA=$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)
  # 注意别写成 `git diff --quiet || git diff --cached --quiet || ...`：第二个 --quiet 返回 0
  # 会把链短路，未提交的工作区改动就标不出来（实测过）。
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    BUILD_SHA="$BUILD_SHA-dirty"
  fi
  printf '{"sha":"%s","builtAt":"%s","app":"%s"}\n' \
    "$BUILD_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$APP_PACKAGE" > "$GO_DIR/ui/build.json"
  echo "==> build.json: $(cat "$GO_DIR/ui/build.json")"
fi
ABI=
if [ -f "$GO_DIR/go.mod" ]; then
  need go golang
  GO_ARCH=${GOARCH:-$(go env GOARCH 2>/dev/null || echo arm64)}
  case "$GO_ARCH" in
    arm64) ABI=arm64-v8a ;; arm) ABI=armeabi-v7a ;; 386) ABI=x86 ;; amd64) ABI=x86_64 ;;
    *) die "unsupported GOARCH: $GO_ARCH" ;;
  esac
  grep -q 'extractNativeLibs="true"' AndroidManifest.xml \
    || warn "manifest lacks android:extractNativeLibs=\"true\": there is no zipalign on device, so the .so may fail to load"
  mkdir -p "$OUT/native"
  PROJ=$PWD
  if [ "${GO_TEST:-0}" = 1 ]; then
    echo "==> go test"
    ( cd "$GO_DIR" && go test ./... )
  fi
  if [ -n "$GO_LIB" ]; then
    echo "==> go build -buildmode=c-shared (GOOS=android GOARCH=$GO_ARCH -> lib/$ABI/lib$GO_LIB.so)"
  ( cd "$GO_DIR" && env GOOS=android GOARCH="$GO_ARCH" CGO_ENABLED=1 \
      go build -buildmode=c-shared -trimpath -ldflags="$GO_LDFLAGS" $GO_FLAGS \
      -o "$PROJ/$OUT/native/lib$GO_LIB.so" . ) || die "go build failed"
  [ -f "$OUT/native/lib$GO_LIB.so" ] || die "go build produced no lib$GO_LIB.so"
  fi
  # Optional: go/bin/ is a pure-Go (cgo-free) static binary, shipped as lib<name>.so so that
  # pm install extracts it into nativeLibraryDir, where Java can Runtime.exec() it.
  # GO_BIN_FLAGS carries extra build args, e.g. '-tags server' for a Wails v3 server build.
  if [ -d "$GO_DIR/$GO_BIN_DIR" ]; then
    echo "==> go build (pure Go binary -> lib/$ABI/lib$GO_BIN.so, exec'able)"
    ( cd "$GO_DIR" && env GOOS=android GOARCH="$GO_ARCH" CGO_ENABLED=0 \
        go build -trimpath -ldflags="$GO_LDFLAGS" $GO_BIN_FLAGS \
        -o "$PROJ/$OUT/native/lib$GO_BIN.so" ./$GO_BIN_DIR ) \
      || die "go build ./$GO_BIN_DIR failed"
  fi
fi

echo "==> package"
cp "$OUT/apk/base.apk" "$OUT/apk/unaligned.apk"
(cd "$OUT/dex" && zip -q -X -j "$OLDPWD/$OUT/apk/unaligned.apk" classes.dex)
if [ -d "$OUT/native" ] && ls "$OUT/native"/*.so >/dev/null 2>&1; then
  mkdir -p "$OUT/apk/lib/$ABI"
  cp "$OUT/native"/*.so "$OUT/apk/lib/$ABI/"
  (cd "$OUT/apk" && zip -q -X -r "$OLDPWD/$OUT/apk/unaligned.apk" "lib/$ABI")
fi
# Prebuilt native libraries shipped with the project (jniLibs/<abi>/*.so), e.g. the OCR engine.
if [ -d "jniLibs/$ABI" ] && [ -n "$(ls -A jniLibs/$ABI 2>/dev/null)" ]; then
  mkdir -p "$OUT/apk/lib/$ABI"
  cp "jniLibs/$ABI"/*.so "$OUT/apk/lib/$ABI/"
  (cd "$OUT/apk" && zip -q -X -r "$OLDPWD/$OUT/apk/unaligned.apk" "lib/$ABI")
fi
if [ -d assets ] && [ -n "$(ls -A assets 2>/dev/null)" ]; then
  # AssetManager needs the literal "assets/" prefix inside the apk, so zip the directory
  # itself, not its contents.
  zip -q -X -r "$OUT/apk/unaligned.apk" assets
fi

echo "==> sign (v1+v2+v3)"
if [ ! -f "$ANDROID_KEYSTORE" ]; then
  mkdir -p "$(dirname "$ANDROID_KEYSTORE")"
  need keytool openjdk-21
  keytool -genkeypair -keystore "$ANDROID_KEYSTORE" -alias "$ANDROID_KS_ALIAS" \
    -storepass "$ANDROID_KS_PASS" -keypass "$ANDROID_KS_PASS" -keyalg RSA -keysize 2048 \
    -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
apksigner sign --ks "$ANDROID_KEYSTORE" --ks-pass "pass:$ANDROID_KS_PASS" \
  --key-pass "pass:$ANDROID_KS_PASS" --out "$APK_NAME" "$OUT/apk/unaligned.apk"

echo "==> ok: $PWD/$APK_NAME ($(stat -c%s "$APK_NAME") bytes)"
aapt dump badging "$APK_NAME" 2>/dev/null \
  | grep -E "^package|application-label:|launchable-activity" | sed 's/^/    /' || true
