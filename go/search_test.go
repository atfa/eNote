package main

import (
	"testing"
	"time"
)

// testStore points the package-level store at a temp dir and fills it.
func testStore(t *testing.T, notes ...*Note) {
	t.Helper()
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range notes {
		s.add(n)
	}
	store = s
}

func note(id, title, content, ocr, source, status string, mins int, todos ...Todo) *Note {
	t0 := time.Now().Add(-time.Duration(mins) * time.Minute)
	return &Note{ID: id, Title: title, Content: content, RawText: content,
		OCRText: ocr, Source: source, Status: status, Todos: todos,
		Tags: []string{"工作"}, CreatedAt: t0, UpdatedAt: t0}
}

func TestSearchQueryMatchesEveryField(t *testing.T) {
	testStore(t,
		note("a", "周会安排", "下午三点评审原型", "", "share-text", stDone, 30,
			Todo{ID: "t1", Text: "买牛奶和鸡蛋", Due: "2026-01-01T15:00", Priority: "high"}),
		note("b", "购物清单", "周五下班后取快递", "识别自图片：晚上八点周会", "share-image", stRaw, 10),
	)

	cases := []struct {
		q     string
		want  []string // default sort is newest-first
		where string   // note id whose match labels must contain 来自图片文字
	}{
		{"周会", []string{"b", "a"}, ""},
		{"牛奶", []string{"a"}, ""},      // matched inside a todo
		{"识别自图片", []string{"b"}, "b"},  // matched inside OCR text only
		{"工作", []string{"b", "a"}, ""}, // matched inside a tag
		{"没有这个词", nil, ""},
	}
	for _, c := range cases {
		res := runSearch(searchReq{Tab: "notes", Q: c.q})
		if len(res.Notes) != len(c.want) {
			t.Fatalf("q=%q got %d notes, want %d", c.q, len(res.Notes), len(c.want))
		}
		for i, n := range res.Notes {
			if n.ID != c.want[i] {
				t.Fatalf("q=%q order: got %s want %s", c.q, n.ID, c.want[i])
			}
		}
		if c.where != "" {
			labels := res.Where[c.where]
			if !contains(labels, "来自图片文字") {
				t.Fatalf("q=%q expected 来自图片文字 label, got %v", c.q, labels)
			}
		}
	}
}

func TestSearchFiltersAndSort(t *testing.T) {
	testStore(t,
		note("a", "甲", "x", "", "share-text", stDone, 30),
		note("b", "乙", "y", "img", "share-image", stRaw, 20),
		note("c", "丙", "z", "", "share-text", stError, 10),
	)

	if got := runSearch(searchReq{Tab: "notes", Filters: map[string]string{"src": "image"}}); got.Total != 1 {
		t.Fatalf("src=image: got %d, want 1", got.Total)
	}
	if got := runSearch(searchReq{Tab: "notes", Filters: map[string]string{"status": "done"}}); got.Total != 1 {
		t.Fatalf("status=done: got %d, want 1", got.Total)
	}
	if got := runSearch(searchReq{Tab: "notes", Filters: map[string]string{"status": "raw"}}); got.Total != 1 {
		t.Fatalf("status=raw: got %d, want 1", got.Total)
	}

	newest := runSearch(searchReq{Tab: "notes", Sort: "new"})
	if newest.Notes[0].ID != "c" {
		t.Fatalf("sort=new: first is %s, want c", newest.Notes[0].ID)
	}
	oldest := runSearch(searchReq{Tab: "notes", Sort: "old"})
	if oldest.Notes[0].ID != "a" {
		t.Fatalf("sort=old: first is %s, want a", oldest.Notes[0].ID)
	}
	byTitle := runSearch(searchReq{Tab: "notes", Sort: "title"})
	// title sort is a plain codepoint compare: 丙 < 乙 < 甲
	if byTitle.Notes[0].ID != "c" || byTitle.Notes[2].ID != "a" {
		t.Fatalf("sort=title: %s..%s", byTitle.Notes[0].ID, byTitle.Notes[2].ID)
	}
	flipped := runSearch(searchReq{Tab: "notes", Sort: "new", Dir: "asc"})
	if flipped.Notes[0].ID != "a" {
		t.Fatalf("dir=asc: first is %s, want a", flipped.Notes[0].ID)
	}
}

func TestSearchTodosFilters(t *testing.T) {
	testStore(t,
		note("a", "甲", "x", "", "share-text", stDone, 30,
			Todo{ID: "t1", Text: "取快递", Done: true, Priority: "low"},
			Todo{ID: "t2", Text: "写周报", Priority: "high", Due: "2026-01-02T09:00"},
			Todo{ID: "t3", Text: "买牛奶", Priority: "normal", Due: "2026-01-01T09:00"}),
	)

	if got := runSearch(searchReq{Tab: "todos"}); got.Total != 2 {
		t.Fatalf("open todos: got %d, want 2 (done items are filtered out)", got.Total)
	}
	if got := runSearch(searchReq{Tab: "todos", Filters: map[string]string{"done": "all"}}); got.Total != 3 {
		t.Fatalf("done=all: got %d, want 3", got.Total)
	}
	if got := runSearch(searchReq{Tab: "todos", Filters: map[string]string{"done": "done"}}); got.Total != 1 {
		t.Fatalf("done=done: got %d, want 1", got.Total)
	}
	if got := runSearch(searchReq{Tab: "todos", Filters: map[string]string{"pri": "high"}}); got.Total != 1 {
		t.Fatalf("pri=high: got %d, want 1", got.Total)
	}
	byDue := runSearch(searchReq{Tab: "todos"})
	if byDue.Todos[0].Todo.ID != "t3" {
		t.Fatalf("sort=due: first is %s, want t3 (earliest due)", byDue.Todos[0].Todo.ID)
	}
	byPri := runSearch(searchReq{Tab: "todos", Sort: "pri", Filters: map[string]string{"done": "all"}})
	if byPri.Todos[0].Todo.ID != "t2" {
		t.Fatalf("sort=pri: first is %s, want t2", byPri.Todos[0].Todo.ID)
	}
	if got := runSearch(searchReq{Tab: "todos", Q: "牛奶"}); got.Total != 1 {
		t.Fatalf("q=牛奶: got %d, want 1", got.Total)
	}
}

func TestSearchLimitAndFilesTab(t *testing.T) {
	testStore(t,
		note("a", "甲", "x", "", "share-text", stDone, 30),
		note("b", "乙", "y", "", "share-image", stDone, 20),
	)
	withImg := store.get("b")
	store.update("b", func(n *Note) { n.ImagePath = "inbox/b.png"; n.ImageName = "b.png" })
	if withImg == nil {
		t.Fatal("note b missing")
	}
	if got := runSearch(searchReq{Tab: "files"}); got.Total != 1 || got.Notes[0].ID != "b" {
		t.Fatalf("files tab: got %d, want only b", got.Total)
	}
	if got := runSearch(searchReq{Tab: "notes", Limit: 1}); got.Total != 2 || len(got.Notes) != 1 {
		t.Fatalf("limit: total=%d len=%d, want 2/1", got.Total, len(got.Notes))
	}
}
