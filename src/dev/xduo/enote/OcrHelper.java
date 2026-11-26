package dev.xduo.enote;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.util.Log;

import java.io.File;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Owns the vivo offline OCR engine (libocr_general.so + .vaimlite models unpacked from
 * assets). One serial executor: the engine is not reentrant, and sharing must never run
 * two recognitions at once.
 *
 * This is the only place that touches images: the LLM only ever sees the text produced here.
 */
public class OcrHelper {
    static final int MAX_DIM = 2400;

    public static class Out {
        public String text = "";
        public long ms;
        public int lines;
        public String error = "";
    }

    private static OcrHelper one;
    private final Context ctx;
    private OcrEngine engine;
    volatile boolean ready;
    volatile String info = "未初始化";
    private final ExecutorService ex = Executors.newSingleThreadExecutor();

    static synchronized OcrHelper get(Context c) {
        if (one == null) one = new OcrHelper(c.getApplicationContext());
        return one;
    }

    private OcrHelper(Context c) {
        ctx = c;
    }

    private final OcrEngine.Log_ logcb = new OcrEngine.Log_() {
        @Override
        public void log(String s) {
            Log.i(TAG_, s);
        }
    };
    static final String TAG_ = "enote-ocr";

    void initAsync() {
        ex.submit(new Runnable() {
            public void run() {
                ensure();
            }
        });
    }

    /** Must run on the OCR executor. */
    private synchronized boolean ensure() {
        if (ready && engine != null && engine.isInited()) return true;
        try {
            if (!prepareEngine()) return false;
            info = "cpu, v" + engine.getVersion();
            ready = true;
            Bridge.nativeSetOcr(true, info);
            Log.i(TAG_, "OCR ready: " + info);
            return true;
        } catch (Throwable t) {
            boolean r = fail("初始化异常: " + t);
            Log.e(TAG_, "ocr init failed", t);
            return r;
        }
    }

    /** 第一次先解包模型；引擎先试 cpu，不行再试 opencl。抛出来由 ensure 的 catch 接手。 */
    private boolean prepareEngine() throws Exception {
        if (engine == null) {
            info = "解包模型…";
            OcrEngine.unpackModels(ctx, logcb);
            engine = new OcrEngine(ctx);
        }
        info = "初始化引擎…";
        if (engine.init("cpu", 3, 1, 1, logcb)) return true;
        Log.w(TAG_, "cpu init failed (" + engine.getLastError() + "), trying opencl");
        if (engine.init("opencl", 3, 1, 1, logcb)) return true;
        return fail("初始化失败: " + engine.getLastError());
    }

    /** 引擎没起来：info 写原因，同步给页面，固定返回 false。 */
    private boolean fail(String why) {
        info = why;
        ready = false;
        try {
            Bridge.nativeSetOcr(false, info);
        } catch (Throwable ignored) {
        }
        return false;
    }

    /** Blocking OCR of a file; only call from a worker thread. */
    public Out recognizeFile(final String path) {
        try {
            Future<Out> f = ex.submit(new Callable<Out>() {
                public Out call() {
                    return doFile(path);
                }
            });
            return f.get();
        } catch (Throwable t) {
            Out o = new Out();
            o.error = "识别异常: " + t;
            Log.e(TAG_, "recognizeFile", t);
            return o;
        }
    }

    private Out doFile(String path) {
        Out o = new Out();
        if (!ensure()) {
            o.error = "OCR 引擎未就绪：" + info;
            return o;
        }
        Bitmap bmp = decode(path);
        if (bmp == null) {
            o.error = "无法读取图片（格式不支持？）";
            return o;
        }
        try {
            readText(o, path, bmp);
        } catch (Throwable t) {
            o.error = "识别失败: " + t;
            Log.e(TAG_, "recognize", t);
        } finally {
            bmp.recycle();
        }
        return o;
    }

    /** 跑一次识别，把字数 / 行数 / 全文写进出参；没识别到字也写 error。 */
    private void readText(Out o, String path, Bitmap bmp) {
        OcrEngine.Result r = engine.recognizeFull(bmp);
        o.ms = r.ms;
        o.lines = r.lines.size();
        o.text = r.fullText();
        if (o.text.trim().isEmpty()) {
            o.error = "图片里没有识别到文字"
                    + (engine.getLastError().isEmpty() ? "" : " (" + engine.getLastError() + ")");
        }
        Log.i(TAG_, "ocr " + path + " -> " + o.text.length() + " chars, " + o.lines
                + " lines, " + o.ms + " ms");
    }

    /** Decode with downscaling (the engine is quadratic-ish in pixels) + EXIF rotation. */
    static Bitmap decode(String path) {
        try {
            BitmapFactory.Options bo = new BitmapFactory.Options();
            bo.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(path, bo);
            int w = bo.outWidth, h = bo.outHeight;
            int sample = 1;
            while (Math.max(w, h) / sample > MAX_DIM) sample *= 2;
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            o.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap b = BitmapFactory.decodeFile(path, o);
            if (b == null) return null;
            int rot = exifRotation(path);
            if (rot != 0) {
                Matrix m = new Matrix();
                m.postRotate(rot);
                Bitmap r = Bitmap.createBitmap(b, 0, 0, b.getWidth(), b.getHeight(), m, true);
                if (r != b) b.recycle();
                b = r;
            }
            Log.i(TAG_, "decoded " + w + "x" + h + " sample=" + sample
                    + " rot=" + rot + " -> " + b.getWidth() + "x" + b.getHeight());
            return b;
        } catch (Throwable t) {
            Log.e(TAG_, "decode " + path, t);
            return null;
        }
    }

    static int exifRotation(String path) {
        try {
            ExifInterface e = new ExifInterface(path);
            int ori = e.getAttributeInt(ExifInterface.TAG_ORIENTATION, 1);
            if (ori == 3) return 180;
            if (ori == 6) return 90;
            if (ori == 8) return 270;
        } catch (Throwable ignored) {
        }
        return 0;
    }

    static File inboxDir(Context c) {
        File d = new File(c.getFilesDir(), "enote/inbox");
        if (!d.exists()) d.mkdirs();
        return d;
    }
}
