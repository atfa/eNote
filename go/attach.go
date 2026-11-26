package main

// Attachments (R4): every file that belongs to a note - a shared image, a picked document, a
// PDF. The 附件 page lists them all, /file?id= serves them with the right mime type.
//
// Notes used to hold exactly one image in Note.ImagePath. That field is still written (double
// write) and the lazy migration in openStore synthesises an attachment record for old notes,
// so the old read paths (/img?id=, card thumbnails) keep working untouched.

import (
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// attachTo adds an attachment to a note, replacing one that points at the same file
// (re-OCR of the same image must not duplicate the record).
func attachTo(n *Note, a Attachment) {
	if a.ID == "" {
		a.ID = newID()
	}
	a.NoteID = n.ID
	for i := range n.Attachments {
		if n.Attachments[i].Path != "" && n.Attachments[i].Path == a.Path {
			n.Attachments[i] = a
			return
		}
	}
	n.Attachments = append(n.Attachments, a)
}

// attachmentFor builds the record for a file that is already inside the app's files dir.
func attachmentFor(noteID, path, name, mime, source string, at time.Time) Attachment {
	if name == "" {
		name = filepath.Base(path)
	}
	if mime == "" || mime == "application/octet-stream" {
		// a file:// share reports a generic mime, so the extension is the better hint
		mime = mimeForName(name)
	}
	return Attachment{
		ID:        newID(),
		NoteID:    noteID,
		Name:      name,
		MIME:      mime,
		Size:      fileSize(path),
		Path:      path,
		Source:    source,
		CreatedAt: at,
	}
}

var mimeByExt = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
	".gif": "image/gif", ".bmp": "image/bmp", ".heic": "image/heic", ".svg": "image/svg+xml",
	".pdf": "application/pdf",
	".txt": "text/plain", ".md": "text/plain", ".csv": "text/csv", ".json": "application/json",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt":  "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".zip":  "application/zip", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "video/mp4",
}

func mimeForName(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	if m, ok := mimeByExt[ext]; ok {
		return m
	}
	switch ext {
	case ".docx", ".xlsx", ".pptx":
		return "application/octet-stream"
	}
	return "application/octet-stream"
}

// kindOfMime groups a mime type for the 附件 page icons and its 类型 filter.
func kindOfMime(mime string) string {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return "image"
	case strings.HasPrefix(mime, "audio/"):
		return "audio"
	case strings.HasPrefix(mime, "video/"):
		return "video"
	case strings.HasPrefix(mime, "text/"):
		return "text"
	case strings.Contains(mime, "pdf"):
		return "pdf"
	case strings.Contains(mime, "sheet") || strings.Contains(mime, "excel"):
		return "sheet"
	case strings.Contains(mime, "presentation") || strings.Contains(mime, "powerpoint"):
		return "slides"
	case strings.Contains(mime, "word") || strings.Contains(mime, "document"):
		return "doc"
	case strings.Contains(mime, "zip"), strings.Contains(mime, "compressed"),
		strings.Contains(mime, "tar"), strings.Contains(mime, "7z"):
		return "archive"
	}
	return "file"
}

var kindLabels = map[string]string{
	"image": "图片", "pdf": "PDF", "doc": "文档", "sheet": "表格", "slides": "演示",
	"text": "文本", "audio": "音频", "video": "视频", "archive": "压缩包", "file": "文件",
}

// attachItem is one attachment plus the note it belongs to, as the API returns it.
type attachItem struct {
	Attachment
	NoteTitle string `json:"noteTitle"`
	NoteAt    string `json:"noteAt,omitempty"`
	Kind      string `json:"kind"`
	Missing   bool   `json:"missing,omitempty"`
}

type attachRes struct {
	OK        bool         `json:"ok"`
	Items     []attachItem `json:"items"`
	Total     int          `json:"total"`
	Bytes     int64        `json:"bytes"`
	Files     int          `json:"files"` // attachments on disk (missing ones excluded)
	Missing   int          `json:"missing"`
	Scanned   int          `json:"scanned"`
	Dirs      []string     `json:"dirs,omitempty"` // directories holding files, for the test
	DiskFiles int          `json:"diskFiles"`
}

// listAttachments walks the store and returns the attachments that pass q/mime/note, newest
// first by default. `mime` accepts a mime prefix ("image/", "application/pdf") or a kind
// ("image", "pdf", "doc", ...) as the UI's 类型 filter sends it.
/* 步骤 59：listAttachments 原来 58 行，一条附件的「拼装 / 过滤 / 收尾」三件事挤在两层循环里。
   现在拼归 newAttachItem、过滤归 attachItem.matches、收尾归 attachRes.finish，
   主函数只剩「遍历 → 过滤 → 收下」。语句逐字搬，只把 a.MIME/a.Name 换成 it.（attachItem
   内嵌 Attachment，同一字段）、过滤器里的 continue 换成 return false、收尾里的 res. 换成 r.。 */

func listAttachments(q, sortKey, dir, mime, noteID string, limit int) attachRes {
	q = strings.ToLower(strings.TrimSpace(q))
	limit = clampLimit(limit, 500, 2000)
	res := attachRes{OK: true}
	for _, n := range store.snapshot() {
		if noteID != "" && n.ID != noteID {
			continue
		}
		res.Scanned++
		for _, a := range n.Attachments {
			it := newAttachItem(n, a)
			if !it.matches(mime, q) {
				continue
			}
			res.Items = append(res.Items, it)
			res.Bytes += a.Size
		}
	}
	res.finish(sortKey, dir, limit)
	return res
}

// newAttachItem 把一条附件连同所属笔记拼成 API 要的形状：标题空给占位、带上笔记时间、
// 文件不在盘上标 missing。
func newAttachItem(n *Note, a Attachment) attachItem {
	it := attachItem{Attachment: a, NoteTitle: n.Title, Kind: kindOfMime(a.MIME)}
	if it.NoteTitle == "" {
		it.NoteTitle = "(未命名笔记)"
	}
	it.NoteAt = n.CreatedAt.Format("2006-01-02 15:04")
	if a.Path == "" {
		it.Missing = true
	} else if _, err := os.Stat(a.Path); err != nil {
		it.Missing = true
	}
	return it
}

// matches 是 UI 的两个过滤器：mime 可以是 mime 前缀（"image/"）或类型名（"image"、"pdf"），
// q 是名称 / mime / 笔记标题的小写子串。返回 false 表示这条不进列表。
func (it attachItem) matches(mime, q string) bool {
	switch mime {
	case "", "all":
		// no filter
	default:
		if strings.Contains(mime, "/") {
			if !strings.HasPrefix(strings.ToLower(it.MIME), strings.ToLower(mime)) {
				return false
			}
		} else if it.Kind != mime {
			return false
		}
	}
	if q != "" {
		blob := strings.ToLower(it.Name + "\n" + it.MIME + "\n" + it.NoteTitle)
		if !strings.Contains(blob, q) {
			return false
		}
	}
	return true
}

// finish 收尾：missing / files 只统计过滤后的列表（否则搜索会把 missing 减成负数），
// 排序在截断之前，最后补上磁盘侧的两个数。
func (r *attachRes) finish(sortKey, dir string, limit int) {
	r.Total = len(r.Items)
	// files/missing describe the *filtered* list, so a search cannot make missing negative
	for _, it := range r.Items {
		if it.Missing {
			r.Missing++
		}
	}
	r.Files = r.Total - r.Missing
	sortAttachments(r.Items, sortKey, dir)
	if r.Total > limit {
		r.Items = r.Items[:limit]
	}
	r.Dirs = attachmentDirs()
	r.DiskFiles = countDiskFiles()
}

func sortAttachments(list []attachItem, s, dir string) {
	less := func(i, j int) bool {
		a, b := list[i], list[j]
		switch s {
		case "size":
			if a.Size != b.Size {
				return a.Size > b.Size
			}
		case "name":
			if a.Name != b.Name {
				return strings.ToLower(a.Name) < strings.ToLower(b.Name)
			}
		case "mime", "kind":
			if a.Kind != b.Kind {
				return a.Kind < b.Kind
			}
			if a.Name != b.Name {
				return strings.ToLower(a.Name) < strings.ToLower(b.Name)
			}
		default: // created
			if !a.CreatedAt.Equal(b.CreatedAt) {
				return a.CreatedAt.After(b.CreatedAt)
			}
		}
		return a.Name < b.Name
	}
	sort.SliceStable(list, less)
	// less already yields newest/biggest first for created/size and A-Z for name/kind.
	// `dir`, when set, is the direction the caller wants, not a flip of it.
	descByDefault := s == "" || s == "new" || s == "created" || s == "size"
	asc := dir == "asc" || (dir == "" && !descByDefault)
	if asc == descByDefault {
		sort.SliceStable(list, func(i, j int) bool { return less(j, i) })
	}
}

func atoiDefault(s string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
		return n
	}
	return def
}

func clampLimit(v, def, max int) int {
	if v <= 0 {
		return def
	}
	if v > max {
		return max
	}
	return v
}

// attachmentDirs lists the directories that hold attachment files (deduped).
func attachmentDirs() []string {
	seen := map[string]bool{}
	var out []string
	for _, n := range store.snapshot() {
		for _, a := range n.Attachments {
			if a.Path == "" {
				continue
			}
			d := filepath.Dir(a.Path)
			if !seen[d] {
				seen[d] = true
				out = append(out, d)
			}
		}
	}
	sort.Strings(out)
	return out
}

// countDiskFiles counts the files inside the attachment directories - the acceptance check
// for "the attachment list and the disk agree" (no orphan files).
func countDiskFiles() int {
	n := 0
	for _, d := range attachmentDirs() {
		es, err := os.ReadDir(d)
		if err != nil {
			continue
		}
		for _, e := range es {
			if !e.IsDir() {
				n++
			}
		}
	}
	return n
}

func findAttachment(id string) (attachItem, bool) {
	for _, n := range store.snapshot() {
		for _, a := range n.Attachments {
			if a.ID == id {
				it := attachItem{Attachment: a, NoteTitle: n.Title, Kind: kindOfMime(a.MIME)}
				it.NoteAt = n.CreatedAt.Format("2006-01-02 15:04")
				_, err := os.Stat(a.Path)
				it.Missing = err != nil
				return it, true
			}
		}
	}
	return attachItem{}, false
}

// handleAttachments GET /api/attachments?q&sort&dir&mime&note&limit
func handleAttachments(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	res := listAttachments(qs.Get("q"), qs.Get("sort"), qs.Get("dir"), qs.Get("mime"),
		qs.Get("note"), atoiDefault(qs.Get("limit"), 0))
	jsonOut(w, res)
}

// handleFile GET /file?id=<attachment id> - inline, with the stored mime type.
func handleFile(w http.ResponseWriter, r *http.Request) {
	it, ok := findAttachment(r.URL.Query().Get("id"))
	if !ok {
		http.Error(w, "no such attachment", http.StatusNotFound)
		return
	}
	if it.Missing || it.Path == "" {
		http.Error(w, "文件已不在磁盘上", http.StatusGone)
		return
	}
	if it.MIME != "" {
		w.Header().Set("Content-Type", it.MIME)
	}
	w.Header().Set("Content-Disposition", "inline; filename*=UTF-8''"+url.PathEscape(it.Name))
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, it.Path)
}

// handleAttachDelete POST {id} - remove one file and its record; clears Note.ImagePath when
// it was the note's image, so the card stops pointing at a deleted file.
func handleAttachDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	it, ok := findAttachment(body.ID)
	if !ok {
		jsonOut(w, map[string]any{"ok": false, "error": "附件不存在"})
		return
	}
	removeFile(it.Path)
	store.update(it.NoteID, func(n *Note) {
		out := n.Attachments[:0]
		for _, a := range n.Attachments {
			if a.ID != it.ID {
				out = append(out, a)
			}
		}
		n.Attachments = out
		if n.ImagePath == it.Path {
			n.ImagePath = ""
			n.ImageName = ""
			for _, a := range n.Attachments {
				if kindOfMime(a.MIME) == "image" {
					n.ImagePath = a.Path
					n.ImageName = a.Name
					break
				}
			}
		}
	})
	logf("attach delete %s (%s)", it.ID, it.Name)
	jsonOut(w, map[string]any{"ok": true, "name": it.Name})
}
