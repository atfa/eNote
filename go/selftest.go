package main

/* 步骤 56：headless 自检入口（am start --es hook selftest）。
   从 web.go 拆出来：它跟 HTTP 服务器只在「调同一批 handler」上有关，
   读起来是两件事——一个是网络面，一个是测试面。 */

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ---------------------------------------------------------------------------
// headless self test: am start -n dev.xduo.enote/.MainActivity --es hook selftest
// ---------------------------------------------------------------------------

func selfTest(arg string) map[string]any {
	var req struct {
		Mode string `json:"mode"`
		Text string `json:"text"`
	}
	if arg != "" {
		json.Unmarshal([]byte(arg), &req)
	}
	mode := req.Mode
	if mode == "" {
		mode = "all"
	}
	out := map[string]any{"ok": true, "mode": mode, "app": appInfo()}
	if mode == "all" || mode == "store" {
		res := enqueue(ingestReq{Kind: "text", Text: "自测：明天下午3点和产品组开评审会", Source: "manual-text"})
		n := store.get(res.ID)
		out["store"] = map[string]any{"id": res.ID, "ok": n != nil, "error": res.Error}
		if n != nil {
			out["store"] = map[string]any{"id": res.ID, "ok": true, "rawText": n.RawText,
				"status": n.Status}
		}
	}
	if mode == "all" || mode == "web" {
		startWebServer()
		t0 := time.Now()
		resp, err := http.Get(srvURL + "api/state")
		web := map[string]any{"url": srvURL}
		if err != nil {
			web["error"] = err.Error()
		} else {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			resp.Body.Close()
			var st map[string]any
			json.Unmarshal(b, &st)
			web["httpCode"] = resp.StatusCode
			web["ms"] = time.Since(t0).Milliseconds()
			web["notes"] = fmt.Sprint(st["notes"] != nil)
			web["info"] = st["info"]
		}
		out["web"] = web
	}
	if mode == "all" || mode == "llm" {
		text := req.Text
		if text == "" {
			text = "下周三下午两点半和小李在会议室B过一版设计稿，会前把原型图发群里"
		}
		call, err := callLLM(systemPrompt(), text)
		res := map[string]any{"ms": call.MS, "url": call.URL, "model": call.Model,
			"raw": clip(call.Raw, 1500)}
		if err != nil {
			res["error"] = call.Err
		} else if p, perr := parseNoteJSON(call.Raw); perr != nil {
			res["parseError"] = perr.Error()
		} else {
			res["parsed"] = p
		}
		out["llm"] = res
	}
	if mode == "all" || mode == "ocr" {
		out["ocr"] = map[string]any{"ready": ocrReady, "info": ocrInfo}
	}
	return out
}
