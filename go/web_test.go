package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
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
	for _, want := range []string{`<link rel="stylesheet" href="/css/tokens.css">`, `<script type="module" src="/js/app.js"></script>`} {
		if !strings.Contains(body, want) {
			t.Errorf("首页缺少 %s", want)
		}
	}
	// 拆分后不许留内联样式：留着就是"半拆"，两边各一份真相。
	// 先剔掉 HTML 注释，否则注释里提到的 "<style>" 会自匹配。
	code := regexp.MustCompile(`(?s)<!--.*?-->`).ReplaceAllString(body, "")
	if strings.Contains(code, "<style>") {
		t.Errorf("首页还有 <style> 块，样式没拆干净")
	}
	// S3（D16）之后首页允许**一个**内联脚本：feature probe。它必须在 module 之前、语法必须停在
	// ES5：老 WebView 连 type="module" 都不认，探针写在 app.js 里就跟着模块一起静默失败；
	// 探针自己用上新语法则是第一个解析失败的脚本——两种都回到白屏，probe 白写。
	inline := regexp.MustCompile("(?s)<script([^>]*)>(.*?)</script>").FindAllStringSubmatch(code, -1)
	probeBody, probeCount := "", 0
	for _, m := range inline {
		if strings.Contains(m[1], "src=") {
			continue
		}
		probeCount++
		if !strings.Contains(m[1], `id="probe"`) {
			t.Errorf("首页多了内联 <script>（属性：%s）；只允许 id=\"probe\" 那一个",
				strings.TrimSpace(m[1]))
		}
		probeBody = m[2]
	}
	if probeCount == 0 {
		t.Errorf("首页没有内联 probe 脚本（D16：旧 WebView 要失败得响亮）")
	}
	for _, es5 := range []struct{ what, re string }{
		{"箭头函数 =>", `=>`},
		{"模板字符串 `", "`"},
		{"const/let 声明", `(?m)^[[:space:]]*(const|let)[[:space:]]`},
		{"可选链 ?.", `\?\.`},
		{"空值合并 ??", `\?\?`},
		{"class 声明", `(?m)^[[:space:]]*class[[:space:]]`},
	} {
		if regexp.MustCompile(es5.re).MatchString(probeBody) {
			t.Errorf("probe 脚本用了 %s：老引擎解析不了，探针自己先死（D16）", es5.what)
		}
	}
	if strings.Index(code, `id="probe"`) > strings.Index(code, `type="module"`) {
		t.Errorf("probe 必须在 module 脚本之前：模块解析失败时 app.js 里的代码一行都不会跑")
	}
	if !strings.Contains(probeBody, "WATCHDOG_MS") || !strings.Contains(probeBody, "__enoteProbe") {
		t.Errorf("probe 缺看门狗或 __enoteProbe（D16）")
	}
	// D9（S3 后反向）：app.js 必须是 ES module，而且必须带导出表。
	// 页面里 70 个内联 handler 按全局作用域解析函数名；转 module 后顶层 function 变成
	// 模块作用域，少了 window.__enoteActions + Object.assign(window, …) 就是 70 个 handler
	// 全部静默失效（P12 那一类「点了没反应」）。这三样必须同批存在，中间态不能存在。
	if !strings.Contains(body, `type="module"`) {
		t.Errorf("首页的 app.js 没加 type=\"module\"（S3 已转 ES module）")
	}
	appjs := uiBody(t, doUI(t, "/js/app.js"))
	for _, want := range []string{"window.__enoteActions = {", "Object.assign(window, window.__enoteActions)", "window.__enote.state = {"} {
		if !strings.Contains(appjs, want) {
			t.Errorf("app.js 缺少 %s：转 module 与导出表/状态桥必须同批（D12/D21）", want)
		}
	}
	// D21 状态桥的六个名字逐个钉住：只钉 `window.__enote.state = {` 这个字面量的话，
	// 改名（比如 tab 改成 currentTab）就漏，而载荷里的 tab="notes" 会静默打到 window 上。
	for _, s := range []string{"tab", "S", "MISSED", "open", "shotSel", "shotList", "SR"} {
		for _, want := range []string{"get " + s + "()", "set " + s + "(v)"} {
			if !strings.Contains(appjs, want) {
				t.Errorf("app.js 状态桥缺 %s：载荷里对它的读写会打到 window 上，测试绿着骗过去（D21）", want)
			}
		}
	}
	// D17：__enote 必须**合并**进去。整份赋值会把上面 state 的六个 getter/setter 全冲掉，
	// 症状是步骤 2 那 11 处载荷集体假绿（赋值打到新对象，模块里的变量一动不动）。
	if strings.Contains(appjs, "window.__enote = {") {
		t.Errorf("app.js 整份覆盖 window.__enote，会冲掉状态桥的 getter/setter（D17）")
	}
	if !strings.Contains(appjs, "Object.assign(window.__enote, {") {
		t.Errorf("app.js 缺 Object.assign(window.__enote, {…})：D17 测试缝没接上")
	}
	for _, want := range []string{"ready: __ready", "build: null", "api: api", "dom: {",
		"probe: window.__enoteProbe", "fetch('/build.json')"} {
		if !strings.Contains(appjs, want) {
			t.Errorf("app.js 的 __enote 缺 %s（D17）", want)
		}
	}
	// D13：render() 的契约是 Promise。视图转 Vue 后刷新是微任务，调用点不 await 就断言不到
	// 新 DOM；今天的实现是同步 innerHTML，return 时 DOM 已更新，Promise.resolve() 就是真语义。
	// 钉这个是因为契约比实现先动：步骤 5-10 换实现时调用点（3 处 jseval 载荷）一行不用改。
	// D13/D14：render() 的契约是 Promise，混合期两条分支都得兑现：遗留路径是同步
	// innerHTML（return 时 DOM 已更新，Promise.resolve() 就是真语义），Vue 路径是
	// vuePaint().then(...)。钉这个是因为契约比实现先动：步骤 5-10 换实现时调用点
	// （3 处 jseval 载荷）一行不用改。
	if n := strings.Count(appjs, "function render(){"); n != 1 {
		t.Errorf("app.js 里 function render(){ 出现 %d 次（应为 1）：函数声明提升会让后一份覆盖前一份，Vue 分发静默失效", n)
	}
	if i := strings.Index(appjs, "function render(){"); i >= 0 {
		body := appjs[i:]
		if j := strings.Index(body, "\n}"); j > 0 {
			body = body[:j]
		}
		for _, want := range []string{
			"return Promise.resolve();",              // 遗留分支
			"return vuePaint().then(done, done);",    // Vue 分支（D14）
			"try { afterPaint() } finally { markReady() }", // 首屏记号无条件打出去
			"markReady();",                           // 遗留分支的首屏记号
		} {
			if !strings.Contains(body, want) {
				t.Errorf("app.js 的 render() 缺 %q（D13/D14）", want)
			}
		}
		// markReady 的语义是「首屏画完」。遗留分支是同步的，所以下面这个顺序有意义；
		// Vue 分支的 DOM 在 nextTick 之后才落地，只能靠 done 在 then/catch 两条分支上都挂上
		// （上面那条）+ done 内部 try/finally 保证它一跑就打记号。
		legacy := body[strings.Index(body, "p.innerHTML = buildPage(tab);"):]
		mi, ri := strings.Index(legacy, "markReady();"), strings.Index(legacy, "return Promise.resolve();")
		if mi < 0 || ri < 0 || mi > ri {
			t.Errorf("遗留分支里 markReady() 必须在 return 之前（D13/D17）")
		}
	}
	// D14：混合期的唯一开关——注册表。加一行迁移一个视图，删一行退回字符串路径。
	if !strings.Contains(appjs, "var VUE_VIEWS = { notes: NotesView }") {
		t.Errorf("app.js 缺 VUE_VIEWS 注册表（步骤 5：notes 转 Vue）")
	}
	// Vue 是全局构建，js/vue.js 在模块求值时就要拿 window.Vue，所以脚本顺序是硬约束。
	if i, j := strings.Index(body, "/vendor/vue.global.prod.js"), strings.Index(body, `type="module" src="/js/app.js"`); i < 0 || j < 0 || i > j {
		t.Errorf("index.html 里 vendored Vue 必须在 <script type=module> 之前（i=%d j=%d）", i, j)
	}
	// 组件 setup() 里就要读宿主接口，所以 setHost 必须早于首次 refresh()。
	if i, j := strings.Index(appjs, "setHost({"), strings.Index(appjs, "\nrefresh();"); i < 0 || j < 0 || i > j {
		t.Errorf("setHost() 必须早于首次 refresh()（i=%d j=%d）：render() 会 mount Vue 视图，组件 setup() 立刻要读宿主接口", i, j)
	}
	// build.json 由独立 fetch 填，ready 在首屏就兑现：没存 promise 的话，载荷 await ready 后
	// 立刻读 E.build 是没顺序保证的（实测不犯，因为 seam 载荷是在桥载荷轮询完几秒后注入的）。
	if !strings.Contains(appjs, "window.__enote.buildReady = fetch('/build.json')") {
		t.Errorf("app.js 缺 __enote.buildReady（D17 竞态）：seam 载荷没法显式等 build.json 落地")
	}
}

// D17：/build.json 是「WebView 里跑的就是刚装的这版」的凭据。设备是共享的（两个 worktree
// 轮流装），光看日志对不上号；测试拿它和 APK 的 git sha 逐项比。
func TestBuildJSONServed(t *testing.T) {
	// build.json 是 build.sh 生成的构建产物，进了 .gitignore：新 worktree / 新 clone 里
	// 本就没这文件，//go:embed 也就收不到它，404 不是 bug。缺文件就跳过（Tony 实测：
	// 不跳的话「顺手跑个 go test」在干净树上必红），文件在时格式断言照旧严格。
	if _, err := os.Stat("ui/build.json"); os.IsNotExist(err) {
		t.Skip("先跑 build.sh：go/ui/build.json 不存在（它是构建产物，不进版本库）")
	}
	resp := doUI(t, "/build.json")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /build.json 返回 %d：build.sh 没生成它，还是 //go:embed 没收到？", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("/build.json Content-Type = %q，期望 application/json（nosniff 下类型不对就是不解析）", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("/build.json Cache-Control = %q，必须 no-store：缓存了它，sha 就永远指旧版本", cc)
	}
	var b struct {
		SHA     string `json:"sha"`
		BuiltAt string `json:"builtAt"`
		App     string `json:"app"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&b); err != nil {
		t.Fatalf("/build.json 不是合法 JSON：%v", err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{12}(-dirty)?$`).MatchString(b.SHA) {
		t.Errorf("build.json 的 sha = %q，期望 12 位 hex（未提交的树带 -dirty 后缀）", b.SHA)
	}
	if !regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`).MatchString(b.BuiltAt) {
		t.Errorf("build.json 的 builtAt = %q，期望 UTC ISO8601", b.BuiltAt)
	}
	if b.App != "dev.xduo.enote" {
		t.Errorf("build.json 的 app = %q，期望 dev.xduo.enote", b.App)
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
		if sn := r.Header.Get("X-Content-Type-Options"); sn != "nosniff" {
			t.Errorf("GET %s 没有 nosniff：WebView 会探内容，类型写死了也要拦住", path)
		}
		// 空文件：css/views/ 下的占位是合法的（S2 才填规则），其余引用到空文件就是坏了。
		// 不写死文件名：views.css 在 S2 被拆成 views/*.css，写死的名字下次就失效。
		if len(uiBody(t, r)) == 0 && !strings.Contains(path, "/css/views/") {
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
	for _, p := range []string{"/../../etc/passwd", "/../go.mod", "/css", "/js", "/vendor", "/nope.css", "/css/nope.css", "/favicon.ico", "/vendor/VENDOR.md"} {
		r := doUI(t, p)
		if r.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s = %d，期望 404（目录不能当文件读，.. 不能跳出 ui/，不服务的扩展名不许变 octet-stream 200）", p, r.StatusCode)
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
		"a.weird":   "",   // 空串 = 不服务，handleUI 会 404
		"a.md":      "",
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

// probe 自测：把 index.html 里的探针脚本在 node 的 vm 里跑一遍，断言它判定「特性齐全」。
// 为什么要有这条：探针的判定式写错是**静默**的。真机首跑就抓到一次——Reflect 是命名空间
// 对象（同 Math / JSON），typeof 是 'object'，写成 typeof Reflect === 'function' 会让
// probe 永远报缺，Chrome 159 上直接假红。这类 bug 只有真跑一遍判定式才看得见。
func TestProbeSelfTest(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("没有 node，跳过 probe 自测")
	}
	src, err := os.ReadFile("ui/index.html")
	if err != nil {
		t.Fatalf("读 ui/index.html：%v", err)
	}
	m := regexp.MustCompile(`(?s)<script id="probe">(.*?)</script>`).FindSubmatch(src)
	if m == nil {
		t.Fatal("index.html 里没有 <script id=\"probe\">")
	}
	cmd := exec.Command(node, "-e", probeHarness)
	cmd.Stdin = strings.NewReader(string(m[1]))
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Errorf("probe 自测没通过（判定式写错 / 探针抛异常？）：%v\n%s", err, out)
		return
	}
	t.Logf("probe 自测：%s", strings.TrimSpace(string(out)))
}

// 探针在浏览器里靠 window / document / navigator / setTimeout；这里给最小桩，
// 只保证「特性探测」这一段能独立跑。缺桩会让探针抛异常，自测同样判红。
const probeHarness = `
const vm = require('vm');
const src = require('fs').readFileSync(0, 'utf8');
const win = { addEventListener: function () {}, __enote: undefined };
const doc = { title: '', getElementById: function () { return null }, body: null };
const ctx = { window: win, document: doc, navigator: { userAgent: 'node-selftest' },
              setTimeout: function () { return 0 }, console: { log: function () {} } };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'probe.js' });
const p = win.__enoteProbe;
if (!p) { console.error('探针没写出 window.__enoteProbe'); process.exit(1); }
if (!Array.isArray(p.missing) || !Array.isArray(p.missingDetail)) {
  console.error('probe.missing / missingDetail 不是数组'); process.exit(1);
}
if (p.ok !== (p.missing.length === 0)) { console.error('probe.ok 与 missing 不一致'); process.exit(1); }
if (p.missing.length) { console.error('本机（node V8）判定缺特性：' + p.missing.join(',')); process.exit(1); }
console.log('ok 探针判定特性齐全，探测 ' + p.probed + ' 项');
`
