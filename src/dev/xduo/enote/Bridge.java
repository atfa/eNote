package dev.xduo.enote;

import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.LinkedHashSet;
import java.util.Set;

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
    static native String nativeShotAdd(String payloadJson);
    static native int nativeClipCount();
    static native String nativeEnqueue(String payloadJson);
    static native String nativeStatus();
    static native String nativeReminders();
    static native String nativeSelfTest(String json);
    static native String nativeAttachment(String id);
    static native String nativeAppendAttachments(String payload);
    static native String nativeNoteImage(String id);
    static native String nativeNoteAudio(String id);
    static native void nativeSetOcr(boolean ready, String info);
    static native void nativeSetStt(boolean ready, String info);

    @JavascriptInterface
    public void openAttachment(String id) {
        MainActivity activity = current.get();
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override public void run() { AttachmentProvider.open(activity, id); }
            });
        }
    }

    /** Go->Java->JS: push a JS snippet to the WebView (STT partial results, ...). */
    static void pushJs(String js) {
        MainActivity a = current.get();
        if (a != null) a.runJs(js);
    }

    /** window.Android.askMic(): request RECORD_AUDIO at runtime, result via window.micResult. */
    @JavascriptInterface
    public void askMic() {
        MainActivity a = current.get();
        Log.i(TAG, "js askMic");
        if (a != null) a.askMicPermission();
    }

    /** window.Android.micGranted(): is RECORD_AUDIO granted already? */
    @JavascriptInterface
    public boolean micGranted() {
        return MainActivity.micGranted(EnoteApp.app);
    }

    /** window.Android.startVoice(): begin a live STT session (UI keeps the button pressed). */
    @JavascriptInterface
    public void startVoice() {
        Log.i(TAG, "js startVoice");
        if (!micGranted()) {
            Log.w(TAG, "startVoice without RECORD_AUDIO");
            return;
        }
        SttHelper.get(EnoteApp.app).startSession(null);
    }

    /** window.Android.stopVoice(): end the session; result via window.onSttEnd. */
    @JavascriptInterface
    public void stopVoice() {
        Log.i(TAG, "js stopVoice");
        SttHelper.get(EnoteApp.app).stopSession(null);
    }

    static volatile Context appCtx;  // set in init(), for the clipboard hint (no Activity needed)

    static synchronized void init(Context c) {
        if (loaded) return;
        appCtx = c.getApplicationContext();
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
        return enqueueImageInternal(id, path, name, ocr, ocrMs, ocrError, source, false);
    }

    /** 手动选图“先入队后 OCR”：占位入队（无 OCR 文本、不进 LLM 队列），
     *  卡片立刻显「排队中」；返回的 note id 交给调用方，OCR 完成后用它 reingest。 */
    static String enqueueImageDeferred(String path, String name, String source) {
        return enqueueImageInternal(null, path, name, "", 0, "", source, true);
    }

    private static String enqueueImageInternal(String id, String path, String name, String ocr,
                                               long ocrMs, String ocrError, String source, boolean defer) {
        JSONObject o = new JSONObject();
        try {
            o.put("kind", "image");
            if (id != null && !id.isEmpty()) o.put("id", id);
            o.put("path", path == null ? "" : path);
            o.put("name", name == null ? "" : name);
            o.put("ocr", ocr == null ? "" : ocr);
            o.put("ocrMs", ocrMs);
            o.put("ocrError", ocrError == null ? "" : ocrError);
            o.put("source", source);
            if (defer) o.put("defer", true);
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

    // ---------------------------------------------------------------- 语音 (P18)

    /** 语音分享 / 重新识别语音：识别文本 + 原音频（可以多段，一段一个附件）。
     *  segsJson = [{text,path,name}]；一次分享多条音频 = 一条笔记挂多个音频。
     *  id 非空 = 「重新识别语音」：Go 侧走 reingestVoice，用 text 换掉旧文本、音频附件不动。 */
    static String enqueueVoice(String id, String segsJson, long stMs, String error, String source) {
        JSONObject o = new JSONObject();
        try {
            o.put("kind", "voice");
            if (id != null && !id.isEmpty()) o.put("id", id);
            JSONArray segs = new JSONArray(segsJson == null || segsJson.isEmpty() ? "[]" : segsJson);
            /* 正文只由 audios[].text 带过去：Go 的 fillVoice 会把 text 和每段 audios[].text
               都拼进正文，两处都给等于每段重复一遍（实测 zh.wav → 「…\n\n…」）。
               text 留空串只是为了 JSON 形状稳定。 */
            o.put("text", "");
            o.put("audios", segs);
            o.put("stMs", stMs);
            o.put("stError", error == null ? "" : error);
            o.put("source", source);
        } catch (Exception e) {
            return "{\"error\":\"" + e + "\"}";
        }
        return nativeEnqueue(o.toString());
    }

    // ---------------------------------------------------------------- 截图捕获 (P11)

    /** Java 扫到的新截图交给 Go 的暂存区；shotsJson 是 [{path,name,mime,size,dateAdded}]。 */
    static String shotAdd(String shotsJson) {
        if (!loaded) return "{\"ok\":false,\"error\":\"native 未加载\"}";
        try {
            JSONObject o = new JSONObject();
            o.put("shots", new org.json.JSONArray(shotsJson));
            String r = nativeShotAdd(o.toString());
            Log.i(TAG, "shotAdd -> " + (r == null ? "null"
                    : r.length() > 200 ? r.substring(0, 200) : r));
            return r;
        } catch (Throwable t) {
            Log.w(TAG, "shotAdd failed " + t);
            return "{\"ok\":false}";
        }
    }

    /** 首页横幅用的轻量状态（不扫媒体库，可以每帧调）。 */
    @JavascriptInterface
    public String shotFlags() {
        Context c = appCtx;
        return c == null ? "{}" : Shots.flagsJson(c);
    }

    /** 设置页 / 向导：{enabled,granted,folders:[{path,count,bytes,shot,missing}],watermark,total} */
    @JavascriptInterface
    public String shotState() {
        Context c = appCtx;
        return c == null ? "{}" : Shots.stateJson(c);
    }

    /** 向导：所有含图片的文件夹 [{path,count,bytes,shot}]（需要媒体权限）。 */
    @JavascriptInterface
    public String shotFolders() {
        Context c = appCtx;
        return c == null ? "[]" : Shots.foldersJson(c);
    }

    @JavascriptInterface
    public boolean shotGranted() {
        Context c = appCtx;
        return c != null && Shots.mediaGranted(c);
    }

    @JavascriptInterface
    public void askMedia() {
        MainActivity a = current.get();
        Log.i(TAG, "js askMedia");
        if (a != null) a.askMediaPermission();
    }

    /** 保存多选的监控文件夹（json 数组），同时把水位重置为现在。 */
    @JavascriptInterface
    public void setShotFolders(String json) {
        Context c = appCtx;
        if (c == null) return;
        Set<String> out = new LinkedHashSet<String>();
        try {
            org.json.JSONArray a = new org.json.JSONArray(json == null ? "[]" : json);
            for (int i = 0; i < a.length(); i++) out.add(a.optString(i));
        } catch (Throwable t) {
            Log.w(TAG, "setShotFolders: " + t);
        }
        Shots.setFolders(c, out);
    }

    @JavascriptInterface
    public void setShotEnabled(boolean on) {
        Context c = appCtx;
        if (c != null) Shots.setEnabled(c, on);
    }

    /** 立刻扫一次（后台线程），扫完回调 window.shotsScanned(n)。 */
    @JavascriptInterface
    public void scanShots(final boolean force) {
        final Context c = appCtx;
        if (c == null) return;
        new Thread(new Runnable() {
            public void run() {
                int n = Shots.scan(c, force, null, 0);
                MainActivity a = current.get();
                if (a != null) a.runJs("window.shotsScanned && shotsScanned(" + n + ")");
            }
        }, "shot-scan").start();
    }

    /** 导入暂存的截图（OCR + 入队），完成后回调 window.shotsImported(result)。 */
    @JavascriptInterface
    public void importShots(final String json) {
        final Context c = appCtx;
        if (c == null) return;
        Log.i(TAG, "js importShots");
        new Thread(new Runnable() {
            public void run() {
                final String res = Shots.importShots(c, json);
                MainActivity a = current.get();
                if (a != null) a.runJs("window.shotsImported && shotsImported(" + res + ")");
            }
        }, "shot-import").start();
    }

    /** 回捞最近 N 天的截图（忽略水位，仍走 sha1 去重），扫完回调 window.shotsScanned(n)。 */
    @JavascriptInterface
    public void rescanShots(final int days) {
        final Context c = appCtx;
        if (c == null) return;
        new Thread(new Runnable() {
            public void run() {
                int n = Shots.scan(c, true, null, days <= 0 ? 7 : days);
                MainActivity a = current.get();
                if (a != null) a.runJs("window.shotsScanned && shotsScanned(" + n + ")");
            }
        }, "shot-rescan").start();
    }

    /** 导入期间保持屏幕常亮：真的别黑屏，而不只是嘴上说。 */
    @JavascriptInterface
    public void keepScreenOn(final boolean on) {
        MainActivity a = current.get();
        Log.i(TAG, "js keepScreenOn " + on);
        if (a != null) a.keepScreenOn(on);
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
        Log.i(TAG, "clipAdd resp=" + (r == null ? "null"
                : r.length() > 220 ? r.substring(0, 220) : r) + " 入参 text=" + text.length() + " app=" + app);
        boolean added = r != null && r.contains("\"ok\":true") && !r.contains("\"duplicate\":true");
        if (added && appCtx != null) {
            KeepAlive.markClipCaptured(appCtx);
            KeepAlive.updateNotification(appCtx);          // 常驻通知上的条数跟着变
            if (!MainActivity.foreground) KeepAlive.notifyClip(appCtx, clipCount());
        }
        return added;
    }

    static int clipCount() {
        try {
            return loaded ? nativeClipCount() : 0;
        } catch (Throwable t) {
            return 0;
        }
    }

    /** 页面删完条目后叫一声，让常驻通知上的条数别撒谎。 */
    @JavascriptInterface
    public void clipSync() {
        Context c = appCtx;
        if (c != null) KeepAlive.updateNotification(c);
    }

    /** 剪贴板在后台变过、我们还没成功抓到 → 页面提示「点这里收进来」。 */
    @JavascriptInterface
    public String clipHint() {
        Context c = appCtx;
        return c != null && KeepAlive.clipHint(c) ? "1" : "0";
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

    @JavascriptInterface
    public void pickNoteAttachments(String noteId) {
        MainActivity a = current.get();
        if (a != null) {
            a.runOnUiThread(new Runnable() {
                @Override public void run() { a.pickNoteAttachments(noteId); }
            });
        }
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

    /** window.Android.revoice(id): re-run the local STT on a note's stored audio (P18).
     *  多段语音会有多个音频附件：逐段重跑，拼成一段文本回写（reingestVoice 只换文字，
     *  附件不动）。没有音频附件的笔记直接返回（按钮不该出现）。 */
    @JavascriptInterface
    public void revoice(final String id) {
        Log.i(TAG, "js revoice " + id);
        new Thread(new Runnable() {
            public void run() {
                JSONArray segs = new JSONArray();
                try {
                    String js = loaded ? nativeNoteAudio(id) : "";
                    if (js != null && !js.isEmpty()) segs = new JSONArray(js);
                } catch (Exception e) {
                    Log.w(TAG, "revoice: bad audio list " + e);
                }
                if (segs.length() == 0) {
                    Log.w(TAG, "revoice: no audio for " + id);
                    return;
                }
                long t0 = System.currentTimeMillis();
                String err = "";
                for (int i = 0; i < segs.length(); i++) {
                    try {
                        JSONObject s = segs.getJSONObject(i);
                        String txt = SttHelper.get(EnoteApp.app)
                                .recognizeFile(s.optString("path", ""));
                        s.put("text", txt == null ? "" : txt);
                    } catch (Throwable t) {
                        Log.e(TAG, "revoice segment", t);
                        err = "重新识别失败: " + t;
                    }
                }
                long ms = System.currentTimeMillis() - t0;
                String r = enqueueVoice(id, segs.toString(), ms, err, "share-voice");
                Log.i(TAG, "revoice -> " + r);
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
