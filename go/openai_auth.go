package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const siwcIssuer = "https://auth.openai.com"
const siwcAuthURL = siwcIssuer + "/api/accounts/authorize"
const siwcTokenURL = siwcIssuer + "/api/accounts/oauth/token"
const siwcResource = "https://api.openai.com/v1"
const siwcScopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"

type siwcClaims struct {
	Sub      string `json:"sub"`
	Email    string `json:"email"`
	Issuer   string `json:"iss"`
	Audience any    `json:"aud"`
	Nonce    string `json:"nonce"`
	Exp      int64  `json:"exp"`
	Iat      int64  `json:"iat"`
}

func verifySIWCIDToken(ctx context.Context, token, aud, nonce string) (siwcClaims, error) {
	var c siwcClaims
	p := strings.Split(token, ".")
	if len(p) != 3 {
		return c, errors.New("bad jwt")
	}
	hb, e := base64.RawURLEncoding.DecodeString(p[0])
	if e != nil {
		return c, e
	}
	var h struct{ Alg, Kid string }
	if json.Unmarshal(hb, &h) != nil || h.Alg != "RS256" {
		return c, errors.New("unsupported jwt")
	}
	key, e := siwcJWK(ctx, h.Kid)
	if e != nil {
		return c, e
	}
	sig, e := base64.RawURLEncoding.DecodeString(p[2])
	if e != nil {
		return c, e
	}
	sum := sha256.Sum256([]byte(p[0] + "." + p[1]))
	if e = rsa.VerifyPKCS1v15(key, crypto.SHA256, sum[:], sig); e != nil {
		return c, e
	}
	pb, e := base64.RawURLEncoding.DecodeString(p[1])
	if e != nil {
		return c, e
	}
	if e = json.Unmarshal(pb, &c); e != nil {
		return c, e
	}
	audOK := false
	switch x := c.Audience.(type) {
	case string:
		audOK = x == aud
	case []any:
		for _, v := range x {
			if v == aud {
				audOK = true
			}
		}
	}
	if c.Issuer != siwcIssuer || !audOK || c.Sub == "" || (nonce != "" && c.Nonce != nonce) || c.Exp <= time.Now().Unix() || c.Iat > time.Now().Unix()+5 {
		return c, errors.New("jwt claims invalid")
	}
	return c, nil
}
func siwcJWK(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	req, e := http.NewRequestWithContext(ctx, "GET", siwcIssuer+"/.well-known/jwks.json", nil)
	if e != nil {
		return nil, e
	}
	res, e := siwcHTTP.Do(req)
	if e != nil {
		return nil, e
	}
	defer res.Body.Close()
	var doc struct {
		Keys []struct{ Kid, Kty, N, E string } `json:"keys"`
	}
	if res.StatusCode != 200 {
		return nil, errors.New("jwks unavailable")
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&doc); e != nil {
		return nil, e
	}
	for _, k := range doc.Keys {
		if k.Kid == kid && k.Kty == "RSA" {
			nb, e := base64.RawURLEncoding.DecodeString(k.N)
			if e != nil {
				return nil, e
			}
			eb, e := base64.RawURLEncoding.DecodeString(k.E)
			if e != nil {
				return nil, e
			}
			ev := 0
			for _, b := range eb {
				ev = ev<<8 | int(b)
			}
			return &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: ev}, nil
		}
	}
	return nil, errors.New("signing key not found")
}

type siwcTokens struct {
	ClientID     string    `json:"client_id"`
	Subject      string    `json:"subject"`
	Email        string    `json:"email,omitempty"`
	AccessToken  string    `json:"access_token,omitempty"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	IDToken      string    `json:"id_token,omitempty"`
	Scope        string    `json:"scope,omitempty"`
	ExpiresAt    time.Time `json:"expires_at"`
}

func (s siwcTokens) authorized() bool {
	for _, scope := range strings.Fields(s.Scope) {
		if scope == "chatgpt.tokens.use.direct" {
			return s.AccessToken != "" && s.RefreshToken != ""
		}
	}
	return false
}

func (s siwcTokens) registration() siwcTokens {
	return siwcTokens{ClientID: s.ClientID, Subject: s.Subject, Email: s.Email}
}

type siwcAttempt struct {
	state, nonce, verifier, redirect string
	account                          siwcTokens
	expires                          time.Time
	exchanging                       bool
}

var siwcHTTP = &http.Client{
	Timeout:       20 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

var (
	siwcMu      sync.Mutex
	siwcRenewal sync.Mutex // serializes refresh, credential replacement, and disconnection
	siwcPending *siwcAttempt
	siwcHostID  string
	siwcCred    siwcTokens
	siwcError   string
)

type siwcDiskRecord struct {
	HostID      string     `json:"host_id"`
	Credentials siwcTokens `json:"credentials"`
}

func loadSIWCLocked() error {
	if siwcHostID != "" {
		return nil
	}
	if logDir == "" {
		return errors.New("应用存储尚未准备好")
	}
	b, err := os.ReadFile(filepath.Join(logDir, "chatgpt_credentials.json"))
	if err == nil {
		var disk siwcDiskRecord
		if json.Unmarshal(b, &disk) != nil || disk.HostID == "" {
			return errors.New("无法读取本地 ChatGPT 授权记录")
		}
		siwcHostID, siwcCred = disk.HostID, disk.Credentials
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return errors.New("无法读取本地 ChatGPT 授权记录")
	}
	var raw [16]byte
	_, _ = rand.Read(raw[:])
	raw[6] = raw[6]&0x0f | 0x40
	raw[8] = raw[8]&0x3f | 0x80
	siwcHostID = fmt.Sprintf("urn:uuid:%x-%x-%x-%x-%x", raw[:4], raw[4:6], raw[6:8], raw[8:10], raw[10:])
	if err := saveSIWCLocked(siwcCred); err != nil {
		siwcHostID = ""
		return err
	}
	return nil
}

func saveSIWCLocked(credentials siwcTokens) error {
	f, err := os.CreateTemp(logDir, ".chatgpt-credentials-*")
	if err != nil {
		return errors.New("无法保存 ChatGPT 授权记录")
	}
	defer os.Remove(f.Name())
	err = json.NewEncoder(f).Encode(siwcDiskRecord{siwcHostID, credentials})
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(f.Name(), filepath.Join(logDir, "chatgpt_credentials.json"))
	}
	if err != nil {
		return errors.New("无法保存 ChatGPT 授权记录")
	}
	siwcCred = credentials
	return nil
}

func handleOpenAIAuthStart(w http.ResponseWriter, r *http.Request) {
	if srvURL == "" {
		jsonOut(w, map[string]any{"ok": false, "error": "本机登录回调服务未启动"})
		return
	}
	siwcMu.Lock()
	defer siwcMu.Unlock()
	if err := loadSIWCLocked(); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	a := &siwcAttempt{
		state: rand.Text(), nonce: rand.Text(), verifier: rand.Text(),
		redirect: strings.TrimRight(srvURL, "/") + "/auth/callback", account: siwcCred,
		expires: time.Now().Add(10 * time.Minute),
	}
	// PKCE requires 43–128 unreserved characters.
	a.verifier += rand.Text()
	challenge := sha256.Sum256([]byte(a.verifier))
	q := url.Values{
		"response_type": {"code"}, "redirect_uri": {a.redirect}, "scope": {siwcScopes},
		"resource": {siwcResource}, "state": {a.state}, "nonce": {a.nonce},
		"code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"ext_agent_host_id": {siwcHostID},
	}
	if a.account.ClientID == "" {
		q.Set("client_id", "dynamic_agent_client")
		q.Set("agent_name_hint", "eNote")
	} else {
		q.Set("client_id", a.account.ClientID)
		if a.account.IDToken != "" {
			q.Set("id_token_hint", a.account.IDToken)
		}
		if a.account.Email != "" {
			q.Set("login_hint", a.account.Email)
		}
		if !a.account.authorized() && a.account.IDToken != "" {
			q.Set("prompt", "consent")
		}
	}
	siwcPending, siwcError = a, ""
	jsonOut(w, map[string]any{"ok": true, "url": siwcAuthURL + "?" + q.Encode()})
}

func handleOpenAIAuthCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := completeSIWCCallback(r.Context(), r.URL); err != nil {
		if errors.Is(err, errSIWCInvalidCallback) {
			w.WriteHeader(http.StatusBadRequest)
		}
		writeSIWCCallback(w, err.Error())
		return
	}
	writeSIWCCallback(w, "ChatGPT 已连接")
}

var errSIWCInvalidCallback = errors.New("登录请求无效、正在处理或已过期")

// A browser proxy or Android background freezing may prevent the loopback request.
// Accept the same callback from our WebView after the user brings eNote to the foreground.
func isSIWCCallbackAddress(text string) bool {
	if !strings.HasPrefix(text, "http://127.0.0.1:") {
		return false
	}
	address, err := url.Parse(text)
	return err == nil && address.Hostname() == "127.0.0.1" && address.Path == "/auth/callback" && address.Query().Has("state")
}

func handleOpenAIAuthPaste(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if err := readBody(r, &body); err != nil || len(body.URL) > 8192 {
		jsonOut(w, map[string]any{"ok": false, "error": "请输入完整的浏览器回调地址"})
		return
	}
	callback, err := url.Parse(strings.TrimSpace(body.URL))
	if err != nil || callback == nil || callback.User != nil || callback.Fragment != "" ||
		callback.Scheme+"://"+callback.Host+callback.EscapedPath() != strings.TrimRight(srvURL, "/")+"/auth/callback" {
		jsonOut(w, map[string]any{"ok": false, "error": "请粘贴本次登录后以 http://127.0.0.1 开头的回调地址"})
		return
	}
	if err := completeSIWCCallback(r.Context(), callback); err != nil {
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	jsonOut(w, map[string]any{"ok": true})
}

func completeSIWCCallback(ctx context.Context, callback *url.URL) error {
	q := callback.Query()
	siwcMu.Lock()
	a := siwcPending
	if a == nil || a.exchanging || time.Now().After(a.expires) || subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(a.state)) != 1 {
		siwcMu.Unlock()
		return errSIWCInvalidCallback
	}
	a.exchanging = true
	siwcMu.Unlock()

	// Once the browser has delivered a valid code, finish the exchange even if it closes
	// the connection when the user returns to the app. The code can only be used once.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 40*time.Second)
	defer cancel()
	credentials, err := exchangeSIWCCode(ctx, a, q)
	siwcRenewal.Lock()
	defer siwcRenewal.Unlock()
	siwcMu.Lock()
	defer siwcMu.Unlock()
	if siwcPending != a {
		return errors.New("登录请求已取消或被替换")
	}
	siwcPending = nil
	if err == nil {
		err = saveSIWCLocked(credentials)
	}
	if err == nil && !credentials.authorized() {
		err = errors.New("已登录，但尚未授权使用 ChatGPT 套餐额度")
	}
	if err != nil {
		siwcError = err.Error()
	}
	return err
}

func writeSIWCCallback(w http.ResponseWriter, message string) {
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>eNote</title><h1>%s</h1><p>请返回 eNote。</p>`, html.EscapeString(message))
}

func exchangeSIWCCode(ctx context.Context, a *siwcAttempt, q url.Values) (siwcTokens, error) {
	if q.Get("error") != "" || q.Get("code") == "" {
		return siwcTokens{}, errors.New("登录已取消或授权未完成")
	}
	clientID := a.account.ClientID
	issued := q.Get("client_id")
	if clientID == "" {
		if !strings.HasPrefix(issued, "oaiapp_") {
			return siwcTokens{}, errors.New("OpenAI 未返回有效的应用注册信息")
		}
		clientID = issued
	} else if issued != "" && issued != clientID {
		return siwcTokens{}, errors.New("登录返回的应用注册信息不匹配")
	}
	tokens, err := siwcTokenRequest(ctx, url.Values{
		"grant_type": {"authorization_code"}, "code": {q.Get("code")}, "client_id": {clientID},
		"code_verifier": {a.verifier}, "redirect_uri": {a.redirect}, "resource": {siwcResource},
	})
	if err != nil {
		return siwcTokens{}, err
	}
	claims, err := verifySIWCIDToken(ctx, tokens.IDToken, clientID, a.nonce)
	if err != nil || (a.account.Subject != "" && claims.Sub != a.account.Subject) {
		return siwcTokens{}, errors.New("无法验证 ChatGPT 账号身份")
	}
	account := siwcTokens{ClientID: clientID, Subject: claims.Sub, Email: claims.Email}
	return tokens.update(account), nil
}

type siwcTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
}

var errSIWCExpired = errors.New("ChatGPT 授权已失效，请重新连接")

func siwcFormRequest(ctx context.Context, endpoint string, form url.Values) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	return siwcHTTP.Do(req)
}

func siwcTokenRequest(ctx context.Context, form url.Values) (siwcTokenResponse, error) {
	var out siwcTokenResponse
	resp, err := siwcFormRequest(ctx, siwcTokenURL, form)
	if err != nil {
		return out, errors.New("无法连接 OpenAI 授权服务")
	}
	defer resp.Body.Close()
	decodeErr := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out)
	if resp.StatusCode != http.StatusOK {
		switch out.Error {
		case "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused":
			return out, errSIWCExpired
		}
		return out, fmt.Errorf("OpenAI 授权失败（HTTP %d）", resp.StatusCode)
	}
	if decodeErr != nil || out.AccessToken == "" || out.ExpiresIn <= 0 {
		return out, errors.New("OpenAI 返回了不完整的登录信息")
	}
	return out, nil
}

func (t siwcTokenResponse) update(account siwcTokens) siwcTokens {
	account.AccessToken, account.RefreshToken = t.AccessToken, t.RefreshToken
	if t.IDToken != "" {
		account.IDToken = t.IDToken
	}
	if t.Scope != "" {
		account.Scope = t.Scope
	}
	account.ExpiresAt = time.Now().Add(time.Duration(t.ExpiresIn) * time.Second)
	return account
}

func openAILoginPending() bool {
	siwcMu.Lock()
	defer siwcMu.Unlock()
	return siwcPending != nil && time.Now().Before(siwcPending.expires)
}

func handleOpenAIAuthStatus(w http.ResponseWriter, r *http.Request) {
	siwcMu.Lock()
	defer siwcMu.Unlock()
	if err := loadSIWCLocked(); err != nil {
		jsonOut(w, map[string]any{"error": err.Error()})
		return
	}
	if siwcPending != nil && time.Now().After(siwcPending.expires) {
		siwcPending, siwcError = nil, "登录请求已过期，请重试"
	}
	jsonOut(w, map[string]any{
		"connected": siwcCred.IDToken != "", "authorized": siwcCred.authorized(),
		"account": siwcCred.Email, "pending": siwcPending != nil, "error": siwcError,
	})
}

func handleOpenAIAuthDisconnect(w http.ResponseWriter, r *http.Request) {
	siwcRenewal.Lock()
	defer siwcRenewal.Unlock()
	siwcMu.Lock()
	if err := loadSIWCLocked(); err != nil {
		siwcMu.Unlock()
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	siwcPending, siwcError = nil, ""
	previous := siwcCred
	if err := saveSIWCLocked(previous.registration()); err != nil {
		siwcMu.Unlock()
		jsonOut(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	siwcMu.Unlock()
	out := map[string]any{"ok": true}
	if previous.RefreshToken != "" {
		resp, err := siwcFormRequest(r.Context(), siwcIssuer+"/api/accounts/oauth/revoke", url.Values{
			"token": {previous.RefreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {previous.ClientID},
		})
		if resp != nil {
			resp.Body.Close()
		}
		if err != nil || resp.StatusCode != http.StatusOK {
			out["warning"] = "本机已退出。未能确认远程撤销，可在 ChatGPT 的登录设置中断开 eNote。"
		}
	}
	jsonOut(w, out)
}

func chatGPTAccessToken(ctx context.Context) (string, error) {
	siwcRenewal.Lock()
	defer siwcRenewal.Unlock()
	siwcMu.Lock()
	err := loadSIWCLocked()
	account := siwcCred
	siwcMu.Unlock()
	if err != nil {
		return "", err
	}
	if !account.authorized() {
		return "", errors.New("请在设置中连接 ChatGPT 并授权使用套餐额度")
	}
	if time.Until(account.ExpiresAt) > time.Minute {
		return account.AccessToken, nil
	}
	tokens, err := siwcTokenRequest(ctx, url.Values{
		"grant_type": {"refresh_token"}, "refresh_token": {account.RefreshToken},
		"client_id": {account.ClientID}, "resource": {siwcResource},
	})
	if err != nil {
		if errors.Is(err, errSIWCExpired) {
			siwcMu.Lock()
			if saveSIWCLocked(account.registration()) != nil {
				siwcCred = account.registration()
			}
			siwcError = err.Error()
			siwcMu.Unlock()
		}
		return "", err
	}
	if tokens.RefreshToken == "" {
		return "", errors.New("OpenAI 返回了不完整的授权更新")
	}
	if tokens.IDToken != "" {
		claims, err := verifySIWCIDToken(ctx, tokens.IDToken, account.ClientID, "")
		if err != nil || claims.Sub != account.Subject {
			return "", errors.New("无法验证更新后的 ChatGPT 账号身份")
		}
	}
	updated := tokens.update(account)
	siwcMu.Lock()
	err = saveSIWCLocked(updated)
	if err != nil {
		// The previous refresh token has already been rotated by OpenAI.
		siwcCred = updated
	}
	siwcMu.Unlock()
	if err != nil {
		return "", err
	}
	if !updated.authorized() {
		return "", errors.New("当前 ChatGPT 授权不包含套餐额度使用权限")
	}
	return updated.AccessToken, nil
}
