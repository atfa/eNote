package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const chatGPTAPI = "https://api.openai.com/v1"

func chatGPTClient(timeout time.Duration) http.Client {
	client := *httpCli
	client.Timeout = timeout
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return client
}

func handleChatGPTModels(w http.ResponseWriter, r *http.Request) {
	fail := func(message string) { jsonOut(w, map[string]any{"ok": false, "error": message}) }
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	token, err := chatGPTAccessToken(ctx)
	if err != nil {
		fail(err.Error())
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, chatGPTAPI+"/models", nil)
	if err != nil {
		fail("无法创建模型列表请求")
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	client := chatGPTClient(20 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		fail("无法获取 ChatGPT 模型列表")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fail(chatGPTHTTPError(resp).Error())
		return
	}
	var catalog struct {
		Models []struct {
			Slug        string `json:"slug"`
			DisplayName string `json:"display_name"`
			Visibility  string `json:"visibility"`
		} `json:"models"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&catalog); err != nil || catalog.Models == nil {
		fail("ChatGPT 返回了无法识别的模型列表")
		return
	}
	models := make([]map[string]string, 0, len(catalog.Models))
	for _, model := range catalog.Models {
		if model.Visibility == "list" && model.Slug != "" {
			name := model.DisplayName
			if name == "" {
				name = model.Slug
			}
			models = append(models, map[string]string{"slug": model.Slug, "display_name": name})
		}
	}
	jsonOut(w, map[string]any{"ok": true, "models": models})
}

func callChatGPT(c *LLMCall, s Settings) (*LLMCall, error) {
	c.Model = s.ChatGPTModel
	c.URL = chatGPTAPI + "/responses"
	if c.Model == "" {
		return c.fail("请在设置中连接 ChatGPT 并选择模型")
	}
	timeout := time.Duration(s.TimeoutS) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	start := time.Now()
	token, err := chatGPTAccessToken(ctx)
	if err != nil {
		return c.failErr(err)
	}
	body, err := json.Marshal(map[string]any{
		"model": c.Model, "instructions": c.System, "input": []map[string]string{
			{"type": "message", "role": "user", "content": c.User},
		}, "store": false, "stream": true,
	})
	if err != nil {
		return c.failErr(err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(body))
	if err != nil {
		return c.failErr(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	client := chatGPTClient(timeout)
	resp, err := client.Do(req)
	if err != nil {
		return c.failNet(err, start)
	}
	defer resp.Body.Close()
	c.HTTPCode = resp.StatusCode
	if resp.StatusCode != http.StatusOK {
		err = chatGPTHTTPError(resp)
	} else {
		err = readChatGPTStream(resp.Body, c)
	}
	c.MS = time.Since(start).Milliseconds()
	if err != nil {
		return c.failErr(err)
	}
	logf("llm: ok %d chars in %dms (ChatGPT)", len(c.Raw), c.MS)
	remember(c)
	return c, nil
}

func chatGPTHTTPError(resp *http.Response) error {
	var body struct {
		Error struct{ Code string } `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&body)
	return chatGPTResponseError(body.Error.Code, fmt.Sprintf("ChatGPT 请求失败（HTTP %d）", resp.StatusCode))
}

func chatGPTResponseError(code, fallback string) error {
	switch code {
	case "subscription_sharing_usage_limit_exceeded":
		return errors.New("ChatGPT 套餐已达到用量上限，请在 ChatGPT 的用量设置中查看")
	case "subscription_sharing_user_not_eligible":
		return errors.New("当前 ChatGPT 账号或工作区无法使用套餐额度")
	case "subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable":
		return errors.New("暂时无法确认 ChatGPT 套餐状态，请稍后重试")
	case "subscription_sharing_unsupported_capability":
		return errors.New("当前 ChatGPT 模型或套餐不支持此次请求")
	case "subscription_sharing_invalid_user", "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context":
		return errors.New("ChatGPT 授权失效，请在设置中重新连接")
	default:
		return errors.New(fallback)
	}
}

func readChatGPTStream(r io.Reader, c *LLMCall) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 32<<10), 4<<20)
	var eventName string
	var data, answer strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event:") {
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		}
		if strings.HasPrefix(line, "data:") {
			if data.Len()+len(line) > 4<<20 {
				return errors.New("ChatGPT 返回的事件过大")
			}
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
		if line != "" || data.Len() == 0 {
			continue
		}
		var event struct {
			Type, Delta, Code string
			Error             struct{ Code string }
			Response          struct {
				Usage             any
				Error             struct{ Code string }
				IncompleteDetails struct{ Reason string } `json:"incomplete_details"`
			}
		}
		if err := json.Unmarshal([]byte(data.String()), &event); err != nil {
			return errors.New("ChatGPT 返回了无法解析的响应事件")
		}
		data.Reset()
		if event.Type == "" {
			event.Type = eventName
		}
		eventName = ""
		switch event.Type {
		case "response.output_text.delta":
			if answer.Len()+len(event.Delta) > 4<<20 {
				return errors.New("ChatGPT 回复超过大小上限")
			}
			answer.WriteString(event.Delta)
		case "response.completed":
			if strings.TrimSpace(answer.String()) == "" {
				return errors.New("ChatGPT 完成了请求，但没有返回文本")
			}
			c.Raw, c.Usage, c.finishReason = answer.String(), event.Response.Usage, "stop"
			return nil
		case "error", "response.failed":
			code := event.Response.Error.Code
			if code == "" {
				code = event.Error.Code
			}
			if code == "" {
				code = event.Code
			}
			return chatGPTResponseError(code, "ChatGPT 未能完成请求")
		case "response.incomplete":
			if event.Response.IncompleteDetails.Reason == "max_output_tokens" {
				return errors.New("ChatGPT 回复达到输出上限，结果不完整")
			}
			return errors.New("ChatGPT 返回了不完整的回复")
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("读取 ChatGPT 回复中断：%w", err)
	}
	return errors.New("ChatGPT 连接在回复完成前中断")
}
