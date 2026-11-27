package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"
)

// ---------------------------------------------------------------------------
// /api/import + /api/clear - the 数据 section of the settings panel.
//
// Import merges by note id: a note that already exists locally is left alone, so
// restoring an old backup never overwrites newer edits. Files referenced by an
// imported note are kept as-is (they live in the same app-private dir), which is
// what makes export -> reinstall -> import work for images.
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
	res := importRes{OK: true}
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
	for _, n := range list {
		if n == nil || n.ID == "" || (n.Content == "" && n.RawText == "" && n.Title == "" && n.Description == "" && len(n.Attachments) == 0) {
			res.Invalid++
			continue
		}
		if store.get(n.ID) != nil {
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
		migrateNoteMetadata(n)
		sortTodos(n.Todos)
		store.add(n)
		res.Imported++
	}
	res.Total = len(list)
	if res.Imported == 0 && res.Skipped == 0 && res.Invalid == 0 {
		res.OK = false
		res.Error = "文件里没有笔记"
	}
	return res
}

// trimJSON strips a UTF-8 BOM and surrounding whitespace, which is what a file saved
// from a Windows text editor looks like.
func trimJSON(b []byte) []byte {
	i, j := 0, len(b)
	for i < j && (b[i] == ' ' || b[i] == '\n' || b[i] == '\r' || b[i] == '\t' || b[i] == 0xef) {
		i++
	}
	for j > i && (b[j-1] == ' ' || b[j-1] == '\n' || b[j-1] == '\r' || b[j-1] == '\t') {
		j--
	}
	return b[i:j]
}

func handleImport(w http.ResponseWriter, r *http.Request) {
	b, err := readAll(r, 64<<20)
	if err != nil {
		jsonOut(w, importRes{OK: false, Error: err.Error()})
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
