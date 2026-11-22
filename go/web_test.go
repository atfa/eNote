package main

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
)

// S1a：UI 从单个 ui.html 拆成 go/ui/ 目录（index.html + css/ + js/ + vendor/）。
// 拆分的硬要求是**行为零变化**，所以这里的重点不是"页面好看"，而是：
//   1. 页面引用的每个资源都能取到（拆文件最容易漏的就是路径）
//   2. Content-Type 正确（Android 上没有 /etc/mime.types，回落到 text/plain 会整页不执行）
//   3. 每个文件都带 no-store（升级后新页面配旧脚本是最难查的混合态）
//   4. vendor 里的 Vue 与 VENDOR.md 记的 sha256 一致（第三方文件不许被手改）

func doUI(t *testing.T, path string) *http.Response {
	t.Helper()
	srv := httptest.NewServer(apiMux())
	defer srv.Close()
	resp, err := srv.Client().Get(srv.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	return resp
}

func TestIndexServedFromDirectory(t *testing.T) {
	resp := doUI(t, "/")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("首页返回 %d，期望 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("首页 Content-Type = %q，期望 text/html", ct)
	}
	body := uiBody(t, resp)
	for _, want := range []string{`<link rel="stylesheet" href="/css/tokens.css">`, `<script src="/js/app.js"></script>`} {
		if !strings.Contains(body, want) {
			t.Errorf("首页缺少 %s", want)
		}
	}
	// 拆分后不许留内联样式/脚本：留着就是"半拆"，两边各一份真相。
	// 先剔掉 HTML 注释，否则注释里提到的 "<style>" 会自匹配。
	code := regexp.MustCompile(`(?s)<!--.*?-->`).ReplaceAllString(body, "")
	if strings.Contains(code, "<style>") {
		t.Errorf("首页还有 <style> 块，样式没拆干净")
	}
	if regexp.MustCompile(`<script>`).MatchString(code) {
		t.Errorf("首页还有内联 <script>，脚本没拆干净")
	}
	// D9：app.js 必须是普通脚本。加 type="module" 会让顶层 function 变成模块作用域，
	// 页面里 70 个内联 handler 全部静默失效（P12 那一类"点了没反应"）。
	if strings.Contains(body, `type="module"`) {
		t.Errorf("首页出现 type=\"module\"：转 module 必须与 window 导出表 + handler 存在性检查同批（S3）")
	}
}

// 页面引用的每个静态资源都必须存在且类型正确——这是拆文件的回归测试。
func TestUIAssetsResolve(t *testing.T) {
	resp := doUI(t, "/")
	index := uiBody(t, resp)
	resp.Body.Close()

	refs := map[string]string{}
	for _, m := range regexp.MustCompile(`href="(/[^"]+\.css)"`).FindAllStringSubmatch(index, -1) {
		refs[m[1]] = "text/css"
	}
	for _, m := range regexp.MustCompile(`src="(/[^"]+\.js)"`).FindAllStringSubmatch(index, -1) {
		refs[m[1]] = "text/javascript"
	}
	if len(refs) == 0 {
		t.Fatal("首页没引用任何 css/js，拆分是不是被回退了？")
	}
	for path, wantType := range refs {
		r := doUI(t, path)
		if r.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d，页面引用了它，404 就是白屏/无样式", path, r.StatusCode)
			r.Body.Close()
			continue
		}
		if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, wantType) {
			t.Errorf("GET %s Content-Type = %q，期望 %s（WebView 收到 text/plain 会拒绝执行）", path, ct, wantType)
		}
		if cc := r.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
			t.Errorf("GET %s 没有 no-store：升级后会是新页面配旧脚本", path)
		}
		if len(uiBody(t, r)) == 0 && path != "/css/views.css" {
			t.Errorf("GET %s 是空文件", path)
		}
		r.Body.Close()
	}
}

// css/views/*.css 是 S1a 建的空占位文件（S2 才填），单独确认它们可访问且确实是空的。
func TestViewPlaceholdersExist(t *testing.T) {
	for _, n := range []string{"shell", "notes", "todos", "files", "shots", "clip", "stats", "settings"} {
		path := "/css/views/" + n + ".css"
		r := doUI(t, path)
		if r.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d", path, r.StatusCode)
		}
		r.Body.Close()
	}
}

func TestUIPathTraversalAndMisses(t *testing.T) {
	for _, p := range []string{"/../../etc/passwd", "/../go.mod", "/css", "/js", "/vendor", "/nope.css", "/css/nope.css", "/favicon.ico"} {
		r := doUI(t, p)
		if r.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s = %d，期望 404（目录不能当文件读，.. 不能跳出 ui/）", p, r.StatusCode)
		}
		r.Body.Close()
	}
}

func TestContentTypeMap(t *testing.T) {
	// Android 上没有系统 mime.types，这些类型必须写死在代码里。
	want := map[string]string{
		"a.html":    "text/html; charset=utf-8",
		"css/a.css": "text/css; charset=utf-8",
		"js/a.js":   "text/javascript; charset=utf-8",
		"a.json":    "application/json; charset=utf-8",
		"a.svg":     "image/svg+xml",
		"a.png":     "image/png",
		"a.map":     "application/json; charset=utf-8",
		"a.weird":   "application/octet-stream",
		"a.CSS":     "text/css; charset=utf-8",
	}
	for name, ct := range want {
		if got := contentType(name); got != ct {
			t.Errorf("contentType(%q) = %q，期望 %q", name, got, ct)
		}
	}
}

// vendor 是第三方整文件：内容必须与 VENDOR.md 记录的 sha256 一致，
// 否则"谁手改了 Vue / 升级没更新文档"这种事故没人拦得住。
func TestVendorHashMatchesDoc(t *testing.T) {
	raw, err := fs.ReadFile(uiFS, "ui/vendor/vue.global.prod.js")
	if err != nil {
		t.Fatalf("读不到 vendor 里的 Vue: %v", err)
	}
	sum := sha256.Sum256(raw)
	got := hex.EncodeToString(sum[:])
	doc, err := os.ReadFile("ui/vendor/VENDOR.md")
	if err != nil {
		t.Fatalf("读不到 VENDOR.md: %v", err)
	}
	m := regexp.MustCompile("sha256\\s*\\|\\s*`([0-9a-f]{64})`").FindSubmatch(doc)
	if m == nil {
		t.Fatal("VENDOR.md 里没有 sha256 行（格式：| sha256 | `<64位hex>` |）")
	}
	if string(m[1]) != got {
		t.Errorf("vendor 内容与 VENDOR.md 不一致：文件 %s，文档 %s\n升级请照 VENDOR.md 的步骤做，两处一起改", got, m[1])
	}
	if !strings.Contains(string(raw), "vue v3.5.46") {
		t.Errorf("vendor 文件里的版本号与预期不符，检查是不是下成了 runtime-only 构建")
	}
	// 全局构建自带模板编译器；换成 runtime-only 会让 template: 字符串静默不编译（页面空白）。
	if !regexp.MustCompile(`version:"3\.5\.`).MatchString(string(raw)) && !strings.Contains(string(raw), "3.5.46") {
		t.Errorf("vendor 里找不到版本号字符串")
	}
}

// 拆分不许动业务代码：Go 侧的 API 与 Java 桥保持零改动（plan D3）。
// 静态化把 "/" 换成了文件服务，Go 的 ServeMux 按最长前缀匹配，
// 这条而测试就是防"/" 把 API 吃掉。
func TestAPIRoutesStillRegistered(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatalf("openStore: %v", err)
	}
	oldStore, oldCfg := store, config
	store = s
	config, err = openConfig(dir)
	if err != nil {
		t.Fatalf("openConfig: %v", err)
	}
	defer func() { store, config = oldStore, oldCfg }()

	m := apiMux()
	for _, p := range []string{"/api/state", "/api/note", "/api/settings", "/api/missed", "/api/stats", "/api/prefs"} {
		r := httptest.NewRequest(http.MethodGet, p, nil)
		w := httptest.NewRecorder()
		m.ServeHTTP(w, r)
		if w.Code == http.StatusNotFound {
			t.Errorf("%s 变成 404 了：静态化改动把 API 路由吃掉了", p)
		}
	}
}

func uiBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	b := make([]byte, 0, 4096)
	buf := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buf)
		b = append(b, buf[:n]...)
		if err != nil {
			break
		}
	}
	return string(b)
}
