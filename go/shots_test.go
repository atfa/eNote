package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// newShotFixture 造一个独立的 shot store + 若干真实文件（Go 侧只收已存在的文件）。
func newShotFixture(t *testing.T, n int) (*ShotStore, []Shot) {
	t.Helper()
	dir := t.TempDir()
	s, err := openShotStore(dir)
	if err != nil {
		t.Fatalf("openShotStore: %v", err)
	}
	old := shotStore
	shotStore = s
	t.Cleanup(func() { shotStore = old })
	inbox := filepath.Join(dir, "inbox")
	if err := os.MkdirAll(inbox, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	shots := make([]Shot, 0, n)
	for i := 0; i < n; i++ {
		name := "shot-" + string(rune('a'+i%26)) + itoaTest(i) + ".png"
		path := filepath.Join(inbox, name)
		if err := os.WriteFile(path, []byte("png-bytes-"+itoaTest(i)), 0o600); err != nil {
			t.Fatalf("write: %v", err)
		}
		shots = append(shots, Shot{
			Path:      path,
			Name:      name,
			MIME:      "image/png",
			Size:      0, // 让 store 自己去 stat
			DateAdded: int64(1795300000 + i),
		})
	}
	return s, shots
}

// 测试里没有 strconv，用一个足够用的小工具（只在 _test.go 里）。
func itoaTest(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// 同一个文件被重复上报（改名/重复入库/两次扫描撞车）只能留一条。
func TestShotAddDedup(t *testing.T) {
	s, shots := newShotFixture(t, 1)
	added, skipped, dupes := s.add(shots)
	if added != 1 || len(skipped) != 0 || len(dupes) != 0 {
		t.Fatalf("first add: added=%d skipped=%v dupes=%v", added, skipped, dupes)
	}
	added, _, dupes = s.add(shots)
	if added != 0 || len(dupes) != 1 {
		t.Fatalf("repeat add must be a dupe: added=%d dupes=%v", added, dupes)
	}
	if len(s.snapshot()) != 1 {
		t.Fatalf("want 1 staged shot, got %d", len(s.snapshot()))
	}
}

// 忽略是永久的：同名同大小的图以后再上来，直接跳过并让 Java 删掉刚复制的副本。
func TestShotIgnoreIsPermanent(t *testing.T) {
	s, shots := newShotFixture(t, 1)
	if added, _, _ := s.add(shots); added != 1 {
		t.Fatalf("want 1 added")
	}
	if n := s.ignore([]string{s.snapshot()[0].ID}); n != 1 {
		t.Fatalf("ignore: %d", n)
	}
	if _, err := os.Stat(shots[0].Path); !os.IsNotExist(err) {
		t.Fatalf("忽略后该把副本删掉, stat err=%v", err)
	}
	// 同一张图（同名同大小）再次上报
	if err := os.WriteFile(shots[0].Path, []byte("png-bytes-0"), 0o600); err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	added, skipped, _ := s.add(shots)
	if added != 0 || len(skipped) != 1 {
		t.Fatalf("忽略表没生效: added=%d skipped=%v", added, skipped)
	}
	if len(s.snapshot()) != 0 {
		t.Fatalf("忽略的图不该回到暂存区")
	}
}

// 不存在的文件（用户一边扫一边删）不能进暂存区，否则界面上是个坏图。
func TestShotAddSkipsMissingFiles(t *testing.T) {
	s, shots := newShotFixture(t, 1)
	os.Remove(shots[0].Path)
	added, _, dupes := s.add(shots)
	if added != 0 || len(dupes) != 1 {
		t.Fatalf("missing file: added=%d dupes=%v", added, dupes)
	}
}

// 硬上限：超过 shotKeepMax 丢最老的，并把文件删掉（不能只留 record）。
func TestShotCapDropsOldest(t *testing.T) {
	s, _ := newShotFixture(t, 0)
	dir := filepath.Join(t.TempDir(), "many")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	var batch []Shot
	for i := 0; i < shotKeepMax+5; i++ {
		p := filepath.Join(dir, "s"+itoaTest(i)+".png")
		if err := os.WriteFile(p, []byte("x"+itoaTest(i)), 0o600); err != nil {
			t.Fatalf("write: %v", err)
		}
		batch = append(batch, Shot{Path: p, Name: "s" + itoaTest(i) + ".png",
			DateAdded: int64(1795300000 + i)})
	}
	s.add(batch)
	got := s.snapshot()
	if len(got) != shotKeepMax {
		t.Fatalf("want %d kept, got %d", shotKeepMax, len(got))
	}
	// 最老的 5 张应该被丢掉（文件也没了）
	for i := 0; i < 5; i++ {
		p := filepath.Join(dir, "s"+itoaTest(i)+".png")
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("被裁掉的文件还在: %s", p)
		}
	}
	if got[0].DateAdded > got[len(got)-1].DateAdded {
		t.Fatalf("暂存区该按时间升序, got %d > %d", got[0].DateAdded, got[len(got)-1].DateAdded)
	}
	if got[len(got)-1].DateAdded != int64(1795300000+shotKeepMax+4) {
		t.Fatalf("最新的那张该留下, got %d", got[len(got)-1].DateAdded)
	}
}

// remove 要连文件一起删，并且不碰没被点名的条目。
func TestShotRemoveKeepsOthers(t *testing.T) {
	s, shots := newShotFixture(t, 3)
	s.add(shots)
	snap := s.snapshot()
	if n := s.remove([]string{snap[1].ID}); n != 1 {
		t.Fatalf("remove: %d", n)
	}
	if len(s.snapshot()) != 2 {
		t.Fatalf("want 2 left")
	}
	if _, err := os.Stat(snap[1].Path); !os.IsNotExist(err) {
		t.Fatalf("remove 该删文件")
	}
	if _, err := os.Stat(snap[0].Path); err != nil {
		t.Fatalf("没被点名的文件不该删: %v", err)
	}
}

// nativeShotAdd 的返回必须带 skipped/dupes（Java 靠它删副本、记 seen），数组不能是 null。
func TestShotAddJSONShape(t *testing.T) {
	_, shots := newShotFixture(t, 1)
	out := shotAddJSON(`{"shots":[{"path":"", "name":"x"},{"path":"` + shots[0].Path + `","name":"ok.png"}]}`)
	var got struct {
		OK      bool     `json:"ok"`
		Added   int      `json:"added"`
		Skipped []string `json:"skipped"`
		Dupes   []string `json:"dupes"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("bad json %q: %v", out, err)
	}
	if !got.OK || got.Added != 1 {
		t.Fatalf("want ok with 1 added, got %s", out)
	}
	if got.Skipped == nil || got.Dupes == nil {
		t.Fatalf("skipped/dupes 必须是数组而不是 null: %s", out)
	}

	// 坏 payload 不能 panic
	if r := shotAddJSON(`not json`); r == "" {
		t.Fatalf("坏 payload 也该有返回")
	}
}

// 水位/时间戳是 Java 侧的事，但 Go 侧的排序必须稳定：合并笔记里附件顺序要跟截图先后一致。
func TestShotSnapshotOrdersByDateAdded(t *testing.T) {
	s, _ := newShotFixture(t, 0)
	dir := t.TempDir()
	var batch []Shot
	for _, d := range []int64{1795300100, 1795300000, 1795300050} {
		p := filepath.Join(dir, "x"+itoaTest(int(d-1795300000))+".png")
		os.WriteFile(p, []byte("b"), 0o600)
		batch = append(batch, Shot{Path: p, Name: filepath.Base(p), DateAdded: d,
			CreatedAt: time.Now()})
	}
	s.add(batch)
	got := s.snapshot()
	for i := 1; i < len(got); i++ {
		if got[i-1].DateAdded > got[i].DateAdded {
			t.Fatalf("排序不对: %v", []int64{got[0].DateAdded, got[1].DateAdded, got[2].DateAdded})
		}
	}
}

// 重启后记录还在（shot.json 落盘），但文件没了的条目要自己消失。
func TestShotStoreReopenDropsMissing(t *testing.T) {
	dir := t.TempDir()
	s, err := openShotStore(dir)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	inbox := filepath.Join(dir, "inbox")
	os.MkdirAll(inbox, 0o700)
	keep := filepath.Join(inbox, "keep.png")
	gone := filepath.Join(inbox, "gone.png")
	os.WriteFile(keep, []byte("k"), 0o600)
	os.WriteFile(gone, []byte("g"), 0o600)
	s.add([]Shot{{Path: keep, Name: "keep.png"}, {Path: gone, Name: "gone.png"}})
	if len(s.snapshot()) != 2 {
		t.Fatalf("want 2")
	}
	os.Remove(gone)
	s2, err := openShotStore(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	got := s2.snapshot()
	if len(got) != 1 || got[0].Name != "keep.png" {
		t.Fatalf("丢失文件的条目该被丢掉, got %+v", got)
	}
}

// 导入成笔记之后清理暂存，绝不能把笔记正在用的文件删掉。
// 踩过：导入成功 → UI 调 /api/shots/remove → 文件没了 → 笔记首页缩略图 404。
func TestShotRemoveKeepsNoteFiles(t *testing.T) {
	s, shots := newShotFixture(t, 2)
	if n, _, _ := s.add(shots); n != 2 {
		t.Fatalf("add: %d", n)
	}
	stored := s.snapshot()
	taken := stored[0].Path // 第一张已经被笔记接管
	other := stored[1].Path
	s.setKeep(func() map[string]bool { return map[string]bool{taken: true} })

	if n := s.remove([]string{stored[0].ID, stored[1].ID}); n != 2 {
		t.Fatalf("两条记录都该从暂存区移除, got %d", n)
	}
	if _, err := os.Stat(taken); err != nil {
		t.Fatalf("被笔记引用的文件不该被删: %v", err)
	}
	if _, err := os.Stat(other); !os.IsNotExist(err) {
		t.Fatalf("没人引用的文件该删掉, err=%v", err)
	}
	if len(s.Shots) != 0 {
		t.Fatalf("暂存区该空了, got %d", len(s.Shots))
	}
}

// ignore 和上限裁剪也一样：笔记在用就不能删。
func TestShotIgnoreAndCapKeepNoteFiles(t *testing.T) {
	s, shots := newShotFixture(t, 3)
	if n, _, _ := s.add(shots); n != 3 {
		t.Fatalf("add: %d", n)
	}
	first := s.snapshot()[0]
	s.setKeep(func() map[string]bool {
		return map[string]bool{first.Path: true}
	})
	s.ignore([]string{first.ID})
	if _, err := os.Stat(first.Path); err != nil {
		t.Fatalf("ignore 不该删被引用的文件: %v", err)
	}
	if !s.isIgnored(first.Name, first.Size) {
		t.Fatalf("ignored 表里该有它")
	}
}
