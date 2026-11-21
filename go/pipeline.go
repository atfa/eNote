package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ingestReq is what Java hands over: shared text, or an image plus the text the local
// vivo OCR engine read out of it. The image itself never goes to the LLM.
type ingestReq struct {
	ID        string `json:"id"`   // set = re-ingest an existing note (re-OCR + re-parse)
	Kind      string `json:"kind"` // text | image
	Text      string `json:"text"`
	Subject   string `json:"subject"`
	Path      string `json:"path"`
	Name      string `json:"name"`
	OCR       string `json:"ocr"`
	OCRMs     int64  `json:"ocrMs"`
	OCRError  string `json:"ocrError"`
	MIME      string `json:"mime"`      // kind=file
	FileError string `json:"fileError"` // kind=file: the copy failed, keep the reason
	Source    string `json:"source"`    // share-text | share-image | manual-text | manual-image | share-file | manual-file
}

var jobs = make(chan string, 256)

type enqueueResult struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Error string `json:"error,omitempty"`
}

// enqueueRaw is the single entry point: Java (share intent, image picker) and the web UI
// (manual text) both end up here.
func enqueueRaw(payload string) enqueueResult {
	var r ingestReq
	if err := json.Unmarshal([]byte(payload), &r); err != nil {
		return enqueueResult{Error: "payload 解析失败: " + err.Error()}
	}
	return enqueue(r)
}

func enqueue(r ingestReq) enqueueResult {
	if r.ID != "" && store.get(r.ID) != nil {
		return reingest(r)
	}
	n := &Note{
		ID:        newID(),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Status:    stQueued,
		Source:    r.Source,
	}
	if n.Source == "" {
		n.Source = "manual-text"
	}
	switch r.Kind {
	case "image":
		if r.OCRError != "" {
			n.Status = stError
			n.Error = r.OCRError
		}
		n.ImagePath = r.Path
		n.ImageName = firstNonEmpty(r.Name, filepath.Base(r.Path))
		if r.Path != "" {
			attachTo(n, attachmentFor(n.ID, r.Path, n.ImageName, r.MIME, r.Source, n.CreatedAt))
		}
		n.OCRText = strings.TrimSpace(r.OCR)
		n.OCRMs = r.OCRMs
		n.RawText = n.OCRText
		n.Content = n.OCRText
		if n.Status != stError && n.OCRText == "" {
			n.Status = stRaw
			n.Error = "图片里没有识别到文字"
		}
	case "file":
		// a document (pdf, docx, txt, ...) shared or picked: stored, not sent to the LLM
		if n.Source == "manual-text" {
			n.Source = "manual-file"
		}
		if r.FileError != "" {
			n.Status = stError
			n.Error = r.FileError
			n.Content = "文件接收失败：" + r.FileError
			n.Title = firstNonEmpty(r.Name, "文件")
			break
		}
		if r.Path == "" {
			return enqueueResult{Kind: r.Kind, Error: "文件路径为空"}
		}
		n.Title = firstNonEmpty(r.Name, filepath.Base(r.Path))
		n.Content = "已保存附件：" + n.Title
		n.RawText = ""
		n.Status = stRaw
		n.Error = "文件已保存，未做 AI 解析"
		attachTo(n, attachmentFor(n.ID, r.Path, n.Title, r.MIME, n.Source, n.CreatedAt))
	default: // text
		n.RawText = strings.TrimSpace(r.Text)
		n.Content = n.RawText
		n.Title = strings.TrimSpace(r.Subject)
		if n.RawText == "" {
			return enqueueResult{Kind: r.Kind, Error: "内容为空"}
		}
	}
	store.add(n)
	logf("enqueue %s kind=%s source=%s len=%d ocrMs=%d status=%s",
		n.ID, r.Kind, r.Source, len(n.RawText), n.OCRMs, n.Status)
	if n.Status == stQueued {
		jobs <- n.ID
	}
	return enqueueResult{ID: n.ID, Kind: r.Kind}
}

// reingest replaces the text of an existing note ("重新识别图片") and sends it back to the LLM.
func reingest(r ingestReq) enqueueResult {
	txt := strings.TrimSpace(r.OCR)
	err := ""
	status := stQueued
	if r.OCRError != "" {
		status, err = stError, r.OCRError
	} else if txt == "" {
		status, err = stRaw, "图片里没有识别到文字"
	}
	store.update(r.ID, func(n *Note) {
		if r.Path != "" {
			n.ImagePath = r.Path
			n.ImageName = firstNonEmpty(r.Name, filepath.Base(r.Path))
			attachTo(n, attachmentFor(n.ID, r.Path, n.ImageName, r.MIME, n.Source, n.CreatedAt))
		}
		n.OCRText = txt
		n.OCRMs = r.OCRMs
		n.RawText = txt
		n.Content = txt
		n.Status = status
		n.Error = err
	})
	if status == stQueued {
		select {
		case jobs <- r.ID:
		default:
		}
	}
	logf("reingest %s len=%d status=%s", r.ID, len(txt), status)
	return enqueueResult{ID: r.ID, Kind: "image"}
}

// requeue sends an existing note back through the LLM, using the text as it was received.
func requeue(id string) enqueueResult {
	n := store.get(id)
	if n == nil {
		return enqueueResult{ID: id, Error: "笔记不存在"}
	}
	if strings.TrimSpace(n.RawText) == "" {
		return enqueueResult{ID: id, Error: "没有可解析的原始文本"}
	}
	store.update(id, func(x *Note) { x.Status = stQueued; x.Error = "" })
	select {
	case jobs <- id:
	default:
		logf("requeue: queue full, dropping %s", id)
	}
	return enqueueResult{ID: id}
}

func startWorker() {
	go func() {
		for id := range jobs {
			runNote(id)
		}
	}()
	logf("worker started")
}

func runNote(id string) {
	defer func() {
		if p := recover(); p != nil {
			logf("PANIC processing %s: %v", id, p)
			store.update(id, func(n *Note) { n.Status = stError; n.Error = "内部错误" })
		}
	}()
	n := store.get(id)
	if n == nil {
		return
	}
	cfg := config.get()
	text := strings.TrimSpace(n.RawText)
	if text == "" {
		text = strings.TrimSpace(n.Content)
	}
	if text == "" {
		store.update(id, func(x *Note) { x.Status = stRaw; x.Error = "没有文本" })
		return
	}
	if !cfg.UseAI {
		store.update(id, func(x *Note) {
			x.Status = stRaw
			x.Content = text
			x.Error = "AI 解析已关闭，仅保存原文"
		})
		return
	}
	store.update(id, func(x *Note) { x.Status = stParsing; x.Error = "" })
	call, err := callLLM(systemPrompt(), userPromptFor(n))
	if err != nil {
		store.update(id, func(x *Note) {
			x.Status = stRaw
			x.Content = text
			x.AIRaw = clip(call.Raw, 4000)
			x.Error = "AI 解析失败：" + clip(call.Err, 300) + "（原文已保留，可重试）"
		})
		return
	}
	p, perr := parseNoteJSON(call.Raw)
	if perr != nil {
		store.update(id, func(x *Note) {
			x.Status = stRaw
			x.Content = text
			x.AIRaw = clip(call.Raw, 4000)
			x.Error = "AI 输出无法解析：" + perr.Error() + "（原文已保留，可重试）"
		})
		return
	}
	store.update(id, func(x *Note) {
		x.RawText = text
		x.AIRaw = clip(call.Raw, 8000)
		applyParsed(x, p, call.Model, call.MS)
	})
	logf("note %s parsed: title=%q todos=%d in %dms", id, p.Title, len(p.Todos), call.MS)
}

// ---------------------------------------------------------------------------
// app lifecycle
// ---------------------------------------------------------------------------

var (
	appDir    string
	inboxDir  string
	bootTime  = time.Now()
	bootStats = map[string]any{}
)

func appInit(dir string) map[string]any {
	appDir = dir
	logDir = filepath.Join(dir, "enote")
	inboxDir = filepath.Join(dir, "enote", "inbox")
	for _, d := range []string{logDir, inboxDir} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return map[string]any{"ok": false, "error": "mkdir: " + err.Error()}
		}
	}
	var err error
	if config, err = openConfig(dir + "/enote"); err != nil {
		return map[string]any{"ok": false, "error": "config: " + err.Error()}
	}
	if store, err = openStore(dir + "/enote"); err != nil {
		return map[string]any{"ok": false, "error": "store: " + err.Error()}
	}
	startWorker()
	bootStats = map[string]any{"ok": true, "dir": dir, "notes": len(store.snapshot()),
		"go": goVersion()}
	logf("appInit dir=%s notes=%d model=%s", dir, len(store.snapshot()), config.get().Model)
	return bootStats
}

func appInfo() map[string]any {
	out := map[string]any{
		"dir":      appDir,
		"uptimeS":  int(time.Since(bootTime).Seconds()),
		"queue":    len(jobs),
		"notes":    0,
		"todos":    0,
		"open":     0,
		"overdue":  0,
		"server":   srvURL,
		"go":       goVersion(),
		"ocrReady": ocrReady,
	}
	if store != nil {
		for _, n := range store.snapshot() {
			out["notes"] = out["notes"].(int) + 1
			for _, t := range n.Todos {
				out["todos"] = out["todos"].(int) + 1
				if !t.Done {
					out["open"] = out["open"].(int) + 1
					if t.Due != "" && t.Due < nowStamp() {
						out["overdue"] = out["overdue"].(int) + 1
					}
				}
			}
		}
	}
	return out
}

func goVersion() string { return goVersionString }

func nowStamp() string { return time.Now().Format("2006-01-02T15:04") }
