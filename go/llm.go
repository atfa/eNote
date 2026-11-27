package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// LLMCall is one request/response pair, kept for the 调试 tab.
type LLMCall struct {
	TS           time.Time `json:"ts"`
	URL          string    `json:"url"`
	Model        string    `json:"model"`
	System       string    `json:"system"`
	User         string    `json:"user"`
	HTTPCode     int       `json:"httpCode"`
	Raw          string    `json:"raw"`    // message.content as returned
	Reason       string    `json:"reason"` // reasoning_content, when the model emits it
	MS           int64     `json:"ms"`
	Err          string    `json:"err,omitempty"`
	Usage        any       `json:"usage,omitempty"`
	Parsed       any       `json:"parsed,omitempty"`
	finishReason string
}

var (
	llmMu   sync.Mutex
	llmLog  []*LLMCall
	httpCli = &http.Client{}
)

func remember(c *LLMCall) {
	llmMu.Lock()
	defer llmMu.Unlock()
	llmLog = append(llmLog, c)
	if len(llmLog) > 30 {
		llmLog = llmLog[len(llmLog)-30:]
	}
}

func llmHistory() []*LLMCall {
	llmMu.Lock()
	defer llmMu.Unlock()
	out := make([]*LLMCall, len(llmLog))
	copy(out, llmLog)
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

type chatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatReq struct {
	Model           string    `json:"model"`
	Messages        []chatMsg `json:"messages"`
	MaxTokens       int       `json:"max_tokens"`
	Temperature     float64   `json:"temperature"`
	Stream          bool      `json:"stream"`
	ReasoningEffort string    `json:"reasoning_effort,omitempty"`
}

type chatResp struct {
	Choices []struct {
		Message struct {
			Content          string `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Code    any    `json:"code"`
	} `json:"error"`
	Usage any `json:"usage"`
}

// callLLM posts one chat completion to the configured OpenAI-compatible endpoint.
/* 步骤 58：callLLM 原来 69 行，六条失败出口每条都要「写 c.Err → remember(c) → 造 error」
   三件套，中间还夹着建请求、发请求、读响应、解响应四段。现在四段各自成函数，六条出口
   收敛成 c.fail(...) / c.failErr(err) / c.failNet(...) / c.failLogged() 一行；语句逐字搬。 */

func callLLM(system, user string) (*LLMCall, error) {
	s := config.get()
	c := &LLMCall{TS: time.Now(), Model: s.Model, System: system, User: user}
	if strings.TrimSpace(s.BaseURL) == "" {
		return c.fail("未配置大模型地址：在设置里填 OpenAI 兼容的 API Base URL")
	}
	c.URL = s.BaseURL + "/chat/completions"
	req, err := chatRequest(c, s, system, user)
	if err != nil {
		return c.failErr(err)
	}
	cli := *httpCli
	cli.Timeout = time.Duration(s.TimeoutS) * time.Second
	t0 := time.Now()
	resp, err := cli.Do(req)
	if err != nil {
		return c.failNet(err, t0)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	c.MS = time.Since(t0).Milliseconds()
	c.HTTPCode = resp.StatusCode
	if resp.StatusCode != 200 {
		c.Err = "HTTP " + fmt.Sprint(resp.StatusCode) + ": " + clip(string(raw), 400)
		c.Raw = string(raw)
		return c.failLogged()
	}
	finish, err := c.readChatBody(raw)
	if err != nil {
		return c, err
	}
	logf("llm: ok %d chars in %dms (finish=%s)", len(c.Raw), c.MS, finish)
	remember(c)
	return c, nil
}

// fail / failErr / failNet / failLogged 是六条失败出口的共同收尾：写 Err、进日志环、造 error。
// failErr 与 failNet 原样返回底层 error（上层要拿它判类型），failNet 多记一次耗时与一行日志，
// failLogged 给「已经自己写好 Err」的出口（HTTP 非 200）用。
func (c *LLMCall) fail(msg string) (*LLMCall, error) {
	c.Err = msg
	remember(c)
	return c, fmt.Errorf("%s", c.Err)
}

func (c *LLMCall) failErr(err error) (*LLMCall, error) {
	c.Err = err.Error()
	remember(c)
	return c, err
}

func (c *LLMCall) failNet(err error, t0 time.Time) (*LLMCall, error) {
	c.MS = time.Since(t0).Milliseconds()
	c.Err = err.Error()
	logf("llm: %s (%dms)", err, c.MS)
	remember(c)
	return c, err
}

func (c *LLMCall) failLogged() (*LLMCall, error) {
	logf("llm: %s (%dms)", c.Err, c.MS)
	remember(c)
	return c, fmt.Errorf("%s", c.Err)
}

// chatRequest 拼 OpenAI 兼容的 chat/completions 请求体与请求头。
func chatRequest(c *LLMCall, s Settings, system, user string) (*http.Request, error) {
	body, _ := json.Marshal(chatReq{
		Model: s.Model, MaxTokens: s.MaxTok, Temperature: s.Temp, Stream: false,
		Messages: []chatMsg{{Role: "system", Content: system}, {Role: "user", Content: user}},
	})
	req, err := http.NewRequest("POST", c.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+s.APIKey)
	}
	return req, nil
}

// readChatBody 解响应：不是 JSON、endpoint 自己报错、choices 为空都是失败；成功时把正文与
// 思考过程写回 c，并把 finish reason 交回调用方打日志。
func (c *LLMCall) readChatBody(raw []byte) (string, error) {
	var cr chatResp
	if err := json.Unmarshal(raw, &cr); err != nil {
		c.Err = "bad json from endpoint: " + clip(string(raw), 300)
		remember(c)
		return "", fmt.Errorf("%s", c.Err)
	}
	c.Usage = cr.Usage
	if cr.Error != nil {
		c.Err = cr.Error.Message
		remember(c)
		return "", fmt.Errorf("%s", c.Err)
	}
	if len(cr.Choices) == 0 {
		c.Err = "no choices in response"
		remember(c)
		return "", fmt.Errorf("%s", c.Err)
	}
	c.Raw = cr.Choices[0].Message.Content
	c.Reason = cr.Choices[0].Message.ReasoningContent
	c.finishReason = cr.Choices[0].FinishReason
	return c.finishReason, nil
}

// ---------------------------------------------------------------------------
// turning model output into a note
// ---------------------------------------------------------------------------

type parsedTodo struct {
	Text     string `json:"text"`
	Due      string `json:"due"`
	Priority string `json:"priority"`
}

type parsedNote struct {
	Title   string       `json:"title"`
	Content string       `json:"content"`
	Facts   []Fact       `json:"facts"`
	Tags    []string     `json:"tags"`
	Todos   []parsedTodo `json:"todos"`
}

const systemPromptTemplate = `你是笔记与待办整理助手。用户把一段内容分享给你（来自聊天、网页、截图 OCR），你要把它整理成一条笔记：关键事实 + 正文 + 待办。

只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。结构：
{"title":"不超过20字的标题","content":"整理后的笔记正文","facts":[{"q":"何时","a":"2026-11-19"}],"tags":["标签"],"todos":[{"text":"待办事项","due":"YYYY-MM-DDTHH:MM","priority":"high|normal|low"}]}

规则：
1. 现在是 {{NOW}}（本地时区，星期{{WEEK}}）。文中的相对时间（明天、下周三、晚上8点、半小时后）按此换算成绝对时间。
2. due 精确到分钟；只说了日期就写 "YYYY-MM-DDT09:00"；没有时间就写 null。
3. 只有明确的可执行事项才进 todos；纯信息、纯知识记录时 todos 为 []。
4. 每个 todo 是一句独立可执行的中文短句，不要写成整段。
5. content 用原文语言（中文就保持中文）重写要点，条理清晰，保留关键信息、数字、人名、链接，不要编造原文没有的内容。
6. 内容可能来自图片 OCR 或语音识别。OCR 有明显识别错误时按上下文纠正错字；语音识别常有同音字、歧义字、识别错漏（含句尾语气词重复，如"好吗吗"），请结合上下文整体理解纠正，保持原意，不编造原文没有的内容。
7. tags 0-3 个，短词。
8. facts 是这条笔记里可当事实查的硬信息，按六问提取：何时、何人、何地、何事、为何、下一步。
   q 就用这六个词（能归类的用原词，确实需要时可用更具体的两到四字，如「体检机构」「异常指标」「颁发机构」）；
   a 是一句话答案，带具体日期、数字、机构名、指标名。只写原文里有的，推不出来的就省略这一问；
   六问全都没有信息时 facts 为 []。体检报告、证书、合同、发票、通知这类记录尤其要把时间、主体、关键数值提干净。`

var weekNames = []string{"日", "一", "二", "三", "四", "五", "六"}

func systemPrompt() string {
	now := time.Now()
	return strings.ReplaceAll(
		strings.ReplaceAll(systemPromptTemplate, "{{NOW}}", now.Format("2006-01-02 15:04")),
		"{{WEEK}}", weekNames[int(now.Weekday())])
}

var fenceRe = regexp.MustCompile("(?s)```(?:json)?\\s*(.*?)```")

// extractJSON pulls the first JSON object out of a model reply (models wrap it in prose
// or code fences even when told not to).
func extractJSON(s string) string {
	s = strings.TrimSpace(s)
	if m := fenceRe.FindStringSubmatch(s); len(m) == 2 {
		s = strings.TrimSpace(m[1])
	}
	i := strings.IndexByte(s, '{')
	if i < 0 {
		return ""
	}
	depth, inStr, esc := 0, false, false
	for j := i; j < len(s); j++ {
		switch c := s[j]; {
		case esc:
			esc = false
		case c == '\\' && inStr:
			esc = true
		case c == '"':
			inStr = !inStr
		case inStr:
		case c == '{':
			depth++
		case c == '}':
			depth--
			if depth == 0 {
				return s[i : j+1]
			}
		}
	}
	return ""
}

func parseNoteJSON(raw string) (*parsedNote, error) {
	js := extractJSON(raw)
	if js == "" {
		return nil, fmt.Errorf("回复里没有 JSON 对象")
	}
	var p parsedNote
	if err := json.Unmarshal([]byte(js), &p); err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %v", err)
	}
	if strings.TrimSpace(p.Content) == "" && strings.TrimSpace(p.Title) == "" {
		return nil, fmt.Errorf("模型返回的 JSON 没有内容")
	}
	return &p, nil
}

// applyParsed merges a parsed reply into the note.
func applyParsed(n *Note, p *parsedNote, model string, ms int64) {
	n.Title = strings.TrimSpace(p.Title)
	n.Content = strings.TrimSpace(p.Content)
	n.Tags = p.Tags
	n.AIModel = model
	n.AIMs = ms
	n.Status = stDone
	n.Error = ""
	src := "ai"
	n.Facts = cleanFacts(p.Facts)
	n.Todos = nil
	for _, t := range p.Todos {
		txt := strings.TrimSpace(t.Text)
		if txt == "" {
			continue
		}
		pr := strings.ToLower(strings.TrimSpace(t.Priority))
		if pr != "high" && pr != "low" {
			pr = "normal"
		}
		n.Todos = append(n.Todos, Todo{
			ID: newID(), Text: txt, Due: normaliseDue(t.Due),
			Priority: pr, Source: src,
		})
	}
	sortTodos(n.Todos)
}

// cleanFacts keeps the six-question facts usable: answers must be non-empty,
// one entry per question, at most six, each answer short enough to read on a card.
func cleanFacts(in []Fact) []Fact {
	out := make([]Fact, 0, len(in))
	seen := map[string]bool{}
	for _, f := range in {
		q := clip(strings.TrimSpace(f.Q), 24)
		a := clip(strings.TrimSpace(f.A), 200)
		if q == "" || a == "" || seen[q] {
			continue
		}
		seen[q] = true
		out = append(out, Fact{Q: q, A: a})
		if len(out) == 6 {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// userPromptFor builds the user message for one note.
func userPromptFor(n *Note) string {
	var b strings.Builder
	switch {
	case n.OCRText != "":
		b.WriteString("以下内容识别自图片《" + n.ImageName + "》：\n\n")
		b.WriteString(clip(n.OCRText, 6000))
	case strings.HasPrefix(n.Source, "manual-voice") || strings.HasPrefix(n.Source, "share-voice"):
		// P16：语音识别文本。告诉模型可能含同音字/错漏，让它结合上下文纠错。
		b.WriteString("以下文字识别自语音（可能含同音字、错漏，请结合上下文纠正）：\n\n")
		b.WriteString(clip(n.RawText, 6000))
	case n.Source == "share-text":
		if n.ImageName != "" {
			b.WriteString("标题：" + n.ImageName + "\n\n")
		}
		b.WriteString(clip(n.Content, 6000))
	default:
		b.WriteString(clip(n.Content, 6000))
	}
	return b.String()
}
