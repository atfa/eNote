package dev.xduo.enote;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.os.SystemClock;
import android.media.MediaRecorder;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
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
    /* 约 -45 dBFS：用于离线静音检测，以及实时无转写时选择提示语。 */
    static final int SILENCE_PEAK = 184;
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
    private NoiseSuppressor ns;
    private AutomaticGainControl agc;
    private volatile boolean recording;
    /* 第二遍离线重识别排在 ex 上；用户按了下一次录音时它必须立刻让路，
       否则一个长句的重识别会把「再录一段」拖住好几秒。 */
    private volatile boolean startRequested;
    private Thread recThread;
    private SessionListener ses;
    private volatile int peak;      // max |sample| seen during the live session
    private final StringBuilder seg = new StringBuilder();
    private String livePartial = ""; // guarded by seg
    private RandomAccessFile raf;   // WAV being written during the session
    private String audioPath = "";
    /* 引擎的最终句是**异步**回调（decode 线程上），engine.stop() 返回时它可能还没到：
       以前 stop 后立刻读 seg，最后一句必然丢（实测分享 zh.wav 读回空串，而 native 日志里
       FINAL_JSON 明明是「今天天气怎么样？」）。这枚 latch 在每次 start 时复位，
       收到 is_final 就 countDown，读文本前最多等 1.5s。 */
    private volatile CountDownLatch finalLatch;
    private String engineVersion = "";
    /* True while doFile feeds a saved WAV (second pass / re-recognize): the engine's partial
       callbacks must not be painted into the live partial line. */
    private volatile boolean offlinePass;

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
        SessionListener l;
        synchronized (seg) {
            l = ses;
            if (isFinal) {
                if (!endsWith(seg, t)) {
                    if (seg.length() > 0 && !seg.toString().endsWith("\n")) seg.append("\n");
                    seg.append(t);
                }
                CountDownLatch latch = finalLatch;
                if (latch != null) latch.countDown();
                if (!offlinePass) pushPartial(seg.toString());
            } else if (!offlinePass) {
                livePartial = t;
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
        final long requestedAt = SystemClock.elapsedRealtime();
        startRequested = true;
        ex.submit(new Runnable() {
            public void run() {
                doStart(l, requestedAt);
            }
        });
    }

    private void doStart(final SessionListener l, long requestedAt) {
        startRequested = false;
        if (recording) return;
        final int min = AudioRecord.getMinBufferSize(SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        final int bufSize = Math.max(min, SAMPLE_RATE * 2);
        AudioRecord r = openRecord(AudioFormat.CHANNEL_IN_MONO,
                MediaRecorder.AudioSource.VOICE_RECOGNITION, bufSize * 2);
        if (r == null) r = openRecord(AudioFormat.CHANNEL_IN_MONO,
                MediaRecorder.AudioSource.MIC, bufSize * 2);
        if (r == null) {
            startFailed(l, "麦克风初始化失败");
            return;
        }
        try {
            r.startRecording();
            if (r.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                throw new IllegalStateException("AudioRecord did not start");
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "cannot start capture", e);
            r.release();
            startFailed(l, "麦克风启动失败");
            return;
        }
        Log.i(TAG, "capture started in " + (SystemClock.elapsedRealtime() - requestedAt) + "ms");
        Bridge.pushJs("window.onSttStarted && onSttStarted()");

        // AudioRecord buffers the first samples while the recognizer and effects start.
        if (!ensure()) {
            r.release();
            startFailed(l, "语音引擎未就绪：" + info);
            return;
        }
        int rc = engine.start();
        if (rc != 0) {
            r.release();
            startFailed(l, "识别启动失败 rc=" + rc);
            return;
        }
        enableCaptureEffects(r.getAudioSessionId());
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
            livePartial = "";
            audioPath = out == null ? "" : af.getAbsolutePath();
            raf = out;
            ses = l;
        }
        recording = true;
        peak = 0;
        rec = r;
        final AudioRecord fr = r;
        recThread = new Thread(new Runnable() {
            public void run() { runMono(fr, rafOut); }
        }, "stt-mic");
        recThread.start();
    }

    private static void startFailed(SessionListener l, String error) {
        if (l != null) l.onEnd("", error, "");
        pushEnd("", error, "");
    }

    private static AudioRecord openRecord(int channelMask, int source, int bufSize) {
        try {
            AudioRecord a = new AudioRecord(source, SAMPLE_RATE, channelMask,
                    AudioFormat.ENCODING_PCM_16BIT, bufSize);
            if (a.getState() == AudioRecord.STATE_INITIALIZED) return a;
            try { a.release(); } catch (Throwable ignored) { }
        } catch (Throwable t) {
            Log.w(TAG, "AudioRecord(" + source + "," + channelMask + "): " + t);
        }
        return null;
    }

    /** Mono capture (fallback): straight to the engine and the WAV. */
    private void runMono(AudioRecord r, RandomAccessFile out) {
        byte[] buf = new byte[CHUNK];
        while (recording) {
            int n = r.read(buf, 0, buf.length);
            if (n <= 0) continue;
            int level = peakOf(buf, n);
            peak = Math.max(peak, level);
            Bridge.pushJs("window.onSttLevel && onSttLevel(" + level + ")");
            engine.writeData(buf, n);
            if (out != null) {
                try { out.write(buf, 0, n); } catch (IOException ignored) { }
            }
        }
    }

    /** Platform noise suppression / AGC, when the device offers them. Best-effort. */
    private void enableCaptureEffects(int session) {
        try {
            if (NoiseSuppressor.isAvailable()) {
                ns = NoiseSuppressor.create(session);
                if (ns != null) ns.setEnabled(true);
            }
        } catch (Throwable t) { Log.w(TAG, "NoiseSuppressor: " + t); }
        try {
            if (AutomaticGainControl.isAvailable()) {
                agc = AutomaticGainControl.create(session);
                if (agc != null) agc.setEnabled(true);
            }
        } catch (Throwable t) { Log.w(TAG, "AGC: " + t); }
    }

    private void releaseCaptureEffects() {
        if (ns != null) { try { ns.release(); } catch (Throwable ignored) { } ns = null; }
        if (agc != null) { try { agc.release(); } catch (Throwable ignored) { } agc = null; }
    }

    /** Stop the current session (tap end / long-press release). */
    void stopSession(final SessionListener l) {
        ex.submit(new Runnable() {
            public void run() {
                doStop(l, false);
            }
        });
    }

    void cancelSession() {
        ex.submit(new Runnable() {
            public void run() {
                doStop(null, true);
            }
        });
    }

    private void doStop(final SessionListener l, boolean discard) {
        if (rec == null) return;
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
        releaseCaptureEffects();
        if (discard) {
            engine.cancel();
            if (raf != null) {
                try { raf.close(); } catch (IOException e) { Log.w(TAG, "close canceled WAV", e); }
                raf = null;
            }
            if (!audioPath.isEmpty() && !new File(audioPath).delete()) {
                Log.w(TAG, "cannot delete canceled WAV");
            }
            synchronized (seg) {
                seg.setLength(0);
                livePartial = "";
                audioPath = "";
                ses = null;
            }
            pushEnd("", "", "");
            return;
        }
        String txt, err = "", path = "";
        int rc = 0;
        if (engine != null && ready) {
            try { rc = engine.stop(); } catch (Throwable t) { Log.w(TAG, "stop: " + t); }
        }
        awaitFinal();
        synchronized (seg) {
            txt = seg.length() == 0 ? livePartial : seg.toString().trim();
            path = audioPath;
        }
        if (txt.isEmpty()) {
            err = peak < SILENCE_PEAK ? "没有听到声音，请再说一次" : "未识别到文字，请再说一次";
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
        maybeRefine(path, txt);
    }

    /* 第二遍：拿刚落盘的 WAV 做一次离线重识别（裁掉长前导静音），只在**能证明更好**时
       替换本段文字：两段文本把相邻重复字压掉后完全相同、而第二遍重复更少。
       这样「下下午陪娃娃娃打打羽毛球」会变成「下午陪娃娃打羽毛球」，而
       「今天天气怎么样」不会被裁得过头的「今天天气怎怎么样」顶掉。
       不阻塞提交：onEnd 已经带着流式结果先回去了，这里只在 ex 上排队，
       用户按下一次录音（startRequested）时立刻放弃。 */
    private void maybeRefine(final String path, final String live) {
        if (path == null || path.isEmpty() || live == null || live.isEmpty() || !ready) return;
        long bytes = new File(path).length() - 44;
        if (bytes < SAMPLE_RATE * 2 / 2) return;                 // < 0.5 s
        if (bytes > 15L * SAMPLE_RATE * 2) return;               // > 15 s: too slow to redo
        ex.submit(new Runnable() {
            public void run() {
                if (startRequested || recording) return;
                try {
                    String off = doFile(path, true);
                    if (off.isEmpty()) return;
                    if (prefer(off, live)) {
                        Log.i(TAG, "refined: " + live + " -> " + off);
                        Bridge.pushJs("window.onSttRefined && onSttRefined("
                                + jsStr(path) + "," + jsStr(off) + ")");
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "refine failed", t);
                }
            }
        });
    }

    /** True when off is the same sentence with fewer adjacent duplicates than live. */
    static boolean prefer(String off, String live) {
        if (off == null || off.isEmpty()) return false;
        if (live == null || live.isEmpty()) return true;
        if (off.length() < live.length() - 3) return false;   // don't accept a heavily shortened pass
        if (!collapse(off).equals(collapse(live))) return false;
        return dupRuns(off) < dupRuns(live);
    }

    /** Collapse runs of the same character — only for comparing two engine outputs. */
    static String collapse(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (i == 0 || c != s.charAt(i - 1)) b.append(c);
        }
        return b.toString();
    }

    static int dupRuns(String s) {
        int n = 0;
        for (int i = 1; i < s.length(); i++) if (s.charAt(i) == s.charAt(i - 1)) n++;
        return n;
    }

    // -------------------------------------------------------- WAV file feed

    /** Feed a 16 kHz mono PCM16 WAV file through the engine. Call from a worker thread. */
    public String recognizeFile(final String path) {
        try {
            Future<String> f = ex.submit(new Callable<String>() {
                public String call() {
                    return doFile(path, false);
                }
            });
            return f.get();
        } catch (Throwable t) {
            Log.e(TAG, "recognizeFile", t);
            return "";
        }
    }

    private String doFile(String path, boolean preemptible) {
        if (!ensure()) return "";
        offlinePass = true;
        try {
            byte[] pcm = trimLeadingSilence(readWav(new File(path)));
            if (peakOf(pcm) < SILENCE_PEAK) return "";
            finalLatch = new CountDownLatch(1);
            synchronized (seg) {
                seg.setLength(0);
                ses = null;
            }
            int rc = engine.start();
            if (rc != 0) return "";
            int off = 0;
            while (off < pcm.length) {
                if (preemptible && startRequested) {
                    engine.cancel();
                    return "";
                }
                int n = Math.min(CHUNK, pcm.length - off);
                byte[] chunk = new byte[n];
                System.arraycopy(pcm, off, chunk, 0, n);
                engine.writeData(chunk, n);
                off += n;
                try { Thread.sleep(20); } catch (InterruptedException ignored) { }
            }
            for (int waited = 0; waited < 400; waited += 20) {
                if (preemptible && startRequested) {
                    engine.cancel();
                    return "";
                }
                try { Thread.sleep(20); } catch (InterruptedException ignored) { }
            }
            engine.stop();
            awaitFinal();
            synchronized (seg) {
                return seg.toString().trim();
            }
        } catch (Throwable t) {
            Log.e(TAG, "wav failed", t);
            return "";
        } finally {
            offlinePass = false;
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

    static int peakOf(byte[] pcm) {
        return peakOf(pcm, pcm.length);
    }

    private static int peakOf(byte[] pcm, int len) {
        int p = 0;
        for (int i = 0; i + 1 < len; i += 2) {
            int v = (short) ((pcm[i] & 0xFF) | (pcm[i + 1] << 8));
            int a = v < 0 ? -v : v;
            if (a > p) p = a;
        }
        return p;
    }

    /**
     * Drop the leading non-speech part of an utterance when it is long (>0.4s).
     * The engine's streaming decoder otherwise turns a leading noise burst into a phantom
     * syllable (the extra 「下」 in 「下下午」, the 「V ok」 in the dad clip). Speech onset is
     * detected with a 20 ms RMS envelope, a threshold 12 dB above the clip's 25th percentile
     * (floor >= -42 dB), and 160 ms of sustained energy so a 60 ms click does not count.
     * Trailing audio is never cut: cutting the tail is what produced 「羽毛球球」/「陪爸」.
     */
    static byte[] trimLeadingSilence(byte[] pcm) {
        final int winBytes = 640;         // 20 ms at 16k/16-bit/mono
        final int winSamples = winBytes / 2;
        int nwin = pcm.length / winBytes;
        if (nwin < 40) return pcm;        // < 0.8 s: nothing to trim
        double[] db = new double[nwin];
        for (int i = 0; i < nwin; i++) {
            long sum = 0;
            int off = i * winBytes;
            for (int j = 0; j < winSamples; j++) {
                int v = (short) ((pcm[off + j * 2] & 0xFF) | (pcm[off + j * 2 + 1] << 8));
                sum += (long) v * v;
            }
            double rms = Math.sqrt((double) sum / winSamples) / 32768.0;
            db[i] = rms > 0 ? 20 * Math.log10(rms) : -99;
        }
        double[] sorted = db.clone();
        java.util.Arrays.sort(sorted);
        double floor = sorted[Math.max(0, sorted.length / 4 - 1)];  // 25th percentile
        double thr = Math.max(-42.0, floor + 12.0);
        final int need = 8;               // 160 ms
        int onset = -1;
        for (int i = 0; i + need <= nwin; i++) {
            int ok = 0;
            for (int j = 0; j < need; j++) if (db[i + j] >= thr) ok++;
            if (ok >= need - 1) { onset = i; break; }
        }
        if (onset <= 0) return pcm;
        double t = onset * 0.02;
        if (t <= 0.40) return pcm;        // short leading silence: trimming hurt these
        int start = onset * winBytes;
        if (start >= pcm.length - 3200) return pcm;
        byte[] out = new byte[pcm.length - start];
        System.arraycopy(pcm, start, out, 0, out.length);
        Log.i(TAG, String.format(Locale.US, "trim leading silence: %.2fs", t));
        return out;
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