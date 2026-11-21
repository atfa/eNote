#!/usr/bin/env sh
# One-time (idempotent) setup of the on-device Android toolchain.
#   sh scripts/setup-toolchain.sh            # API 33, everything from vendor/
#
# No network unless a Termux package is missing. The 38 MB of jars live in vendor/ and are
# verified against vendor/SHA256SUMS before they are installed.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"

step "environment"
say "  skill      $SKILL_DIR"
say "  platform   API $PLATFORM_API (min $MIN_API)"
say "  android.jar $ANDROID_JAR"
say "  dexer      $R8_JAR"
say "  root       $(root_desc)"
[ -n "$PY" ] || warn "no python3: the Perfetto stub cannot be generated, icon/screen tools are off"

step "vendor cache"
[ -f "$VENDOR/SHA256SUMS" ] || die "no $VENDOR/SHA256SUMS"
VJAR="$VENDOR/android-$PLATFORM_API-android.jar"
[ -f "$VJAR" ] || die "no android jar for API $PLATFORM_API in $VENDOR - see vendor/MANIFEST.md"
(cd "$VENDOR" && sha256sum -c SHA256SUMS 2>/dev/null | sed 's/^/  /') || die "vendor checksum mismatch"
grep -q "  android-$PLATFORM_API-android.jar\$" "$VENDOR/SHA256SUMS" \
  || warn "vendor/android-$PLATFORM_API-android.jar is not listed in SHA256SUMS (unverified)"

step "Termux packages"
missing=
for c in aapt2 aapt apksigner zip unzip javac keytool; do
  command -v "$c" >/dev/null 2>&1 || missing="$missing $c"
done
if [ -n "$missing" ] && command -v pkg >/dev/null 2>&1; then
  say "  installing:$missing"
  # aapt2/apksigner ship as Termux packages, openjdk-21 is the compiler, zip packages the apk
  pkg install -y openjdk-21 aapt2 aapt apksigner zip unzip python >/dev/null 2>&1 || \
    warn "pkg install failed - install openjdk-21 aapt2 aapt apksigner zip unzip python by hand"
fi
for c in aapt2 aapt apksigner zip unzip; do
  command -v "$c" >/dev/null 2>&1 && say "  $c: OK" || warn "$c missing - pkg install $c"
done
command -v kotlinc >/dev/null 2>&1 && say "  kotlinc: present (optional)"

step "Termux JDK startup fix"
# Termux ships OpenJDK as a native Android binary whose JNI init registers natives for
# com.android.internal.dev.perfetto.sdk.PerfettoTrace - a framework-only class - so every
# tool except `java -version` aborts with exit 134. A stub jar on the boot classpath fixes
# it; references/installation.md has the gory details.
if javac -version >/dev/null 2>&1; then
  say "  javac: OK ($(javac -version 2>&1))"
elif [ -n "$PY" ]; then
  "$PY" "$HERE/fix-termux-javac.py" "$PERFETTO_STUB_JAR"
  sh "$HERE/wrap-termux-jdk.sh" >/dev/null || warn "wrap-termux-jdk.sh failed"
  javac -version >/dev/null 2>&1 \
    && say "  javac: OK after stub ($(javac -version 2>&1))" \
    || die "javac still aborts - run: $PY $HERE/fix-termux-javac.py $PERFETTO_STUB_JAR"
else
  warn "javac aborts and python3 is missing - cannot build the stub"
fi

step "dexer (r8 -> $R8_JAR)"
mkdir -p "$ANDROID_TOOLS"
unzip -l "$VENDOR/r8-8.13.25.jar" 2>/dev/null | grep -q 'com/android/tools/r8/D8.class' \
  || die "vendor r8 jar is broken (no D8.class)"
rm -f "$R8_JAR"
# /data forbids hardlinks, so this is a real copy (11 MB)
cp "$VENDOR/r8-8.13.25.jar" "$R8_JAR"
say "  vendor/r8-8.13.25.jar -> $R8_JAR"

step "android.jar (API $PLATFORM_API)"
mkdir -p "$(dirname "$ANDROID_JAR")"
[ "$ANDROID_JAR" = "$VJAR" ] || cp "$VJAR" "$ANDROID_JAR"
say "  $ANDROID_JAR ($(wc -c < "$ANDROID_JAR") bytes)"

step "silent root install"
if have_root; then
  sh "$HERE/silent-install.sh" 2>/dev/null | sed 's/^/  /' || warn "silent-install.sh failed"
else
  say "  skipped (no root) - install.sh will use termux-open"
fi

step "debug keystore"
if [ ! -f "$ANDROID_KEYSTORE" ]; then
  mkdir -p "$(dirname "$ANDROID_KEYSTORE")"
  need keytool openjdk-21
  keytool -genkeypair -keystore "$ANDROID_KEYSTORE" -storepass "$ANDROID_KS_PASS" \
    -keypass "$ANDROID_KS_PASS" -alias "$ANDROID_KS_ALIAS" -keyalg RSA -keysize 2048 \
    -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
say "  $ANDROID_KEYSTORE: OK"

step "done"
say "next: sh $HERE/new-project.sh <dir> <package> [label]"
say "      cd <dir> && ./build.sh && ./install.sh && ./test.sh"
