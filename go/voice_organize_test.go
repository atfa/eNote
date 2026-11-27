package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVoiceOrganize(t *testing.T) {
	const transcript = "呃，明天上午九点开会。\n\n请李明带合同。"
	for _, tc := range []struct {
		name, result, finish string
		status               int
		wantOK               bool
	}{
		{"complete", "明天上午九点开会，请李明带合同。", "stop", 200, true},
		{"empty", " ", "stop", 200, false},
		{"truncated", "明天上午", "length", 200, false},
		{"provider failure", "", "", 503, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request chatReq
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil ||
					r.Method != http.MethodPost || r.URL.Path != "/chat/completions" ||
					len(request.Messages) != 2 || request.Messages[1].Content != transcript {
					t.Errorf("unexpected provider request: %s %s %+v (err=%v)", r.Method, r.URL.Path, request, err)
				}
				w.WriteHeader(tc.status)
				jsonOut(w, map[string]any{"choices": []any{map[string]any{
					"message": map[string]string{"content": tc.result}, "finish_reason": tc.finish,
				}}})
			}))
			t.Cleanup(upstream.Close)
			oldConfig := config
			settings := defaultSettings
			settings.BaseURL = upstream.URL
			config = &Config{Settings: settings}
			t.Cleanup(func() { config = oldConfig })

			body, err := json.Marshal(map[string]string{"text": transcript})
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			apiMux().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/voice/organize", strings.NewReader(string(body))))
			var got struct {
				OK    bool   `json:"ok"`
				Text  string `json:"text"`
				Error string `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got.OK != tc.wantOK || (got.OK && got.Text != tc.result) || (!got.OK && (got.Text != "" || got.Error == "")) {
				t.Fatalf("unexpected response: %+v", got)
			}
		})
	}
}
