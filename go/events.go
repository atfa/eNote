package main

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

// eventsHub 是 SSE 广播中枢（步骤 73：轮询 2s 降级为事件推送 + 30s 心跳）。
// 所有 store 写路径的最终落盘点（store.save / ClipStore.save / ShotStore.save /
// Config.set，add/update/remove/import/clear/theme/settings 全从这里过）在
// 成功落盘后调 broadcast，把「数据变了」推给每个存活的 /api/events 订阅者。
//
// 事件类型是粗粒度四个：notes / clips / shots / settings。前端拿到任何一种都只
// 走 refresh(true)，重绘与否交给 pollflow 的 stateSig 指纹闸门 —— 事件不携带
// payload，不存在格式演进问题；丢了也不怕，EventSource 重连后 onopen 全量刷新兜底。
type eventsHub struct {
	mu   sync.Mutex
	subs map[chan string]struct{}
}

// eventSub 是单个订阅：ch 收广播，close() 从 hub 摘掉自己并通知 handler 退出。
type eventSub struct {
	h    *eventsHub
	ch   chan string
	done chan struct{}
	once sync.Once
}

func (s *eventSub) close() {
	s.h.mu.Lock()
	delete(s.h.subs, s.ch)
	s.h.mu.Unlock()
	s.once.Do(func() { close(s.done) })
}

// broadcast 是非阻塞扇出：某个订阅者队列满了就丢那一帧（SSE 尽力而为，
// 静默丢失由重连兜底，不会把写路径卡住）。
func (h *eventsHub) broadcast(typ string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- typ:
		default:
		}
	}
}

var hub = eventsHub{subs: make(map[chan string]struct{})}

// handleEvents 是 /api/events 的 SSE 端点（web.go apiMux 里注册）。
// 协议顺序很讲究：先 WriteHeader 再 Flush —— 反向代理 / WebView 的 EventSource
// 都要看到第一帧才开始透传，而订阅必须在首帧之后注册，否则「连接建立到注册之间」
// 落地的广播会丢。WebView 的 EventSource 也是收到首帧才触发 onopen，所以
// onopen 里那次 refresh(true) 天然晚于订阅注册，不重不漏。
func handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	// 全部走默认事件类型（不带 event: 行）：WebView 的 EventSource 只把默认类型
	// 分发给 onmessage，命名事件（event: notes 这种）要 addEventListener 才收得到，
	// 真机探针踩过：onopen 正常但事件全丢。前端反正只关心「数据变了」一件事。
	fmt.Fprintf(w, "data: connected\n\n")
	fl.Flush()

	sub := &eventSub{h: &hub, ch: make(chan string, 8), done: make(chan struct{})}
	hub.mu.Lock()
	hub.subs[sub.ch] = struct{}{}
	hub.mu.Unlock()
	defer sub.close()

	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		select {
		case ev := <-sub.ch:
			fmt.Fprintf(w, "data: %s\n\n", ev)
			fl.Flush()
		case <-tick.C:
			// 心跳注释帧：不携带数据，只证明连接活着（代理与 EventSource 都认注释帧）
			fmt.Fprintf(w, ": ping\n\n")
			fl.Flush()
		case <-r.Context().Done():
			return
		case <-sub.done:
			return
		}
	}
}
