package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed ui.html
var uiFS embed.FS

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
	m.HandleFunc("/", handleIndex)
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
	m.HandleFunc("/img", handleImg)
	return m
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	b, err := uiFS.ReadFile("ui.html")
	if err != nil {
		http.Error(w, "ui missing", 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(b)
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

func maskedSettings() Settings {
	s := config.get()
	if len(s.APIKey) > 8 {
		s.APIKey = s.APIKey[:4] + "…" + s.APIKey[len(s.APIKey)-4:]
	} else if s.APIKey != "" {
		s.APIKey = "****"
	}
	return s
}

func handleSettings(w http.ResponseWriter, r *http.Request) {
	var s Settings
	if err := readBody(r, &s); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	old := config.get()
	if s.APIKey == "" || strings.Contains(s.APIKey, "…") {
		s.APIKey = old.APIKey // the UI shows a masked key; keep the real one
	}
	if s.BaseURL == "" {
		s.BaseURL = old.BaseURL
	}
	if s.Model == "" {
		s.Model = old.Model
	}
	if s.Theme == "" {
		s.Theme = old.Theme
	}
	if s.UI == nil {
		s.UI = old.UI
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
