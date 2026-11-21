package dev.xduo.enote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
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
                Toast.makeText(MainActivity.this, "再返回一次退出 eNote", Toast.LENGTH_SHORT).show();
            }
        });
    }

    static String quote(String s) {
        return "\"" + (s == null ? "" : s).replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "").replace("\t", "\\t") + "\"";
    }
}
