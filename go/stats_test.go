package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestStatsCountsMatchStore(t *testing.T) {
	testStore(t,
		note("a", "周会", "下午三点评审原型", "", "share-text", stDone, 60,
			Todo{ID: "t1", Text: "买牛奶", Due: "2020-01-01T15:00", Priority: "high"},
			Todo{ID: "t2", Text: "取快递", Done: true, DoneAt: time.Now().Format("2006-01-02T15:04")},
			Todo{ID: "t3", Text: "今天开会", Due: time.Now().Format("2006-01-02") + "T23:00"}),
		note("b", "购物", "周五取快递", "", "share-image", stRaw, 30),
		note("c", "坏了", "解析失败", "", "manual-text", stError, 5),
	)
	s := stats()
	if s.Notes["total"] != 3 || s.Notes["done"] != 1 || s.Notes["raw"] != 1 || s.Notes["error"] != 1 {
		t.Fatalf("note buckets: %+v", s.Notes)
	}
	if s.Todos["total"] != 3 || s.Todos["open"] != 2 || s.Todos["done"] != 1 {
		t.Fatalf("todo buckets: %+v", s.Todos)
	}
	if s.Todos["overdue"] != 1 || s.Todos["high"] != 1 || s.Todos["dueToday"] != 1 {
		t.Fatalf("todo buckets: %+v", s.Todos)
	}
	if s.Sources["share-text"] != 1 || s.Sources["share-image"] != 1 {
		t.Fatalf("sources: %+v", s.Sources)
	}
	// the 7-day chart is oldest first and the last bucket is today
	if len(s.Days) != 7 {
		t.Fatalf("want 7 days, got %d", len(s.Days))
	}
	last := s.Days[6]
	if last.Day != time.Now().Format("2006-01-02") || last.Label != "今天" {
		t.Fatalf("last day: %+v", last)
	}
	if last.Notes != 3 || last.Todos != 3 || last.Done != 1 {
		t.Fatalf("today bucket: %+v", last)
	}
	if s.Days[0].Label == "今天" || s.Days[5].Label != "昨天" || s.Days[6].Label != "今天" {
		t.Fatalf("labels: %+v", s.Days)
	}
	// every note carries the 工作 tag from the fixture
	if len(s.Tags) == 0 || s.Tags[0].Tag != "工作" || s.Tags[0].N != 3 {
		t.Fatalf("tags: %+v", s.Tags)
	}
}

func writeFile(t *testing.T, path string, n int) {
	t.Helper()
	if err := os.WriteFile(path, make([]byte, n), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestStatsAttachments(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir+"/a.png", 120)
	testStore(t, note("a", "带图", "正文", "", "share-image", stDone, 10))
	store.update("a", func(n *Note) {
		attachTo(n, Attachment{ID: "x1", NoteID: "a", Name: "a.png", MIME: "image/png",
			Size: 120, Path: dir + "/a.png", CreatedAt: time.Now()})
		attachTo(n, Attachment{ID: "x2", NoteID: "a", Name: "gone.pdf", MIME: "application/pdf",
			Size: 999, Path: dir + "/missing.pdf", CreatedAt: time.Now()})
	})
	s := stats()
	if iv(s.Attach["count"]) != 2 {
		t.Fatalf("count: %+v", s.Attach)
	}
	if i64v(s.Attach["bytes"]) != 1119 {
		t.Fatalf("bytes: %+v", s.Attach)
	}
	if iv(s.Attach["missing"]) != 1 {
		t.Fatalf("missing: %+v", s.Attach)
	}
	byk := s.Attach["byKind"].(map[string]int)
	if byk["image"] != 1 || byk["pdf"] != 1 {
		t.Fatalf("byKind: %+v", byk)
	}
}

func TestStatsEmptyStore(t *testing.T) {
	testStore(t)
	s := stats()
	if !s.OK || s.Notes["total"] != 0 || s.Todos["total"] != 0 {
		t.Fatalf("empty store: %+v", s)
	}
	if len(s.Days) != 7 || s.Days[6].Notes != 0 {
		t.Fatalf("days: %+v", s.Days)
	}
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"days"`) {
		t.Fatalf("json: %s", b)
	}
}

func TestImportMergesByID(t *testing.T) {
	testStore(t, note("a", "已有", "本地内容", "", "share-text", stDone, 10))
	b, _ := json.Marshal([]*Note{
		{ID: "a", Title: "远端覆盖", Content: "旧内容"},
		{ID: "b", Title: "新笔记", Content: "来自备份", Source: "share-text",
			Todos: []Todo{{ID: "t1", Text: "取快递"}}},
		{ID: "", Title: "没有 id"},
		{ID: "c", Title: "空笔记"},
	})
	res := importNotes(b)
	// "c" has a title, so it counts as a note; only the id-less entry is invalid
	if !res.OK || res.Imported != 2 || res.Skipped != 1 || res.Invalid != 1 || res.Total != 4 {
		t.Fatalf("import: %+v", res)
	}
	if n := store.get("a"); n.Title != "已有" {
		t.Fatalf("existing note was overwritten: %s", n.Title)
	}
	n := store.get("b")
	if n == nil || n.Status != stDone || len(n.Todos) != 1 || n.CreatedAt.IsZero() {
		t.Fatalf("imported note: %+v", n)
	}
}

func TestImportSingleNoteAndGarbage(t *testing.T) {
	testStore(t)
	one := importNotes([]byte(" {\"id\":\"z\",\"title\":\"单条\",\"content\":\"正文\"} "))
	if !one.OK || one.Imported != 1 {
		t.Fatalf("single note: %+v", one)
	}
	for _, bad := range []string{"", "   ", "not json", "[]"} {
		r := importNotes([]byte(bad))
		if r.OK {
			t.Fatalf("%q should fail: %+v", bad, r)
		}
	}
}

func TestClearAll(t *testing.T) {
	testStore(t, note("a", "一", "正文", "", "share-text", stDone, 10),
		note("b", "二", "正文", "", "share-text", stDone, 5))
	n, want := clearAll()
	if n != 2 || want != 2 || len(store.snapshot()) != 0 {
		t.Fatalf("clear: %d/%d", n, want)
	}
	n, _ = clearAll()
	if n != 0 {
		t.Fatalf("second clear deleted %d", n)
	}
}

func TestImportEnvelope(t *testing.T) {
	testStore(t)
	// 导出文件是 {"notes":[...]} 信封，必须能直接导回来
	env := []byte(`{"notes":[{"id":"a1","title":"T","content":"C","tags":["x"],"todos":[{"id":"t1","title":"买牛奶"}]}]}`)
	r := importNotes(env)
	if !r.OK || r.Imported != 1 || r.Invalid != 0 {
		t.Fatalf("envelope import = %+v", r)
	}
	if r2 := importNotes(env); r2.Skipped != 1 {
		t.Fatalf("re-import should skip, got %+v", r2)
	}
	// 裸数组和单条笔记也要继续支持
	if r3 := importNotes([]byte(`[{"id":"a2","title":"T2"}]`)); r3.Imported != 1 {
		t.Fatalf("array import = %+v", r3)
	}
	if r4 := importNotes([]byte(`{"id":"a3","title":"T3"}`)); r4.Imported != 1 {
		t.Fatalf("single import = %+v", r4)
	}
}

// R12: cleanFacts drops empty/duplicate entries and caps the list.
func TestCleanFacts(t *testing.T) {
	in := []Fact{{Q: "何时", A: "2026-11-19"}, {Q: "何时", A: "重复"}, {Q: "何人", A: "  "},
		{Q: " ", A: "无问题"}, {Q: "异常指标", A: "总胆固醇偏高"}}
	got := cleanFacts(in)
	if len(got) != 2 || got[0].Q != "何时" || got[0].A != "2026-11-19" || got[1].Q != "异常指标" {
		t.Fatalf("cleanFacts: %+v", got)
	}
	if cleanFacts([]Fact{{Q: "何时", A: ""}}) != nil {
		t.Fatal("empty facts must be nil so the card shows nothing")
	}
}
