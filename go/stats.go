package main

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// /api/stats - the numbers behind the 我的 page.
//
// Everything is derived from the store on demand (a few thousand notes at most), so the
// figures can never drift out of sync with /api/state. AI call totals come from the
// in-memory log, which only covers the current run - the UI says so.
// ---------------------------------------------------------------------------

// DayStat is one bar of the 近 7 天 chart.
type DayStat struct {
	Day   string `json:"day"`   // "2006-01-02"
	Label string `json:"label"` // 今天 / 昨天 / 11-18
	Notes int    `json:"notes"` // notes created that day
	Todos int    `json:"todos"` // todos that arrived with those notes
	Done  int    `json:"done"`  // todos ticked off that day
}

// TagStat is one tag with its note count.
type TagStat struct {
	Tag string `json:"tag"`
	N   int    `json:"n"`
}

type statsRes struct {
	OK      bool           `json:"ok"`
	Notes   map[string]int `json:"notes"`
	Todos   map[string]int `json:"todos"`
	Attach  map[string]any `json:"attach"`
	AI      map[string]any `json:"ai"`
	Days    []DayStat      `json:"days"`
	Tags    []TagStat      `json:"tags"`
	Sources map[string]int `json:"sources"`
	Bytes   int64          `json:"bytes"`
	/* 步骤 28 删掉 Generated string `json:"generatedAt"`：统计接口原来带一个「生成时刻」，
	   UI 的「更新于」是前端自己记的刷新时间，Go 里也没人读这个字段，纯死负载。 */
}

/* 步骤 57：stats() 原来 81 行，一个循环里同时干四件事（笔记计数、待办计数、附件计数、
   近 7 天分桶），res / dayIdx / tags 三个累加器在四段之间穿来穿去。现在换成一个小聚合器：
   stats() 只剩「建聚合器 → 逐条笔记喂进去 → 收尾」，四段各自成方法，累加器挂在结构体上。
   语句逐字搬，只把裸累加器加上 a. 前缀；附件段的循环变量 a 跟接收者撞名，改叫 att。 */

func stats() statsRes {
	a := newStatsAgg()
	for _, n := range store.snapshot() {
		a.note(n)
		a.todos(n)
		a.attachments(n)
	}
	return a.finish()
}

// statsAgg 是统计的累加器：res 是最后要返回的那张表，dayIdx 是「日期 → 近 7 天下标」，
// tags 是标签计数（收尾时 topTags 取前 8），today / now 在循环外算一次就够。
type statsAgg struct {
	res    statsRes
	dayIdx map[string]int
	tags   map[string]int
	today  string
	now    string
}

// newStatsAgg 建表：状态与待办计数的 key 先全部预置成 0，UI 就不用防着 key 不存在。
func newStatsAgg() *statsAgg {
	res := statsRes{OK: true,
		Notes:   map[string]int{},
		Todos:   map[string]int{},
		Attach:  map[string]any{"byKind": map[string]int{}},
		AI:      map[string]any{},
		Sources: map[string]int{},
		Days:    lastDays(7)}
	for _, k := range []string{"total", "done", "raw", "error", "queued", "parsing"} {
		res.Notes[k] = 0
	}
	for _, k := range []string{"total", "open", "done", "overdue", "dueToday", "high", "withDue"} {
		res.Todos[k] = 0
	}
	a := &statsAgg{res: res, dayIdx: map[string]int{}, tags: map[string]int{},
		today: time.Now().Format("2006-01-02"), now: nowStamp()}
	for i, d := range a.res.Days {
		a.dayIdx[d.Day] = i
	}
	return a
}

// note 一条笔记：状态计数、来源计数、标签计数，以及它带来的当天笔记数与待办数。
func (a *statsAgg) note(n *Note) {
	a.res.Notes["total"]++
	st := n.Status
	if st == "" {
		st = stDone
	}
	a.res.Notes[st]++
	a.res.Sources[firstNonEmpty(n.Source, "unknown")]++
	for _, t := range n.Tags {
		if t = trimTag(t); t != "" {
			a.tags[t]++
		}
	}
	day := n.CreatedAt.Format("2006-01-02")
	if i, ok := a.dayIdx[day]; ok {
		a.res.Days[i].Notes++
		a.res.Days[i].Todos += len(n.Todos)
	}
}

// todos 一条笔记里的待办：总数 / 完成 / 未完成 / 逾期 / 今天到期 / 高优先级 / 有截止日，
// 完成的还要按 DoneAt 落到近 7 天那根柱子上。
func (a *statsAgg) todos(n *Note) {
	for _, t := range n.Todos {
		a.res.Todos["total"]++
		if t.Priority == "high" {
			a.res.Todos["high"]++
		}
		if t.Due != "" {
			a.res.Todos["withDue"]++
		}
		if t.Done {
			a.res.Todos["done"]++
			if i, ok := a.dayIdx[dayOf(t.DoneAt)]; ok {
				a.res.Days[i].Done++
			}
			continue
		}
		a.res.Todos["open"]++
		if t.Due != "" && t.Due < a.now {
			a.res.Todos["overdue"]++
		}
		if len(t.Due) >= 10 && t.Due[:10] == a.today {
			a.res.Todos["dueToday"]++
		}
	}
}

// attachments 一条笔记的附件：张数、字节数、文件已丢失的张数、按 MIME 大类分桶。
func (a *statsAgg) attachments(n *Note) {
	for _, att := range n.Attachments {
		a.res.Attach["count"] = iv(a.res.Attach["count"]) + 1
		a.res.Attach["bytes"] = i64v(a.res.Attach["bytes"]) + att.Size
		if fileSize(att.Path) == 0 {
			a.res.Attach["missing"] = iv(a.res.Attach["missing"]) + 1
		}
		byk := a.res.Attach["byKind"].(map[string]int)
		byk[kindOfMime(att.MIME)]++
	}
}

// finish 收尾：标签取前 8，AI 与磁盘占用是全局的，跟笔记循环无关。
func (a *statsAgg) finish() statsRes {
	a.res.Tags = topTags(a.tags, 8)
	a.res.Attach["count"] = iv(a.res.Attach["count"])
	a.res.AI = aiStats()
	a.res.Bytes = dataBytes()
	return a.res
}

// aiStats summarises the in-memory LLM log (this run only).
func aiStats() map[string]any {
	calls := llmHistory()
	out := map[string]any{"calls": len(calls), "ok": 0, "fail": 0, "avgMs": 0,
		"lastMs": 0, "model": "", "url": "", "lastAt": ""}
	var sum int64
	for i, c := range calls {
		if c.Err == "" {
			out["ok"] = iv(out["ok"]) + 1
		} else {
			out["fail"] = iv(out["fail"]) + 1
		}
		sum += c.MS
		if i == 0 {
			out["lastMs"] = c.MS
			out["model"] = c.Model
			out["url"] = c.URL
			out["lastAt"] = c.TS.Format("2006-01-02T15:04")
		}
	}
	if len(calls) > 0 {
		out["avgMs"] = sum / int64(len(calls))
	}
	return out
}

// lastDays builds the day buckets, oldest first, with 今天/昨天 labels.
func lastDays(n int) []DayStat {
	out := make([]DayStat, 0, n)
	today := time.Now()
	for i := n - 1; i >= 0; i-- {
		d := today.AddDate(0, 0, -i)
		label := d.Format("01-02")
		switch i {
		case 0:
			label = "今天"
		case 1:
			label = "昨天"
		}
		out = append(out, DayStat{Day: d.Format("2006-01-02"), Label: label})
	}
	return out
}

func topTags(tags map[string]int, n int) []TagStat {
	out := make([]TagStat, 0, len(tags))
	for t, c := range tags {
		out = append(out, TagStat{Tag: t, N: c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].N != out[j].N {
			return out[i].N > out[j].N
		}
		return out[i].Tag < out[j].Tag
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

func trimTag(s string) string {
	return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s), "#"))
}

// dayOf is the "2006-01-02" prefix of a "2006-01-02T15:04" stamp, "" when unusable.
func dayOf(s string) string {
	s = strings.TrimSpace(s)
	if len(s) < 10 {
		return ""
	}
	return s[:10]
}

// dataBytes is what the app occupies: notes.json + settings + every attachment on disk.
func dataBytes() int64 {
	var total int64
	for _, p := range []string{filepath.Join(appDir, "enote", "notes.json"),
		filepath.Join(appDir, "enote", "settings.json")} {
		total += fileSize(p)
	}
	for _, n := range store.snapshot() {
		for _, a := range n.Attachments {
			if st, err := os.Stat(a.Path); err == nil {
				total += st.Size()
			}
		}
	}
	return total
}

func handleStats(w http.ResponseWriter, r *http.Request) { jsonOut(w, stats()) }

func iv(v any) int {
	if n, ok := v.(int); ok {
		return n
	}
	return 0
}

func i64v(v any) int64 {
	if n, ok := v.(int64); ok {
		return n
	}
	return 0
}
