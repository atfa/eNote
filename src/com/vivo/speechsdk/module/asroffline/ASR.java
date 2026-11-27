package com.vivo.speechsdk.module.asroffline;

import java.io.UnsupportedEncodingException;

/**
 * Reconstructed from JoviIme 3.8.3 (ASR.java) - pure JNI wrapper around libvasrjni.so.
 * Class name, package and native method names MUST stay exactly like this: the .so binds
 * them by name (no RegisterNatives) via Java_com_vivo_speechsdk_module_asroffline_ASR_*.
 */
public class ASR {

    public static final int NORMAL = 0;
    public static final int LOW_MEMORY = 1;

    public static final int PARAM_LOG_LEVEL = 0;
    public static final int PARAM_PUNCT_ENABLE = 1;
    public static final int PARAM_NUM_FORMAT_ENABLE = 2;
    public static final int PARAM_VAD_END_TIME = 3;
    public static final int PARAM_TRADITIONAL_CN = 4;

    public static final int VALUE_DISABLE = 0;
    public static final int VALUE_ENABLE = 1;

    private static final String TAG = "ASR";

    private static String mEngineVersion;
    private static boolean sIsLibraryLoaded;

    private a mASRListener;

    public ASR() {
    }

    /** Loads libvasrjni.so (its DT_NEEDED chain pulls in libvasr/libvcap/... from the same dir). */
    public static boolean isLoaded() {
        if (!sIsLibraryLoaded) {
            try {
                System.loadLibrary("vasrjni");
                sIsLibraryLoaded = true;
            } catch (Throwable t) {
                android.util.Log.e(TAG, "load libvasrjni failed", t);
                sIsLibraryLoaded = false;
            }
        }
        return sIsLibraryLoaded;
    }

    public static String getEngineVersion() {
        if (mEngineVersion == null) {
            mEngineVersion = isLoaded() ? getVersion() : "";
        }
        return mEngineVersion;
    }

    public static native String getVersion();

    private void nativeCallBack(String text, boolean isFinal) {
        a listener = this.mASRListener;
        if (listener != null) {
            listener.a(text, isFinal);
        }
    }

    private void nativeCallBack(byte[] data, boolean isFinal) {
        String text;
        try {
            text = new String(data, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            text = "";
        }
        nativeCallBack(text, isFinal);
    }

    public void setASRListener(a listener) {
        this.mASRListener = listener;
    }

    /**
     * @param resPath  directory that contains libenc.model/libdec.model/libconf.so/...
     * @param lowMemory true -> LOW_MEMORY model set, false -> NORMAL
     */
    public native int init2(String resPath, boolean lowMemory);

    public native int init(String resPath);

    /** PARAM_* id, VALUE_* value. Returns 0 on success. */
    public native int setParam(int id, int value);

    /** @param mode 0 normally. Returns 0 on success. */
    public native int start(int mode);

    /** Feed raw PCM: 16 kHz, 16-bit little endian, mono. */
    public native int writeData(byte[] pcm, int len);

    public native int stop();

    public native int cancel();

    public native int destory();

    public native int updateHotword(String json);
}
