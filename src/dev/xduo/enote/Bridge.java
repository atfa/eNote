package dev.xduo.enote;

import android.content.Context;
import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

/**
 * The only Java/Go seam.
 *
 * Java -> Go: the static native methods (symbol names are
 * Java_dev_xduo_enote_Bridge_&lt;method&gt; in libenote.so).
 * Go -> Java: the WebView's window.Android object, i.e. the @JavascriptInterface methods
 * below. Go never calls back into the JVM: the UI polls the Go HTTP API instead, which
 * keeps the JNI surface tiny (no global refs, no AttachCurrentThread).
 */
public class Bridge {
    static final String TAG = "enote";
    static WeakReference<MainActivity> current = new WeakReference<MainActivity>(null);
    static volatile boolean loaded;
    static volatile String initResult = "not initialised";
    static volatile String serverUrl = "";
    static volatile String loadError = "";

    static native String nativeInit(String filesDir);
    static native String nativeStartServer();
    static native String nativeEnqueue(String payloadJson);
    static native String nativeStatus();
    static native String nativeSelfTest(String json);
    static native String nativeNoteImage(String id);
    static native void nativeSetOcr(boolean ready, String info);

    static synchronized void init(Context c) {
        if (loaded) return;
        try {
            System.loadLibrary("enote");
            loaded = true;
        } catch (Throwable t) {
            loadError = String.valueOf(t);
            Log.e(TAG, "loadLibrary(enote) failed", t);
            return;
        }
        initResult = nativeInit(c.getFilesDir().getAbsolutePath());
        Log.i(TAG, "nativeInit -> " + initResult);
    }

    static String startServer() {
        if (!loaded) return "";
        if (serverUrl.isEmpty()) {
            serverUrl = nativeStartServer();
            Log.i(TAG, "server -> " + serverUrl);
        }
        return serverUrl;
    }

    // ---------------------------------------------------------------- text / image in

    static String enqueueText(String text, String subject, String source) {
        JSONObject o = new JSONObject();
        try {
            o.put("kind", "text");
            o.put("text", text == null ? "" : text);
            o.put("subject", subject == null ? "" : subject);
            o.put("source", source);
        } catch (Exception e) {
            return "{\"error\":\"" + e + "\"}";
        }
        return nativeEnqueue(o.toString());
    }

    static String enqueueImage(String id, String path, String name, String ocr,
                               long ocrMs, String ocrError, String source) {
        JSONObject o = new JSONObject();
        try {
            o.put("kind", "image");
            if (id != null && !id.isEmpty()) o.put("id", id);
            o.put("path", path);
            o.put("name", name);
            o.put("ocr", ocr == null ? "" : ocr);
            o.put("ocrMs", ocrMs);
            o.put("ocrError", ocrError == null ? "" : ocrError);
            o.put("source", source);
        } catch (Exception e) {
            return "{\"error\":\"" + e + "\"}";
        }
        return nativeEnqueue(o.toString());
    }

    static String enqueueFile(String path, String name, String mime, String error, String source) {
        JSONObject o = new JSONObject();
        try {
            o.put("kind", "file");
            o.put("path", path == null ? "" : path);
            o.put("name", name == null ? "" : name);
            o.put("mime", mime == null ? "" : mime);
            o.put("fileError", error == null ? "" : error);
            o.put("source", source);
        } catch (Exception e) {
            return "{\"error\":\"" + e + "\"}";
        }
        return nativeEnqueue(o.toString());
    }

    // ---------------------------------------------------------------- webview bridge

    /** Called from JS as window.Android.pickImage() - opens the system image picker. */
    @JavascriptInterface
    public void pickImage() {
        MainActivity a = current.get();
        Log.i(TAG, "js pickImage");
        if (a != null) a.pickImage();
    }

    /** window.Android.pickFile(): any document (ACTION_OPEN_DOCUMENT), for the 附件 page. */
    @JavascriptInterface
    public void pickFile() {
        MainActivity a = current.get();
        Log.i(TAG, "js pickFile");
        if (a != null) a.pickFile();
    }

    /** window.Android.reocr(id): re-run the local OCR on a note's stored image. */
    @JavascriptInterface
    public void reocr(final String id) {
        Log.i(TAG, "js reocr " + id);
        new Thread(new Runnable() {
            public void run() {
                String path = loaded ? nativeNoteImage(id) : "";
                if (path == null || path.isEmpty()) {
                    Log.w(TAG, "reocr: no image for " + id);
                    return;
                }
                OcrHelper.Out out = OcrHelper.get(EnoteApp.app).recognizeFile(path);
                enqueueImage(id, path, nameOf(path), out.text, out.ms, out.error, "share-image");
            }
        }).start();
    }

    @JavascriptInterface
    public void log(String msg) {
        Log.i(TAG, "web: " + msg);
    }

    /** window.Android.setTheme(mode): keeps the system bars in sync with the CSS theme. */
    @JavascriptInterface
    public void setTheme(final String mode) {
        final MainActivity a = current.get();
        Log.i(TAG, "js setTheme " + mode);
        if (a != null) a.runOnUiThread(new Runnable() {
            public void run() {
                Theme.apply(a, mode);
            }
        });
    }

    /** window.Android.themeMode(): resolved theme, so the WebView's first paint matches. */
    @JavascriptInterface
    public String themeMode() {
        return Theme.resolve();
    }

    @JavascriptInterface
    public String status() {
        return statusStatic();
    }

    static String statusStatic() {
        return loaded ? nativeStatus() : "{\"error\":\"" + loadError + "\"}";
    }

    static String nameOf(String path) {
        int i = path.lastIndexOf('/');
        return i >= 0 ? path.substring(i + 1) : path;
    }
}
