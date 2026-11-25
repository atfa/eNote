package main

// 步骤 28（P14 S6）：Go 侧的「定义了没人用」。
//
// 闸门⑩ 在 JS/CSS 侧已经查了 token、函数、class、图标、关键帧五个方向，Go 侧对应的那一维是
// 结构体字段：字段被 JSON 序列化给 UI，UI 从来不读，Go 自己也不读 —— 它就是纯死负载，
// 而且比 JS 更隐蔽，因为「后端算出来」看起来总像有用。
//
// 真实收获：statsRes.Generated（json:generatedAt）。统计接口带的「生成时刻」，UI 的「更新于」
// 是前端自己记的刷新时间，Go 里除了赋值没人读它。
//
// 基线里留的是 LLM 线协议字段（Role/Messages/MaxTokens/Stream/ReasoningEffort）：它们只被
// json.Marshal 成请求体发给模型服务，Go 代码里确实没有 `.Role` 这样的读点，属于「协议要求
// 存在」，不是死字段。

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// 只被 JSON 协议要求、Go 不读的字段（json tag 名）
var wireProtocolFields = map[string]bool{
	"role":             true, // chat 请求体
	"messages":         true,
	"max_tokens":       true,
	"stream":           true,
	"reasoning_effort": true,
}

func TestNoDeadJSONFields(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	goText := map[string]string{}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		goText[f] = string(b)
	}
	goAll := strings.Join(mapValues(goText), "\n")

	// UI 侧引用：js + html（剔 vendor，那是第三方）+ test.sh 的探针载荷。
	// 不读 app/src/main/assets —— 那是 build.sh 每次拷过去的构建产物，不是源码。
	ui := readTree("ui") + readFileOrFail(t, "../test.sh")

	fieldRe := regexp.MustCompile("(?m)^\\t([A-Z]\\w*)\\s+[\\w\\[\\]\\*{}.]+\\s+`json:\"([A-Za-z0-9_]+)")
	var dead []string
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		for _, m := range fieldRe.FindAllStringSubmatch(goText[f], -1) {
			field, tag := m[1], m[2]
			if wireProtocolFields[tag] {
				continue
			}
			goRead := regexp.MustCompile("\\." + field + "\\b").MatchString(goAll)
			uiRead := regexp.MustCompile("\\b" + regexp.QuoteMeta(tag) + "\\b").MatchString(ui)
			if !goRead && !uiRead {
				dead = append(dead, field+" (json:"+tag+") "+f)
			}
		}
	}
	if len(dead) > 0 {
		t.Fatalf("Go 结构体字段既没被 Go 读、也没被 UI 读（死负载）：\n%s", strings.Join(dead, "\n"))
	}
}

func mapValues(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}

func readFileOrFail(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("读 %s: %v", p, err)
	}
	return string(b)
}

func readTree(dir string) string {
	var sb strings.Builder
	filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			if info != nil && info.IsDir() && info.Name() == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".js") && !strings.HasSuffix(p, ".html") {
			return nil
		}
		b, err := os.ReadFile(p)
		if err == nil {
			sb.Write(b)
		}
		return nil
	})
	return sb.String()
}
