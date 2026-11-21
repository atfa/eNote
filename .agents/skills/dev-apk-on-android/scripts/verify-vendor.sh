#!/usr/bin/env sh
# Check the bundled binaries: size, checksum, and that the dexer really runs.
#   sh scripts/verify-vendor.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"

[ -d "$VENDOR" ] || die "no vendor/ in $SKILL_DIR"
step "files"
ls -l "$VENDOR"/*.jar 2>/dev/null | awk '{printf "  %-34s %10s bytes\n", $NF, $5}'

step "checksums"
(cd "$VENDOR" && sha256sum -c SHA256SUMS) | sed 's/^/  /' || die "checksum mismatch"

step "content"
unzip -l "$VENDOR/r8-8.13.25.jar" 2>/dev/null | grep -q 'com/android/tools/r8/D8.class' \
  || die "r8 jar has no D8.class"
say "  r8: com/android/tools/r8/D8 present"
unzip -l "$VENDOR/android-$PLATFORM_API-android.jar" 2>/dev/null | grep -q 'resources.arsc' \
  || die "android jar has no resources.arsc - aapt2 link would fail"
unzip -l "$VENDOR/android-$PLATFORM_API-android.jar" 2>/dev/null | grep -q 'android/app/Activity.class' \
  || die "android jar has no android/app/Activity.class - javac would fail"
say "  android-$PLATFORM_API: framework resources + classes present"

step "dexer"
TMP=$(mktemp -d 2>/dev/null || echo "${TMPDIR:-$HOME}/dexcheck.$$")
trap 'rm -rf "$TMP"' EXIT INT TERM
mkdir -p "$TMP/out"
printf 'public class T { public static void main(String[] a) { System.out.println("x"); } }\n' > "$TMP/T.java"
javac -nowarn -source 8 -target 8 -d "$TMP" "$TMP/T.java" 2>/dev/null || die "javac failed"
java -cp "$VENDOR/r8-8.13.25.jar" com.android.tools.r8.D8 --release \
  --lib "$VENDOR/android-$PLATFORM_API-android.jar" --min-api "$MIN_API" \
  --output "$TMP/out" "$TMP/T.class" >/dev/null 2>&1 \
  || die "D8 from vendor r8 jar failed"
[ -s "$TMP/out/classes.dex" ] || die "D8 produced no classes.dex"
say "  D8 -> classes.dex ($(wc -c < "$TMP/out/classes.dex") bytes)"

say ""
say "vendor OK"
