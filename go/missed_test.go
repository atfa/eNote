package main

import (
	"os"
	"testing"
	"time"
)

// 「打开时补看错过的提醒」：只挑上次打开之后、现在之前到点、且没完成的待办。
// 这是厂商后台冻结的唯一补救手段，所以边界必须测死：
//   - 上次打开之前就到点的（用户当时见过）不算
//   - 还没到点的（未来的）不算
//   - 已完成的不算
func TestMissedTodosWindow(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatalf("openStore: %v", err)
	}
	old := store
	store = s
	defer func() { store = old }()

	now := time.Date(2026, 11, 22, 9, 0, 0, 0, time.Local)
	since := now.Add(-3 * time.Hour) // 06:00
	at := func(h, m int) string {
		return time.Date(2026, 11, 22, h, m, 0, 0, time.Local).Format("2006-01-02T15:04")
	}

	store.add(&Note{ID: "n1", Title: "错过提醒测试", Content: "x", Todos: []Todo{
		{ID: "t1", Text: "07:00 到点（该补看）", Due: at(7, 0)},
		{ID: "t2", Text: "05:00 到点（上次已见过）", Due: at(5, 0)},
		{ID: "t3", Text: "10:00 还没到（不该提醒）", Due: at(10, 0)},
		{ID: "t4", Text: "08:00 已完成", Due: at(8, 0), Done: true},
		{ID: "t5", Text: "没有日期"},
		{ID: "t6", Text: "08:30 也到点了", Due: at(8, 30)},
	}})

	got := missedTodos(since, now, 20)
	want := []string{"07:00 到点（该补看）", "08:30 也到点了"}
	if len(got) != len(want) {
		t.Fatalf("want %d missed todos, got %d: %v", len(want), len(got), got)
	}
	for i, w := range want {
		if got[i]["text"] != w {
			t.Fatalf("item %d: want %q, got %v（要按到点时间正序）", i, w, got[i]["text"])
		}
		if got[i]["id"] == "" || got[i]["noteId"] == "" {
			t.Fatalf("每一条都要带 id 和 noteId，UI 才能跳过去：%v", got[i])
		}
	}

	// 零值 since（第一次打开）不该把历史待办全倒出来
	if n := len(missedTodos(time.Time{}, now, 20)); n != 0 {
		t.Fatalf("首次打开不该补看历史提醒，got %d", n)
	}
	// since == now 也不该有
	if n := len(missedTodos(now, now, 20)); n != 0 {
		t.Fatalf("窗口为空时不该有提醒，got %d", n)
	}
	// limit 生效但总数能单独算出来（UI 上要显示「还有更多」）
	if n := len(missedTodos(since, now, 1)); n != 1 {
		t.Fatalf("limit=1 应该只返回 1 条，got %d", n)
	}
}

// lastopen 文件的读写：读不到 / 坏内容都当成「没记录」，不能让补看功能把 app 卡住。
func TestLastOpenFile(t *testing.T) {
	dir := t.TempDir()
	old := logDir
	logDir = dir
	defer func() { logDir = old }()

	if !readLastOpen().IsZero() {
		t.Fatal("没有文件时应该是零值")
	}
	now := time.Date(2026, 11, 22, 9, 0, 0, 0, time.Local)
	writeLastOpen(now)
	if got := readLastOpen(); !got.Equal(now) {
		t.Fatalf("round trip: want %s, got %s", now, got)
	}
	// 坏内容当没记录
	if err := os.WriteFile(missedPath(), []byte("not a time"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !readLastOpen().IsZero() {
		t.Fatal("坏内容应该当成没记录")
	}
}
