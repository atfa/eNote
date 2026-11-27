package dev.xduo.enote;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Owns the vivo offline ASR engine (libvasrjni.so + assets/stt/model, unpacked on first
 * run) and the microphone. One serial executor: the engine is not reentrant, exactly like
 * OcrHelper's single-thread rule.
 *
 * Two entry points:
 *  - startSession / stopSession: live mic recording (16 kHz / mono / PCM16). PCM is fed to
 *    the engine in 100 ms chunks and simultaneously written to a WAV file, so the original
 *    utterance is kept as an attachment (可重新识别).
 *  - recognizeFile: feed a 16 kHz mono PCM16 WAV straight through the engine (share audio
 *    decode, re-recognize, the automated test).
 *
 * Partial results are pushed to the web UI (window.onSttPartial / onSttEnd) via Bridge.pushJs;
 * finished utterances accumulate into the current segment. The engine's own callback thread
 * drives onResult, so StringBuilder access is synchronized.
 */
public class SttHelper {
    static final String TAG = "enote-stt";
    public static final int SAMPLE_RATE = 16000;
    static final int CHUNK = 3200; // 100 ms at 16k/16-bit/mono

    public interface SessionListener {
        /** Recognizer is working; text is the current (partial) hypothesis. */
        void onPartial(String text);

        /** A finished utterance within this session; text is that sentence. */
        void onSegment(String text);

        /** Session over; text = accumulated transcript, audioPath = saved WAV (or ""). */
        void onEnd(String text, String error, String audioPath);
    }

    private static SttHelper one;
    private final Context ctx;
    private SttEngine engine;
    volatile boolean ready;
    volatile String info = "未初始化";
    private final ExecutorService ex = Executors.newSingleThreadExecutor();

    // ---- live session state (guarded by seg's lock) ----
    private AudioRecord rec;
    private volatile boolean recording;
    private Thread recThread;
    private SessionListener ses;
    private final StringBuilder seg = new StringBuilder();
    private RandomAccessFile raf;   // WAV being written during the session
    private String audioPath = "";
    /* 引擎的最终句是**异步**回调（decode 线程上），engine.stop() 返回时它可能还没到：
       以前 stop 后立刻读 seg，最后一句必然丢（实测分享 zh.wav 读回空串，而 native 日志里
       FINAL_JSON 明明是「今天天气怎么样？」）。这枚 latch 在每次 start 时复位，
       收到 is_final 就 countDown，读文本前最多等 1.5s。 */
    private volatile CountDownLatch finalLatch;
    private String engineVersion = "";

    static synchronized SttHelper get(Context c) {
        if (one == null) one = new SttHelper(c.getApplicationContext());
        return one;
    }

    private SttHelper(Context c) {
        ctx = c;
    }

    public boolean isReady() {
        return ready;
    }

    public String info() {
        return info;
    }

    public String engineVersion() {
        return engineVersion;
    }

    // ------------------------------------------------------------------ init

    void initAsync() {
        ex.submit(new Runnable() {
            public void run() {
                ensure();
            }
        });
    }

    /** Must run on the STT executor (or anywhere, it's re-entrant enough; only callers on ex). */
    private synchronized boolean ensure() {
        if (ready && engine != null && engine.isInited()) return true;
        try {
            if (engine == null) {
                info = "解包模型…";
                engine = new SttEngine();
                /* 引擎 → 这里的回调接线。少了这一行 seg 永远是空的（放心：它不会报错，
                   症状是「识别结果一直是空白」，而 native 日志里 FINAL_JSON 明明有字）。 */
                engine.setListener(new SttEngine.Listener() {
                    public void onResult(String text, boolean isFinal) {
                        SttHelper.this.onResult(text, isFinal);
                    }
                });
            }
            info = "初始化引擎…";
            if (!engine.init(ctx)) {
                return fail("引擎初始化失败");
            }
            engineVersion = engine.getVersion();
            info = "v" + engineVersion + " 就绪";
            ready = true;
            Bridge.nativeSetStt(true, info);
            Log.i(TAG, "STT ready: " + info);
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "stt init failed", t);
            return fail("初始化异常: " + t);
        }
    }

    private boolean fail(String why) {
        info = why;
        ready = false;
        try {
            Bridge.nativeSetStt(false, info);
        } catch (Throwable ignored) {
        }
        return false;
    }

    /** Engine -> listener wiring: partial shown live, final sentences accumulate. */
    void onResult(String text, boolean isFinal) {
        String t = text == null ? "" : text.trim();
        if (t.isEmpty()) return;
        if (isFinal) {
            CountDownLatch l0 = finalLatch;
            if (l0 != null) l0.countDown();
        }
        SessionListener l;
        synchronized (seg) {
            l = ses;
            if (isFinal) {
                if (!endsWith(seg, t)) {
                    if (seg.length() > 0 && !seg.toString().endsWith("\n")) seg.append("\n");
                    seg.append(t);
                }
                pushPartial(seg.toString());
            } else {
                pushPartial(t);
            }
        }
        if (l != null) {
            if (isFinal) l.onSegment(t); else l.onPartial(t);
        }
    }

    private static boolean endsWith(StringBuilder b, String t) {
        return b.length() >= t.length()
                && b.substring(b.length() - t.length()).equals(t);
    }

    // ------------------------------------------------------------- live mic

    /**
     * Start a recording session. RECORD_AUDIO must already be granted. The PCM goes to the
     * engine and to a WAV file (voice_<ts>.wav in the inbox), so the audio stays reusable.
     */
    void startSession(final SessionListener l) {
        ex.submit(new Runnable() {
            public void run() {
                doStart(l);
            }
        });
    }

    private void doStart(final SessionListener l) {
        if (!ensure()) {
            if (l != null) l.onEnd("", "语音引擎未就绪：" + info, "");
            return;
        }
        final int min = AudioRecord.getMinBufferSize(SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        final int bufSize = Math.max(min, SAMPLE_RATE * 2);
        AudioRecord r = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize * 2);
        if (r.getState() != AudioRecord.STATE_INITIALIZED) {
            if (l != null) l.onEnd("", "麦克风初始化失败", "");
            return;
        }
        int rc = engine.start();
        if (rc != 0) {
            r.release();
            if (l != null) l.onEnd("", "识别启动失败 rc=" + rc, "");
            return;
        }
        RandomAccessFile out = null;
        File af = new File(OcrHelper.inboxDir(ctx),
                "voice_" + System.currentTimeMillis() + ".wav");
        try {
            out = new RandomAccessFile(af, "rw");
            out.write(new byte[44]); // WAV header placeholder, patched at stop
        } catch (IOException e) {
            Log.w(TAG, "cannot open voice wav: " + af, e);
            try { if (out != null) out.close(); } catch (IOException ignored) { }
            out = null;
        }
        final RandomAccessFile rafOut = out;
        finalLatch = new CountDownLatch(1);
        synchronized (seg) {
            seg.setLength(0);
            audioPath = out == null ? "" : af.getAbsolutePath();
            raf = out; // 字段版：doStop 封 WAV 尾用
            ses = l;
        }
        recording = true;
        rec = r;
        r.startRecording();
        recThread = new Thread(new Runnable() {
            public void run() {
                byte[] buf = new byte[CHUNK];
                while (recording) {
                    int n = r.read(buf, 0, buf.length);
                    if (n > 0) {
                        engine.writeData(buf, n);
                        if (rafOut != null) {
                            try { rafOut.write(buf, 0, n); } catch (IOException ignored) { }
                        }
                    }
                }
            }
        }, "stt-mic");
        recThread.start();
    }

    /** Stop the current session (tap end / long-press release). */
    void stopSession(final SessionListener l) {
        ex.submit(new Runnable() {
            public void run() {
                doStop(l);
            }
        });
    }

    private void doStop(final SessionListener l) {
        recording = false;
        if (recThread != null) {
            try {
                recThread.join(1500);
            } catch (InterruptedException ignored) {
            }
            recThread = null;
        }
        if (rec != null) {
            try { rec.stop(); } catch (Throwable ignored) { }
            rec.release();
            rec = null;
        }
        String txt, err = "", path = "";
        int rc = 0;
        if (engine != null && ready) {
            try { rc = engine.stop(); } catch (Throwable t) { Log.w(TAG, "stop: " + t); }
        }
        awaitFinal();
        synchronized (seg) {
            txt = seg.toString().trim();
            path = audioPath;
        }
        if (raf != null) {
            try {
                long dataLen = raf.getFilePointer() - 44;
                raf.seek(0);
                writeWavHeader(raf, dataLen);
                raf.close();
            } catch (Throwable t) {
                Log.w(TAG, "finalize wav", t);
                err = "音频保存失败";
            }
            raf = null;
        }
        if (rc != 0 && err.isEmpty()) err = "识别停止异常 rc=" + rc;
        if (l != null) l.onEnd(txt, err, path);
        pushEnd(txt, err, path);
    }

    // -------------------------------------------------------- WAV file feed

    /** Feed a 16 kHz mono PCM16 WAV file through the engine. Call from a worker thread. */
    public String recognizeFile(final String path) {
        try {
            Future<String> f = ex.submit(new Callable<String>() {
                public String call() {
                    return doFile(path);
                }
            });
            return f.get();
        } catch (Throwable t) {
            Log.e(TAG, "recognizeFile", t);
            return "";
        }
    }

    private String doFile(String path) {
        if (!ensure()) return "";
        try {
            byte[] pcm = readWav(new File(path));
            finalLatch = new CountDownLatch(1);
            synchronized (seg) {
                seg.setLength(0);
                ses = null;
            }
            int rc = engine.start();
            if (rc != 0) return "";
            int off = 0;
            while (off < pcm.length) {
                int n = Math.min(CHUNK, pcm.length - off);
                byte[] chunk = new byte[n];
                System.arraycopy(pcm, off, chunk, 0, n);
                engine.writeData(chunk, n);
                off += n;
                try { Thread.sleep(20); } catch (InterruptedException ignored) { }
            }
            try { Thread.sleep(400); } catch (InterruptedException ignored) { }
            engine.stop();
            awaitFinal();
            synchronized (seg) {
                return seg.toString().trim();
            }
        } catch (Throwable t) {
            Log.e(TAG, "wav failed", t);
            return "";
        }
    }

    /** Wait (<=1.5s) for the engine's is_final callback; it arrives after stop() returns. */
    private void awaitFinal() {
        CountDownLatch l = finalLatch;
        if (l == null) return;
        try {
            l.await(1500, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    static byte[] readWav(File f) throws IOException {
        byte[] all = new byte[(int) f.length()];
        try (FileInputStream in = new FileInputStream(f)) {
            int off = 0;
            while (off < all.length) {
                int n = in.read(all, off, all.length - off);
                if (n < 0) break;
                off += n;
            }
        }
        if (all.length < 44) throw new IOException("too short");
        int dataOff = -1, dataLen = 0;
        for (int i = 12; i + 8 <= all.length; ) {
            String id = new String(all, i, 4, "US-ASCII");
            int size = (all[i + 4] & 0xFF) | ((all[i + 5] & 0xFF) << 8)
                    | ((all[i + 6] & 0xFF) << 16) | ((all[i + 7] & 0xFF) << 24);
            if ("data".equals(id)) {
                dataOff = i + 8;
                dataLen = Math.min(size, all.length - dataOff);
                break;
            }
            i += 8 + size + (size & 1);
        }
        if (dataOff < 0) throw new IOException("no data chunk");
        byte[] pcm = new byte[dataLen];
        System.arraycopy(all, dataOff, pcm, 0, dataLen);
        return pcm;
    }

    static void writeWavHeader(RandomAccessFile raf, long dataLen) throws IOException {
        byte[] h = new byte[44];
        putAscii(h, 0, "RIFF");
        putLE32(h, 4, 36 + dataLen);
        putAscii(h, 8, "WAVE");
        putAscii(h, 12, "fmt ");
        putLE32(h, 16, 16);
        putLE16(h, 20, 1);          // PCM
        putLE16(h, 22, 1);          // mono
        putLE32(h, 24, SAMPLE_RATE);
        putLE32(h, 28, SAMPLE_RATE * 2); // byte rate
        putLE16(h, 32, 2);          // block align
        putLE16(h, 34, 16);         // bits
        putAscii(h, 36, "data");
        putLE32(h, 40, dataLen);
        raf.write(h);
    }

    private static void putAscii(byte[] b, int off, String s) {
        for (int i = 0; i < s.length(); i++) b[off + i] = (byte) s.charAt(i);
    }

    private static void putLE32(byte[] b, int off, long v) {
        b[off] = (byte) (v & 0xFF); b[off + 1] = (byte) ((v >> 8) & 0xFF);
        b[off + 2] = (byte) ((v >> 16) & 0xFF); b[off + 3] = (byte) ((v >> 24) & 0xFF);
    }

    private static void putLE16(byte[] b, int off, int v) {
        b[off] = (byte) (v & 0xFF); b[off + 1] = (byte) ((v >> 8) & 0xFF);
    }

    // -------------------------------------------------------------- js push

    private static void pushPartial(String text) {
        Bridge.pushJs("window.onSttPartial && onSttPartial(" + jsStr(text) + ")");
    }

    private static void pushEnd(String text, String error, String path) {
        Bridge.pushJs("window.onSttEnd && onSttEnd(" + jsStr(text) + "," + jsStr(error)
                + "," + jsStr(path) + ")");
    }

    static String jsStr(String s) {
        if (s == null) s = "";
        StringBuilder b = new StringBuilder(s.length() + 16);
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format(Locale.US, "\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }
}