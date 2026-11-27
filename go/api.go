package main

/* 步骤 56：从 web.go 拆出来的 /api/* 处理器。web.go 只留服务器与静态资源，
   这里是一组 handleXxx：读 body → 调 store / pipeline → jsonOut。
   路由注册表在 web.go 的 apiMux()，闸门⑯ 从 web.go 里读它，别搬走。 */

import (
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

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

// handleVoice POST /api/voice — 多段语音一次发送（P18）。每段 = 识别文本 + 原音频附件，
// 全部合并成一条笔记；Source 固定 manual-voice（判断处见 userPromptFor）。
func handleVoice(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID     string     `json:"id"`   // 有 id = 重新识别（只换正文，附件不动）
		Text   string     `json:"text"` // 兼容单段：识别文本
		Path   string     `json:"path"` // 兼容单段：音频文件
		Name   string     `json:"name"`
		MIME   string     `json:"mime"`
		Source string     `json:"source"` // 默认 manual-voice（share-voice 由 Java 侧直连 native）
		Audios []voiceSeg `json:"audios"` // 多段
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	req := ingestReq{ID: body.ID, Kind: "voice", Source: body.Source}
	if req.Source == "" {
		req.Source = "manual-voice"
	}
	if len(body.Audios) > 0 {
		req.Audios = body.Audios
		req.Text = ""
	} else {
		req.Text = body.Text
		req.Path, req.Name, req.MIME = body.Path, body.Name, body.MIME
	}
	res := enqueue(req)
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

// todoReq 是 /api/todo 的请求体。步骤 57：它原来是 handleTodo 里的匿名 struct，
// 三个 action 各占 15 行，拆成三个函数之后得给它一个名字。
type todoReq struct {
	Action   string `json:"action"` // add | toggle | delete
	NoteID   string `json:"noteId"`
	TodoID   string `json:"todoId"`
	Text     string `json:"text"`
	Due      string `json:"due"`
	Priority string `json:"priority"`
}

func handleTodo(w http.ResponseWriter, r *http.Request) {
	var body todoReq
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	switch body.Action {
	case "add":
		todoAdd(w, body)
	case "toggle":
		todoToggle(w, body)
	case "delete":
		todoDelete(w, body)
	default:
		jsonOut(w, map[string]any{"ok": false, "error": "unknown action"})
	}
}

// todoAdd 手动加一条待办：优先级只认 high / low，其余归 normal；截止日走 normaliseDue。
func todoAdd(w http.ResponseWriter, body todoReq) {
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
}

// todoToggle 勾选 / 取消勾选：勾上记 DoneAt（近 7 天那根柱子按它落桶），取消就清掉，
// 两个方向都重排一次，完成的沉底。
func todoToggle(w http.ResponseWriter, body todoReq) {
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
}

// todoDelete 删掉一条待办：留下所有 id 不等于目标 id 的。
func todoDelete(w http.ResponseWriter, body todoReq) {
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

/* 步骤 60：handleSettings 原来 52 行，九行「patch 里有这项就盖上去」加四行「空值退回旧配置」
   平铺在 handler 里。现在盖归 settingsPatch.applyTo、兜底归 Settings.fillDefaults，
   handler 只剩「读 body → 盖 → 兜 → 存」。语句逐字搬，只把 config.get() 的快照提成参数 cur。 */

func handleSettings(w http.ResponseWriter, r *http.Request) {
	var p settingsPatch
	if err := readBody(r, &p); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	s := config.get()
	p.applyTo(&s)
	s.fillDefaults(config.get())
	if err := config.set(s); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOut(w, map[string]any{"ok": true, "settings": maskedSettings()})
}

// applyTo 把 patch 里出现过的字段盖到 s 上（指针非空 = 界面这一项提交了）。
// 没提交的字段保持 s 里的原值。
func (p settingsPatch) applyTo(s *Settings) {
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
}

// fillDefaults 兜住空值：地址 / 模型 / 主题 / UI 提交成空不等于要清空，退回当前配置。
// cur 是改动前的配置快照（原来四处各自 config.get()，中间没人改过，等价）。
func (s *Settings) fillDefaults(cur Settings) {
	if s.BaseURL == "" {
		s.BaseURL = cur.BaseURL
	}
	if s.Model == "" {
		s.Model = cur.Model
	}
	if s.Theme == "" {
		s.Theme = cur.Theme
	}
	if s.UI == nil {
		s.UI = cur.UI
	}
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
