package dev.xduo.enote;

import android.content.Context;
import android.graphics.Bitmap;
import android.util.Log;

import com.vivo.aiocr.general.InitParamsOCRGPU;
import com.vivo.aiocr.general.SaveWordsResults;
import com.vivo.aiocr.general.VivoOCRGeneral;
import com.vivo.aiocr.general.WordResult;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Loads vivo's offline OCR engine inside our own process.
 *
 * Model layout is the one AIService builds at runtime (OcrMdlBase.d()/b()):
 *
 *   <filesDir>/algorithmRes/local/asset/mdl_ocr/ocr_det/<detKey>/det_model.vaimlite
 *   <filesDir>/algorithmRes/local/asset/mdl_ocr/ocr_rec/<recKey>/rec_model_fp16.vaimlite
 *                                                          vert_model_fp16.vaimlite
 *                                                          hw_model_fp16.vaimlite
 *                                                          dire_model_fp16.vaimlite
 *                                                          rec_md5.json
 *   <filesDir>/vcap/gpu/mdl_ocr/                                (vcap cache, VcapUtils.c)
 *
 * detKey/recKey are the size constants AIService passes to OcrModelInfo ("6" / "4").
 */
public class OcrEngine {
    public static final String TAG = "vivoocr";

    public interface Log_ {
        void log(String s);
    }

    /** One recognised word with its pixel box in the source bitmap. */
    public static class Word {
        public int x, y, w, h;
        public int[] raw;
        public String text;
        public int line = -1;      // index into Result.lines
        public int order = -1;     // reading order index inside the line
        public String toString() {
            return text + " [" + x + "," + y + " " + w + "x" + h + "]";
        }
    }

    /** One recognised text line: mRec/mDet of a SaveWordsResults entry. */
    public static class Line {
        public int x, y, w, h;
        public int[] raw;
        public String text;
        public int rot;
        public int directFlag;
    }

    /** Everything one OCR pass produced. */
    public static class Result {
        public final List<Line> lines = new ArrayList<Line>();
        public final List<Word> words = new ArrayList<Word>();
        public long ms;
        public int errorCode;

        /** Lines top-to-bottom, left-to-right, joined with newlines. */
        public String fullText() {
            List<Line> sorted = new ArrayList<Line>(lines);
            java.util.Collections.sort(sorted, new java.util.Comparator<Line>() {
                public int compare(Line a, Line b) {
                    int rowA = a.y / Math.max(1, a.h / 2);
                    int rowB = b.y / Math.max(1, b.h / 2);
                    if (Math.abs(rowA - rowB) > Math.max(a.h, b.h) / 2) return rowA - rowB;
                    return a.x - b.x;
                }
            });
            StringBuilder sb = new StringBuilder();
            for (Line l : sorted) {
                if (sb.length() > 0) sb.append('\n');
                sb.append(l.text);
            }
            return sb.toString();
        }
    }

    private final Context ctx;
    private boolean inited;
    private String version = "";
    private String lastError = "";

    public OcrEngine(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    public boolean isInited() {
        return inited;
    }

    public String getVersion() {
        return version;
    }

    public String getLastError() {
        return lastError;
    }

    public static File modelRoot(Context ctx) {
        return new File(ctx.getFilesDir(), "algorithmRes/local/asset/mdl_ocr");
    }

    /** Copy the models out of assets/ once (~9 MB, ~1 s). */
    public static void unpackModels(Context ctx, Log_ log) throws Exception {
        File root = modelRoot(ctx);
        File det = new File(root, "ocr_det/6");
        File rec = new File(root, "ocr_rec/4");
        String[] detFiles = {"det_model.vaimlite"};
        String[] recFiles = {"rec_model_fp16.vaimlite", "vert_model_fp16.vaimlite",
                "hw_model_fp16.vaimlite", "dire_model_fp16.vaimlite", "rec_md5.json"};
        long t0 = System.currentTimeMillis();
        int n = 0;
        for (String f : detFiles) n += unpack(ctx, det, f, log);
        for (String f : recFiles) n += unpack(ctx, rec, f, log);
        File cache = new File(ctx.getFilesDir(), "vcap/gpu/mdl_ocr");
        if (!cache.exists()) cache.mkdirs();
        log.log("models unpacked (" + n + " files, " + (System.currentTimeMillis() - t0) + " ms)");
    }

    private static int unpack(Context ctx, File dir, String name, Log_ log) throws Exception {
        File out = new File(dir, name);
        if (out.exists() && out.length() > 0) return 0;
        dir.mkdirs();
        InputStream in = ctx.getAssets().open("mdl_ocr/" + name);
        byte[] buf = new byte[65536];
        FileOutputStream fo = new FileOutputStream(out);
        int n;
        while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
        fo.close();
        in.close();
        log.log("  unpacked " + name + " (" + out.length() + " B)");
        return 1;
    }

    /**
     * @param device  "cpu" (portable) or "opencl" (vivo/Adreno tuned)
     * @return true when the engine answered and reported success
     */
    public boolean init(String device, int threads, int power, int logFlag, Log_ log) {
        lastError = "";
        if (!VivoOCRGeneral.loadLibs()) {
            lastError = "loadLibrary: " + VivoOCRGeneral.loadError();
            log.log("FAIL " + lastError);
            return false;
        }
        log.log("libraries loaded");
        InitParamsOCRGPU p = new InitParamsOCRGPU();
        p.modelDir = new File(modelRoot(ctx), "ocr_det/6").getAbsolutePath();
        p.modelDirectDir = new File(modelRoot(ctx), "ocr_rec/4").getAbsolutePath();
        p.cachePath = new File(ctx.getFilesDir(), "vcap/gpu/mdl_ocr").getAbsolutePath();
        p.device = device;
        p.threadNumsVCAP = threads;
        p.powerVCAP = power;
        p.logFlag = logFlag;
        long t0 = System.currentTimeMillis();
        int ret;
        try {
            ret = VivoOCRGeneral.InitOCR(p);
        } catch (Throwable t) {
            lastError = "InitOCR threw " + t;
            log.log("FAIL " + lastError);
            return false;
        }
        long ms = System.currentTimeMillis() - t0;
        version = safe(VivoOCRGeneral.GetOCRVersion());
        log.log("InitOCR(device=" + device + ", threads=" + threads + ", power=" + power
                + ") -> " + ret + " in " + ms + " ms, ocr version=" + version);
        if (ret != 0) {
            lastError = "InitOCR returned " + ret;
            return false;
        }
        inited = true;
        return true;
    }

    public void release() {
        if (!inited) return;
        try { VivoOCRGeneral.ReleaseOCR(); } catch (Throwable ignored) {}
        inited = false;
    }

    /** Flat word list (used by the headless probe). */
    public List<Word> recognize(Bitmap bmp) {
        return recognizeFull(bmp).words;
    }

    /**
     * Full pipeline: detect + recognise + direction + drop noise.
     *
     * vivo returns one SaveWordsResults per text line: mRec is the whole line,
     * mWords[] the individual words. Boxes are int[8] = 4 corner points.
     */
    public Result recognizeFull(Bitmap bmp) {
        Result res = new Result();
        long t0 = System.currentTimeMillis();
        if (!inited) {
            lastError = "not inited";
            return res;
        }
        SaveWordsResults[] r;
        try {
            r = VivoOCRGeneral.runDetRecDireDel(bmp);
        } catch (Throwable t) {
            lastError = "runDetRecDireDel threw " + t;
            return res;
        }
        res.ms = System.currentTimeMillis() - t0;
        if (r == null) {
            lastError = "runDetRecDireDel returned null";
            return res;
        }
        for (SaveWordsResults s : r) {
            if (s == null) continue;
            if (s.errorCode != 0) {
                lastError = "errorCode=" + s.errorCode;
                res.errorCode = s.errorCode;
            }
            final int lineIdx = res.lines.size();
            if (s.mRec != null && s.mRec.trim().length() > 0) {
                Line l = new Line();
                l.text = s.mRec;
                l.raw = s.mDet;
                l.rot = (int) s.mRot;
                l.directFlag = s.directFlag;
                Word tmp = new Word();
                box(s.mDet, tmp);
                l.x = tmp.x; l.y = tmp.y; l.w = tmp.w; l.h = tmp.h;
                res.lines.add(l);
            }
            int order = 0;
            if (s.mWords != null) {
                for (WordResult wr : s.mWords) {
                    if (wr == null || wr.wRec == null || wr.wRec.trim().length() == 0) continue;
                    Word w = new Word();
                    w.text = wr.wRec;
                    w.raw = wr.wDet;
                    box(wr.wDet, w);
                    w.line = s.mRec != null && s.mRec.trim().length() > 0 ? lineIdx : -1;
                    w.order = order++;
                    res.words.add(w);
                }
            }
        }
        return res;
    }

    /** vivo hands back a flat int[] per line/word; dump it raw and map the common shapes. */
    static void box(int[] d, Word w) {
        if (d == null) return;
        if (d.length >= 8) {
            int minx = Integer.MAX_VALUE, miny = Integer.MAX_VALUE;
            int maxx = Integer.MIN_VALUE, maxy = Integer.MIN_VALUE;
            for (int i = 0; i + 1 < d.length; i += 2) {
                if (d[i] < minx) minx = d[i];
                if (d[i] > maxx) maxx = d[i];
                if (d[i + 1] < miny) miny = d[i + 1];
                if (d[i + 1] > maxy) maxy = d[i + 1];
            }
            w.x = minx; w.y = miny;
            w.w = maxx - minx; w.h = maxy - miny;
        } else if (d.length == 4) {
            w.x = d[0]; w.y = d[1];
            w.w = d[2] - d[0]; w.h = d[3] - d[1];
        }
    }

    private static String safe(String s) {
        return s == null ? "" : s;
    }
}
