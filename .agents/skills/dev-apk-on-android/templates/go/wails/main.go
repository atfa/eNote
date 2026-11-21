// Wails v3 in "server mode" as the business layer of this APK - built on the phone, no NDK,
// no gomobile, no npm. Java exec's this binary from nativeLibraryDir, reads the URL it prints
// and shows it in a WebView; window.Android is the way back into Java.
//
// On-device setup (see references/go-native.md):
//
//   pkg install nodejs-lts golang
//   go install github.com/wailsapp/wails/v3/cmd/wails3@latest
//   cd go && GOFLAGS=-mod=mod go get github.com/wailsapp/wails/v3@latest
//   GOFLAGS=-mod=mod go mod tidy
//   wails3 generate bindings -b -d frontend/dist/wailsjs .
//
// The generated bindings live under frontend/dist/wailsjs/<module>/...; index.html imports
// them, so rewrite the import once after generating:
//
//   B=$(find frontend/dist/wailsjs -name index.js -not -path '*/events/*' | head -1 | sed 's|frontend/dist/||')
//   sed -i "s|__BINDINGS__|./$B|" frontend/dist/index.html
package main

import (
	"embed"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func fib(n int) int {
	if n < 2 {
		return n
	}
	return fib(n-1) + fib(n-2)
}

// App is the bound service: every exported method becomes callable from JS.
type App struct{}

func (a *App) Info() string {
	return fmt.Sprintf("__PACKAGE__ on %s/%s, gomaxprocs=%d",
		runtime.GOOS, runtime.GOARCH, runtime.GOMAXPROCS(0))
}

func (a *App) Fib(n int) map[string]any {
	t := time.Now()
	v := fib(n)
	return map[string]any{"n": n, "value": v, "ms": time.Since(t).Milliseconds()}
}

func (a *App) Ping(msg string) string {
	return "go got: " + msg
}

func main() {
	port := 34789
	if v := os.Getenv("WAILS_SERVER_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			port = p
		}
	}

	app := application.New(application.Options{
		Name:     "__TAG__",
		Services: []application.Service{application.NewService(&App{})},
		Assets: application.AssetOptions{
			Handler:        application.AssetFileServerFS(assets),
			DisableLogging: true,
		},
		Server: application.ServerOptions{Host: "127.0.0.1", Port: port},
	})

	// The Java parent parses this line, so nobody has to guess the port.
	fmt.Printf("SERVER URL: http://127.0.0.1:%d/\n", port)
	os.Stdout.Sync()

	if err := app.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "wails run failed:", err)
		os.Exit(1)
	}
}
