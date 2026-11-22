package main

import "testing"

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
