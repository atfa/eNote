package main

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
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
			logf("clip: corrupt %s moved aside", moveAsideCorrupt(s.path))
			s.Clips = nil
		}
	}
	return s, nil
}

func (s *ClipStore) save() error {
	err := writeJSONAtomic(s.path, s)
	if err == nil {
		hub.broadcast("clips")
	}
	return err
}

func (s *ClipStore) snapshot() []*Clip {
	s.mu.Lock()
	defer s.mu.Unlock()
	return snapshotSorted(s.Clips, func(a, b *Clip) bool { return a.CreatedAt.After(b.CreatedAt) })
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
/* 步骤 58：clipAdd 原来 68 行，六个参数（kind/text/path/name/mime/app）在校验、去重、
   追加三段之间穿来穿去，`now` 也要一路带着。现在先归成一个 clipIn，三段各自成方法：
   normalize 校验归一化、dedupe 去重（完全相同丢弃 / 同来源 5s 内覆盖）、append 收下。
   语句逐字搬，只把裸参数换成 in. 前缀，本地 sig 换成 in.sig()。 */

// clipIn 是 Java 递过来的一条剪贴板内容（kind=text/image，text 可以是 dataURL）。
type clipIn struct {
	kind, text, path, name, mime, app string
	at                                time.Time
}

// sig 是这条内容的去重指纹，跟 Clip.sig 同一套算法。
func (in *clipIn) sig() string { return in.kind + "\x00" + in.text + "\x00" + in.path }

func clipAdd(kind, text, path, name, mime, app string) string {
	if clipStore == nil {
		return `{"error":"clip store 未初始化"}`
	}
	in := &clipIn{kind: kind, text: text, path: path, name: name, mime: mime, app: app, at: time.Now()}
	if bad := in.normalize(); bad != "" {
		return bad
	}
	logf("clip add: kind=%s runes=%d app=%q path=%q", in.kind, len([]rune(in.text)), in.app, in.path)
	clipStore.mu.Lock()
	defer clipStore.mu.Unlock()
	if r, done := in.dedupe(); done {
		return r
	}
	return in.append()
}

// normalize 校验并归一化：text 去空白再截断，image 要有路径或 dataURL，未知类型直接拒。
// 返回空串表示通过，否则是要直接回给 Java 的 JSON 错误。
func (in *clipIn) normalize() string {
	in.kind = strings.TrimSpace(in.kind)
	if in.kind == "" {
		in.kind = "text"
	}
	if in.kind == "text" {
		in.text = strings.TrimSpace(in.text)
		in.text = clip(in.text, maxClipText)
		if in.text == "" {
			return `{"ok":false,"error":"内容为空"}`
		}
	} else if in.kind == "image" {
		if in.path == "" && in.text == "" {
			return `{"ok":false,"error":"图片为空"}`
		}
	} else {
		return `{"ok":false,"error":"未知类型 ` + in.kind + `"}`
	}
	return ""
}

// dedupe 去重：跟最新一条完全相同就丢弃；同来源 5 秒内则覆盖最新一条（快速连抄两次
// 同一个东西）。返回 (要回给 Java 的 JSON, 是否已处理完)。
func (in *clipIn) dedupe() (string, bool) {
	// exact repeat of the newest item -> drop
	if n := len(clipStore.Clips); n > 0 {
		last := clipStore.Clips[n-1]
		if last.sig() == in.sig() {
			logf("clip add: 与最新一条完全相同 → 丢弃（最新 %d 字）", len([]rune(last.Text)))
			return `{"ok":true,"duplicate":true}`, true
		}
		// same source within 5s -> replace the newest
		if last.App == in.app && in.at.Sub(last.CreatedAt) <= 5*time.Second {
			logf("clip add: 同来源 5s 内 → 覆盖最新一条")
			last.Text = in.text
			last.Path = in.path
			last.Name = in.name
			last.MIME = in.mime
			last.Kind = in.kind
			last.CreatedAt = in.at
			if err := clipStore.save(); err != nil {
				logf("clip add(replace): %v", err)
			}
			return `{"ok":true}`, true
		}
	}
	return "", false
}

// append 收下这条：进表 + 落盘。
func (in *clipIn) append() string {
	c := &Clip{
		ID:        newID(),
		Kind:      in.kind,
		Text:      in.text,
		Path:      in.path,
		Name:      in.name,
		MIME:      in.mime,
		App:       in.app,
		CreatedAt: in.at,
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
