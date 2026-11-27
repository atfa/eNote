package main

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Search is server-side so the query state lives with the data (R3): every page
// (笔记 / 待办 / 附件) keeps its own remembered conditions in settings.ui.

// searchReq is one page's query state: the topbar search box, the sort button
// and the floating filter panel all end up here.
type searchReq struct {
	Tab     string            `json:"tab"` // notes | todos | files
	Q       string            `json:"q"`
	Sort    string            `json:"sort"`
	Dir     string            `json:"dir"` // asc | desc, empty = the sort's own default
	Filters map[string]string `json:"filters"`
	Limit   int               `json:"limit"`
}

// todoHit is one matching todo with the note it came from.
type todoHit struct {
	NoteID    string    `json:"noteId"`
	NoteTitle string    `json:"noteTitle"`
	NoteAt    time.Time `json:"noteAt"`
	Todo      Todo      `json:"todo"`
}

type searchRes struct {
	OK      bool                `json:"ok"`
	Tab     string              `json:"tab"`
	Notes   []*Note             `json:"notes"`
	Todos   []todoHit           `json:"todos,omitempty"`
	TodoIDs map[string]bool     `json:"todoIds,omitempty"` // noteID|todoID, for the grouped 待办 page
	Where   map[string][]string `json:"where,omitempty"`   // noteID -> matched fields
	Total   int                 `json:"total"`
	Scanned int                 `json:"scanned"`
}

// searchableFields splits a note into the fields we search, keyed by the label
// the UI shows when a hit comes from there. 图片文字 is called out explicitly
// because the user never typed it (R3).
func searchableFields(n *Note) [][2]string {
	todos := make([]string, 0, len(n.Todos))
	for _, t := range n.Todos {
		todos = append(todos, t.Text)
	}
	names := make([]string, 0, len(n.Attachments))
	for _, a := range n.Attachments {
		names = append(names, a.Name)
	}
	facts := make([]string, 0, len(n.Facts))
	for _, f := range n.Facts {
		facts = append(facts, f.Q+" "+f.A)
	}
	return [][2]string{
		{"标题", n.Title},
		{"正文", n.Content},
		{"说明", n.Description},
		{"关键信息", strings.Join(facts, " ")},
		{"待办", strings.Join(todos, " ")},
		{"标签", strings.Join(n.Tags, " ")},
		{"附件名", strings.Join(names, " ")},
		{"来自图片文字", n.OCRText},
		{"原始分享文字", n.RawText},
	}
}

// matchNote returns the labels of the fields that contain q (empty q matches
// everything) and whether the note passes the source/status filters.
/* 步骤 60：matchNote 原来 49 行，三个下拉筛选器和关键词命中挤在一个函数里，
   每条不匹配的路径都要写两值的 return。现在筛选归 notePassesFilters（单值 bool），
   关键词命中归 noteWhere，matchNote 只剩「先筛后搜」。语句逐字搬，
   只把筛选分支里的 return nil, false 换成 return false。 */

func matchNote(n *Note, q string, f map[string]string) ([]string, bool) {
	if !notePassesFilters(n, f) {
		return nil, false
	}
	if q == "" {
		return nil, true
	}
	return noteWhere(n, q)
}

// notePassesFilters 是三个下拉筛选器：来源（图片 / 文字）、有没有附件、状态。
// 空值 = 没筛，全过。
func notePassesFilters(n *Note, f map[string]string) bool {
	switch f["src"] {
	case "image":
		if !strings.HasSuffix(n.Source, "image") {
			return false
		}
	case "text":
		if strings.HasSuffix(n.Source, "image") {
			return false
		}
	}
	switch f["file"] {
	case "yes":
		if len(n.Attachments) == 0 {
			return false
		}
	case "no":
		if len(n.Attachments) > 0 {
			return false
		}
	}
	switch f["status"] {
	case "done":
		if n.Status != stDone {
			return false
		}
	case "raw":
		if n.Status != stRaw && n.Status != stQueued && n.Status != stParsing {
			return false
		}
	case "error":
		if n.Status != stError {
			return false
		}
	}
	return true
}

// noteWhere 返回命中关键词的字段名（界面按它画高亮）；一个都没命中就不算匹配。
func noteWhere(n *Note, q string) ([]string, bool) {
	var where []string
	for _, fl := range searchableFields(n) {
		if fl[1] == "" {
			continue
		}
		if strings.Contains(strings.ToLower(fl[1]), q) {
			where = append(where, fl[0])
		}
	}
	return where, len(where) > 0
}

func matchTodo(t Todo, q string, f map[string]string, noteText string) bool {
	switch f["done"] {
	case "open":
		if t.Done {
			return false
		}
	case "done":
		if !t.Done {
			return false
		}
	}
	switch f["pri"] {
	case "high", "normal", "low":
		if t.Priority != "" && t.Priority != f["pri"] {
			return false
		}
		if t.Priority == "" && f["pri"] != "normal" {
			return false
		}
	}
	if q == "" {
		return true
	}
	return strings.Contains(strings.ToLower(t.Text+" "+noteText), q)
}

func sortNotes(list []*Note, s, dir string) {
	less := func(i, j int) bool {
		switch s {
		case "title":
			return list[i].Title < list[j].Title
		case "old":
			return list[i].CreatedAt.Before(list[j].CreatedAt)
		default:
			return list[i].CreatedAt.After(list[j].CreatedAt)
		}
	}
	sort.SliceStable(list, less)
	if dir == "asc" && s == "new" || dir == "desc" && s == "old" {
		for i, j := 0, len(list)-1; i < j; i, j = i+1, j-1 {
			list[i], list[j] = list[j], list[i]
		}
	}
}

func sortTodoHits(list []todoHit, s string) {
	switch s {
	case "pri":
		rank := map[string]int{"high": 3, "normal": 2, "low": 1}
		sort.SliceStable(list, func(i, j int) bool {
			return rank[list[i].Todo.Priority] > rank[list[j].Todo.Priority]
		})
	case "new":
		sort.SliceStable(list, func(i, j int) bool {
			return list[i].NoteAt.After(list[j].NoteAt)
		})
	default: // due: soonest first, undated and done last
		sort.SliceStable(list, func(i, j int) bool {
			return dueKey(list[i].Todo) < dueKey(list[j].Todo)
		})
	}
}

// runSearch is the whole of R3: filter, match, sort, truncate.
func runSearch(req searchReq) searchRes {
	q := strings.ToLower(strings.TrimSpace(req.Q))
	f := req.Filters
	if f == nil {
		f = map[string]string{}
	}
	limit := req.Limit
	if req.Tab == "todos" && f["done"] == "" {
		f["done"] = "open" // the 待办 page shows open items by default
	}
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	all := store.snapshot()
	res := searchRes{OK: true, Tab: req.Tab, Where: map[string][]string{}, Scanned: len(all)}
	// 步骤 57：两条分支各 20 多行（待办页把每个待办单独拿出来匹配，笔记页整条笔记匹配），
	// 混在一个函数里读要在两种数据形状之间来回切。现在 runSearch 只做参数归一化 + 分流。
	if req.Tab == "todos" {
		return searchTodos(all, res, q, f, req, limit)
	}
	return searchNotes(all, res, q, f, req, limit)
}

// searchTodos 待办页：命中的是「某条笔记里的某个待办」，所以命中项带 NoteID / NoteTitle；
// 截断只截返回的列表，TodoIDs 给全量（UI 按日期分组要用整份）。
func searchTodos(all []*Note, res searchRes, q string, f map[string]string, req searchReq, limit int) searchRes {
	var hits []todoHit
	var ids map[string]bool
	for _, n := range all {
		text := n.Title + " " + n.Content + " " + n.Description
		for _, t := range n.Todos {
			if matchTodo(t, q, f, text) {
				if ids == nil {
					ids = map[string]bool{}
				}
				ids[n.ID+"|"+t.ID] = true
				hits = append(hits, todoHit{NoteID: n.ID, NoteTitle: n.Title, NoteAt: n.CreatedAt, Todo: t})
			}
		}
	}
	sortTodoHits(hits, req.Sort)
	res.Total = len(hits)
	if len(hits) > limit {
		hits = hits[:limit]
	}
	res.Todos = hits
	res.TodoIDs = ids // the UI groups todos by date, it needs the whole set
	res.Notes = all
	return res
}

// searchNotes 笔记页 / 附件页：整条笔记匹配，命中位置记进 res.Where（UI 拿它画高亮）。
func searchNotes(all []*Note, res searchRes, q string, f map[string]string, req searchReq, limit int) searchRes {
	var out []*Note
	for _, n := range all {
		if req.Tab == "files" && n.ImagePath == "" {
			continue
		}
		where, ok := matchNote(n, q, f)
		if !ok {
			continue
		}
		out = append(out, n)
		if len(where) > 0 {
			res.Where[n.ID] = where
		}
	}
	sortNotes(out, req.Sort, req.Dir)
	res.Total = len(out)
	if len(out) > limit {
		out = out[:limit]
	}
	res.Notes = out
	return res
}

// handleSearch answers GET /api/search?tab=&q=&sort=&dir=&src=&status=&done=&pri=&limit=
func handleSearch(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	req := searchReq{
		Tab:  qs.Get("tab"),
		Q:    qs.Get("q"),
		Sort: qs.Get("sort"),
		Dir:  qs.Get("dir"),
		Filters: map[string]string{
			"src":    qs.Get("src"),
			"status": qs.Get("status"),
			"done":   qs.Get("done"),
			"pri":    qs.Get("pri"),
			"file":   qs.Get("file"),
		},
	}
	if req.Tab == "" {
		req.Tab = "notes"
	}
	if n := qs.Get("limit"); n != "" {
		req.Limit, _ = strconv.Atoi(n)
	}
	jsonOut(w, runSearch(req))
}

// handlePrefs remembers one page's query state (R3: 每个页面记住自己的条件).
func handlePrefs(w http.ResponseWriter, r *http.Request) {
	var p ViewPrefs
	if err := readBody(r, &p); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	s := config.get()
	if s.UI == nil {
		s.UI = map[string]ViewPrefs{}
	}
	name := strings.TrimSpace(p.Tab)
	if name == "" {
		name = "notes"
	}
	s.UI[name] = p
	if err := config.set(s); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOut(w, map[string]any{"ok": true, "ui": s.UI})
}
