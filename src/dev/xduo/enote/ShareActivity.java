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
 * The system share target: "分享 → eNote" from any app.
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
        setContentView(sc);

        final Intent it = getIntent();
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
        new Thread(new Runnable() {
            public void run() {
                handle(getIntent());
                finish(1200);
            }
        }).start();
    }

    void handle(Intent it) {
        note("handle action=" + it.getAction() + " type=" + it.getType()
                + " text=" + (it.getStringExtra(Intent.EXTRA_TEXT) == null ? "null" : "yes"));
        String action = it.getAction();
        String type = it.getType() == null ? "" : it.getType();
        try {
            if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> uris = it.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (uris != null) {
                    for (Uri u : uris) processImage(u);
                }
                return;
            }
            String text = it.getStringExtra(Intent.EXTRA_TEXT);
            String subject = it.getStringExtra(Intent.EXTRA_SUBJECT);
            Uri stream = it.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream != null && (type.startsWith("image/") || type.equals("*/*"))) {
                processImage(stream);
                if (text != null && text.trim().length() > 0) {
                    Bridge.enqueueText(text, subject, "share-text");
                }
                return;
            }
            if (text != null && text.trim().length() > 0) {
                String r = Bridge.enqueueText(text, subject, "share-text");
                note("enqueueText -> " + r);
                ui("已保存文字，AI 解析中…");
                return;
            }
            if (stream != null) {
                processImage(stream);
                return;
            }
            // some apps share a plain-text file through EXTRA_STREAM
            if (stream != null && type.startsWith("text/")) {
                processImage(stream);
                return;
            }
            ui("没有可保存的内容");
        } catch (Throwable t) {
            Log.e(TAG, "share failed", t);
            ui("处理失败: " + t);
        }
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

    File copyToInbox(Uri uri) throws Exception {
        String name = displayName(uri);
        String ext = ".jpg";
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
                    Toast.makeText(ShareActivity.this, "已加入 eNote", Toast.LENGTH_SHORT).show();
                }
                finish();
            }
        });
    }
}
