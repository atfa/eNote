#!/usr/bin/env sh
# Compile the background-display daemon into vendor/vd/vd.jar.
#   usage: vd-build.sh          (writes vendor/vd/vd.jar)
# Needs the same toolchain as build.sh: android.jar + r8.jar. The jar is shipped prebuilt,
# so this is only needed after editing vendor/vd/Vd.java.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/../lib"
. "$LIB/common.sh"

SRC="$VENDOR/vd/Vd.java"
OUT="$VENDOR/vd"
[ -f "$SRC" ] || die "missing $SRC"
[ -f "$ANDROID_JAR" ] || die "android.jar not found: $ANDROID_JAR (run setup-toolchain.sh)"
[ -f "$R8_JAR" ] || die "r8.jar not found: $R8_JAR (run setup-toolchain.sh)"
need javac
need zip

WORK=$(mktemp -d "${TMPDIR:-$HOME}/vdbuild.XXXXXX")
trap 'rm -rf "$WORK"' EXIT INT TERM

step "javac (source 8, bootclasspath android.jar)"
mkdir -p "$WORK/classes" "$WORK/dex"
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$ANDROID_JAR" \
      -d "$WORK/classes" "$SRC"

step "d8 -> classes.dex"
java -cp "$R8_JAR" com.android.tools.r8.D8 --min-api "$MIN_API" --lib "$ANDROID_JAR" \
     --output "$WORK/dex" "$WORK"/classes/dev/apkdbg/*.class

step "package vd.jar"
( cd "$WORK/dex" && zip -q -j "$OUT/vd.jar" classes.dex )

say "BUILT $OUT/vd.jar ($(wc -c < "$OUT/vd.jar") bytes)"
say "deploy with: sh $HERE/vd.sh create"
