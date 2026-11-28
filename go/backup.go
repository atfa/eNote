package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// ---------------------------------------------------------------------------
// /api/import + /api/clear - the 数据 section of the settings panel.
//
// Import merges by note id: a note that already exists locally is left alone, so
// restoring an old backup never overwrites newer edits. JSON preserves
// attachment metadata. The attachment files live separately in the app inbox.
// ---------------------------------------------------------------------------

type importRes struct {
	OK       bool   `json:"ok"`
	Imported int    `json:"imported"`
	Skipped  int    `json:"skipped"`
	Invalid  int    `json:"invalid"`
	Total    int    `json:"total"`
	Error    string `json:"error,omitempty"`
}

func importNotes(b []byte) importRes {
	b = trimJSON(b)
	if len(b) == 0 {
		return importRes{OK: false, Error: "文件是空的"}
	}
	var list []*Note
	if b[0] == '[' {
		if err := json.Unmarshal(b, &list); err != nil {
			return importRes{OK: false, Error: "不是合法的笔记 JSON：" + err.Error()}
		}
	} else if b[0] == '{' && bytes.Contains(b, []byte(`"notes"`)) {
		// 导出文件是 {"notes":[...]} 信封，导回来得能直接吃
		var env struct {
			Notes []*Note `json:"notes"`
		}
		if err := json.Unmarshal(b, &env); err != nil {
			return importRes{OK: false, Error: "不是合法的笔记 JSON：" + err.Error()}
		}
		list = env.Notes
	} else { // a single note object
		var one Note
		if err := json.Unmarshal(b, &one); err != nil {
			return importRes{OK: false, Error: "不是合法的笔记 JSON：" + err.Error()}
		}
		list = []*Note{&one}
	}
	if len(list) == 0 {
		return importRes{OK: false, Error: "此备份没有笔记"}
	}
	return store.restoreNotes(list)
}

func (s *Store) restoreNotes(list []*Note) importRes {
	res := importRes{OK: true, Total: len(list)}
	s.mu.Lock()
	defer s.mu.Unlock()
	seen := make(map[string]bool, len(s.Notes))
	for _, n := range s.Notes {
		seen[n.ID] = true
	}
	inbox := filepath.Join(filepath.Dir(s.path), "inbox")
	var additions []*Note
	for _, n := range list {
		if n == nil || n.ID == "" || (n.Content == "" && n.RawText == "" && n.Title == "" &&
			n.Description == "" && len(n.Attachments) == 0 && len(n.Todos) == 0 && n.ImagePath == "") {
			res.Invalid++
			continue
		}
		if seen[n.ID] {
			res.Skipped++
			continue
		}
		if n.CreatedAt.IsZero() {
			n.CreatedAt = time.Now()
		}
		if n.UpdatedAt.IsZero() {
			n.UpdatedAt = n.CreatedAt
		}
		if n.Status == "" {
			n.Status = stDone
		}
		restoreAttachmentMetadata(n, inbox)
		sortTodos(n.Todos)
		seen[n.ID] = true
		additions = append(additions, n)
	}
	if len(additions) == 0 {
		return res
	}
	previous := s.Notes
	s.Notes = append(s.Notes, additions...)
	if err := s.save(); err != nil {
		s.Notes = previous
		logf("store restore: %v", err)
		return importRes{OK: false, Error: "无法保存导入的笔记"}
	}
	res.Imported = len(additions)
	return res
}

func restoreAttachmentMetadata(n *Note, inbox string) {
	image := n.ImagePath
	n.ImagePath = restoredAttachmentPath(image, inbox)
	if image != "" && n.ImagePath == "" {
		found := false
		for _, a := range n.Attachments {
			if a.Path == image {
				found = true
				break
			}
		}
		if !found {
			name := firstNonEmpty(n.ImageName, filepath.Base(image))
			attachTo(n, Attachment{ID: newID(), NoteID: n.ID, Name: name, MIME: mimeForName(name),
				Source: n.Source, Role: attachmentOriginal, CreatedAt: n.CreatedAt})
		}
	}
	for i := range n.Attachments {
		a := &n.Attachments[i]
		a.Path = restoredAttachmentPath(a.Path, inbox)
	}
	migrateNoteMetadata(n)
}

func restoredAttachmentPath(path, inbox string) string {
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) || filepath.Dir(clean) != inbox {
		return ""
	}
	if info, err := os.Lstat(clean); err == nil && info.Mode().IsRegular() {
		return clean
	}
	return ""
}

// trimJSON strips a UTF-8 BOM and surrounding whitespace, which is what a file saved
// from a Windows text editor looks like.
func trimJSON(b []byte) []byte {
	return bytes.TrimSpace(bytes.TrimPrefix(bytes.TrimSpace(b), []byte("\xef\xbb\xbf")))
}

func handleExport(w http.ResponseWriter, r *http.Request) {
	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		http.Error(w, "无法生成备份文件名", http.StatusInternalServerError)
		return
	}
	data, err := json.MarshalIndent(store.snapshot(), "", "  ")
	if err != nil {
		http.Error(w, "无法生成备份", http.StatusInternalServerError)
		return
	}
	now := time.Now()
	name := fmt.Sprintf("enote-backup-%s-%03d-%x.json", now.Format("20060102-150405"), now.Nanosecond()/1e6, suffix)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Write(data)
}

func handleImport(w http.ResponseWriter, r *http.Request) {
	const max = 64 << 20
	b, err := readAll(r, max+1)
	if err != nil {
		jsonOut(w, importRes{OK: false, Error: err.Error()})
		return
	}
	if len(b) > max {
		jsonOut(w, importRes{OK: false, Error: "备份文件超过 64 MB"})
		return
	}
	jsonOut(w, importNotes(b))
}

// clearAll deletes every note and the files it owns; settings (incl. the API key) stay.
func clearAll() (int, int) {
	ids := []string{}
	for _, n := range store.snapshot() {
		ids = append(ids, n.ID)
	}
	n := 0
	for _, id := range ids {
		if store.remove(id) {
			n++
		}
	}
	return n, len(ids)
}

func handleClear(w http.ResponseWriter, r *http.Request) {
	n, want := clearAll()
	jsonOut(w, map[string]any{"ok": n == want, "deleted": n})
}
