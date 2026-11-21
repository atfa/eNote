package main

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Clip is one item the clipboard watcher held back (R7, P6): the user copied text or an
// image, it is NOT parsed yet - it sits here until they open the app, tick what they want
// and hit 一键解析 (or 原样存为笔记). Everything is kept in clip.json inside the files dir.
type Clip struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"` // text | image
	Text      string    `json:"text,omitempty"`
	Path      string    `json:"path,omitempty"` // image: the file copied into inbox/
	Name      string    `json:"name,omitempty"`
	MIME      string    `json:"mime,omitempty"`
	App       string    `json:"app,omitempty"` // the app that put it on the clipboard, if known
	CreatedAt time.Time `json:"createdAt"`
}

type ClipStore struct {
	mu    sync.Mutex
	path  string
	Clips []*Clip `json:"clips"`
}

var clipStore *ClipStore

const maxClipText = 20000

func openClipStore(dir string) (*ClipStore, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &ClipStore{path: filepath.Join(dir, "clip.json")}
	if b, err := os.ReadFile(s.path); err == nil && len(b) > 0 {
		if err := json.Unmarshal(b, s); err != nil {
			_ = os.Rename(s.path, s.path+".bad-"+time.Now().Format("20060102-150405"))
			s.Clips = nil
			logf("clip: corrupt %s moved aside", s.path)
		}
	}
	return s, nil
}

func (s *ClipStore) save() error {
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

func (s *ClipStore) snapshot() []*Clip {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Clip, 0, len(s.Clips))
	for _, c := range s.Clips {
		cp := *c
		out = append(out, &cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func clipCount() int {
	if clipStore == nil {
		return 0
	}
	return len(clipStore.snapshot())
}

// clipAdd is the single entry point for the clipboard watcher (JNI nativeClipAdd) and the
// web UI. It de-dupes: an exact repeat of the last item is dropped, and the same source
// within 5s just replaces the last item (a fast double-copy of the same thing).
func clipAdd(kind, text, path, name, mime, app string) string {
	if clipStore == nil {
		return `{"error":"clip store 未初始化"}`
	}
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = "text"
	}
	if kind == "text" {
		text = strings.TrimSpace(text)
		text = clip(text, maxClipText)
		if text == "" {
			return `{"ok":false,"error":"内容为空"}`
		}
	} else if kind == "image" {
		if path == "" && text == "" {
			return `{"ok":false,"error":"图片为空"}`
		}
	} else {
		return `{"ok":false,"error":"未知类型 ` + kind + `"}`
	}

	now := time.Now()
	sig := kind + "\x00" + text + "\x00" + path
	logf("clip add: kind=%s runes=%d app=%q path=%q", kind, len([]rune(text)), app, path)

	clipStore.mu.Lock()
	defer clipStore.mu.Unlock()

	// exact repeat of the newest item -> drop
	if n := len(clipStore.Clips); n > 0 {
		last := clipStore.Clips[n-1]
		if last.sig() == sig {
			logf("clip add: 与最新一条完全相同 → 丢弃（最新 %d 字）", len([]rune(last.Text)))
			return `{"ok":true,"duplicate":true}`
		}
		// same source within 5s -> replace the newest
		if last.App == app && now.Sub(last.CreatedAt) <= 5*time.Second {
			logf("clip add: 同来源 5s 内 → 覆盖最新一条")
			last.Text = text
			last.Path = path
			last.Name = name
			last.MIME = mime
			last.Kind = kind
			last.CreatedAt = now
			if err := clipStore.save(); err != nil {
				logf("clip add(replace): %v", err)
			}
			return `{"ok":true}`
		}
	}

	c := &Clip{
		ID:        newID(),
		Kind:      kind,
		Text:      text,
		Path:      path,
		Name:      name,
		MIME:      mime,
		App:       app,
		CreatedAt: now,
	}
	clipStore.Clips = append(clipStore.Clips, c)
	if err := clipStore.save(); err != nil {
		logf("clip add: %v", err)
	}
	return `{"ok":true,"id":"` + c.ID + `"}`
}

// sig is the de-dupe fingerprint of a stored clip. It used to take the *incoming*
// kind/text/path as arguments, which made the comparison `last.kindSig(kind,text,path) == sig`
// a tautology: every clip after the first one was thrown away as a "duplicate".
func (c *Clip) sig() string {
	return c.Kind + "\x00" + c.Text + "\x00" + c.Path
}

// clipParse turns the selected clips into notes, reusing the normal ingest pipeline:
// text clips go straight to the LLM, image clips carry their (already OCR'd) text. raw
// stores them as plain notes without any LLM call.
func clipParse(ids []string, raw bool) map[string]any {
	if clipStore == nil {
		return map[string]any{"ok": false, "error": "clip store 未初始化"}
	}
	if len(ids) == 0 {
		return map[string]any{"ok": false, "error": "没有选择任何条目"}
	}
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	parsed, kept := 0, 0
	var firstErr string
	for _, c := range clipStore.snapshot() {
		if !want[c.ID] {
			continue
		}
		kept++
		var res enqueueResult
		switch c.Kind {
		case "image":
			res = enqueue(ingestReq{
				Kind: "image", Path: c.Path, Name: c.Name, MIME: c.MIME,
				OCR: c.Text, Source: "clipboard-image",
			})
		default:
			res = enqueue(ingestReq{Kind: "text", Text: c.Text, Source: "clipboard-text", Raw: raw})
		}
		if res.Error != "" && firstErr == "" {
			firstErr = res.Error
		} else if res.Error == "" {
			parsed++
		}
	}
	// whatever we accepted is now a note (or at least out of the holding area)
	clipStore.remove(ids)
	return map[string]any{"ok": firstErr == "", "parsed": parsed, "kept": kept, "error": firstErr}
}

func (s *ClipStore) remove(ids []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	left := s.Clips[:0]
	for _, c := range s.Clips {
		if want[c.ID] {
			if c.Kind == "image" && c.Path != "" {
				removeFile(c.Path)
			}
			continue
		}
		left = append(left, c)
	}
	s.Clips = left
	if err := s.save(); err != nil {
		logf("clip remove: %v", err)
	}
}

func (s *ClipStore) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.Clips {
		if c.Kind == "image" && c.Path != "" {
			removeFile(c.Path)
		}
	}
	s.Clips = nil
	if err := s.save(); err != nil {
		logf("clip clear: %v", err)
	}
}

// hashText is shared by Java-side de-dup decisions when useful; the Go side de-dupes on
// its own, this is just a stable fingerprint.
func hashText(s string) string {
	h := sha1.Sum([]byte(s))
	return hex.EncodeToString(h[:])
}
