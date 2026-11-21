package dev.xduo.enote;

import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;

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

    static native String nativeInit(String filesDir, int tzOffsetSec, String tzId);
    static native String nativeStartServer();
    static native String nativeClipAdd(String payloadJson);
    static native int nativeClipCount();
    static native String nativeEnqueue(String payloadJson);
    static native String nativeStatus();
    static native String nativeReminders();
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
        java.util.TimeZone tz = java.util.TimeZone.getDefault();
        int off = tz.getOffset(System.currentTimeMillis()) / 1000;
        initResult = nativeInit(c.getFilesDir().getAbsolutePath(), off, tz.getID());
        Log.i(TAG, "nativeInit -> " + initResult + " tz=" + tz.getID() + " off=" + off);
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

    // ---------------------------------------------------------------- clipboard (R7/P6)

    /**
     * Holds one clipboard item back in Go. Returns true when it was actually added (a
     * duplicate of the last item or a burst does not count), for the notification badge.
     */
    static boolean clipAdd(String kind, String text, String path, String name, String mime, String app) {
        JSONObject o = new JSONObject();
        try {
            o.put("kind", kind == null ? "text" : kind);
            o.put("text", text == null ? "" : text);
            o.put("path", path == null ? "" : path);
            o.put("name", name == null ? "" : name);
            o.put("mime", mime == null ? "" : mime);
            o.put("app", app == null ? "" : app);
        } catch (Exception e) {
            return false;
        }
        String r = nativeClipAdd(o.toString());
        return r != null && r.contains("\"ok\":true") && !r.contains("\"duplicate\":true");
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

    /** window.Android.pickJSON(): pick a JSON export and POST it to /api/import. */
    @JavascriptInterface
    public void pickJSON() {
        MainActivity a = current.get();
        Log.i(TAG, "js pickJSON");
        if (a != null) a.pickJSON();
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

    /** 手动「从剪贴板导入」：页面上的 📋 按钮，读到就进暂存队列。 */
    @JavascriptInterface
    public void clipImport() {
        MainActivity a = current.get();
        Log.i(TAG, "js clipImport");
        if (a != null) a.clipImportNow();
    }

    /**
     * window.Android.dialogResult(id, ok): resolves a native alert/confirm that MainActivity
     * forwarded to the page's own dialog, so the user never sees the "http://127.0.0.1" bar.
     */
    @JavascriptInterface
    public void dialogResult(String id, boolean ok) {
        JsResult r = MainActivity.pendingJs;
        MainActivity.pendingJs = null;
        Log.i(TAG, "dialogResult " + id + " ok=" + ok + " pending=" + (r != null));
        if (r != null) {
            if (ok) r.confirm(); else r.cancel();
        }
    }

    /**
     * window.Android.syncReminders(json): rebuild the alarm set from the open todos.
     * json = [{"id":"noteId|todoId","text":"...","note":"笔记标题","dueMs":1795...}]
     * Returns the number of alarms now pending, so the UI can show 已提醒 N 条.
     */
    @JavascriptInterface
    public int syncReminders(final String json) {
        return Reminders.sync(EnoteApp.app, json);
    }

    /**
     * The alarm list straight from Go's store. The foreground service calls this so it can
     * rebuild the timers with no WebView alive (restart, or alarms dropped while frozen).
     */
    static String remindersFromStore() {
        try {
            return loaded ? nativeReminders() : "[]";
        } catch (Throwable t) {
            Log.w(TAG, "remindersFromStore: " + t);
            return "[]";
        }
    }

    // ------------------------------------------------------- keep-alive (P6.5, standard APIs)

    /** window.Android.keepAlive(): is the 常驻后台 foreground service switched on? */
    @JavascriptInterface
    public boolean keepAlive() {
        return KeepAlive.enabled(EnoteApp.app);
    }

    /** window.Android.setKeepAlive(on): start/stop the foreground service. */
    @JavascriptInterface
    public void setKeepAlive(final boolean on) {
        Log.i(TAG, "js setKeepAlive " + on);
        new Thread(new Runnable() {
            public void run() {
                try { KeepAlive.setEnabled(EnoteApp.app, on); } catch (Throwable t) { Log.w(TAG, "setKeepAlive: " + t); }
            }
        }).start();
    }

    /** window.Android.batteryIgnoring(): already exempt from battery optimisation? */
    @JavascriptInterface
    public boolean batteryIgnoring() {
        return KeepAlive.ignoringBattery(EnoteApp.app);
    }

    /** window.Android.askBattery(): open the standard battery-optimisation settings. */
    @JavascriptInterface
    public void askBattery() {
        final MainActivity a = current.get();
        Log.i(TAG, "js askBattery");
        if (a != null) a.runOnUiThread(new Runnable() {
            public void run() { KeepAlive.askIgnoreBattery(a); }
        });
    }

    /** window.Android.exactGranted(): true when exact alarms are allowed. */
    @JavascriptInterface
    public boolean exactGranted() {
        return Reminders.exactGranted(EnoteApp.app);
    }

    /** window.Android.askExact(): system page to allow precise reminders (API 31+). */
    @JavascriptInterface
    public void askExact() {
        Log.i(TAG, "js askExact");
        try { Reminders.askExact(EnoteApp.app); } catch (Throwable t) { Log.w(TAG, "askExact: " + t); }
    }

    /** window.Android.askNotify(): Android 13+ runtime permission for notifications. */
    @JavascriptInterface
    public void askNotify() {
        final MainActivity a = current.get();
        Log.i(TAG, "js askNotify");
        if (a != null) a.runOnUiThread(new Runnable() {
            public void run() { a.askNotifyPermission(); }
        });
    }

    /** window.Android.notifyGranted(): true when notifications can be posted. */
    @JavascriptInterface
    public boolean notifyGranted() {
        return MainActivity.notifyGranted(EnoteApp.app);
    }

    /** window.Android.addToCalendar(title, dueMs): system calendar insert (R13-A). */
    @JavascriptInterface
    public void addToCalendar(final String title, final double dueMs) {
        final MainActivity a = current.get();
        Log.i(TAG, "js addToCalendar " + title + " " + dueMs);
        if (a != null) a.runOnUiThread(new Runnable() {
            public void run() { a.addToCalendar(title, (long) dueMs); }
        });
    }

    /** window.Android.setAlarm(dueMs, label): system alarm at the due time (R13-B). */
    @JavascriptInterface
    public void setAlarm(final double dueMs, final String label) {
        final MainActivity a = current.get();
        Log.i(TAG, "js setAlarm " + dueMs);
        if (a != null) a.runOnUiThread(new Runnable() {
            public void run() { a.setAlarm((long) dueMs, label); }
        });
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
