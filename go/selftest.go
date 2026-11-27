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

/* 步骤 59：selfTest 原来 63 行，四个 mode 的分支挤在一起，每个分支都要自己写进 out。
   现在一个 mode 一个函数（selfTestStore / selfTestWeb / selfTestLLM），selfTest 只剩
   「解参数 → 按 mode 收集」。语句逐字搬，只把 out["store"] = / out["web"] = / out["llm"] =
   改成 return，内联的匿名参数结构体归成 selfTestInput。 */

// selfTestInput 是 am start 传进来的参数：
// am start -n dev.xduo.enote/.MainActivity --es hook selftest '{"mode":"llm","text":"…"}'
type selfTestInput struct {
	Mode string `json:"mode"`
	Text string `json:"text"`
}

func selfTest(arg string) map[string]any {
	var req selfTestInput
	if arg != "" {
		json.Unmarshal([]byte(arg), &req)
	}
	mode := req.Mode
	if mode == "" {
		mode = "all"
	}
	out := map[string]any{"ok": true, "mode": mode, "app": appInfo()}
	if mode == "all" || mode == "store" {
		out["store"] = selfTestStore(req)
	}
	if mode == "all" || mode == "web" {
		out["web"] = selfTestWeb()
	}
	if mode == "all" || mode == "llm" {
		out["llm"] = selfTestLLM(req)
	}
	if mode == "all" || mode == "ocr" {
		out["ocr"] = map[string]any{"ready": ocrReady, "info": ocrInfo}
	}
	if mode == "all" || mode == "stt" {
		out["stt"] = map[string]any{"ready": sttReady, "info": sttInfo}
	}
	return out
}

// selfTestStore：入队一条自测笔记，看 store 收不收下、解析有没有跑起来。
func selfTestStore(req selfTestInput) map[string]any {
	res := enqueue(ingestReq{Kind: "text", Text: "自测：明天下午3点和产品组开评审会", Source: "manual-text"})
	n := store.get(res.ID)
	out := map[string]any{"id": res.ID, "ok": n != nil, "error": res.Error}
	if n != nil {
		out = map[string]any{"id": res.ID, "ok": true, "rawText": n.RawText,
			"status": n.Status}
	}
	return out
}

// selfTestWeb：起内置 HTTP 服务，自己 GET 一次 /api/state。
func selfTestWeb() map[string]any {
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
	return web
}

// selfTestLLM：拿一段中文长句真调一次大模型，顺带验证返回值能不能解析成笔记。
func selfTestLLM(req selfTestInput) map[string]any {
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
	return res
}
