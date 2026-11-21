package dev.xduo.enote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

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
    WebView web;

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

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_IMG || res != RESULT_OK || data == null || data.getData() == null) {
            return;
        }
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
            if (web != null && web.canGoBack()) {
                web.goBack();
                return true;
            }
            finish();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
