package main

import (
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ui 是整 front-end 的静态资源目录（S1a 把原来 2527 行的单个 ui.html 拆成了目录）。
// 用 all: 前缀：以 _ 或 . 开头的文件也要进二进制，否则以后放 .css.map 之类会静默丢失。
// 目录里每个文件都要能被 handleUI 取到，go/web_test.go 会遍历一遍并核对 Content-Type。
//
//go:embed all:ui
var uiFS embed.FS

//go:embed icon.png
var iconPNG []byte

var (
	srvOnce sync.Once
	srvURL  string
	srvErr  string
)

func startWebServer() string {
	srvOnce.Do(func() {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			srvErr = err.Error()
			return
		}
		srvURL = fmt.Sprintf("http://127.0.0.1:%d/", ln.Addr().(*net.TCPAddr).Port)
		srv := &http.Server{Handler: apiMux(), ReadHeaderTimeout: 10 * time.Second}
		go func() {
			if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
				logf("http server: %v", err)
			}
		}()
		logf("http server on %s", srvURL)
	})
	if srvErr != "" {
		return "error: " + srvErr
	}
	return srvURL
}

// The WebView gets its per-process secret directly from the Android bridge.
var openAISessionToken = sync.OnceValue(rand.Text)

func validOpenAISession(r *http.Request) bool {
	return subtle.ConstantTimeCompare([]byte(r.Header.Get("X-eNote-Session")), []byte(openAISessionToken())) == 1
}

func requireOpenAISession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !validOpenAISession(r) {
			http.Error(w, "Open this page in eNote", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

func requireInferenceSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if config != nil && config.get().Provider == "chatgpt" && !validOpenAISession(r) {
			http.Error(w, "Open this page in eNote", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

func apiMux() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("/", handleUI)
	m.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, map[string]any{"ok": true, "info": appInfo(),
			"settings": maskedSettings(), "notes": store.snapshot()})
	})
	m.HandleFunc("/api/note", handleNote)
	m.HandleFunc("POST /api/note/description", handleNoteDescription)
	m.HandleFunc("/api/add", requireInferenceSession(handleAdd))
	m.HandleFunc("POST /api/draft", requireInferenceSession(handleDraft))
	m.HandleFunc("POST /api/draft/discard", requireOpenAISession(handleDiscardDraftFile))
	m.HandleFunc("/api/voice", requireInferenceSession(handleVoice))
	m.HandleFunc("POST /api/voice/organize", requireInferenceSession(handleVoiceOrganize))
	m.HandleFunc("/api/reparse", requireInferenceSession(handleReparse))
	m.HandleFunc("/api/delete", handleDelete)
	m.HandleFunc("/api/todo", handleTodo)
	m.HandleFunc("/api/settings", handleSettings)
	m.HandleFunc("/api/theme", handleTheme)
	m.HandleFunc("/api/search", handleSearch)
	m.HandleFunc("/api/clip/list", handleClipList)
	m.HandleFunc("/api/clip/remove", handleClipRemove)
	m.HandleFunc("/api/clip/parse", requireInferenceSession(handleClipParse))
	m.HandleFunc("/api/clip/clear", handleClipClear)
	m.HandleFunc("/api/prefs", handlePrefs)
	m.HandleFunc("/api/events", handleEvents)
	m.HandleFunc("/api/attachments", handleAttachments)
	m.HandleFunc("/api/attach/delete", handleAttachDelete)
	m.HandleFunc("/api/shots/list", handleShotsList)
	m.HandleFunc("/api/shots/add", handleShotsAdd)
	m.HandleFunc("/api/shots/remove", handleShotsRemove)
	m.HandleFunc("/api/shots/ignore", handleShotsIgnore)
	m.HandleFunc("/api/stats", handleStats)
	m.HandleFunc("/api/missed", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, apiMissed())
	})
	m.HandleFunc("/api/import", handleImport)
	m.HandleFunc("/api/clear", handleClear)
	m.HandleFunc("/api/llm/test", requireInferenceSession(handleLLMTest))
	m.HandleFunc("GET /api/openai/status", requireOpenAISession(handleOpenAIAuthStatus))
	m.HandleFunc("POST /api/openai/login", requireOpenAISession(handleOpenAIAuthStart))
	m.HandleFunc("POST /api/openai/callback", requireOpenAISession(handleOpenAIAuthPaste))
	m.HandleFunc("POST /api/openai/logout", requireOpenAISession(handleOpenAIAuthDisconnect))
	m.HandleFunc("GET /api/openai/models", requireOpenAISession(handleChatGPTModels))
	m.HandleFunc("GET /auth/callback", handleOpenAIAuthCallback)
	m.HandleFunc("/api/llmlog", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, map[string]any{"ok": true, "calls": llmHistory()})
	})
	m.HandleFunc("/api/log", func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		if n <= 0 {
			n = 200
		}
		jsonOut(w, map[string]any{"ok": true, "log": readLog(n), "ocrReady": ocrReady,
			"ocrInfo": ocrInfo, "sttReady": sttReady, "sttInfo": sttInfo, "server": srvURL,
			"app": appInfo()})
	})
	m.HandleFunc("/api/export", handleExport)
	m.HandleFunc("/icon.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(iconPNG)
	})
	m.HandleFunc("/img", handleImg)
	m.HandleFunc("/file", handleFile)
	m.HandleFunc("/shotimg", handleShotImg)
	m.HandleFunc("/sttaudio", handleSttAudio) // 语音暂存区回放（只发 inbox 内文件）
	return m
}

// handleUI 服务首页和拆出来的静态文件（css / js / vendor）。
// 页面里的引用全是绝对路径（/css/…、/js/…、/vendor/…），所以路径直接映射到 ui/ 下的文件。
func handleUI(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	// WebView caches aggressively; the UI is embedded in the binary so it only
	// changes on install - never let a stale page survive an update.
	// 拆成多文件后这条规则必须覆盖每一个文件，不然升级后是「新页面配旧脚本」这种难查的混合态。
	w.Header().Set("Content-Security-Policy", "frame-src 'none'; object-src 'none'; base-uri 'none'")
	w.Header().Set("Cache-Control", "no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	// 类型写死了还要防一手：WebView 会探内容，nosniff 让它严格听 Content-Type。
	w.Header().Set("X-Content-Type-Options", "nosniff")

	ct := contentType(name)
	if ct == "" {
		// 不认识的扩展名直接 404，不是 octet-stream 200：vendor/VENDOR.md 这类
		// 给人看的文档没必要被 WebView 拉走，而 octet-stream 让客户端去猜类型。
		http.NotFound(w, r)
		return
	}
	b, err := uiFS.ReadFile("ui/" + name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Write(b)
}

// contentType 只列出本项目会用到的类型：Go 的 mime.TypeByExtension 依赖系统 /etc/mime.types，
// Android 上没有，会一律回落到 text/plain，WebView 就会拒绝执行脚本和样式表。
// 返回空串 = 不服务这个扩展名（handleUI 会 404）。
func contentType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	switch ext {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".woff2":
		return "font/woff2"
	case ".map":
		return "application/json; charset=utf-8"
	}
	return ""
}

func jsonOut(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

func readBody(r *http.Request, v any) error {
	b, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		return err
	}
	if len(b) == 0 {
		return nil
	}
	return json.Unmarshal(b, v)
}

// readAll is readBody for endpoints that take a raw body (importing a JSON backup).
func readAll(r *http.Request, max int64) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r.Body, max))
}
