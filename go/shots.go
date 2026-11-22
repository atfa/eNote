package main

// 截图捕获（P11）：Java 侧扫描监控文件夹、把新图复制进 inbox/，再通过 nativeShotAdd
// 交给这里。和剪贴板暂存（clip.go）是同一套思路 —— 先屯着，用户在首页看到提示条，
// 进去多选，一次性导入成笔记（合并成一条 / 各存一条 / 原样存）。
//
// 分工说明：OCR 只能由 Java 侧做（ML Kit），所以"导入"这个动作由 Java 触发
// （Android.importShots），这里只负责暂存、去重、忽略表和文件的生命周期。

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Shot is one screenshot waiting in the staging area.
type Shot struct {
	ID        string    `json:"id"`
	Path      string    `json:"path"` // 私有目录里的副本（不是 MediaStore 的 URI）
	Name      string    `json:"name"`
	MIME      string    `json:"mime,omitempty"`
	Size      int64     `json:"size,omitempty"`
	DateAdded int64     `json:"dateAdded,omitempty"` // MediaStore 的 DATE_ADDED（秒）
	CreatedAt time.Time `json:"createdAt"`
}

type ShotStore struct {
	mu    sync.Mutex
	path  string
	Shots []*Shot `json:"shots"`
	// Ignored 是"永远别再提醒"的表，键是 name|size（没有 sha1 时够用，改了名换了大小
	// 就当新图处理 —— 宁可多问一次，也不要漏掉用户真的想收的图）。
	Ignored []string `json:"ignored,omitempty"`
}

var shotStore *ShotStore

const (
	shotKeepMax   = 200 // 暂存区硬上限：超过就丢最老的（并删文件）
	shotIgnoreMax = 1000
	maxShotBytes  = 64 << 20 // 单张 64MB 以上不当截图处理
)

func openShotStore(dir string) (*ShotStore, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &ShotStore{path: filepath.Join(dir, "shot.json")}
	if b, err := os.ReadFile(s.path); err == nil && len(b) > 0 {
		if err := json.Unmarshal(b, s); err != nil {
			_ = os.Rename(s.path, s.path+".bad-"+time.Now().Format("20060102-150405"))
			s.Shots, s.Ignored = nil, nil
			logf("shot: corrupt %s moved aside", s.path)
		}
	}
	// 文件被用户在系统里删掉了（或者清理工具动了）→ 记录跟着消失，别给用户一个坏入口
	live := make([]*Shot, 0, len(s.Shots))
	for _, sh := range s.Shots {
		if sh == nil || sh.Path == "" {
			continue
		}
		if st, err := os.Stat(sh.Path); err != nil || st.IsDir() {
			logf("shot: drop %s (%s 不存在)", sh.Name, sh.Path)
			continue
		}
		live = append(live, sh)
	}
	s.Shots = live
	return s, nil
}

func (s *ShotStore) save() error {
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

func (s *ShotStore) snapshot() []*Shot {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Shot, 0, len(s.Shots))
	for _, x := range s.Shots {
		cp := *x
		out = append(out, &cp)
	}
	// 时间升序：合并成一条笔记时，附件顺序 = 截图先后顺序
	sort.Slice(out, func(i, j int) bool {
		if out[i].DateAdded != out[j].DateAdded {
			return out[i].DateAdded < out[j].DateAdded
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out
}

func (s *ShotStore) ignoredKey(name string, size int64) string {
	return strings.ToLower(strings.TrimSpace(name)) + "|" + strconv.FormatInt(size, 10)
}

func (s *ShotStore) isIgnored(name string, size int64) bool {
	want := s.ignoredKey(name, size)
	for _, k := range s.Ignored {
		if k == want {
			return true
		}
	}
	return false
}

// addShots 把 Java 扫到的图收进暂存区。返回 (新增, 被忽略的路径, 重复的路径)。
// 忽略/重复的路径要让 Java 把刚复制过来的副本删掉，否则 inbox 里会留垃圾。
func (s *ShotStore) add(shots []Shot) (int, []string, []string) {
	if len(shots) == 0 {
		return 0, nil, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	byPath := map[string]*Shot{}
	for _, x := range s.Shots {
		byPath[x.Path] = x
	}
	added := 0
	var skipped, dupes []string
	for _, in := range shots {
		if in.Path == "" {
			continue
		}
		if st, err := os.Stat(in.Path); err != nil || st.IsDir() || st.Size() == 0 {
			logf("shot add: 跳过 %s（文件不存在或为空）", in.Path)
			dupes = append(dupes, in.Path)
			continue
		}
		if in.Size == 0 {
			if st, err := os.Stat(in.Path); err == nil {
				in.Size = st.Size()
			}
		}
		if in.Size > maxShotBytes {
			logf("shot add: 跳过 %s（%d 字节，太大）", in.Name, in.Size)
			dupes = append(dupes, in.Path)
			continue
		}
		if s.isIgnored(in.Name, in.Size) {
			logf("shot add: %s 在忽略表里", in.Name)
			skipped = append(skipped, in.Path)
			continue
		}
		if _, ok := byPath[in.Path]; ok {
			dupes = append(dupes, in.Path)
			continue
		}
		in.ID = newID()
		if in.CreatedAt.IsZero() {
			in.CreatedAt = time.Now()
		}
		if in.Name == "" {
			in.Name = filepath.Base(in.Path)
		}
		x := in
		s.Shots = append(s.Shots, &x)
		byPath[in.Path] = &x
		added++
	}
	// 硬上限：丢最老的（连文件一起删，否则暂存只剩 record 没有实际意义）
	if len(s.Shots) > shotKeepMax {
		s.sortNewest()
		for _, old := range s.Shots[shotKeepMax:] {
			_ = os.Remove(old.Path)
			logf("shot add: 超过上限，丢掉最老的 %s", old.Name)
		}
		s.Shots = s.Shots[:shotKeepMax]
	}
	if err := s.save(); err != nil {
		logf("shot: save failed %v", err)
	}
	logf("shot add: 新增 %d，忽略 %d，重复 %d，当前 %d", added, len(skipped), len(dupes), len(s.Shots))
	return added, skipped, dupes
}

// sortNewest 把最新的排前面（配合上限裁剪）。
func (s *ShotStore) sortNewest() {
	sort.Slice(s.Shots, func(i, j int) bool {
		if s.Shots[i].DateAdded != s.Shots[j].DateAdded {
			return s.Shots[i].DateAdded > s.Shots[j].DateAdded
		}
		return s.Shots[i].CreatedAt.After(s.Shots[j].CreatedAt)
	})
}

func (s *ShotStore) remove(ids []string) int {
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := make([]*Shot, 0, len(s.Shots))
	n := 0
	for _, x := range s.Shots {
		if want[x.ID] {
			_ = os.Remove(x.Path)
			n++
			continue
		}
		kept = append(kept, x)
	}
	s.Shots = kept
	if err := s.save(); err != nil {
		logf("shot: save failed %v", err)
	}
	logf("shot remove: %d 条", n)
	return n
}

func (s *ShotStore) ignore(ids []string) int {
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := make([]*Shot, 0, len(s.Shots))
	n := 0
	for _, x := range s.Shots {
		if want[x.ID] {
			key := s.ignoredKey(x.Name, x.Size)
			if !s.isIgnored(x.Name, x.Size) {
				s.Ignored = append(s.Ignored, key)
			}
			if len(s.Ignored) > shotIgnoreMax {
				s.Ignored = s.Ignored[len(s.Ignored)-shotIgnoreMax:]
			}
			_ = os.Remove(x.Path)
			n++
			continue
		}
		kept = append(kept, x)
	}
	s.Shots = kept
	if err := s.save(); err != nil {
		logf("shot: save failed %v", err)
	}
	logf("shot ignore: %d 条，忽略表 %d", n, len(s.Ignored))
	return n
}

func (s *ShotStore) get(id string) *Shot {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, x := range s.Shots {
		if x.ID == id {
			cp := *x
			return &cp
		}
	}
	return nil
}

func (s *ShotStore) bytes() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	var total int64
	for _, x := range s.Shots {
		total += x.Size
	}
	return total
}

// shotCount 给常驻通知/指标用。
func shotCount() int {
	if shotStore == nil {
		return 0
	}
	shotStore.mu.Lock()
	defer shotStore.mu.Unlock()
	return len(shotStore.Shots)
}

// shotAddJSON 是 nativeShotAdd 的实现：{"shots":[{path,name,mime,size,dateAdded}]}
// 返回 {"ok":true,"added":N,"skipped":[…],"dupes":[…]}。
func shotAddJSON(payload string) string {
	var in struct {
		Shots []Shot `json:"shots"`
	}
	if err := json.Unmarshal([]byte(payload), &in); err != nil {
		return `{"ok":false,"error":"payload 解析失败"}`
	}
	if shotStore == nil {
		return `{"ok":false,"error":"shot store 未初始化"}`
	}
	added, skipped, dupes := shotStore.add(in.Shots)
	if skipped == nil {
		skipped = []string{}
	}
	if dupes == nil {
		dupes = []string{}
	}
	b, _ := json.Marshal(map[string]any{
		"ok": true, "added": added, "skipped": skipped, "dupes": dupes,
	})
	return string(b)
}

// ---------------------------------------------------------------- HTTP

func handleShotsList(w http.ResponseWriter, r *http.Request) {
	if shotStore == nil {
		jsonOut(w, map[string]any{"ok": false, "error": "shot store 未初始化"})
		return
	}
	shots := shotStore.snapshot()
	jsonOut(w, map[string]any{
		"ok":    true,
		"shots": shots,
		"total": len(shots),
		"bytes": shotStore.bytes(),
	})
}

func handleShotsAdd(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Shots []Shot `json:"shots"`
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if len(body.Shots) == 0 {
		jsonOut(w, map[string]any{"ok": false, "error": "没有截图"})
		return
	}
	added, skipped, dupes := shotStore.add(body.Shots)
	jsonOut(w, map[string]any{"ok": true, "added": added,
		"skipped": skipped, "dupes": dupes})
}

func handleShotsRemove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOut(w, map[string]any{"ok": true, "removed": shotStore.remove(body.IDs)})
}

func handleShotsIgnore(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := readBody(r, &body); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOut(w, map[string]any{"ok": true, "ignored": shotStore.ignore(body.IDs)})
}

// handleShotImg 供截图页的缩略图（暂存图还不是笔记附件，/img 走不了）。
func handleShotImg(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if shotStore == nil || id == "" {
		http.NotFound(w, r)
		return
	}
	sh := shotStore.get(id)
	if sh == nil {
		http.NotFound(w, r)
		return
	}
	// 只发 inbox 里的真实文件，防止有人拿 id 拼路径
	clean := filepath.Clean(sh.Path)
	if !strings.HasPrefix(clean, filepath.Clean(inboxDir)+string(os.PathSeparator)) {
		logf("shotimg: 拒绝越权路径 %s", sh.Path)
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, clean)
}
