#!/usr/bin/env sh
# Scaffold a self-contained, on-device Android project.
#   usage: new-project.sh <dir> <package> [label] [tag]
#   e.g.   sh scripts/new-project.sh $HOME/apps/myapp com.example.myapp "My App"
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
SKILL="$HERE"
[ -f "$SKILL/templates/AndroidManifest.xml" ] || SKILL=$(cd "$HERE/.." && pwd)
LIB="$SKILL/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/lib"
. "$LIB/common.sh"

DIR="${1:?usage: new-project.sh <dir> <package> [label] [tag]}"
PKG="${2:?usage: new-project.sh <dir> <package> [label] [tag]}"
LABEL="${3:-${PKG##*.}}"
PKGPATH=$(echo "$PKG" | tr '.' '/')
TAG="${4:-${PKG##*.}}"
[ -e "$DIR" ] && die "exists: $DIR"
[ -d "$SKILL/templates" ] || die "templates/ not found next to $0"

mkdir -p "$DIR/src/$PKGPATH" "$DIR/res/values" "$DIR/assets" "$DIR/lib"

sub() {   # sub <template> <dest>
  sed -e "s|__PACKAGE__|$PKG|g" -e "s|__PKGPATH__|$PKGPATH|g" \
      -e "s|__LABEL__|$LABEL|g" -e "s|__TAG__|$TAG|g" "$1" > "$2"
}

sub "$SKILL/templates/AndroidManifest.xml" "$DIR/AndroidManifest.xml"
sub "$SKILL/templates/res/values/strings.xml" "$DIR/res/values/strings.xml"
sub "$SKILL/templates/src/__PKGPATH__/MainActivity.java" "$DIR/src/$PKGPATH/MainActivity.java"
sub "$SKILL/templates/test.sh" "$DIR/test.sh"
cp "$SKILL/templates/gen_icon.py" "$DIR/gen_icon.py"
cp "$SKILL/templates/ascii.py" "$DIR/ascii.py"

# Everything the project needs to rebuild, install and test itself, offline.
for f in build.sh install.sh probe.sh log.sh screen.sh silent-install.sh \
         wrap-termux-jdk.sh fix-termux-javac.py dumpjni.py vd.sh vd-build.sh; do
  cp "$SKILL/scripts/$f" "$DIR/$f"
done
# The background-display daemon ships prebuilt (7 KB) so a project can run headless without
# rebuilding it; the source comes along so it stays rebuildable.
if [ -f "$SKILL/vendor/vd/vd.jar" ]; then
  mkdir -p "$DIR/vendor/vd"
  cp "$SKILL/vendor/vd/vd.jar" "$SKILL/vendor/vd/Vd.java" "$DIR/vendor/vd/"
fi
cp "$SKILL"/lib/*.sh "$DIR/lib/"
chmod 755 "$DIR"/*.sh "$DIR"/gen_icon.py

cat > "$DIR/app.env" <<EOF
# Read by build.sh / install.sh / test.sh. Anything set in the environment wins over this file.
APP_PACKAGE=$PKG
ACTIVITY=MainActivity
APK_NAME=$TAG.apk
TAG=$TAG
PLATFORM_API=\${PLATFORM_API:-33}
MIN_API=\${MIN_API:-24}
EOF

cat > "$DIR/README.md" <<EOF
# $LABEL ($PKG)

Built, signed, installed and tested on this phone with the \`dev-apk-on-android\` skill.

    ./build.sh && ./install.sh && ./test.sh

Scripts are bash/sh - call them as \`./build.sh\`, never \`sh build.sh\` (build.sh needs bash).

* sources: \`src/$PKGPATH/\`
* resources: \`res/\`  (launcher icons: \`$PY gen_icon.py [letter]\`)
* config: \`app.env\` (package, activity, api levels, apk name)
* test hook: \`am start -n $PKG/.MainActivity --es hook ping\` or a \`files/testhook\` file
* logs: \`./log.sh $TAG\`   foreground/crash: \`./probe.sh $PKG\`   screen as text: \`./screen.sh 60\`
* headless (root): \`./install.sh --bg\` runs it on an invisible display, \`./screen.sh --vd\` sees it,
  \`./vd.sh tap X Y\` drives it, \`./test.sh --vd\` tests it while the phone stays yours
* toolchain (jars, keystore) is shared and lives outside the project: setup-toolchain.sh
EOF

if [ -n "$PY" ]; then
  ( cd "$DIR" && "$PY" gen_icon.py "$TAG" >/dev/null )
else
  warn "no python3: launcher icons not generated (res/mipmap-*/ic_launcher.png missing)"
fi
say "created $DIR"
say "next: cd $DIR && ./build.sh && ./install.sh && ./test.sh"
