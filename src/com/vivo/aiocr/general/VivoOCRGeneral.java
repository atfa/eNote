package com.vivo.aiocr.general;

import android.graphics.Bitmap;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HashMap;

/**
 * Java shell for vivo's offline OCR engine (libocr_general.so).
 *
 * Class name, method names/signatures and the parameter/result class layouts are
 * copied verbatim from the com.vivo.aiocr.general package inside the AIService
 * base.apk classes.dex, because the native library resolves them by name through
 * JNI (FindClass / GetFieldID).
 *
 * InitOCR() below reproduces the wrapper vivo ships: it picks the recognition
 * model version string out of rec_md5.json (matched by md5 of
 * rec_model_fp16.vaimlite) and hands the struct to native initNetWithPath().
 */
public class VivoOCRGeneral {
    private static final String TAG = "VOCR";
    private static volatile boolean sLoaded;
    private static String sLoadError = "";

    private VivoOCRGeneral() {}

    /** Load the engine. Returns false (and keeps the reason) if the linker refuses. */
    public static synchronized boolean loadLibs() {
        if (sLoaded) return true;
        try {
            System.loadLibrary("vcap_core");
            System.loadLibrary("vcap_opencl");
            System.loadLibrary("ocr_general");
            sLoaded = true;
            return true;
        } catch (Throwable t) {
            sLoadError = String.valueOf(t);
            Log.e(TAG, "loadLibrary failed: " + t);
            return false;
        }
    }

    public static String loadError() {
        return sLoadError;
    }

    // ---- native methods (signatures verbatim from the smali) -------------------
    public static native int initNetWithPath(InitParamsOCRGPU params);
    public static native int release();
    public static native int resetVcapParams(int threadNums, int power);
    public static native String getOCRVersion();
    public static native SaveWordsResults[] runDetRecDireDel(Bitmap bitmap);
    public static native SaveWordsResults[] runDetectRecogn(Bitmap bitmap);
    public static native SaveWordsResults[] runRecogn(Bitmap bitmap, int[] boxes);
    public static native SaveDetResults runDetect(Bitmap bitmap);
    public static native SaveDetDirect[] runDetectDirect(Bitmap bitmap);
    public static native SaveDetResults runDetectImage(Bitmap bitmap);
    public static native HashMap cropDetectRecogn(Bitmap bitmap, int[] boxes);

    // ---- vivo's own wrapper, same behaviour ------------------------------------
    public static int InitOCR(InitParamsOCRGPU p) {
        long t0 = System.currentTimeMillis();
        p.recVersion = "1.0.0.3";
        try {
            File model = new File(p.modelDirectDir, "/rec_model_fp16.vaimlite");
            File json = new File(p.modelDirectDir, "/rec_md5.json");
            if (model.exists() && json.exists()) {
                Log.i(TAG, "rec model and json exist");
                String md5 = getFileMD5(model.getAbsolutePath());
                Log.i(TAG, "md5:" + md5);
                if (md5 != null && md5.length() >= 26) {
                    JSONObject o = new JSONObject(new String(readFile(json)));
                    JSONArray list = o.getJSONArray("md5_version");
                    for (int i = 0; i < list.length(); i++) {
                        JSONObject e = list.getJSONObject(i);
                        if (md5.equals(e.getString("md5"))) {
                            p.recVersion = e.getString("version");
                        }
                    }
                }
            } else {
                Log.e(TAG, "rec model or json not exist");
            }
        } catch (Throwable t) {
            Log.e(TAG, "rec_md5.json: " + t);
        }
        int ret = initNetWithPath(p);
        Log.i(TAG, "Total Init time:" + (System.currentTimeMillis() - t0) + "ms");
        if (ret == 0) Log.i(TAG, "vivo ocr init success!");
        else Log.e(TAG, "vivo ocr init failed ...");
        return ret;
    }

    public static String GetOCRVersion() {
        try { return getOCRVersion(); } catch (Throwable t) { return ""; }
    }

    public static int ReleaseOCR() {
        try { return release(); } catch (Throwable t) { return -1; }
    }

    public static String getFileMD5(String path) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            InputStream in = new FileInputStream(path);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            in.close();
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b & 0xff));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private static byte[] readFile(File f) throws Exception {
        InputStream in = new FileInputStream(f);
        byte[] buf = new byte[(int) f.length()];
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n <= 0) break;
            off += n;
        }
        in.close();
        return buf;
    }
}
