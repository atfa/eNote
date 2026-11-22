package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
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

func apiMux() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("/", handleUI)
	m.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, map[string]any{"ok": true, "info": appInfo(),
			"settings": maskedSettings(), "notes": store.snapshot()})
	})
	m.HandleFunc("/api/note", handleNote)
	m.HandleFunc("/api/add", handleAdd)
	m.HandleFunc("/api/reparse", handleReparse)
	m.HandleFunc("/api/delete", handleDelete)
	m.HandleFunc("/api/todo", handleTodo)
	m.HandleFunc("/api/settings", handleSettings)
	m.HandleFunc("/api/theme", handleTheme)
	m.HandleFunc("/api/search", handleSearch)
	m.HandleFunc("/api/clip/list", handleClipList)
	m.HandleFunc("/api/clip/remove", handleClipRemove)
	m.HandleFunc("/api/clip/parse", handleClipParse)
	m.HandleFunc("/api/clip/clear", handleClipClear)
	m.HandleFunc("/api/prefs", handlePrefs)
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
	m.HandleFunc("/api/llm/test", handleLLMTest)
	m.HandleFunc("/api/llmlog", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, map[string]any{"ok": true, "calls": llmHistory()})
	})
	m.HandleFunc("/api/log", func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		if n <= 0 {
			n = 200
		}
		jsonOut(w, map[string]any{"ok": true, "log": readLog(n), "ocrReady": ocrReady,
			"ocrInfo": ocrInfo, "server": srvURL, "app": appInfo()})
	})
	m.HandleFunc("/api/export", func(w http.ResponseWriter, r *http.Request) {
		b, _ := json.MarshalIndent(store.snapshot(), "", "  ")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(b)
	})
	m.HandleFunc("/icon.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(iconPNG)
	})
	m.HandleFunc("/img", handleImg)
	m.HandleFunc("/file", handleFile)
	m.HandleFunc("/shotimg", handleShotImg)
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
	w.Header().Set("Cache-Control", "no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	b, err := uiFS.ReadFile("ui/" + name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType(name))
	w.Write(b)
}

// contentType 只列出本项目会用到的类型：Go 的 mime.TypeByExtension 依赖系统 /etc/mime.types，
// Android 上没有，会一律回落到 text/plain，WebView 就会拒绝执行脚本和样式表。
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
	return "application/octet-stream"
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

func handleNote(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	n := store.get(id)
	if n == nil {
		jsonOut(w, map[string]any{"ok": false, "error": "not found"})
		return
	}
	jsonOut(w, map[string]any{"ok": true, "note": n})
}

func handleAdd(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	res := enqueue(ingestReq{Kind: "text", Text: body.Text, Source: "manual-text"})
	jsonOut(w, map[string]any{"ok": res.Error == "", "id": res.ID, "error": res.Error})
}

func handleClipList(w http.ResponseWriter, r *http.Request) {
	jsonOut(w, map[string]any{"ok": true, "clips": clipStore.snapshot()})
}

func handleClipRemove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	readBody(r, &body)
	clipStore.remove(body.IDs)
	jsonOut(w, map[string]any{"ok": true})
}

func handleClipClear(w http.ResponseWriter, r *http.Request) {
	clipStore.clear()
	jsonOut(w, map[string]any{"ok": true})
}

func handleClipParse(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
		Raw bool     `json:"raw"` // true = 原样存为笔记，不调 LLM
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOut(w, clipParse(body.IDs, body.Raw))
}

func handleReparse(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	readBody(r, &body)
	res := requeue(body.ID)
	jsonOut(w, map[string]any{"ok": res.Error == "", "error": res.Error})
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	readBody(r, &body)
	ok := store.remove(body.ID)
	jsonOut(w, map[string]any{"ok": ok})
}

func handleTodo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Action   string `json:"action"` // add | toggle | delete
		NoteID   string `json:"noteId"`
		TodoID   string `json:"todoId"`
		Text     string `json:"text"`
		Due      string `json:"due"`
		Priority string `json:"priority"`
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	switch body.Action {
	case "add":
		txt := strings.TrimSpace(body.Text)
		if txt == "" {
			jsonOut(w, map[string]any{"ok": false, "error": "内容为空"})
			return
		}
		pr := strings.ToLower(body.Priority)
		if pr != "high" && pr != "low" {
			pr = "normal"
		}
		t := Todo{ID: newID(), Text: txt, Due: normaliseDue(body.Due),
			Priority: pr, Source: "manual"}
		ok := store.update(body.NoteID, func(n *Note) {
			n.Todos = append(n.Todos, t)
			sortTodos(n.Todos)
		})
		jsonOut(w, map[string]any{"ok": ok, "id": t.ID})
	case "toggle":
		ok := store.update(body.NoteID, func(n *Note) {
			for i := range n.Todos {
				if n.Todos[i].ID == body.TodoID {
					n.Todos[i].Done = !n.Todos[i].Done
					if n.Todos[i].Done {
						n.Todos[i].DoneAt = time.Now().Format("2006-01-02T15:04")
					} else {
						n.Todos[i].DoneAt = ""
					}
				}
			}
			sortTodos(n.Todos)
		})
		jsonOut(w, map[string]any{"ok": ok})
	case "delete":
		ok := store.update(body.NoteID, func(n *Note) {
			var keep []Todo
			for _, t := range n.Todos {
				if t.ID != body.TodoID {
					keep = append(keep, t)
				}
			}
			n.Todos = keep
		})
		jsonOut(w, map[string]any{"ok": ok})
	default:
		jsonOut(w, map[string]any{"ok": false, "error": "unknown action"})
	}
}

// currentSettings 原样返回（含明文 API Key）。
// 以前这里打码，结果设置页每次打开都是 sk-l…ellm，用户以为没存住、反复重填；
// key 本来就明文躺在 app 私有目录（别的 app 读不到），打码只带来麻烦，不打码了。
func maskedSettings() Settings {
	return config.get()
}

// settingsPatch 让"只提交一部分字段"的 POST 不会把没提交的字段清成零值。
// 这个坑真踩过：一个只带 {"theme":"light"} 的请求把 temperature 变成 0、useAI 变成 false，
// 用户的下限值就这么被悄悄改掉了（而且是在他自己没动过设置的情况下）。
type settingsPatch struct {
	BaseURL  *string              `json:"baseUrl"`
	APIKey   *string              `json:"apiKey"`
	Model    *string              `json:"model"`
	TimeoutS *int                 `json:"timeoutS"`
	MaxTok   *int                 `json:"maxTokens"`
	Temp     *float64             `json:"temperature"`
	UseAI    *bool                `json:"useAI"`
	Theme    *string              `json:"theme"`
	UI       map[string]ViewPrefs `json:"ui"`
}

func handleSettings(w http.ResponseWriter, r *http.Request) {
	var p settingsPatch
	if err := readBody(r, &p); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	s := config.get()
	if p.BaseURL != nil {
		s.BaseURL = *p.BaseURL
	}
	if p.APIKey != nil && *p.APIKey != "" && !strings.Contains(*p.APIKey, "…") {
		s.APIKey = *p.APIKey // 界面显示的是打码 key，回传打码值不能覆盖真 key
	}
	if p.Model != nil {
		s.Model = *p.Model
	}
	if p.TimeoutS != nil {
		s.TimeoutS = *p.TimeoutS
	}
	if p.MaxTok != nil {
		s.MaxTok = *p.MaxTok
	}
	if p.Temp != nil {
		s.Temp = *p.Temp
	}
	if p.UseAI != nil {
		s.UseAI = *p.UseAI
	}
	if p.Theme != nil {
		s.Theme = *p.Theme
	}
	if p.UI != nil {
		s.UI = p.UI
	}
	if s.BaseURL == "" {
		s.BaseURL = config.get().BaseURL
	}
	if s.Model == "" {
		s.Model = config.get().Model
	}
	if s.Theme == "" {
		s.Theme = config.get().Theme
	}
	if s.UI == nil {
		s.UI = config.get().UI
	}
	if err := config.set(s); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOut(w, map[string]any{"ok": true, "settings": maskedSettings()})
}

// handleTheme switches the palette: the WebView repaints from settings.theme and calls
// Android.setTheme so Java can repaint the status/navigation bars to match.
func handleTheme(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	s := config.get()
	s.Theme = strings.TrimSpace(body.Mode)
	if err := config.set(s); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOut(w, map[string]any{"ok": true, "theme": config.get().Theme,
		"settings": maskedSettings()})
}

// handleLLMTest is the BYOK "测试连接" button: one round trip, raw reply shown in the UI.
func handleLLMTest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Prompt string `json:"prompt"`
	}
	readBody(r, &body)
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		prompt = "你好，请用一句话介绍你自己。"
	}
	call, err := callLLM("你是一个连接测试助手，按要求简短回答。", prompt)
	out := map[string]any{"ok": err == nil, "ms": call.MS, "url": call.URL,
		"model": call.Model, "reply": call.Raw, "reasonLen": len(call.Reason),
		"httpCode": call.HTTPCode}
	if err != nil {
		out["error"] = call.Err
	}
	jsonOut(w, out)
}

func handleImg(w http.ResponseWriter, r *http.Request) {
	n := store.get(r.URL.Query().Get("id"))
	if n == nil || n.ImagePath == "" {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(n.ImagePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", contentTypeOf(n.ImagePath))
	w.Header().Set("Cache-Control", "max-age=86400")
	io.Copy(w, f)
}

func contentTypeOf(p string) string {
	switch {
	case strings.HasSuffix(strings.ToLower(p), ".png"):
		return "image/png"
	case strings.HasSuffix(strings.ToLower(p), ".webp"):
		return "image/webp"
	case strings.HasSuffix(strings.ToLower(p), ".gif"):
		return "image/gif"
	default:
		return "image/jpeg"
	}
}

// ---------------------------------------------------------------------------
// headless self test: am start -n dev.xduo.enote/.MainActivity --es hook selftest
// ---------------------------------------------------------------------------

func selfTest(arg string) map[string]any {
	var req struct {
		Mode string `json:"mode"`
		Text string `json:"text"`
	}
	if arg != "" {
		json.Unmarshal([]byte(arg), &req)
	}
	mode := req.Mode
	if mode == "" {
		mode = "all"
	}
	out := map[string]any{"ok": true, "mode": mode, "app": appInfo()}
	if mode == "all" || mode == "store" {
		res := enqueue(ingestReq{Kind: "text", Text: "自测：明天下午3点和产品组开评审会", Source: "manual-text"})
		n := store.get(res.ID)
		out["store"] = map[string]any{"id": res.ID, "ok": n != nil, "error": res.Error}
		if n != nil {
			out["store"] = map[string]any{"id": res.ID, "ok": true, "rawText": n.RawText,
				"status": n.Status}
		}
	}
	if mode == "all" || mode == "web" {
		startWebServer()
		t0 := time.Now()
		resp, err := http.Get(srvURL + "api/state")
		web := map[string]any{"url": srvURL}
		if err != nil {
			web["error"] = err.Error()
		} else {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			resp.Body.Close()
			var st map[string]any
			json.Unmarshal(b, &st)
			web["httpCode"] = resp.StatusCode
			web["ms"] = time.Since(t0).Milliseconds()
			web["notes"] = fmt.Sprint(st["notes"] != nil)
			web["info"] = st["info"]
		}
		out["web"] = web
	}
	if mode == "all" || mode == "llm" {
		text := req.Text
		if text == "" {
			text = "下周三下午两点半和小李在会议室B过一版设计稿，会前把原型图发群里"
		}
		call, err := callLLM(systemPrompt(), text)
		res := map[string]any{"ms": call.MS, "url": call.URL, "model": call.Model,
			"raw": clip(call.Raw, 1500)}
		if err != nil {
			res["error"] = call.Err
		} else if p, perr := parseNoteJSON(call.Raw); perr != nil {
			res["parseError"] = perr.Error()
		} else {
			res["parsed"] = p
		}
		out["llm"] = res
	}
	if mode == "all" || mode == "ocr" {
		out["ocr"] = map[string]any{"ready": ocrReady, "info": ocrInfo}
	}
	return out
}
