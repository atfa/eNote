package main

// 截图捕获（P11）：Java 侧扫描监控文件夹、把新图复制进 inbox/，再通过 nativeShotAdd
// 交给这里。和剪贴板暂存（clip.go）是同一套思路 —— 先屯着，用户在首页看到提示条，
// 进去多选，一次性导入成笔记（合并成一条 / 各存一条 / 原样存）。
//
// 分工说明：OCR 只能由 Java 侧做（ML Kit），所以"导入"这个动作由 Java 触发
// （Android.importShots），这里只负责暂存、去重、忽略表和文件的生命周期。

import (
	"encoding/json"
	"fmt"
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

	// keepFn 报告"这些文件已经归笔记所有了"：暂存区可以丢记录，但绝不能删文件。
	// P11 上线后真实踩到过：导入成功后 UI 顺手清理暂存，把刚变成附件的那几张图一起删了，
	// 结果笔记首页的缩略图全是 404（文件没了，记录还指着它）。
	keepFn func() map[string]bool
}

// setKeep 由 appInit 注入：返回所有被笔记引用的文件路径。
func (s *ShotStore) setKeep(fn func() map[string]bool) { s.keepFn = fn }

// dropUnlessKept 只在没有笔记引用时删文件。
func (s *ShotStore) dropUnlessKept(keep map[string]bool, p string) {
	if p == "" {
		return
	}
	if keep[p] {
		logf("shot: 保留 %s（已有笔记在用）", filepath.Base(p))
		return
	}
	_ = os.Remove(p)
}

// referenced 取一次"被笔记引用的路径"快照（在拿 s.mu 之前调用，避免锁顺序问题）。
func (s *ShotStore) referenced() map[string]bool {
	if s.keepFn == nil {
		return nil
	}
	return s.keepFn()
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
			logf("shot: corrupt %s moved aside", moveAsideCorrupt(s.path))
			s.Shots, s.Ignored = nil, nil
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
	err := writeJSONAtomic(s.path, s)
	if err == nil {
		hub.broadcast("shots")
	}
	return err
}

func (s *ShotStore) snapshot() []*Shot {
	s.mu.Lock()
	defer s.mu.Unlock()
	// 时间升序：合并成一条笔记时，附件顺序 = 截图先后顺序
	return snapshotSorted(s.Shots, func(a, b *Shot) bool {
		if a.DateAdded != b.DateAdded {
			return a.DateAdded < b.DateAdded
		}
		return a.CreatedAt.Before(b.CreatedAt)
	})
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
/* 步骤 58：add 原来 68 行，一个循环里塞了六条准入检查（空路径、文件坏、太大、忽略表、
   路径重复），每条都要「打日志 → 记进 skipped/dupes → continue」，收下那张图的动作又跟在
   后面。现在判定归 verdict、收下归 accept、上限裁剪归 trimToKeepMax，add 只剩记账。
   条件与日志文案逐字搬，只把 logf 的文案交给调用方打。 */

// shotVerdict 是一张图进暂存区前的判定：kind 为 "silent" 空路径直接跳过（不记账不打日志），
// "skip" 在忽略表里（记 skipped，副本留着），"drop" 坏图/太大/路径重复（记 dupes，让 Java 删副本），
// 空串表示收下。reason 是日志文案，由 add 统一打。
type shotVerdict struct {
	kind   string
	reason string
}

// verdict 六条准入检查，顺序跟原来一模一样（Size 的补全必须在 isIgnored 之前）。
// 传指针是因为 in.Size 的补全会一路带进收下的记录里。
func (s *ShotStore) verdict(in *Shot, byPath map[string]*Shot) shotVerdict {
	if in.Path == "" {
		return shotVerdict{kind: "silent"}
	}
	if st, err := os.Stat(in.Path); err != nil || st.IsDir() || st.Size() == 0 {
		return shotVerdict{kind: "drop", reason: fmt.Sprintf("跳过 %s（文件不存在或为空）", in.Path)}
	}
	if in.Size == 0 {
		if st, err := os.Stat(in.Path); err == nil {
			in.Size = st.Size()
		}
	}
	if in.Size > maxShotBytes {
		return shotVerdict{kind: "drop", reason: fmt.Sprintf("跳过 %s（%d 字节，太大）", in.Name, in.Size)}
	}
	if s.isIgnored(in.Name, in.Size) {
		return shotVerdict{kind: "skip", reason: fmt.Sprintf("%s 在忽略表里", in.Name)}
	}
	if _, ok := byPath[in.Path]; ok {
		return shotVerdict{kind: "drop"}
	}
	return shotVerdict{}
}

// accept 收下这张图：补 id / 时间 / 文件名，进表与 byPath。
func (s *ShotStore) accept(in *Shot, byPath map[string]*Shot) {
	in.ID = newID()
	if in.CreatedAt.IsZero() {
		in.CreatedAt = time.Now()
	}
	if in.Name == "" {
		in.Name = filepath.Base(in.Path)
	}
	x := *in
	s.Shots = append(s.Shots, &x)
	byPath[in.Path] = &x
}

// trimToKeepMax 硬上限：丢最老的（连文件一起删，否则暂存只剩 record 没有实际意义）。
func (s *ShotStore) trimToKeepMax() {
	if len(s.Shots) > shotKeepMax {
		keep := s.referenced()
		s.sortNewest()
		for _, old := range s.Shots[shotKeepMax:] {
			s.dropUnlessKept(keep, old.Path)
			logf("shot add: 超过上限，丢掉最老的 %s", old.Name)
		}
		s.Shots = s.Shots[:shotKeepMax]
	}
}

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
		v := s.verdict(&in, byPath)
		if v.reason != "" {
			logf("shot add: %s", v.reason)
		}
		switch v.kind {
		case "silent":
			continue
		case "skip":
			skipped = append(skipped, in.Path)
			continue
		case "drop":
			dupes = append(dupes, in.Path)
			continue
		}
		s.accept(&in, byPath)
		added++
	}
	s.trimToKeepMax()
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
	keep := s.referenced()
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := make([]*Shot, 0, len(s.Shots))
	n := 0
	for _, x := range s.Shots {
		if want[x.ID] {
			s.dropUnlessKept(keep, x.Path)
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
	keep := s.referenced()
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
			s.dropUnlessKept(keep, x.Path)
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

// handleSttAudio GET /api/sttaudio?p=<inbox 下的绝对路径> — 语音暂存区回放用。
// 会话结束的音频还没进附件表（只有 path），先按路径直接从 inbox 发；等附件入表后
// 回放走 /file?id=（在 files 页），这里是暂存区播放的唯一通道。
// 只发 inbox 里的真实文件（与 handleShotImg 同款越权防护）：拒绝任何不在 inbox 下的路径。
func handleSttAudio(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("p")
	if p == "" {
		http.NotFound(w, r)
		return
	}
	clean := filepath.Clean(p)
	if !strings.HasPrefix(clean, filepath.Clean(inboxDir)+string(os.PathSeparator)) {
		logf("sttaudio: 拒绝越权路径 %s", p)
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, clean)
}
