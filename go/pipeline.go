package main

import (
	"encoding/json"
	"fmt"
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
	Raw       bool   `json:"raw"`       // true = store as-is, no LLM call
	Source    string `json:"source"`    // share-text | share-image | manual-text | manual-image | share-file | manual-file | clipboard-*
	// Images 只在 kind=images 时用：一次导入的多张截图（合并成一条笔记，P11）。
	Images []ingestImage `json:"images,omitempty"`
}

// ingestImage 是"合并成一条笔记"里的单张图：OCR 结果由 Java 侧（ML Kit）给。
type ingestImage struct {
	Path string `json:"path"`
	Name string `json:"name"`
	MIME string `json:"mime,omitempty"`
	OCR  string `json:"ocr,omitempty"`
	Ms   int64  `json:"ocrMs,omitempty"`
	Err  string `json:"err,omitempty"`
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
	var e string
	switch r.Kind {
	case "image":
		fillImage(n, r)
	case "images":
		e = fillImages(n, r)
	case "file":
		e = fillFile(n, r)
	default: // text
		e = fillText(n, r)
	}
	if e != "" {
		return enqueueResult{Kind: r.Kind, Error: e}
	}
	store.add(n)
	logf("enqueue %s kind=%s source=%s len=%d ocrMs=%d status=%s",
		n.ID, r.Kind, r.Source, len(n.RawText), n.OCRMs, n.Status)
	if n.Status == stQueued {
		jobs <- n.ID
	}
	return enqueueResult{ID: n.ID, Kind: r.Kind}
}

/* 步骤 55：enqueue 原来 109 行，四个 kind 的填充分支各占 15~35 行，读一遍要在脑子里同时装下
   「新建笔记」「四种入队形态」「谁负责落库」。现在 enqueue 只剩路由：新建 → 按 kind 填 →
   填不出内容就直接返回（不落库）→ 落库 → 排队。四个 fill* 逐字搬自原来的四个 case，
   语义一个字节没改：返回非空字符串 =「这条别存」，对应原来 case 里的
   `return enqueueResult{Kind: …, Error: …}`；文件分支那个 `break`（跳出 switch 继续落库）
   现在写成 `return ""`。 */

// newNote 是入队时的空壳：状态先给 queued，各 kind 的 fill* 负责把内容填进去。
func newNote(r ingestReq) *Note {
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
	return n
}

// fillImage：单张图（分享图片 / 相册选一张），OCR 文本就是正文。
func fillImage(n *Note, r ingestReq) {
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
}

// fillImages：多张截图合成一条笔记（P11 合并模式）：附件按时间顺序全部挂上，
// OCR 文本拼接后只调一次 LLM —— 10 张图 = 1 次调用，不是 10 次。
func fillImages(n *Note, r ingestReq) string {
	if len(r.Images) == 0 {
		return "没有图片"
	}
	var parts []string
	ocrErr := ""
	for _, im := range r.Images {
		name := firstNonEmpty(im.Name, filepath.Base(im.Path))
		attachTo(n, attachmentFor(n.ID, im.Path, name, im.MIME, n.Source, n.CreatedAt))
		if n.ImagePath == "" {
			n.ImagePath, n.ImageName = im.Path, name
		}
		if t := strings.TrimSpace(im.OCR); t != "" {
			parts = append(parts, t)
		}
		if im.Err != "" && ocrErr == "" {
			ocrErr = im.Err
		}
		n.OCRMs += im.Ms
	}
	n.OCRText = strings.Join(parts, "\n\n---\n\n")
	n.RawText = n.OCRText
	n.Content = n.OCRText
	n.Title = fmt.Sprintf("截图 %d 张 · %s", len(r.Images), time.Now().Format("01-02 15:04"))
	switch {
	case ocrErr != "":
		n.Status, n.Error = stError, ocrErr
	case n.OCRText == "":
		n.Status, n.Error = stRaw, "图片里没有识别到文字"
	case r.Raw:
		n.Status, n.Error = stRaw, "原样保存，未做 AI 解析"
	}
	return ""
}

// fillFile：文档附件（pdf / docx / txt…）分享进来或选进来，只存不调 LLM。
func fillFile(n *Note, r ingestReq) string {
	if n.Source == "manual-text" {
		n.Source = "manual-file"
	}
	if r.FileError != "" {
		n.Status = stError
		n.Error = r.FileError
		n.Content = "文件接收失败：" + r.FileError
		n.Title = firstNonEmpty(r.Name, "文件")
		return ""
	}
	if r.Path == "" {
		return "文件路径为空"
	}
	n.Title = firstNonEmpty(r.Name, filepath.Base(r.Path))
	n.Content = "已保存附件：" + n.Title
	n.RawText = ""
	n.Status = stRaw
	n.Error = "文件已保存，未做 AI 解析"
	attachTo(n, attachmentFor(n.ID, r.Path, n.Title, r.MIME, n.Source, n.CreatedAt))
	return ""
}

// fillText：纯文本（分享文本 / 手输），返回非空 = 这条别存。
func fillText(n *Note, r ingestReq) string {
	n.RawText = strings.TrimSpace(r.Text)
	n.Content = n.RawText
	n.Title = strings.TrimSpace(r.Subject)
	if n.RawText == "" {
		return "内容为空"
	}
	if r.Raw {
		// 原样存为笔记：不调 LLM，直接落库
		n.Status = stRaw
		n.Error = "原样保存，未做 AI 解析"
	}
	return ""
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
	text := noteText(n)
	if text == "" {
		store.update(id, func(x *Note) { x.Status = stRaw; x.Error = "没有文本" })
		return
	}
	if !config.get().UseAI {
		store.update(id, func(x *Note) {
			x.Status = stRaw
			x.Content = text
			x.Error = "AI 解析已关闭，仅保存原文"
		})
		return
	}
	runNoteAI(id, n, text)
}

// noteText 取笔记里能送去解析的正文：优先原文，没有就用正文。
func noteText(n *Note) string {
	text := strings.TrimSpace(n.RawText)
	if text == "" {
		text = strings.TrimSpace(n.Content)
	}
	return text
}

// noteFail 是 AI 解析失败的落库：状态退回 raw、正文保住原文、AI 原始输出留一份、错误写清原因。
// 两条失败出口（调用失败 / 输出解析不了）原来各写四行，只差一句原因文案。
func noteFail(id, text string, call *LLMCall, msg string) {
	store.update(id, func(x *Note) {
		x.Status = stRaw
		x.Content = text
		x.AIRaw = clip(call.Raw, 4000)
		x.Error = msg
	})
}

// runNoteAI 真调大模型：两条失败出口都走 noteFail（原文保住、可重试），成功走 applyParsed。
func runNoteAI(id string, n *Note, text string) {
	store.update(id, func(x *Note) { x.Status = stParsing; x.Error = "" })
	call, err := callLLM(systemPrompt(), userPromptFor(n))
	if err != nil {
		noteFail(id, text, call, "AI 解析失败："+clip(call.Err, 300)+"（原文已保留，可重试）")
		return
	}
	p, perr := parseNoteJSON(call.Raw)
	if perr != nil {
		noteFail(id, text, call, "AI 输出无法解析："+perr.Error()+"（原文已保留，可重试）")
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

/* 步骤 60：appInit 原来 44 行，建目录、开四个存储、给暂存区挂「笔记引用了哪些文件」的回调、
   起 worker、算启动快照，全平铺在一起。现在目录归 appDirs、开存储归 openStores、
   保留名单归 noteReferencedPaths，appInit 只剩「按顺序装配，任一步失败就把原因回给 Java」。 */

func appInit(dir string) map[string]any {
	appDir = dir
	if bad := appDirs(dir); bad != nil {
		return bad
	}
	if bad := openStores(dir); bad != nil {
		return bad
	}
	startWorker()
	bootStats = map[string]any{"ok": true, "dir": dir, "notes": len(store.snapshot()),
		"go": goVersion()}
	logf("appInit dir=%s notes=%d model=%s tz=%s now=%s", dir, len(store.snapshot()),
		config.get().Model, tzInfo(), nowStamp())
	return bootStats
}

// appDirs 记下两个全局路径并把目录建出来。返回 nil 表示成功。
func appDirs(dir string) map[string]any {
	logDir = filepath.Join(dir, "enote")
	inboxDir = filepath.Join(dir, "enote", "inbox")
	for _, d := range []string{logDir, inboxDir} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return map[string]any{"ok": false, "error": "mkdir: " + err.Error()}
		}
	}
	return nil
}

// openStores 依次打开四个存储，任一失败就把原因回给 Java（返回 nil 表示全开成功）。
func openStores(dir string) map[string]any {
	var err error
	if config, err = openConfig(dir + "/enote"); err != nil {
		return map[string]any{"ok": false, "error": "config: " + err.Error()}
	}
	if store, err = openStore(dir + "/enote"); err != nil {
		return map[string]any{"ok": false, "error": "store: " + err.Error()}
	}
	if clipStore, err = openClipStore(dir + "/enote"); err != nil {
		return map[string]any{"ok": false, "error": "clip store: " + err.Error()}
	}
	if shotStore, err = openShotStore(dir + "/enote"); err != nil {
		return map[string]any{"ok": false, "error": "shot store: " + err.Error()}
	}
	// 笔记已经引用的文件不归暂存区管：导入成功后清理暂存时不能把附件删掉
	shotStore.setKeep(noteReferencedPaths)
	return nil
}

// noteReferencedPaths 是笔记已经用上的文件清单（正文图 + 附件），给截图暂存区当保留名单。
func noteReferencedPaths() map[string]bool {
	keep := map[string]bool{}
	for _, n := range store.snapshot() {
		if n.ImagePath != "" {
			keep[n.ImagePath] = true
		}
		for _, a := range n.Attachments {
			if a.Path != "" {
				keep[a.Path] = true
			}
		}
	}
	return keep
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
		"clip":     clipCount(),
		"shot":     shotCount(),
		"server":   srvURL,
		"go":       goVersion(),
		"tz":       tzInfo(),
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
