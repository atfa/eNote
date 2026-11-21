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
	BaseURL  string  `json:"baseUrl"`
	APIKey   string  `json:"apiKey"`
	Model    string  `json:"model"`
	TimeoutS int     `json:"timeoutS"`
	MaxTok   int     `json:"maxTokens"`
	Temp     float64 `json:"temperature"`
	UseAI    bool    `json:"useAI"` // off = save shared content as-is, no LLM call
	Theme    string  `json:"theme"` // light | dark | auto, default light
	UI       map[string]ViewPrefs `json:"ui"` // per-page remembered search/sort/filter
}

// ViewPrefs is one page's remembered query state (notes / todos / files).
type ViewPrefs struct {
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
	mu  sync.Mutex
	path string
	Settings
}

var config *Config

func openConfig(dir string) (*Config, error) {
	c := &Config{path: filepath.Join(dir, "settings.json"), Settings: defaultSettings}
	b, err := os.ReadFile(c.path)
	if err == nil && len(b) > 0 {
		var s Settings
		if err := json.Unmarshal(b, &s); err == nil {
			if s.BaseURL != "" {
				c.Settings = s
			}
		} else {
			logf("config: bad json, using defaults: %v", err)
		}
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
	return os.WriteFile(c.path, b, 0o600)
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
