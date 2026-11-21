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
	stQueued   = "queued"   // waiting for the worker
	stParsing  = "parsing"  // LLM call in flight
	stDone     = "done"     // LLM produced structured output
	stRaw      = "raw"      // LLM failed / unparseable: text kept, no todos
	stError    = "error"    // ingest failed (OCR failed, file unreadable, ...)
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

type Note struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	RawText   string    `json:"rawText"` // original shared/OCR text, kept for 重新解析
	Tags      []string  `json:"tags"`
	Todos     []Todo    `json:"todos"`
	Source    string    `json:"source"` // share-text|share-image|manual-text|manual-image
	ImagePath string    `json:"imagePath,omitempty"`
	ImageName string    `json:"imageName,omitempty"`
	OCRText   string    `json:"ocrText,omitempty"`
	OCRMs     int64     `json:"ocrMs,omitempty"`
	AIModel   string    `json:"aiModel,omitempty"`
	AIMs      int64     `json:"aiMs,omitempty"`
	AIRaw     string    `json:"aiRaw,omitempty"` // raw model output, for the debug tab
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
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
			bak := s.path + ".bad-" + time.Now().Format("20060102-150405")
			_ = os.Rename(s.path, bak)
			s.Notes = nil
			logf("store: corrupt %s moved to %s", s.path, bak)
		}
	}
	for _, n := range s.Notes {
		if n.Status == stParsing || n.Status == stQueued {
			n.Status = stRaw // a previous process died mid-parse
			n.Error = "处理被中断，可点「重新解析」"
		}
	}
	return s, nil
}

// save writes atomically (temp file + rename); caller holds the lock.
func (s *Store) save() error {
	tmp := s.path + ".tmp"
	b, err := json.MarshalIndent(s, "", " ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
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
			if n.ImagePath != "" {
				if err := os.Remove(n.ImagePath); err != nil && !os.IsNotExist(err) {
					logf("store remove image: %v", err)
				}
			}
			if err := s.save(); err != nil {
				logf("store remove: %v", err)
			}
			return true
		}
	}
	return false
}

// snapshot returns copies newest-first, so the UI never reads a half-written note.
func (s *Store) snapshot() []*Note {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Note, 0, len(s.Notes))
	for _, n := range s.Notes {
		c := *n
		c.Todos = append([]Todo(nil), n.Todos...)
		out = append(out, &c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
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
