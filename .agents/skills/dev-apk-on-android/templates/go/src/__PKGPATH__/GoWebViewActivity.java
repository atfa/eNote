package __PACKAGE__;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.util.Locale;

/**
 * The "no Java business logic at all" variant: a Go HTTP server (net/http, inside
 * lib__GO_LIB__.so) serves an HTML page and a JSON API, and the WebView is only a renderer.
 *
 * Java here is ~70 lines of plumbing; every line of business logic is Go.
 * Needs <uses-permission android:name="android.permission.INTERNET"/> and
 * android:usesCleartextTraffic="true" (the server is plain http on 127.0.0.1).
 */
public class GoWebViewActivity extends Activity {
    WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String url = getIntent().getStringExtra("url");
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
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
        setContentView(web);
        note("web: loading " + url);
        web.loadUrl(url);
    }

    void note(String msg) {
        Log.i("__TAG__", msg);
        try (FileOutputStream f = new FileOutputStream(
                new File(getFilesDir(), "testlog.txt"), true);
             OutputStreamWriter w = new OutputStreamWriter(f, "UTF-8")) {
            w.write(String.format(Locale.US, "%.3f %s\n",
                    System.currentTimeMillis() / 1000.0, msg));
        } catch (Exception e) {
            Log.w("__TAG__", "testlog: " + e);
        }
    }

    /** JS calls window.Android.fromWeb(...) - the way back into Java / Android APIs. */
    class Bridge {
        @JavascriptInterface
        public void fromWeb(String msg) {
            note("check webview: js says " + msg);
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
