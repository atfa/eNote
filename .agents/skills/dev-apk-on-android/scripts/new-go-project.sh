#!/usr/bin/env sh
# Scaffold an on-device Android project whose business logic is Go (cgo + JNI, no Gradle,
# no NDK, no gomobile). Everything is built on the phone by the copied build.sh.
#
#   usage: new-go-project.sh [--wails] <dir> <package> [label] [tag]
#   e.g.   sh scripts/new-go-project.sh $HOME/apps/goapp com.example.goapp "Go App" goapp
#          sh scripts/new-go-project.sh --wails $HOME/apps/wails com.example.wails "Wails App" wails
#
# Adds to what new-project.sh makes: a go/ module (JNI bridge + pure-Go tests + optional
# net/http server for a WebView UI), a thin Java shell, and the app.env/manifest switches.
# With --wails the go/ module is a Wails v3 server (bound Go services + HTML/JS UI, no JNI).
# See references/go-native.md for the rules this scaffold encodes.
set -eu
MODE=go
if [ "${1:-}" = "--wails" ]; then MODE=wails; shift; fi
HERE=$(cd "$(dirname "$0")" && pwd)
SKILL="$HERE"
[ -f "$SKILL/templates/AndroidManifest.xml" ] || SKILL=$(cd "$HERE/.." && pwd)
LIB="$SKILL/lib"; [ -f "$LIB/common.sh" ] || LIB="$HERE/lib"
. "$LIB/common.sh"

DIR="${1:?usage: new-go-project.sh <dir> <package> [label] [tag]}"
PKG="${2:?usage: new-go-project.sh <dir> <package> [label] [tag]}"
LABEL="${3:-${PKG##*.}}"
TAG="${4:-${PKG##*.}}"
[ -d "$SKILL/templates/go" ] || die "templates/go not found next to $0"

# JNI symbol names are the package with '.' -> '_'; a '_' inside the package name would need
# the _1 mangling, so refuse it instead of producing symbols the runtime cannot resolve.
case "$PKG" in
  *_*) die "package name must not contain '_' (JNI name mangling): $PKG" ;;
esac
PKG_UNDER=$(echo "$PKG" | tr '.' '_')
PKGPATH=$(echo "$PKG" | tr '.' '/')
GO_LIB=${GO_LIB:-$(echo "$TAG" | tr -c 'a-z0-9' ' ' | tr -d ' ')}
GO_BIN=${GO_BIN:-${GO_LIB}bin}
if [ "$MODE" = wails ]; then
  GO_LIB=            # no JNI library: the Wails binary is the whole app
  GO_BIN=${GO_BIN:-${TAG}bin}
fi
[ -n "$GO_LIB" ] || [ "$MODE" = wails ] || die "GO_LIB is empty: pass a lowercase alphanumeric tag, or set GO_LIB=..."
[ -n "$GO_BIN" ] || die "GO_BIN is empty: pass a lowercase alphanumeric tag"

sh "$HERE/new-project.sh" "$DIR" "$PKG" "$LABEL" "$TAG"
cd "$DIR"

gosub() {   # gosub <template> <dest>
  sed -e "s|__PKG_UNDERSCORE__|$PKG_UNDER|g" -e "s|__PACKAGE__|$PKG|g" \
      -e "s|__PKGPATH__|$PKGPATH|g" -e "s|__GO_LIB__|$GO_LIB|g" \
      -e "s|__GO_BIN__|$GO_BIN|g" -e "s|__TAG__|$TAG|g" -e "s|__LABEL__|$LABEL|g" "$1" > "$2"
}

if [ "$MODE" = wails ]; then
  # --- go/ module: a Wails v3 server, no JNI ------------------------------------------
  mkdir -p go/frontend/dist
  gosub "$SKILL/templates/go/wails/main.go" go/main.go
  gosub "$SKILL/templates/go/wails/index.html" go/frontend/dist/index.html
  if command -v go >/dev/null 2>&1; then
    ( cd go && go mod init "$PKG" >/dev/null 2>&1 ) || warn "go mod init failed"
  else
    warn "no go in PATH: run 'pkg install golang', then 'cd go && go mod init $PKG'"
    printf 'module %s\n\ngo 1.24\n' "$PKG" > go/go.mod
  fi
  gosub "$SKILL/templates/go/wails/MainActivity.java" "src/$PKGPATH/MainActivity.java"
  gosub "$SKILL/templates/go/src/__PKGPATH__/GoWebViewActivity.java" "src/$PKGPATH/GoWebViewActivity.java"

  # the acceptance test must prove the JS -> Go -> Java round trip, not just that the app starts
  if [ -n "${PY:-}" ]; then
    TESTSH=test.sh "$PY" - <<'PYEOF'
import os
p = os.environ["TESTSH"]
s = open(p).read()
step = '''step "wails: JS calls the Go service, Go reports back to Java"
asroot "am force-stop '$APP_PACKAGE'" >/dev/null 2>&1 || true
sleep 1
start_app "--es hook wails"
waitfor 'check webview: js says wails ok' 60 || fail "the WebView never reported a successful Wails call"

step "still alive"'''
s = s.replace('step "still alive"', step, 1)
open(p, "w").write(s)
PYEOF
  else
    warn "no python3: add the wails check to test.sh by hand"
  fi
fi

# --- go/ module ---------------------------------------------------------------------
if [ "$MODE" != wails ]; then
mkdir -p go/bin
gosub "$SKILL/templates/go/main.go" go/main.go
gosub "$SKILL/templates/go/web.go" go/web.go
cp "$SKILL/templates/go/main_test.go" go/main_test.go
cp "$SKILL/templates/go/bin/main.go" go/bin/main.go
if command -v go >/dev/null 2>&1; then
  ( cd go && go mod init "$PKG" >/dev/null 2>&1 ) || warn "go mod init failed"
else
  warn "no go in PATH: run 'pkg install golang', then 'cd go && go mod init $PKG'"
  printf 'module %s\n\ngo 1.24\n' "$PKG" > go/go.mod
fi
fi

# --- Java shell: replaces the pure-Java template ------------------------------------
if [ "$MODE" != wails ]; then
 gosub "$SKILL/templates/go/src/__PKGPATH__/MainActivity.java" "src/$PKGPATH/MainActivity.java"
 gosub "$SKILL/templates/go/src/__PKGPATH__/GoWebViewActivity.java" "src/$PKGPATH/GoWebViewActivity.java"
fi

# --- manifest: native libs, localhost http, the WebView activity --------------------
if [ -n "${PY:-}" ]; then
  MANIFEST=AndroidManifest.xml GO_LIB=$GO_LIB "$PY" - <<'PYEOF'
import os
p = os.environ["MANIFEST"]
s = open(p).read()
s = s.replace('android:debuggable="true">',
              'android:debuggable="true"\n        android:extractNativeLibs="true"\n'
              '        android:usesCleartextTraffic="true">')
s = s.replace('    <application',
              '    <uses-permission android:name="android.permission.INTERNET" />\n\n    <application', 1)
s = s.replace('    </application>',
              '        <activity\n            android:name=".GoWebViewActivity"\n'
              '            android:exported="false"\n'
              '            android:theme="@android:style/Theme.Material.NoActionBar.Fullscreen" />\n'
              '    </application>')
open(p, "w").write(s)
PYEOF
else
  warn "no python3: patching the manifest with sed (check extractNativeLibs by hand)"
  sed -i 's|android:debuggable="true">|android:debuggable="true" android:extractNativeLibs="true" android:usesCleartextTraffic="true">|' AndroidManifest.xml
fi

# --- app.env: the knobs build.sh reads ----------------------------------------------
if [ "$MODE" = wails ]; then
cat >> app.env <<EOF
# --- Wails v3 server (see references/go-native.md) -----------------------------------
GO_DIR=go                    # go module with the Wails app
GO_LIB=                      # empty: no JNI library, the Wails binary is the whole app
GO_BIN=$GO_BIN               # -> lib/<abi>/lib$GO_BIN.so  (exec'd by Java)
GO_BIN_DIR=.                 # the Wails main package lives at the module root
GO_BIN_FLAGS='-tags server'  # Wails server mode: headless HTTP + WebView UI
GO_LDFLAGS=\${GO_LDFLAGS:--s -w}
EOF
else
cat >> app.env <<EOF
# --- Go native layer (see references/go-native.md) -----------------------------------
GO_DIR=go                    # go module with the business logic
GO_LIB=$GO_LIB               # -> lib/<abi>/lib$GO_LIB.so  (System.loadLibrary("$GO_LIB"))
GO_BIN=$GO_BIN               # -> lib/<abi>/lib$GO_BIN.so  (exec'd by Java; pure Go, no cgo)
GO_LDFLAGS=\${GO_LDFLAGS:--s -w}
GO_FLAGS=\${GO_FLAGS:-}
EOF
fi

if [ "$MODE" != wails ]; then
cat >> README.md <<EOF

## Go business logic

    ./build.sh && ./install.sh && ./test.sh        # GO_TEST=1 ./build.sh also runs go test

* \`go/main.go\`  business logic + JNI exports (\`Java_${PKG_UNDER}_MainActivity_*\`)
* \`go/web.go\`   net/http server + HTML page: the WebView UI variant
* \`go/bin/\`     pure-Go binary, exec'd by Java (no JNI)
* \`src/$PKGPATH/MainActivity.java\` thin shell: View, lifecycle, \`System.loadLibrary("$GO_LIB")\`
* hooks: \`am start -n $PKG/.MainActivity --es hook async|threads|webtest|web|exec\`
* the Go side writes \`files/from-go.txt\`; read logs with \`su --mount-master -c "cat ..."\`

Rules worth knowing before you edit go/main.go: cgo cannot call JNIEnv's function-pointer
table (use the C helpers in the preamble), a Go panic that reaches the JVM kills the app
(every export recovers), a goroutine that outlives the call needs a global ref and must
attach its thread to the JVM, and JNI calls cost ~0.3 us each so batch them.
EOF
fi

if [ "$MODE" = wails ]; then
cat >> README.md <<EOF

## Wails v3 (Go services + HTML/JS UI)

One-time setup (needs network, and nodejs for the binding generator):

    pkg install nodejs-lts golang
    go install github.com/wailsapp/wails/v3/cmd/wails3@latest
    cd go
    GOFLAGS=-mod=mod go get github.com/wailsapp/wails/v3@latest
    GOFLAGS=-mod=mod go mod tidy
    wails3 generate bindings -b -d frontend/dist/wailsjs .
    B=$(find frontend/dist/wailsjs -name index.js -not -path '*/events/*' | head -1 | sed 's|frontend/dist/||')
    sed -i "s|__BINDINGS__|./\$B|" frontend/dist/index.html
    cd .. && ./build.sh && ./install.sh && ./test.sh

* \`go/main.go\`      the Wails app: bound services (exported methods callable from JS)
* \`go/frontend/dist/\` the UI (HTML/JS); \`//go:embed all:frontend/dist\` puts it in the binary
* \`src/$PKGPATH/MainActivity.java\` exec's lib$GO_BIN.so, reads \`SERVER URL:\`, opens a WebView
* JS calls Go through the generated bindings; Go talks back via \`window.Android.fromWeb\`
* dev the UI in a desktop browser: \`go run -tags server .\` then open the printed URL

See the skill's \`references/go-native.md\` (Wails section) for the measured numbers and the
port/URL contract with Java.
EOF
fi

if [ "$MODE" = wails ]; then
  say "created $DIR (Wails v3 server: go/ + frontend, lib$GO_BIN.so, no JNI)"
  say "next: cd $DIR/go && GOFLAGS=-mod=mod go get github.com/wailsapp/wails/v3@latest && GOFLAGS=-mod=mod go mod tidy"
  say "      wails3 generate bindings -b -d frontend/dist/wailsjs .   # then fix the import in index.html"
  say "      cd $DIR && ./build.sh && ./install.sh && ./test.sh"
else
  say "created $DIR (Go business logic, lib$GO_LIB.so)"
  say "next: cd $DIR && ./build.sh && ./install.sh && ./test.sh"
fi
