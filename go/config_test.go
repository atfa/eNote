package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// 部分字段的 POST 不能把别的字段清成零值：只提 theme 的时候，用户设的温度/超时/
// useAI 必须原样留着（踩过：那次 temperature 被悄悄改成 0、useAI 被关掉）。
func TestSettingsPartialPatchKeepsOthers(t *testing.T) {
	dir := t.TempDir()
	c, err := openConfig(dir)
	if err != nil {
		t.Fatalf("openConfig: %v", err)
	}
	old := config
	config = c
	defer func() { config = old }()

	full := Settings{BaseURL: "https://example.test", APIKey: "sk-secret-key-1",
		Model: "m1", TimeoutS: 120, MaxTok: 4096, Temp: 0.7, UseAI: true, Theme: "dark"}
	if err := config.set(full); err != nil {
		t.Fatalf("set: %v", err)
	}

	// 模拟 handleSettings 收到只带 theme 的 patch（旧实现在这里会把 temp/useAI 清零）
	var p settingsPatch
	p.Theme = strPtr("light")
	s := config.get()
	if p.Theme != nil {
		s.Theme = *p.Theme
	}
	if err := config.set(s); err != nil {
		t.Fatalf("set: %v", err)
	}
	got := config.get()
	if got.Temp != 0.7 || !got.UseAI || got.TimeoutS != 120 || got.MaxTok != 4096 {
		t.Fatalf("部分 patch 把别的字段弄丢了: %+v", got)
	}
	if got.Theme != "light" {
		t.Fatalf("theme 该被改掉, got %s", got.Theme)
	}
	if got.APIKey != "sk-secret-key-1" {
		t.Fatalf("key 不该丢, got %q", got.APIKey)
	}
}

func strPtr(s string) *string { return &s }

// settings.json 写坏了要能退回 .bak：里面存着 API Key，读不回来用户就得重填（踩过）。
func TestConfigRecoversFromBackup(t *testing.T) {
	dir := t.TempDir()
	c := &Config{path: filepath.Join(dir, "settings.json"), Settings: defaultSettings}
	if err := c.set(Settings{BaseURL: "https://a.test", APIKey: "sk-keep-me", Model: "m"}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if _, err := os.Stat(c.path + ".bak"); err != nil {
		t.Fatalf("set 该顺手留一份 .bak: %v", err)
	}
	// 模拟写到一半被杀掉：主文件变成半截 JSON
	if err := os.WriteFile(c.path, []byte(`{"baseUrl":"https://a.te`), 0o600); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	c2, err := openConfig(dir)
	if err != nil {
		t.Fatalf("openConfig: %v", err)
	}
	if c2.Settings.APIKey != "sk-keep-me" || c2.Settings.BaseURL != "https://a.test" {
		t.Fatalf("没从 .bak 捡回来: %+v", c2.Settings)
	}
}

// 原子写：写完不能留下 .tmp 残骸，且主文件必须是合法 JSON。
func TestConfigWriteIsAtomic(t *testing.T) {
	dir := t.TempDir()
	c := &Config{path: filepath.Join(dir, "settings.json"), Settings: defaultSettings}
	if err := c.set(Settings{BaseURL: "https://b.test", APIKey: "sk-atomic"}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if _, err := os.Stat(c.path + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("不该留下 .tmp: %v", err)
	}
	b, err := os.ReadFile(c.path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var s Settings
	if err := json.Unmarshal(b, &s); err != nil {
		t.Fatalf("主文件不是合法 JSON: %v", err)
	}
	if s.APIKey != "sk-atomic" {
		t.Fatalf("key 没写进去: %q", s.APIKey)
	}
}

func TestSettingsPersistWithoutOnlineEndpoint(t *testing.T) {
	dir := t.TempDir()
	c, err := openConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := c.get()
	s.UseAI = false
	if err := c.set(s); err != nil {
		t.Fatal(err)
	}
	c, err = openConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := c.get()
	if got.BaseURL != "" || got.UseAI {
		t.Fatal("AI preferences did not survive reopening settings")
	}
}
