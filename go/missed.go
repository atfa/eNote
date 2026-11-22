package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// 「打开时补看错过的提醒」。
//
// 厂商 ROM 会在后台冻结应用（连系统闹钟一起取消，见 README「已知限制」），app 无法绕过。
// 唯一还有意义的补救是：进程不在的时候到点的提醒，等用户下次打开时补看一遍。
//
// 做法：把「上次看到提醒的时间」写进一个小文件，每次前端问 /api/missed 时，
// 取出上次到现在之间到点、且还没完成的待办，然后把文件改成现在。
// 存在独立文件而不是 settings.json：settings 只在配了 AI 时才整体生效（BYOK 的全新
// 安装 BaseURL 为空，写进去会读不回来），提醒不该依赖它。

const missedFile = "lastopen.txt"

func missedPath() string { return filepath.Join(logDir, missedFile) }

// readLastOpen 返回上次记录的打开时间；没记录过时返回零值。
func readLastOpen() time.Time {
	b, err := os.ReadFile(missedPath())
	if err != nil {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(string(b)))
	if err != nil {
		return time.Time{}
	}
	return t
}

func writeLastOpen(t time.Time) {
	if err := os.WriteFile(missedPath(), []byte(t.Format(time.RFC3339)), 0o600); err != nil {
		logf("missed: 写 lastopen 失败: %v", err)
	}
}

// missedTodos 返回 since 之后、now 之前到点且未完成的待办（最多 limit 条，按时间正序）。
func missedTodos(since, now time.Time, limit int) []map[string]any {
	out := []map[string]any{}
	if since.IsZero() || !now.After(since) || store == nil {
		return out
	}
	type hit struct {
		due  time.Time
		item map[string]any
	}
	hits := []hit{}
	for _, n := range store.snapshot() {
		for _, t := range n.Todos {
			if t.Done || strings.TrimSpace(t.Due) == "" {
				continue
			}
			due, err := time.ParseInLocation("2006-01-02T15:04", t.Due, time.Local)
			if err != nil {
				continue
			}
			if due.After(since) && !due.After(now) {
				hits = append(hits, hit{due: due, item: map[string]any{
					"id": t.ID, "text": t.Text, "due": t.Due,
					"noteId": n.ID, "noteTitle": n.Title,
				}})
			}
		}
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].due.Before(hits[j].due) })
	for i, h := range hits {
		if limit > 0 && i >= limit {
			break
		}
		out = append(out, h.item)
	}
	return out
}

// apiMissed 是 /api/missed：先算「上次到现在」错过的提醒，再把上次时间推到现在。
// 前端在启动时问一次，用户点「忽略」不会重复打扰（时间已经推进了）。
func apiMissed() map[string]any {
	now := time.Now()
	since := readLastOpen()
	items := missedTodos(since, now, 20)
	writeLastOpen(now)
	total := len(items)
	if total == 20 {
		// 截断了：至少让 UI 知道「还有更多」，避免出现「就 20 条」的错觉
		total = len(missedTodos(since, now, 0))
	}
	if total > 0 {
		logf("missed: %d 条到点提醒在上次打开之后错过（since=%s）", total, since.Format(time.RFC3339))
	}
	return map[string]any{"ok": true, "count": total, "items": items,
		"since": since.Format(time.RFC3339), "now": now.Format(time.RFC3339)}
}
