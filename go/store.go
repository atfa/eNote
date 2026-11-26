package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Note statuses.
const (
	stQueued  = "queued"  // waiting for the worker
	stParsing = "parsing" // LLM call in flight
	stDone    = "done"    // LLM produced structured output
	stRaw     = "raw"     // LLM failed / unparseable: text kept, no todos
	stError   = "error"   // ingest failed (OCR failed, file unreadable, ...)
)

type Todo struct {
	ID       string `json:"id"`
	Text     string `json:"text"`
	Due      string `json:"due"` // "2006-01-02T15:04" local, "" = no date
	Done     bool   `json:"done"`
	DoneAt   string `json:"doneAt,omitempty"`
	Priority string `json:"priority,omitempty"` // high|normal|low
	Source   string `json:"source,omitempty"`   // ai|manual
}

// Attachment is a file that belongs to a note: a shared image, a picked document, a PDF.
// Notes used to carry exactly one image in ImagePath; that field is still written (double
// write) so the old read paths (/img?id=, card thumbnails) keep working.
type Attachment struct {
	ID        string    `json:"id"`
	NoteID    string    `json:"noteId,omitempty"`
	Name      string    `json:"name"`
	MIME      string    `json:"mime"`
	Size      int64     `json:"size"`
	Path      string    `json:"path"`
	Source    string    `json:"source,omitempty"` // share-image|manual-image|share-file|manual-file
	CreatedAt time.Time `json:"createdAt"`
}

// Fact is one key fact pulled out of a note (R12). We cannot enumerate every
// kind of document a person shares, so the model answers a fixed set of
// questions about the content: Q is the question ("何时"), A the answer taken
// from the source text. Empty answers are dropped before saving.
type Fact struct {
	Q string `json:"q"`
	A string `json:"a"`
}

type Note struct {
	ID          string       `json:"id"`
	Title       string       `json:"title"`
	Content     string       `json:"content"`
	RawText     string       `json:"rawText"` // original shared/OCR text, kept for 重新解析
	Facts       []Fact       `json:"facts,omitempty"`
	Tags        []string     `json:"tags"`
	Todos       []Todo       `json:"todos"`
	Source      string       `json:"source"` // share-text|share-image|manual-text|manual-image
	ImagePath   string       `json:"imagePath,omitempty"`
	ImageName   string       `json:"imageName,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`
	OCRText     string       `json:"ocrText,omitempty"`
	OCRMs       int64        `json:"ocrMs,omitempty"`
	AIModel     string       `json:"aiModel,omitempty"`
	AIMs        int64        `json:"aiMs,omitempty"`
	AIRaw       string       `json:"aiRaw,omitempty"` // raw model output, for the debug tab
	Status      string       `json:"status"`
	Error       string       `json:"error,omitempty"`
	CreatedAt   time.Time    `json:"createdAt"`
	UpdatedAt   time.Time    `json:"updatedAt"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	Notes []*Note `json:"notes"`
}

var store *Store

func openStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dir, "notes.json")}
	b, err := os.ReadFile(s.path)
	if err == nil && len(b) > 0 {
		if err := json.Unmarshal(b, s); err != nil {
			// never lose the user's data: keep the broken file and start fresh
			bak := moveAsideCorrupt(s.path)
			s.Notes = nil
			logf("store: corrupt %s moved to %s", s.path, bak)
		}
	}
	mig := 0
	for _, n := range s.Notes {
		if n.Status == stParsing || n.Status == stQueued {
			n.Status = stRaw // a previous process died mid-parse
			n.Error = "处理被中断，可点「重新解析」"
		}
		if migrateAttachments(n) {
			mig++
		}
	}
	if mig > 0 {
		if err := s.save(); err != nil {
			logf("store migrate attachments: %v", err)
		}
		logf("store: synthesised attachment records for %d note(s)", mig)
	}
	return s, nil
}

// migrateAttachments is the lazy half of the one-image -> attachments[] migration: a note that
// has an ImagePath and no attachment record gets one, so the 附件 page sees old notes too.
func migrateAttachments(n *Note) bool {
	if n.ImagePath == "" {
		return false
	}
	for i := range n.Attachments {
		a := &n.Attachments[i]
		if a.NoteID == "" {
			a.NoteID = n.ID
		}
		if a.Path == n.ImagePath {
			return false
		}
	}
	attachTo(n, Attachment{
		ID:        newID(),
		NoteID:    n.ID,
		Name:      firstNonEmpty(n.ImageName, filepath.Base(n.ImagePath)),
		MIME:      mimeForName(n.ImagePath),
		Size:      fileSize(n.ImagePath),
		Path:      n.ImagePath,
		Source:    n.Source,
		CreatedAt: n.CreatedAt,
	})
	return true
}

func fileSize(p string) int64 {
	if st, err := os.Stat(p); err == nil {
		return st.Size()
	}
	return 0
}

// save writes atomically (temp file + rename); caller holds the lock.
// 落盘成功后广播 data changed（步骤 73：UI 改成 SSE 事件推送，轮询降级为心跳）。
// 广播是非阻塞的：没人订阅就白写一行 select，读写路径零阻塞。
func (s *Store) save() error {
	err := writeJSONAtomic(s.path, s)
	if err == nil {
		hub.broadcast("notes")
	}
	return err
}

// writeJSONAtomic 是三个 store 共用的原子写：先写 .tmp 再 rename。直接 WriteFile 写到一半被杀
// 会留下半截 JSON，下次启动解析失败就回默认值（config.go 那边多一步 fsync + .bak，因为它丢的是
// API Key，值得多花一次磁盘同步）。P14 S6 步骤 55 从 store/clip/shots 三份逐字相同的实现收成一份。
func writeJSONAtomic(path string, v any) error {
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// moveAsideCorrupt 把解析不了的 JSON 挪成 .bad-<时间戳> 再从零开始：宁可给用户一个空列表，
// 也不要每次启动都解析失败。返回改名后的路径，调用方 log 用。
func moveAsideCorrupt(path string) string {
	bak := path + ".bad-" + time.Now().Format("20060102-150405")
	_ = os.Rename(path, bak)
	return bak
}

// snapshotSorted 复制一份切片（连元素一起复制）再排序：调用方拿到的是快照，锁外读到的
// 不是写线程正在改的那些指针。P14 S6 步骤 55 从 clip/shots 两个 snapshot() 收成一份。
func snapshotSorted[T any](in []*T, less func(a, b *T) bool) []*T {
	out := make([]*T, 0, len(in))
	for _, x := range in {
		cp := *x
		out = append(out, &cp)
	}
	sort.Slice(out, func(i, j int) bool { return less(out[i], out[j]) })
	return out
}

func (s *Store) add(n *Note) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Notes = append(s.Notes, n)
	if err := s.save(); err != nil {
		logf("store add: %v", err)
	}
}

// update runs f on the note with the given id and saves.
func (s *Store) update(id string, f func(*Note)) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, n := range s.Notes {
		if n.ID == id {
			f(n)
			n.UpdatedAt = time.Now()
			if err := s.save(); err != nil {
				logf("store update: %v", err)
			}
			return true
		}
	}
	return false
}

func (s *Store) get(id string) *Note {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, n := range s.Notes {
		if n.ID == id {
			c := *n
			return &c
		}
	}
	return nil
}

func (s *Store) remove(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, n := range s.Notes {
		if n.ID == id {
			s.Notes = append(s.Notes[:i], s.Notes[i+1:]...)
			// every file the note owned goes with it, not just the first image
			seen := map[string]bool{}
			for _, a := range n.Attachments {
				seen[a.Path] = true
				removeFile(a.Path)
			}
			if n.ImagePath != "" && !seen[n.ImagePath] {
				removeFile(n.ImagePath)
			}
			if err := s.save(); err != nil {
				logf("store remove: %v", err)
			}
			return true
		}
	}
	return false
}

func removeFile(p string) {
	if p == "" {
		return
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		logf("remove file %s: %v", p, err)
	}
}

// snapshot returns copies newest-first, so the UI never reads a half-written note.
func (s *Store) snapshot() []*Note {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Note, 0, len(s.Notes))
	for _, n := range s.Notes {
		c := *n
		c.Todos = append([]Todo(nil), n.Todos...)
		c.Attachments = append([]Attachment(nil), n.Attachments...)
		out = append(out, &c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

// pendingReminders is the alarm list Reminders.java builds its alarm set from:
// one entry per unfinished todo with a due time still in the future.
//
// The page pushes the same shape after every render (it knows about a todo that was
// just added and not yet saved), but this exists so the foreground service can rebuild
// the set on its own: after a process restart, or after the system dropped our alarms
// while the app was frozen, the timers come back without the WebView being alive.
func (s *Store) pendingReminders() []map[string]any {
	cut := time.Now().Add(5 * time.Second)
	out := make([]map[string]any, 0, 8)
	for _, n := range s.snapshot() {
		for _, t := range n.Todos {
			if t.Done || t.Due == "" {
				continue
			}
			d, err := time.ParseInLocation("2006-01-02T15:04", t.Due, time.Local)
			if err != nil || d.Before(cut) {
				continue
			}
			out = append(out, map[string]any{
				"id": n.ID + "|" + t.ID, "noteId": n.ID, "todoId": t.ID,
				"text": t.Text, "note": n.Title,
				"dueMs": d.UnixNano() / int64(time.Millisecond),
			})
		}
	}
	return out
}

func newID() string {
	return fmt.Sprintf("%d%s", time.Now().UnixNano()/1000, randSuffix(4))
}

func randSuffix(n int) string {
	const al = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = al[int(time.Now().UnixNano()>>uint(3*i))%len(al)]
	}
	return string(b)
}

// dueKey sorts todos: overdue/soonest first, undated last, done items last.
func dueKey(t Todo) string {
	if t.Done {
		return "9999"
	}
	if t.Due == "" {
		return "9998"
	}
	return t.Due
}

func sortTodos(ts []Todo) {
	sort.SliceStable(ts, func(i, j int) bool {
		if dueKey(ts[i]) != dueKey(ts[j]) {
			return dueKey(ts[i]) < dueKey(ts[j])
		}
		return ts[i].Text < ts[j].Text
	})
}

// normaliseDue accepts the shapes a model tends to produce and returns "2006-01-02T15:04"
// in local time, or "" when there is no usable date.
func normaliseDue(s string) string {
	s = strings.TrimSpace(s)
	if s == "" || s == "null" || strings.EqualFold(s, "none") {
		return ""
	}
	layouts := []string{
		"2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02 15:04",
		"2006-01-02T15:04:05Z07:00", "2006-01-02", "2006/01/02 15:04", "2006/01/02",
	}
	for _, l := range layouts {
		if t, err := time.ParseInLocation(l, s, time.Local); err == nil {
			return t.Format("2006-01-02T15:04")
		}
	}
	return ""
}
