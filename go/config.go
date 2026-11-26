package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Settings is the BYOK configuration plus UI preferences, editable in 我的 → 设置.
type Settings struct {
	BaseURL  string               `json:"baseUrl"`
	APIKey   string               `json:"apiKey"`
	Model    string               `json:"model"`
	TimeoutS int                  `json:"timeoutS"`
	MaxTok   int                  `json:"maxTokens"`
	Temp     float64              `json:"temperature"`
	UseAI    bool                 `json:"useAI"` // off = save shared content as-is, no LLM call
	Theme    string               `json:"theme"` // light | dark | auto, default light
	UI       map[string]ViewPrefs `json:"ui"`    // per-page remembered search/sort/filter
}

// ViewPrefs is one page's remembered query state (notes / todos / files).
type ViewPrefs struct {
	Tab     string            `json:"tab,omitempty"`
	Q       string            `json:"q"`
	Sort    string            `json:"sort"`
	Dir     string            `json:"dir"`
	Filters map[string]string `json:"filters"`
}

// A fresh install has no AI configured: the app is BYOK, so the endpoint goes into 设置
// (any OpenAI-compatible server). With BaseURL empty, shared content is stored as-is.
var defaultSettings = Settings{
	BaseURL:  "",
	APIKey:   "",
	Model:    "gpt-4o-mini",
	TimeoutS: 90,
	MaxTok:   2048,
	Temp:     0.2,
	UseAI:    true,
	Theme:    "light",
}

type Config struct {
	mu   sync.Mutex
	path string
	Settings
}

var config *Config

func openConfig(dir string) (*Config, error) {
	c := &Config{path: filepath.Join(dir, "settings.json"), Settings: defaultSettings}
	// 主文件坏了就退回 .bak：settings.json 里存着 API Key，读不回来就得让用户重填一遍
	for _, f := range []string{c.path, c.path + ".bak"} {
		b, err := os.ReadFile(f)
		if err != nil || len(b) == 0 {
			continue
		}
		var s Settings
		if err := json.Unmarshal(b, &s); err != nil {
			logf("config: %s 不是合法 JSON，跳过：%v", filepath.Base(f), err)
			continue
		}
		if s.BaseURL == "" && s.APIKey == "" {
			continue
		}
		if f != c.path {
			logf("config: 主文件坏了，用 %s 恢复", filepath.Base(f))
		}
		c.Settings = s
		break
	}
	c.normalize()
	return c, nil
}

func (c *Config) normalize() {
	c.BaseURL = trimSlash(strings.TrimSpace(c.BaseURL))
	if c.Theme != "dark" && c.Theme != "auto" {
		c.Theme = "light"
	}
	if c.UI == nil {
		c.UI = map[string]ViewPrefs{}
	}
	if c.TimeoutS <= 0 {
		c.TimeoutS = 90
	}
	if c.MaxTok <= 0 {
		c.MaxTok = 2048
	}
	if c.Model == "" {
		c.Model = defaultSettings.Model
	}
}

func (c *Config) get() Settings {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Settings
}

func (c *Config) set(s Settings) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Settings = s
	c.normalize()
	b, err := json.MarshalIndent(c.Settings, "", "  ")
	if err != nil {
		return err
	}
	// 原子写：先写 .tmp 再 rename。直接 WriteFile 写到一半被杀就会留下半截 JSON，
	// 下次启动解析失败回默认值 —— 用户的 Base URL / API Key 就这么丢过一次，
	// 表现为"每次都得重新填 key"。顺手留一份 .bak 兜底。
	tmp := c.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	_ = os.WriteFile(c.path+".bak", b, 0o600)
	if err := os.Rename(tmp, c.path); err != nil {
		return err
	}
	hub.broadcast("settings")
	return nil
}

func trimSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}

// ---------------------------------------------------------------------------
// logging: logcat is muted on this device, so keep our own file
// ---------------------------------------------------------------------------

var (
	logMu  sync.Mutex
	logDir string
)

func logf(format string, a ...any) {
	if logDir == "" {
		return
	}
	logMu.Lock()
	defer logMu.Unlock()
	p := filepath.Join(logDir, "enote.log")
	if st, err := os.Stat(p); err == nil && st.Size() > 2<<20 {
		_ = os.Rename(p, p+".1")
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	time.Now().Format("2006-01-02 15:04:05")
	f.WriteString(time.Now().Format("2006-01-02 15:04:05.000") + " " + sprintf(format, a...) + "\n")
}

func readLog(n int) string {
	b, err := os.ReadFile(filepath.Join(logDir, "enote.log"))
	if err != nil {
		return ""
	}
	lines := splitLines(string(b))
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return joinLines(lines)
}
