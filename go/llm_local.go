package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var localInference = make(chan struct{}, 1)

func localModelPath() string {
	return filepath.Join(appDir, "models", "local.gguf")
}

func localModelState() (name, stage string) {
	if appDir == "" || !localEngineAvailable {
		return "", "missing"
	}
	path := localModelPath()
	if _, err := os.Stat(path); err != nil {
		return "", "missing"
	}
	name = "此前导入的 GGUF"
	if target, err := os.Readlink(path); err == nil {
		name = filepath.Base(target)
	}
	return name, localStage(path)
}

func handleLocalModelState(w http.ResponseWriter, r *http.Request) {
	name, stage := localModelState()
	jsonOut(w, map[string]string{"fileName": name, "stage": stage})
}

func unloadLocalWhenDisabled(c *Config) {
	localInference <- struct{}{}
	defer func() { <-localInference }()
	if c.get().modelBackend() != "local" {
		unloadLocalModel()
	}
}

func callLocalLLM(c *LLMCall, s Settings) (*LLMCall, error) {
	c.Model = "本地 GGUF"
	c.URL = "llama.cpp"
	if !localEngineAvailable {
		return c.fail("此版本未包含 llama.cpp，请配置在线模型")
	}
	if appDir == "" {
		return c.fail("应用存储尚未初始化")
	}
	path := localModelPath()
	model, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return c.fail("请在设置中导入本地 GGUF 模型")
		}
		return c.failErr(err)
	}

	defer model.Close()

	select {
	case localInference <- struct{}{}:
		defer func() { <-localInference }()
	default:
		return c.fail("本地模型正在处理另一项任务，请稍后重试")
	}

	start := time.Now()
	// Keep the same inode if a model replacement completes during inference.
	modelPath := fmt.Sprintf("/proc/self/fd/%d", model.Fd())
	text, finish, err := inferLocal(modelPath, c.System, c.User, min(s.MaxTok, 4096), s.Temp, min(s.TimeoutS, 3600))
	c.MS = time.Since(start).Milliseconds()
	if err != nil {
		return c.failErr(fmt.Errorf("本地推理：%w", err))
	}
	c.Raw, c.finishReason = text, finish
	if strings.TrimSpace(text) == "" {
		return c.fail("本地模型没有生成可显示的回复")
	}
	remember(c)
	return c, nil
}
