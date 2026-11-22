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
import android.os.SystemClock;
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
    static final int REQ_SHOTS = 11;   // P11 截图捕获：读媒体库图片
    /** A note/todo to open once the page is ready (notification tap). */
    static String pendingOpenNote;
    static String pendingOpenTodo;
    static boolean pendingOpenClip;
    volatile boolean pageReady;   // onPageFinished 之后页面才认 window.openNote 这些函数
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
                pageReady = true;
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
        // arg 要在 removeExtra 之前取：runHook 也读它，先删掉的话 hook 只会看到默认值
        //（真踩过：`--es hook keepalive --es arg off` 变成默认 on，测试永远说服务停不掉）
        final String hookArg = intent.getStringExtra("arg");
        if (hook != null && hook.length() > 0) {
            // 不删的话，这个 intent 会一直是 task 的入口 intent，每次重启/恢复都重跑一次
            // hook（以前发生过：开机后 clipset 重跑，把用户刚复制的内容盖掉了）
            intent.removeExtra("hook");
            intent.removeExtra("arg");
            runHook(hook, hookArg);
        }
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
        clipTries = 0;
        resumedNow = true;
        foreground = true;
        clipWaitingFocus = true;
        clipWaitStart = SystemClock.uptimeMillis();
        drainClipboard();
        // P11 截图捕获：每次回到前台扫一次（只看水位之后的新图，第一次只记水位）
        scanShotsAsync();
        // 常驻后台：用户在设置里开过就重新拉起（进程被回收后回来也能恢复）
        KeepAlive.resumeIfEnabled(this);
        // 从系统设置页（电池优化 / 通知权限）回来时刷新设置页的状态
        if (web != null) runJs("window.onAppResume && onAppResume()");
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumedNow = false;
        foreground = false;
        ClipboardManager cm = clipboard;
        if (cm != null) {
            try { cm.removePrimaryClipChangedListener(clipListener); } catch (Throwable ignored) {}
        }
    }

    // ---------------------------------------------------------------- clipboard (foreground)

    ClipboardManager clipboard;
    int clipTries;                // 被系统拒读时的重试次数
    long clipWaitStart;           // 本轮等待焦点的起点（uptimeMillis）
    boolean clipWaitingFocus;    // onResume 比窗口拿到焦点更早，等焦点到了再读一次
    boolean resumedNow;           // 只给诊断日志用
    static volatile boolean foreground;   // 给常驻服务判断「要不要发通知」（同进程）
    final ClipboardManager.OnPrimaryClipChangedListener clipListener =
            new ClipboardManager.OnPrimaryClipChangedListener() {
                @Override public void onPrimaryClipChanged() { drainClipboard(); }
            };
    final Runnable clipRetry = new Runnable() {
        @Override public void run() { drainClipboard(); }
    };

    /**
     * Android 10+ 只允许「当前焦点窗口」读剪贴板，被拒时 getPrimaryClip() 直接返回 null（不抛异常）：
     * ClipboardService: Denying clipboard access to dev.xduo.enote, application is not in focus.
     * onResume 跑得比窗口拿到焦点早，所以从通知点进来的那一次必然读不到，得等焦点。
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        note("window focus: " + hasFocus + (clipWaitingFocus ? " → 补读剪贴板" : ""));
        if (hasFocus && clipWaitingFocus) {
            clipWaitingFocus = false;
            drainClipboard();
        }
    }

    /** JS 里点「📋」：此刻窗口已有焦点，读得到；把结果回到页面。 */
    void clipImportNow() {
        final int before = Bridge.nativeClipCount();
        clipTries = 0;
        drainClipboard();
        if (web == null) return;
        web.postDelayed(new Runnable() {
            @Override public void run() {
                int after = Bridge.nativeClipCount();
                runJs("window.onClipRead && onClipRead(" + after + "," + (after > before) + ")");
            }
        }, 400);
    }

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
                    if (cm == null) { note("clip 拿不到 ClipboardManager"); return; }
                    ClipData cd = cm.getPrimaryClip();
                    if (cd == null) {
                        boolean has = cm.hasPrimaryClip();
                        // 空剪贴板和「无焦点被拒」都返回 null，分不开，所以只要还在等焦点就继续
                        // 重试（上限 20 秒）；焦点到了 onWindowFocusChanged 也会立刻叫一次。
                        // 重试只走一条链：监听器、焦点回调、上一次重试会同时叫，不排队的话
                        // 一次复制能刷出几十个线程。
                        long waited = SystemClock.uptimeMillis() - clipWaitStart;
                        boolean keep = clipWaitingFocus && clipTries < 40 && waited < 20000L;
                        if (keep && web != null) {
                            // 只排一次：post 到同一个 Runnable，重复 post 会先撤掉上一次，
                            // 所以监听器/焦点回调/上一次重试一起叫也只有一条链。
                            clipTries++;
                            web.postDelayed(clipRetry, Math.min(1200L, 250L * clipTries));
                        }
                        note("clip drain#" + clipTries + " 读不到（hasPrimaryClip=" + has
                                + ", windowFocus=" + (web != null && web.hasWindowFocus())
                                + ", resumed=" + resumedNow + ", 已等 " + (waited / 1000)
                                + "s, 继续重试=" + keep + "）"
                                + (KeepAlive.clipHint(Bridge.appCtx != null ? Bridge.appCtx : getApplicationContext()) ? " · 后台看到过变化" : ""));
                        return;
                    }
                    clipTries = 0;
                    clipWaitingFocus = false;
                    if (cd.getItemCount() == 0) { note("clip 剪贴板为空"); return; }
                    ClipData.Item it = cd.getItemAt(0);
                    String app = "";
                    try {
                        CharSequence l = cd.getDescription() != null ? cd.getDescription().getLabel() : null;
                        if (l != null) app = l.toString();
                    } catch (Throwable ignored) {}
                    CharSequence cs = null;
                    String via = "text";
                    try { cs = it.getText(); } catch (Throwable ignored) {}
                    if (cs == null || cs.toString().trim().isEmpty()) {
                        // 浏览器复制常常是 content:// URI（Chrome / vivo 浏览器都这样），
                        // getText() 就是 null；coerceToText 是官方给的标准做法，会去读那个 provider。
                        via = "coerce";
                        try {
                            cs = it.coerceToText(getApplicationContext());
                        } catch (Throwable t) {
                            note("clip coerceToText 失败: " + t);
                        }
                    }
                    if (cs == null) {
                        note("clip 没有文字项（label=" + app + ", uri="
                                + (it.getUri() == null ? "无" : it.getUri().getScheme()) + "）");
                        return;
                    }
                    String text = cs.toString();
                    if (text.trim().isEmpty()) { note("clip 只有空白字符"); return; }
                    boolean added = Bridge.clipAdd("text", text, "", "", "", app);
                    note("clip " + (added ? "暂存文字 " : "重复，未暂存 ") + text.length()
                            + " 字（" + via + ", label=" + app + "）："
                            + text.substring(0, Math.min(24, text.length())).replace("\n", "\\n"));
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

    /**
     * Opens the note/todo a reminder notification pointed at, once the page can handle it.
     *
     * 页没加载完就必须原样留着 pending —— 冷启动时 onNewIntent/onCreate 到的 intent 比
     * onPageFinished 早，以前先清 pending 再 postDelayed，700ms 后那几行 JS 落在
     * window.openNote 还不存在的时候，通知点进来什么都没发生（实测复现）。
     */
    void flushPendingOpen() {
        if (web == null || !pageReady) return;   // 等 onPageFinished 再调一次
        final String id = pendingOpenNote;
        final String todo = pendingOpenTodo;
        final boolean clip = pendingOpenClip;
        pendingOpenNote = null;
        pendingOpenTodo = null;
        pendingOpenClip = false;
        if ((id == null || id.isEmpty()) && !clip) return;
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
        } else if (req == REQ_SHOTS) {
            boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
            note("shots: media permission granted=" + ok);
            runJs("window.shotPermResult && shotPermResult(" + ok + ")");
            if (ok) scanShotsAsync();
        }
    }

    // ---------------------------------------------------------------- 截图捕获 (P11)

    void askMediaPermission() {
        if (Shots.mediaGranted(this)) {
            note("shots: 已有媒体权限");
            runJs("window.shotPermResult && shotPermResult(true)");
            return;
        }
        try {
            requestPermissions(new String[]{Shots.permName()}, REQ_SHOTS);
        } catch (Throwable t) {
            note("shots: requestPermissions failed " + t);
        }
    }

    /** 后台线程扫一次，扫完把条数推给页面（首页 banner 自己会再拉 /api/shots/list）。 */
    void scanShotsAsync() {
        if (!Shots.enabled(this)) return;
        if (!Shots.mediaGranted(this)) {
            note("shots: 没权限，先不扫");
            return;
        }
        new Thread(new Runnable() {
            public void run() {
                int n = Shots.scan(MainActivity.this, false, null, 0);
                note("shots: scan -> " + n);
                runJs("window.shotsScanned && shotsScanned(" + n + ")");
            }
        }, "shot-scan").start();
    }

    /** 导入/解析期间别让屏幕黑掉（用户明确要求"不要黑屏、不要退出"，所以真的做）。 */
    void keepScreenOn(final boolean on) {
        runOnUiThread(new Runnable() {
            public void run() {
                if (on) {
                    getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
                note("shots: keepScreenOn=" + on);
            }
        });
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
    void runHook(final String hook) { runHook(hook, getIntent().getStringExtra("arg")); }

    void runHook(final String hook, final String arg) {
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
                } else if ("cliphtml".equals(hook)) {
                    // 浏览器复制的真实形状：ClipData.newHtmlText("data", 文字, html)，
                    // Chrome / vivo 浏览器都是这个，label 是 "data"，第一项带 text + html。
                    final String t = arg == null ? "浏览器复制测试 https://example.com/a?b=1\n第二行" : arg;
                    runOnUiThread(new Runnable() {
                        public void run() {
                            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                            if (cm != null) {
                                cm.setPrimaryClip(ClipData.newHtmlText("data", t,
                                        "<html><body>" + t + "</body></html>"));
                            }
                            clipTries = 0;
                            clipWaitingFocus = true;
                            clipWaitStart = SystemClock.uptimeMillis();
                            drainClipboard();
                        }
                    });
                    out = "{\"ok\":true,\"len\":" + t.length() + "}";
                } else if ("clipset".equals(hook)) {
                    // 模拟「在别的 app 里复制了一段文字」：写剪贴板，接下来的前台读走哪条路径跟真实场景一致
                    final String t = arg == null ? "懒得记 剪贴板测试" : arg;
                    final boolean[] written = {false};
                    final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
                    runOnUiThread(new Runnable() {
                        public void run() {
                            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                            if (cm == null) { note("clipset 拿不到 ClipboardManager"); return; }
                            try {
                                cm.setPrimaryClip(ClipData.newPlainText("hook", t));
                            } catch (Throwable e) {
                                note("clipset setPrimaryClip 抛异常: " + e);
                                return;
                            }
                            // 写完立刻回读：写不进去是系统不让写（无焦点的窗口连写都被拒），
                            // 不是 app 的 bug，测试要能分辨这两件事
                            ClipData back = cm.getPrimaryClip();
                            written[0] = back != null && back.getItemCount() > 0;
                            note("clipset 写完回读：" + (written[0]
                                    ? "ok focus=" + (web != null && web.hasWindowFocus())
                                    : "null（写入被系统忽略）focus=" + (web != null && web.hasWindowFocus())));
                            clipTries = 0;
                            clipWaitingFocus = true;
                            clipWaitStart = SystemClock.uptimeMillis();
                            drainClipboard();
                            done.countDown();
                        }
                    });
                    try { done.await(3, java.util.concurrent.TimeUnit.SECONDS); } catch (Throwable ignored) {}
                    out = "{\"ok\":true,\"len\":" + t.length() + ",\"written\":" + written[0] + "}";
                } else if ("shotscan".equals(hook)) {
                    // 验收用：{"force":true,"folders":["Pictures/Screenshots"],"rangeDays":1}
                    boolean force = false;
                    int rangeDays = 0;
                    org.json.JSONArray fo = null;
                    try {
                        org.json.JSONObject o = new org.json.JSONObject(arg == null ? "{}" : arg);
                        force = o.optBoolean("force", false);
                        rangeDays = o.optInt("rangeDays", 0);
                        if (o.has("folders")) fo = o.optJSONArray("folders");
                    } catch (Throwable ignored) {}
                    int n = Shots.scan(MainActivity.this, force, fo, rangeDays);
                    out = "{\"ok\":" + (n >= 0) + ",\"added\":" + n
                        + ",\"granted\":" + Shots.mediaGranted(MainActivity.this)
                        + ",\"watermark\":" + Shots.watermark(MainActivity.this) + "}";
                } else if ("shotfolders".equals(hook)) {
                    // 验收用：{"folders":["Pictures/Screenshots"]}，不传就只打印状态
                    try {
                        org.json.JSONObject o = new org.json.JSONObject(arg == null ? "{}" : arg);
                        if (o.has("folders")) {
                            org.json.JSONArray a = o.optJSONArray("folders");
                            java.util.Set<String> want = new java.util.LinkedHashSet<String>();
                            for (int i = 0; i < a.length(); i++) want.add(a.optString(i));
                            Shots.setFolders(MainActivity.this, want);
                        }
                        if (o.has("enabled")) Shots.setEnabled(MainActivity.this, o.optBoolean("enabled"));
                    } catch (Throwable ignored) {}
                    out = Shots.stateJson(MainActivity.this);
                } else if ("shotimport".equals(hook)) {
                    // 验收用：{"mode":"merge","raw":false,"shots":[{path,name,mime}]}
                    out = Shots.importShots(MainActivity.this, arg == null ? "{}" : arg);
                } else if ("clipnotify".equals(hook)) {
                    // 验收用：直接发一条剪贴板通知（这台 ROM 后台不投递监听，靠这条测通知本身）
                    KeepAlive.notifyClip(MainActivity.this, Bridge.clipCount());
                    out = "{\"ok\":true,\"clips\":" + Bridge.clipCount() + "}";
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
