package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type siwcTestTransport func(*http.Request) (*http.Response, error)

func (f siwcTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestChatGPTSignInCallback(t *testing.T) {
	t.Run("browser", func(t *testing.T) { testChatGPTSignInCallback(t, false) })
	t.Run("paste", func(t *testing.T) { testChatGPTSignInCallback(t, true) })
}

func testChatGPTSignInCallback(t *testing.T, paste bool) {
	oldDir, oldURL, oldClient := logDir, srvURL, siwcHTTP
	oldHost, oldAccount, oldPending, oldError := siwcHostID, siwcCred, siwcPending, siwcError
	t.Cleanup(func() {
		logDir, srvURL, siwcHTTP = oldDir, oldURL, oldClient
		siwcHostID, siwcCred, siwcPending, siwcError = oldHost, oldAccount, oldPending, oldError
	})
	logDir, srvURL = t.TempDir(), "http://127.0.0.1:48440/"
	siwcHostID, siwcCred, siwcPending, siwcError = "", siwcTokens{}, nil, ""
	mux := apiMux()
	request := func(method, path string, authenticate bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, nil)
		if authenticate {
			r.Header.Set("X-eNote-Session", openAISessionToken())
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	if w := request("POST", "/api/openai/login", false); w.Code != http.StatusForbidden {
		t.Fatalf("untrusted login status: %d", w.Code)
	}
	var started struct {
		OK  bool
		URL string
	}
	w := request("POST", "/api/openai/login", true)
	if err := json.Unmarshal(w.Body.Bytes(), &started); err != nil || !started.OK {
		t.Fatalf("start login: %s", w.Body)
	}
	authorize, err := url.Parse(started.URL)
	if err != nil {
		t.Fatal(err)
	}
	query := authorize.Query()
	if authorize.Host != "auth.openai.com" || query.Get("client_id") != "dynamic_agent_client" ||
		query.Get("redirect_uri") != srvURL+"auth/callback" || query.Get("code_challenge_method") != "S256" {
		t.Fatal("unexpected authorize request")
	}
	if w := request("GET", "/auth/callback?state=wrong", false); w.Code != http.StatusBadRequest || siwcPending == nil {
		t.Fatal("an invalid state must not consume the login attempt")
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	claims, _ := json.Marshal(map[string]any{
		"sub": "test-user", "aud": "oaiapp_test", "iss": siwcIssuer, "email": "user@example.test",
		"nonce": query.Get("nonce"), "exp": time.Now().Add(time.Hour).Unix(),
	})
	input := encode([]byte(`{"alg":"RS256","kid":"test"}`)) + "." + encode(claims)
	digest := sha256.Sum256([]byte(input))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	idToken := input + "." + encode(signature)
	siwcHTTP = &http.Client{Transport: siwcTestTransport(func(r *http.Request) (*http.Response, error) {
		var body string
		switch r.URL.String() {
		case siwcTokenURL:
			if err := r.ParseForm(); err != nil {
				return nil, err
			}
			challenge := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if r.Form.Get("client_id") != "oaiapp_test" || r.Form.Get("redirect_uri") != query.Get("redirect_uri") || encode(challenge[:]) != query.Get("code_challenge") {
				return nil, fmt.Errorf("invalid token exchange form")
			}
			body = fmt.Sprintf(`{"id_token":%q,"access_token":"test-access","refresh_token":"test-refresh","expires_in":3600,"scope":"chatgpt.tokens.use.direct"}`, idToken)
		case siwcIssuer + "/.well-known/jwks.json":
			body = fmt.Sprintf(`{"keys":[{"kid":"test","kty":"RSA","n":%q,"e":"AQAB"}]}`, encode(key.N.Bytes()))
		default:
			return nil, fmt.Errorf("unexpected authorization endpoint")
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
	callback := "/auth/callback?" + url.Values{"state": {query.Get("state")}, "code": {"test-code"}, "client_id": {"oaiapp_test"}}.Encode()
	if paste {
		full := strings.TrimRight(srvURL, "/") + callback
		if !isSIWCCallbackAddress(full) {
			t.Fatal("clipboard would retain the callback")
		}
		submit := func(address string, authenticated bool) *httptest.ResponseRecorder {
			body := fmt.Sprintf(`{"url":%q}`, address)
			r := httptest.NewRequest("POST", "/api/openai/callback", strings.NewReader(body))
			if authenticated {
				r.Header.Set("X-eNote-Session", openAISessionToken())
			}
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			return w
		}
		if w := submit(full, false); w.Code != http.StatusForbidden {
			t.Fatalf("untrusted paste status: %d", w.Code)
		}
		if w := submit(strings.Replace(full, "48440", "48441", 1), true); !strings.Contains(w.Body.String(), `"ok":false`) || siwcPending == nil {
			t.Fatalf("wrong callback URL consumed the attempt: %s", w.Body)
		}
		if w := submit(full, true); !strings.Contains(w.Body.String(), `"ok":true`) {
			t.Fatalf("paste callback: %s", w.Body)
		}
	} else if w := request("GET", callback, false); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "ChatGPT 已连接") {
		t.Fatalf("callback: HTTP %d %s", w.Code, w.Body)
	}
	stored, err := os.Stat(filepath.Join(logDir, "chatgpt_credentials.json"))
	if err != nil || stored.Mode().Perm() != 0600 {
		t.Fatalf("credentials not stored privately: %v", err)
	}
	siwcHostID, siwcCred = "", siwcTokens{}
	w = request("GET", "/api/openai/status", true)
	if !strings.Contains(w.Body.String(), `"authorized":true`) || strings.Contains(w.Body.String(), "test-access") {
		t.Fatalf("unexpected status: %s", w.Body)
	}
	if w := request("GET", callback, false); w.Code != http.StatusBadRequest {
		t.Fatal("callback state can only be used once")
	}
}

func TestChatGPTStreamRequiresCompletion(t *testing.T) {
	delta := "event: response.output_text.delta\ndata: {\"delta\":\"你好\"}\n\n"
	var call LLMCall
	if err := readChatGPTStream(strings.NewReader(delta), &call); err == nil || call.Raw != "" {
		t.Fatal("partial stream treated as a successful reply")
	}
	completed := `data: {"type":"response.completed","response":{"usage":{"output_tokens":1}}}` + "\n\n"
	if err := readChatGPTStream(strings.NewReader(delta+completed), &call); err != nil || call.Raw != "你好" {
		t.Fatalf("completed stream: %q, %v", call.Raw, err)
	}
	failed := `data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}` + "\n\n"
	if err := readChatGPTStream(strings.NewReader(delta+failed), &LLMCall{}); err == nil || !strings.Contains(err.Error(), "用量上限") {
		t.Fatalf("stream usage limit not surfaced: %v", err)
	}
}
