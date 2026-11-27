package dev.xduo.enote;

import android.content.Context;
import android.util.Log;

import com.vivo.speechsdk.module.asroffline.ASR;
import com.vivo.speechsdk.module.asroffline.a;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Thin wrapper around the vivo offline ASR engine (libvasrjni.so). Model files live in
 * assets/stt/model/ and are unpacked once (stamped) into filesDir/stt/model.
 *
 * Not thread-safe: one recognition at a time (see SttHelper's serial executor). Callbacks
 * arrive on the engine's own thread and are forwarded to the listener.
 */
public class SttEngine {
    static final String TAG = "enote-stt";

    public interface Listener {
        /** A (possibly partial) transcript came in. isFinal=true = this utterance is done. */
        void onResult(String text, boolean isFinal);
    }

    private ASR asr;
    private boolean inited;
    private String version;
    private Listener lis;

    /** Loads libvasrjni.so (and its NEEDED chain) once; called before any other method. */
    public static boolean isLoaded() {
        return ASR.isLoaded();
    }

    /** Unpack assets/stt/model/* to filesDir/stt/model, skipped when the stamp matches. */
    public static File ensureModels(Context ctx) throws IOException {
        File dir = new File(ctx.getFilesDir(), "stt/model");
        String want;
        try {
            want = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionCode
                    + ":" + android.os.Build.VERSION.SDK_INT;
        } catch (Exception e) {
            want = "1";
        }
        File stamp = new File(dir.getParentFile(), "model.stamp");
        String have = null;
        if (stamp.exists()) {
            byte[] b = new byte[(int) stamp.length()];
            try (FileInputStream in = new FileInputStream(stamp)) {
                int n = in.read(b);
                have = new String(b, 0, Math.max(n, 0), "UTF-8");
            }
        }
        if (want.equals(have) && dir.isDirectory() && new File(dir, "libenc.model").length() > 0) {
            return dir;
        }
        if (dir.exists()) deleteTree(dir);
        if (!dir.mkdirs()) throw new IOException("mkdirs " + dir);

        String[] list = ctx.getAssets().list("stt/model");
        if (list == null || list.length == 0) throw new IOException("no assets/stt/model");
        for (String name : list) {
            try (InputStream in = ctx.getAssets().open("stt/model/" + name);
                 OutputStream out = new FileOutputStream(new File(dir, name))) {
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
        }
        try (FileOutputStream out = new FileOutputStream(stamp)) {
            out.write(want.getBytes("UTF-8"));
        }
        return dir;
    }

    private static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    public boolean init(Context ctx) {
        try {
            File modelDir = ensureModels(ctx);
            if (!ASR.isLoaded()) {
                Log.e(TAG, "libvasrjni load failed");
                return false;
            }
            version = ASR.getEngineVersion();
            asr = new ASR();
            asr.setASRListener(new a() {
                @Override
                public void a(String payload, boolean isFinal) {
                    Listener l = lis;
                    if (l == null) return;
                    String text = payload;
                    try {
                        org.json.JSONObject o = new org.json.JSONObject(payload);
                        String t = o.optString("text", payload);
                        if (t != null && t.length() > 0) text = t;
                        if (o.optBoolean("is_finish", isFinal)) isFinal = true;
                    } catch (Throwable ignored) {
                    }
                    Log.i(TAG, (isFinal ? "FINAL " : "PART  ") + text);
                    l.onResult(text, isFinal);
                }
            });
            long t0 = System.currentTimeMillis();
            int rc = asr.init2(modelDir.getAbsolutePath(), false);
            if (rc != 0) {
                Log.w(TAG, "init2 NORMAL failed rc=" + rc + ", trying LOW_MEMORY");
                rc = asr.init2(modelDir.getAbsolutePath(), true);
                if (rc != 0) {
                    Log.e(TAG, "init2 LOW_MEMORY failed rc=" + rc);
                    return false;
                }
            }
            asr.setParam(ASR.PARAM_PUNCT_ENABLE, ASR.VALUE_ENABLE);
            inited = true;
            Log.i(TAG, "engine ready: " + version + " (" + (System.currentTimeMillis() - t0) + "ms)");
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "stt init failed", t);
            return false;
        }
    }

    public boolean isInited() {
        return inited && asr != null;
    }

    public String getVersion() {
        return version == null ? "" : version;
    }

    public void setListener(Listener l) {
        lis = l;
    }

    /** Start a recognition session. Returns 0 on success. */
    public int start() {
        return asr.start(0);
    }

    /** Feed PCM (16kHz/16-bit/mono). */
    public int writeData(byte[] pcm, int len) {
        return asr.writeData(pcm, len);
    }

    /** Stop and finalise the session. */
    public int stop() {
        return asr.stop();
    }

    public void cancel() {
        try {
            asr.cancel();
        } catch (Throwable ignored) {
        }
    }

    public void destroy() {
        try {
            if (asr != null) {
                asr.stop();
                asr.destory();
            }
        } catch (Throwable ignored) {
        }
        inited = false;
    }
}