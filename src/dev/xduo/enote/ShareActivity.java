package dev.xduo.enote;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

/**
 * The system share target: "分享 → 懒得记" from any app.
 *
 * text/plain  -> handed to Go as-is
 * image/*     -> copied into the app's files dir, read by the local OCR engine, and only
 *                the recognised text goes on to the LLM (the image never leaves the phone)
 *
 * The process is started here, so Bridge.init (Go) happens in EnoteApp.onCreate first.
 */
public class ShareActivity extends Activity {
    TextView label;
    volatile boolean done;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(busyView());
        startHandle(getIntent());
    }

    /** 转图 + 一行状态文字：分享处理期间屏幕上只有这一层。 */
    private View busyView() {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        col.setPadding(pad, pad, pad, pad);
        ProgressBar pb = new ProgressBar(this);
        label = new TextView(this);
        label.setText("正在处理分享内容…");
        label.setTextSize(15f);
        label.setGravity(Gravity.CENTER);
        col.addView(pb, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tp.topMargin = pad / 2;
        col.addView(label, tp);
        ScrollView sc = new ScrollView(this);
        sc.addView(col);
        return sc;
    }

    /** 处理放后台线程（OCR + 网络不能卡主线程），完事留 1.2 秒给用户看结果。 */
    private void startHandle(final Intent it) {
        new Thread(new Runnable() {
            public void run() {
                handle(it);
                finish(1200);
            }
        }).start();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        startHandle(getIntent());
    }

    void handle(Intent it) {
        note("handle action=" + it.getAction() + " type=" + it.getType()
                + " text=" + (it.getStringExtra(Intent.EXTRA_TEXT) == null ? "null" : "yes"));
        String action = it.getAction();
        String type = it.getType() == null ? "" : it.getType();
        try {
            if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                shareMultiple(it);
                return;
            }
            String text = it.getStringExtra(Intent.EXTRA_TEXT);
            String subject = it.getStringExtra(Intent.EXTRA_SUBJECT);
            Uri stream = it.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream != null && (type.startsWith("image/") || type.equals("*/*"))) {
                shareImageWithText(stream, text, subject);
                return;
            }
            if (text != null && text.trim().length() > 0) {
                shareText(text, subject);
                return;
            }
            if (stream != null) {
                // anything that is not an image (pdf, txt, office, ...) is stored as a file
                processFile(stream);
                return;
            }
            ui("没有可保存的内容");
        } catch (Throwable t) {
            Log.e(TAG, "share failed", t);
            ui("处理失败: " + t);
        }
    }

    /** 一次分享多张图：逐张走图片链路。 */
    private void shareMultiple(Intent it) {
        ArrayList<Uri> uris = it.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (uris == null) return;
        for (Uri u : uris) processImage(u);
    }

    /** 一张图 + 附带文字：图走图片链路，文字另存一条。 */
    private void shareImageWithText(Uri stream, String text, String subject) {
        processImage(stream);
        if (text != null && text.trim().length() > 0) {
            Bridge.enqueueText(text, subject, "share-text");
        }
    }

    /** 只有文字：直接入队，AI 解析在 Go 侧跑。 */
    private void shareText(String text, String subject) {
        String r = Bridge.enqueueText(text, subject, "share-text");
        note("enqueueText -> " + r);
        ui("已保存文字，AI 解析中…");
    }

    static final String TAG = "enote-share";

    void processImage(Uri uri) {
        ui("正在识别图片…");
        try {
            File f = copyToInbox(uri);
            ui("正在识别图片（本机 OCR）…");
            OcrHelper.Out o = OcrHelper.get(this).recognizeFile(f.getAbsolutePath());
            ui(o.error.isEmpty() ? "识别完成，AI 解析中…" : o.error);
            Bridge.enqueueImage(null, f.getAbsolutePath(), f.getName(),
                    o.text, o.ms, o.error, "share-image");
        } catch (Throwable t) {
            Log.e(TAG, "image failed", t);
            ui("图片处理失败: " + t);
            Bridge.enqueueImage(null, "", displayName(uri), "", 0,
                    "图片处理失败: " + t, "share-image");
        }
    }

    void processFile(Uri uri) {
        ui("正在保存文件…");
        String mime = "application/octet-stream";
        try {
            String m = getContentResolver().getType(uri);
            if (m != null && m.length() > 0) mime = m;
        } catch (Throwable ignored) {
        }
        try {
            File f = copyToInbox(uri, extFor(mime));
            ui("已保存：" + f.getName());
            Bridge.enqueueFile(f.getAbsolutePath(), displayName(uri), mime, "", "share-file");
        } catch (Throwable t) {
            Log.e(TAG, "file failed", t);
            ui("文件处理失败: " + t);
            Bridge.enqueueFile("", displayName(uri), mime,
                    "文件处理失败: " + t, "share-file");
        }
    }

    static String extFor(String mime) {
        if (mime == null) return ".bin";
        if (mime.startsWith("image/")) return ".jpg";
        if (mime.contains("pdf")) return ".pdf";
        if (mime.startsWith("text/")) return ".txt";
        if (mime.contains("zip")) return ".zip";
        return ".bin";
    }

    File copyToInbox(Uri uri) throws Exception {
        return copyToInbox(uri, ".jpg");
    }

    File copyToInbox(Uri uri, String defExt) throws Exception {
        String name = displayName(uri);
        String ext = defExt;
        int dot = name.lastIndexOf('.');
        if (dot > 0 && dot > name.length() - 7) ext = name.substring(dot);
        File dir = OcrHelper.inboxDir(this);
        File out = new File(dir, System.currentTimeMillis() + ext);
        InputStream in = getContentResolver().openInputStream(uri);
        FileOutputStream fo = new FileOutputStream(out);
        byte[] buf = new byte[65536];
        int n;
        long total = 0;
        while ((n = in.read(buf)) > 0) {
            fo.write(buf, 0, n);
            total += n;
        }
        fo.close();
        in.close();
        Log.i(TAG, "copied " + uri + " -> " + out + " (" + total + " B)");
        return out;
    }

    String displayName(Uri uri) {
        try {
            Cursor c = getContentResolver().query(uri,
                    new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null) {
                try {
                    if (c.moveToFirst()) {
                        String s = c.getString(0);
                        if (s != null && s.length() > 0) return s;
                    }
                } finally {
                    c.close();
                }
            }
        } catch (Throwable ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null ? "image.jpg" : last;
    }

    void note(String m) {
        Log.i(TAG, m);
        try (java.io.OutputStreamWriter w = new java.io.OutputStreamWriter(
                new java.io.FileOutputStream(new File(getFilesDir(), "testlog.txt"), true), "UTF-8")) {
            w.write(String.format(java.util.Locale.US, "%.3f share: %s\n",
                    System.currentTimeMillis() / 1000.0, m));
        } catch (Exception ignored) {
        }
    }

    void ui(final String s) {
        runOnUiThread(new Runnable() {
            public void run() {
                label.setText(s);
            }
        });
    }

    void finish(final int ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
        }
        runOnUiThread(new Runnable() {
            public void run() {
                Intent i = new Intent(ShareActivity.this, MainActivity.class);
                i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(i);
                } catch (Throwable t) {
                    Toast.makeText(ShareActivity.this, "已加入 懒得记", Toast.LENGTH_SHORT).show();
                }
                finish();
            }
        });
    }
}
