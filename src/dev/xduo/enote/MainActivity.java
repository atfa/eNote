package dev.xduo.enote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Context;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.lang.ref.WeakReference;
import java.util.Locale;

/**
 * The whole UI is a WebView pointed at the Go HTTP server; Java is a shell: WebView setup,
 * the image picker, and the headless test hooks (`am start --es hook ...`).
 */
public class MainActivity extends Activity {
    static final int REQ_IMG = 7;
    static final int REQ_FILE = 8;
    static final int REQ_IMPORT = 9;
    static final int REQ_NOTIFY = 10;
    /** A note/todo to open once the page is ready (notification tap). */
    static String pendingOpenNote;
    static String pendingOpenTodo;
    static boolean pendingOpenClip;
    WebView web;
    /** A native alert/confirm forwarded to the page; resolved by Bridge.dialogResult. */
    static JsResult pendingJs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bridge.init(getApplication());
        Bridge.current = new WeakReference<MainActivity>(this);
        handleIntent(getIntent());

        String url = Bridge.startServer();
        Theme.apply(this, Theme.loadMode(this));
        if (url == null || !url.startsWith("http")) {
            TextView t = new TextView(this);
            t.setText("Go 服务未启动\n" + url + "\n" + Bridge.initResult);
            int pad = (int) (20 * getResources().getDisplayMetrics().density);
            t.setPadding(pad, pad, pad, pad);
            t.setTextSize(14f);
            setContentView(t);
            note("no server: " + url);
            return;
        }
        openWeb(url);
    }

    @SuppressLint("SetJavaScriptEnabled")
    void openWeb(String url) {
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        // UI 内嵌在二进制里，装新版后不能拿到旧页面
        web.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "Android");
        // 页面没有横向滚动，但 WebView 自己的滑动拉伸效果还在：在“我的”页左滑会拉伸半个屏再弹回
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String u) {
                note("web: page finished " + u);
                flushPendingOpen();
            }

            @Override
            public void onReceivedError(WebView view, int code, String desc, String u) {
                note("web: ERROR " + code + " " + desc + " " + u);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                note("web console: " + m.message());
                return true;
            }

            /** 原生弹框顶着一行“网址为 http://127.0.0.1 的网页显示：”，全部转发给页面自绘的对话框。 */
            @Override
            public boolean onJsAlert(WebView v, String url, String message, JsResult result) {
                pendingJs = result;
                v.evaluateJavascript("window.uiDialog && uiDialog('提示', " + quote(message) + ", '')", null);
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String message, JsResult result) {
                pendingJs = result;
                v.evaluateJavascript("window.uiDialog && uiDialog('确认', " + quote(message) + ", 'js')", null);
                return true;
            }
        });
        setContentView(web);
        note("web: loading " + url);
        web.loadUrl(url);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /** Test hooks + share intents delivered to a running instance. */
    void handleIntent(Intent intent) {
        if (intent == null) return;
        String hook = intent.getStringExtra("hook");
        if (hook != null && hook.length() > 0) runHook(hook);
        String open = intent.getStringExtra("openNote");
        if (open == null || open.isEmpty()) open = intent.getStringExtra("openTodo");
        if (open != null && open.length() > 0) {
            // The reminder notification carries real ids: note to expand + todo to highlight.
            String todo = intent.getStringExtra("openTodoId");
            note("open from notification: note=" + open + " todo=" + todo);
            pendingOpenNote = open;
            pendingOpenTodo = todo == null ? "" : todo;
            flushPendingOpen();
        }
        if ("1".equals(intent.getStringExtra("openClip"))) {
            note("open clip from notification");
            pendingOpenClip = true;
            flushPendingOpen();
        }
        String text = intent.getStringExtra("shareText");
        if (text != null && text.length() > 0) {
            note("hook: shareText " + text.length() + " chars");
            Bridge.enqueueText(text, intent.getStringExtra("shareSubject"), "share-text");
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        Bridge.current = new WeakReference<MainActivity>(this);
        // "auto" follows the system night mode, which can change while we are backgrounded.
        Theme.apply(this, Theme.loadMode(this));
        // 前台剪贴板监听（R7/P6）：Android 10+ 只有有焦点的 app 能读剪贴板，所以只能前台暂存。
        // 用户从别处复制、切回来时 onResume 会把内容暂存，Go 侧去重避免重复。
        registerClipboard();
        drainClipboard();
        // 常驻后台：用户在设置里开过就重新拉起（进程被回收后回来也能恢复）
        KeepAlive.resumeIfEnabled(this);
        // 从系统设置页（电池优化 / 通知权限）回来时刷新设置页的状态
        if (web != null) runJs("window.onAppResume && onAppResume()");
    }

    @Override
    protected void onPause() {
        super.onPause();
        ClipboardManager cm = clipboard;
        if (cm != null) {
            try { cm.removePrimaryClipChangedListener(clipListener); } catch (Throwable ignored) {}
        }
    }

    // ---------------------------------------------------------------- clipboard (foreground)

    ClipboardManager clipboard;
    final ClipboardManager.OnPrimaryClipChangedListener clipListener =
            new ClipboardManager.OnPrimaryClipChangedListener() {
                @Override public void onPrimaryClipChanged() { drainClipboard(); }
            };

    void registerClipboard() {
        try {
            clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (clipboard != null) clipboard.addPrimaryClipChangedListener(clipListener);
        } catch (Throwable t) {
            Log.w("enote", "registerClipboard: " + t);
        }
    }

    /** Reads the clipboard once (we have focus here) and holds the text back, unparsed. */
    void drainClipboard() {
        new Thread(new Runnable() {
            public void run() {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    ClipData cd = cm == null ? null : cm.getPrimaryClip();
                    if (cd == null || cd.getItemCount() == 0) return;
                    CharSequence cs = cd.getItemAt(0).getText();
                    if (cs == null) return;
                    String text = cs.toString();
                    if (text.trim().isEmpty()) return;
                    String app = "";
                    try {
                        CharSequence l = cd.getDescription() != null ? cd.getDescription().getLabel() : null;
                        if (l != null) app = l.toString();
                    } catch (Throwable ignored) {}
                    if (Bridge.clipAdd("text", text, "", "", "", app)) {
                        note("clip: 暂存文字 " + text.length() + " 字");
                    }
                } catch (Throwable t) {
                    Log.w("enote", "clip: " + t);
                }
            }
        }, "clip-front").start();
    }

    // ---------------------------------------------------------------- image picker

    /** Called from JS: window.Android.pickImage(). */
    public void pickImage() {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.setType("image/*");
        i.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            startActivityForResult(Intent.createChooser(i, "选择图片"), REQ_IMG);
        } catch (Throwable t) {
            note("pickImage failed: " + t);
        }
    }

    /** Called from JS: window.Android.pickFile() - any document, not only images. */
    public void pickFile() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.setType("*/*");
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "image/*", "text/*", "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-powerpoint",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "application/zip", "audio/*", "video/*"});
        try {
            startActivityForResult(Intent.createChooser(i, "添加附件"), REQ_FILE);
        } catch (Throwable t) {
            note("pickFile failed: " + t);
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null || data.getData() == null) return;
        if (req == REQ_FILE) { pickDocument(data.getData()); return; }
        if (req == REQ_IMPORT) { importJSON(data.getData()); return; }
        if (req != REQ_IMG) return;
        final Uri uri = data.getData();
        new Thread(new Runnable() {
            public void run() {
                try {
                    File f = copyIn(uri);
                    note("picked image -> " + f);
                    OcrHelper.Out o = OcrHelper.get(MainActivity.this).recognizeFile(
                            f.getAbsolutePath());
                    String r = Bridge.enqueueImage(null, f.getAbsolutePath(), f.getName(),
                            o.text, o.ms, o.error, "manual-image");
                    note("enqueue manual-image -> " + r);
                } catch (Throwable t) {
                    Log.e("enote", "pick failed", t);
                    Bridge.enqueueImage(null, "", String.valueOf(uri), "", 0,
                            "图片处理失败: " + t, "manual-image");
                }
            }
        }).start();
    }

    /** The 附件页 "添加附件" path: images go through OCR, everything else is stored as a file. */
    void pickDocument(final Uri uri) {
        new Thread(new Runnable() {
            public void run() {
                try {
                    String mime = getTypeFor(uri);
                    File f = copyIn(uri);
                    String name = displayName(uri, f.getName());
                    note("picked file -> " + f + " (" + mime + ")");
                    if (mime.startsWith("image/")) {
                        OcrHelper.Out o = OcrHelper.get(MainActivity.this)
                                .recognizeFile(f.getAbsolutePath());
                        note("enqueue manual-image -> " + Bridge.enqueueImage(null,
                                f.getAbsolutePath(), name, o.text, o.ms, o.error, "manual-image"));
                        return;
                    }
                    note("enqueue manual-file -> " + Bridge.enqueueFile(
                            f.getAbsolutePath(), name, mime, "", "manual-file"));
                } catch (Throwable t) {
                    Log.e("enote", "pick file failed", t);
                    Bridge.enqueueFile("", String.valueOf(uri), "",
                            "文件处理失败: " + t, "manual-file");
                }
            }
        }).start();
    }

    String getTypeFor(Uri uri) {
        try {
            String m = getContentResolver().getType(uri);
            if (m != null && m.length() > 0) return m;
        } catch (Throwable ignored) {
        }
        return "application/octet-stream";
    }

    String displayName(Uri uri, String fallback) {
        try {
            android.database.Cursor c = getContentResolver().query(uri,
                    new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null) {
                try {
                    if (c.moveToFirst()) {
                        String s = c.getString(0);
                        if (s != null && s.length() > 0) return s;
                    }
                } finally {
                    c.close();
                }
            }
        } catch (Throwable ignored) {
        }
        return fallback;
    }

    /** Called from JS: window.Android.pickJSON() - restore a JSON export (设置 → 数据). */
    /** Runs JS on the UI thread; the page owns all state, Java only nudges it. */
    void runJs(final String js) {
        runOnUiThread(new Runnable() {
            public void run() {
                try { web.evaluateJavascript(js, null); } catch (Throwable t) { note("runJs: " + t); }
            }
        });
    }

    /** Opens the note/todo a reminder notification pointed at, once the page can handle it. */
    void flushPendingOpen() {
        final String id = pendingOpenNote;
        final String todo = pendingOpenTodo;
        final boolean clip = pendingOpenClip;
        pendingOpenNote = null;
        pendingOpenTodo = null;
        pendingOpenClip = false;
        if ((id == null || id.isEmpty()) && !clip) return;
        if (web == null) return;
        web.postDelayed(new Runnable() {
            public void run() {
                if (clip) {
                    runJs("window.openClip && openClip()");
                } else if (todo != null && !todo.isEmpty()) {
                    runJs("window.openTodo && openTodo('" + id + "','" + todo + "')");
                } else {
                    runJs("window.openNote && openNote('" + id + "')");
                }
            }
        }, 700);
    }

    /** Android 13+ asks the user once; older systems grant at install. */
    static boolean notifyGranted(Context c) {
        if (android.os.Build.VERSION.SDK_INT < 33) return true;
        return c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    void askNotifyPermission() {
        if (android.os.Build.VERSION.SDK_INT < 33) {
            note("notify: 系统低于 13，通知默认有权限");
            return;
        }
        if (notifyGranted(this)) {
            note("notify: 已有权限");
            return;
        }
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        super.onRequestPermissionsResult(req, perms, res);
        if (req == REQ_NOTIFY) {
            boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
            note("notify: 用户选择 granted=" + ok);
            runJs("window.notifyResult && notifyResult(" + ok + ")");
        }
    }

    /**
     * R13-A: hand a due todo to the system calendar. ACTION_INSERT needs no permission and
     * lets the user confirm in the calendar app, which owns its own reminder machinery.
     */
    public void addToCalendar(String title, long dueMs) {
        long end = dueMs + 30 * 60 * 1000L;
        Intent i = new Intent(Intent.ACTION_INSERT);
        i.setData(CalendarContract.Events.CONTENT_URI);
        i.putExtra(CalendarContract.Events.TITLE, title);
        i.putExtra(CalendarContract.Events.DESCRIPTION, "来自 懒得记");
        i.putExtra(CalendarContract.Events.DTSTART, dueMs);
        i.putExtra(CalendarContract.Events.DTEND, end);
        i.putExtra(CalendarContract.Events.ALL_DAY, false);
        // vivo/AOSP 日历读这两个 key 预填时间（Intent.EXTRA_EVENT_* 在 API 33 里不存在）
        i.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, dueMs);
        i.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end);
        i.putExtra(Intent.EXTRA_EMAIL, "");
        launchExternal(i, "日历");
    }

    /** R13-B: system alarm at the due time; some vendor clock apps ignore SKIP_UI. */
    public void setAlarm(long dueMs, String label) {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.setTimeInMillis(dueMs);
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        i.putExtra(AlarmClock.EXTRA_HOUR, c.get(java.util.Calendar.HOUR_OF_DAY));
        i.putExtra(AlarmClock.EXTRA_MINUTES, c.get(java.util.Calendar.MINUTE));
        i.putExtra(AlarmClock.EXTRA_MESSAGE, label);
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        i.putExtra(AlarmClock.EXTRA_VIBRATE, true);
        launchExternal(i, "闹钟");
    }

    private void launchExternal(Intent i, String what) {
        try {
            startActivity(i);
            note(what + "：已交给系统应用");
        } catch (Throwable t) {
            note(what + "：没有可用的系统应用（" + t.getClass().getSimpleName() + "）");
            Toast.makeText(this, "这台机器没有可用的" + what + "应用", Toast.LENGTH_SHORT).show();
        }
    }

    public void pickJSON() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.setType("*/*");
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.putExtra(Intent.EXTRA_MIME_TYPES,
                new String[]{"application/json", "text/plain", "application/octet-stream"});
        try {
            startActivityForResult(Intent.createChooser(i, "选择导出的 JSON"), REQ_IMPORT);
        } catch (Throwable t) {
            note("pickJSON failed: " + t);
        }
    }

    /**
     * Reads a JSON export and POSTs it to the Go server (/api/import). No JNI symbol is
     * needed: the Go HTTP API is loopback, so plain HttpURLConnection is the cheapest seam.
     */
    void importJSON(final Uri uri) {
        new Thread(new Runnable() {
            public void run() {
                final String msg;
                try {
                    String url = Bridge.serverUrl;
                    if (url == null || url.isEmpty()) url = Bridge.startServer();
                    if (url == null || url.isEmpty()) throw new IllegalStateException("Go 服务未启动");
                    byte[] body = readAll(getContentResolver().openInputStream(uri), 64 << 20);
                    String res = post(url + "api/import", body);
                    note("import -> " + res);
                    org.json.JSONObject o = new org.json.JSONObject(res);
                    msg = o.optBoolean("ok")
                            ? ("导入完成：新增 " + o.optInt("imported") + " 条，跳过 "
                               + o.optInt("skipped") + " 条已存在")
                            : ("导入失败：" + o.optString("error"));
                } catch (Throwable t) {
                    note("import failed: " + t);
                    toast("导入失败：" + t);
                    return;
                }
                toast(msg);
                runOnUiThread(new Runnable() {
                    public void run() {
                        if (web != null) web.evaluateJavascript("ST=null;refresh();statsNow();", null);
                    }
                });
            }
        }).start();
    }

    void toast(final String msg) {
        runOnUiThread(new Runnable() {
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    static byte[] readAll(java.io.InputStream in, int max) throws Exception {
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n, total = 0;
        try {
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > max) throw new IllegalArgumentException("文件超过 64 MB");
                bo.write(buf, 0, n);
            }
        } finally {
            try { in.close(); } catch (Throwable ignored) { }
        }
        return bo.toByteArray();
    }

    static String post(String url, byte[] body) throws Exception {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
        c.setConnectTimeout(5000);
        c.setReadTimeout(120000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        java.io.OutputStream os = c.getOutputStream();
        os.write(body);
        os.close();
        java.io.InputStream in = c.getResponseCode() < 400 ? c.getInputStream() : c.getErrorStream();
        return new String(readAll(in, 1 << 20), "UTF-8");
    }

    File copyIn(Uri uri) throws Exception {
        String name = null;
        try {
            android.database.Cursor c = getContentResolver().query(uri,
                    new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null) {
                try {
                    if (c.moveToFirst()) name = c.getString(0);
                } finally {
                    c.close();
                }
            }
        } catch (Throwable ignored) {
        }
        if (name == null) name = uri.getLastPathSegment();
        String ext = ".jpg";
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot > 0 && dot > name.length() - 7) ext = name.substring(dot);
        }
        File out = new File(OcrHelper.inboxDir(this), System.currentTimeMillis() + ext);
        InputStream in = getContentResolver().openInputStream(uri);
        FileOutputStream fo = new FileOutputStream(out);
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
        fo.close();
        in.close();
        return out;
    }

    // ---------------------------------------------------------------- headless hooks

    /** `am start -n dev.xduo.enote/.MainActivity --es hook selftest [--es arg {...}]` */
    void runHook(final String hook) {
        final String arg = getIntent().getStringExtra("arg");
        // Off the main thread: a selftest waits for a full llm round trip and anr's otherwise.
        new Thread(new Runnable() {
            @Override
            public void run() {
                String out;
                if ("status".equals(hook)) {
                    out = Bridge.statusStatic();
                } else if ("enqueue".equals(hook)) {
                    out = Bridge.nativeEnqueue(arg == null ? "{}" : arg);
                } else if ("exact".equals(hook)) {
                    out = "{\"exact\":" + Reminders.exactGranted(MainActivity.this)
                        + ",\"notify\":" + notifyGranted(MainActivity.this)
                        + ",\"sdk\":" + android.os.Build.VERSION.SDK_INT + "}";
                } else if ("calendar".equals(hook)) {
                    final String t = arg == null ? "懒得记 hook 测试" : arg;
                    runOnUiThread(new Runnable() {
                        public void run() { addToCalendar(t, System.currentTimeMillis() + 3600000L); }
                    });
                    out = "{\"ok\":true,\"what\":\"calendar\"}";
                } else if ("alarm".equals(hook)) {
                    final String t = arg == null ? "懒得记 hook 测试" : arg;
                    runOnUiThread(new Runnable() {
                        public void run() { setAlarm(System.currentTimeMillis() + 3600000L, t); }
                    });
                    out = "{\"ok\":true,\"what\":\"alarm\"}";
                } else if ("keepalive".equals(hook)) {
                    // headless switch for the acceptance test: on|off, then report the state
                    boolean on = !"off".equals(arg);
                    KeepAlive.setEnabled(MainActivity.this, on);
                    out = "{\"keepAlive\":" + KeepAlive.enabled(MainActivity.this)
                        + ",\"batteryIgnoring\":" + KeepAlive.ignoringBattery(MainActivity.this)
                        + ",\"pending\":" + Reminders.sync(MainActivity.this, Bridge.remindersFromStore())
                        + "}";
                } else {
                    out = Bridge.nativeSelfTest(arg == null ? "{\"mode\":\"all\"}" : arg);
                }
                note("hook " + hook + ": " + out);
            }
        }).start();
    }

    void note(String msg) {
        Log.i("enote", msg);
        try (FileOutputStream f = new FileOutputStream(
                new File(getFilesDir(), "testlog.txt"), true);
             OutputStreamWriter w = new OutputStreamWriter(f, "UTF-8")) {
            w.write(String.format(Locale.US, "%.3f %s\n", System.currentTimeMillis() / 1000.0, msg));
        } catch (Exception e) {
            Log.w("enote", "testlog: " + e);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.getRepeatCount() == 0) back();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /** 侧滑返回在部分 ROM 上不走 onKeyDown，而是直接调 onBackPressed()，两条路都接上。 */
    @Override
    public void onBackPressed() {
        back();
    }

    private boolean backInFlight;
    private long lastBackAt;

    private final Runnable backReset = new Runnable() {
        public void run() { backInFlight = false; }
    };

    /**
     * 返回：先关对话框 → 关面板 → 回笔记页；已经在笔记页了就连按两次才退出，
     * 侧滑一下就直接退 app 不符合操作习惯。
     */
    private void back() {
        if (backInFlight) return;   // 同一次返回可能被按键和手势各派发一次
        final WebView w = web;
        if (w == null) { finish(); return; }
        // 导出 JSON 这类整页跳转：返回键先回退网页历史，否则会被困在 JSON 页里出不去
        if (w.canGoBack()) { w.goBack(); return; }
        backInFlight = true;
        w.postDelayed(backReset, 800);
        w.evaluateJavascript("window.uiBack ? uiBack() : 0", new ValueCallback<String>() {
            public void onReceiveValue(String v) {
                backInFlight = false;
                w.removeCallbacks(backReset);
                if ("1".equals(v) || "true".equals(v)) return;
                long now = System.currentTimeMillis();
                if (now - lastBackAt < 2200) { finish(); return; }
                lastBackAt = now;
                Toast.makeText(MainActivity.this, "再返回一次退出 懒得记", Toast.LENGTH_SHORT).show();
            }
        });
    }

    static String quote(String s) {
        return "\"" + (s == null ? "" : s).replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "").replace("\t", "\\t") + "\"";
    }
}
