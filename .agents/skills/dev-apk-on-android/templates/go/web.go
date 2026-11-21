// Optional variant: the whole business layer is a Go net/http server, the UI is HTML+JS
// rendered by an Android WebView (see src/__PKGPATH__/GoWebViewActivity.java).
//
// Java starts the server and points a WebView at the URL it gets back; the page calls the
// JSON API and can call back into Java through window.Android.
package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"time"
)

var (
	srvOnce sync.Once
	srvURL  string
	srvErr  error
)

const page = `<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>
 body{background:#101418;color:#e6edf3;font:16px/1.5 system-ui;margin:0;padding:24px}
 pre{background:#161b22;padding:12px;border-radius:8px;overflow:auto}
 button{background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:16px}
</style>
<h1>Go business logic, WebView UI</h1>
<p id=who>loading&hellip;</p>
<button onclick="load()">re-run from Go</button>
<pre id=out>-</pre>
<script>
async function load(){
  const r = await fetch('/api/benchmark?n=26');
  const j = await r.json();
  document.getElementById('out').textContent = JSON.stringify(j, null, 2);
  document.getElementById('who').innerHTML =
    '<span style="color:#3fb950">server: ' + j.go + ' ' + j.os + '/' + j.arch + '</span>';
  if (window.Android) window.Android.fromWeb('benchmark ok ' + JSON.stringify(j).length + ' bytes');
}
load();
</script>`

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func startServer() (string, error) {
	srvOnce.Do(func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, page)
		})
		mux.HandleFunc("/api/add", func(w http.ResponseWriter, r *http.Request) {
			q := r.URL.Query()
			var a, b int
			fmt.Sscanf(q.Get("a"), "%d", &a)
			fmt.Sscanf(q.Get("b"), "%d", &b)
			writeJSON(w, map[string]any{"a": a, "b": b, "sum": a + b})
		})
		mux.HandleFunc("/api/put", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, map[string]any{"result": put(r.URL.Query().Get("k"))})
		})
		mux.HandleFunc("/api/benchmark", func(w http.ResponseWriter, r *http.Request) {
			n := 26
			fmt.Sscanf(r.URL.Query().Get("n"), "%d", &n)
			b := benchmark(n)
			b["go"], b["os"], b["arch"] = runtime.Version(), runtime.GOOS, runtime.GOARCH
			writeJSON(w, b)
		})
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			srvErr = err
			return
		}
		srvURL = fmt.Sprintf("http://127.0.0.1:%d/", ln.Addr().(*net.TCPAddr).Port)
		go func() { _ = http.Serve(ln, mux) }()
	})
	return srvURL, srvErr
}

func startWebServer() string {
	u, err := startServer()
	if err != nil {
		return "listen failed: " + err.Error()
	}
	return u
}

// selfTest hits the server from Go, so a test can prove the loop without a WebView.
func selfTest() string {
	u, err := startServer()
	if err != nil {
		return "listen failed: " + err.Error()
	}
	cl := &http.Client{Timeout: 5 * time.Second}
	resp, err := cl.Get(u + "api/add?a=20&b=22")
	if err != nil {
		return "get failed: " + err.Error()
	}
	defer resp.Body.Close()
	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return "decode failed: " + err.Error()
	}
	b, _ := json.Marshal(v)
	return fmt.Sprintf("GET %sapi/add?a=20&b=22 -> %s", u, strings.TrimRight(string(b), "\n"))
}
