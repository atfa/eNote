package __PACKAGE__;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.ServerSocket;
import java.util.Locale;

/**
 * Java shell for a Wails v3 app: exec the Go server binary, read its URL from stdout, show
 * the page in a WebView. All business logic is Go (bound services), all UI is HTML/JS -
 * Java is ~90 lines of plumbing.
 *
 * Test hooks:
 *   am start -n __PACKAGE__/.MainActivity --es hook start|wails
 */
public class MainActivity extends Activity {
    static final String TAG = "__TAG__";
    volatile String url;
    volatile Process wails;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        note("start");
        TextView tv = new TextView(this);
        tv.setPadding(48, 48, 48, 48);
        tv.setText("starting the Wails Go server\u2026");
        setContentView(tv);

        // The hook comes from the INTENT, not the savedInstanceState bundle (Android 14+ drops
        // the extras when the activity is already on top - then the files/testhook file works).
        String hook = getIntent() == null ? null : getIntent().getStringExtra("hook");
        note("hook: " + (hook == null ? "start" : hook));
        File f = new File(getFilesDir(), "testhook");
        if (f.exists()) {
            readHookFile(f);
        }
        startWails();
    }

    /** Launch the Go binary from nativeLibraryDir and follow its stdout. */
    void startWails() {
        new Thread(new Runnable() {
            public void run() {
                try {
                    String bin = getApplicationInfo().nativeLibraryDir + "/lib__GO_BIN__.so";
                    int port = freePort();
                    ProcessBuilder pb = new ProcessBuilder(bin);
                    pb.environment().put("WAILS_SERVER_PORT", String.valueOf(port));
                    pb.redirectErrorStream(true);
                    note("exec: " + bin + " port=" + port);
                    wails = pb.start();
                    url = "http://127.0.0.1:" + port + "/";
                    BufferedReader r = new BufferedReader(
                            new InputStreamReader(wails.getInputStream(), "UTF-8"));
                    String line;
                    while ((line = r.readLine()) != null) {
                        final String s = line.trim();
                        if (s.isEmpty()) continue;
                        note("wails: " + s);
                        if (s.startsWith("SERVER URL:")) {
                            url = s.substring("SERVER URL:".length()).trim();
                            openWeb();
                        }
                    }
                    note("wails: process exited, code=" + wails.waitFor());
                } catch (Exception e) {
                    note("exec FAILED: " + e);
                }
            }
        }, "wails").start();
    }

    void openWeb() {
        runOnUiThread(new Runnable() {
            public void run() {
                note("open webview " + url);
                Intent it = new Intent(MainActivity.this, GoWebViewActivity.class);
                it.putExtra("url", url);
                startActivity(it);
            }
        });
    }

    /** Never hardcode a port: ask the OS for a free one and hand it to the Go server. */
    static int freePort() {
        try {
            ServerSocket s = new ServerSocket(0);
            int p = s.getLocalPort();
            s.close();
            return p;
        } catch (Exception e) {
            return 34789;
        }
    }

    void readHookFile(File f) {
        try {
            byte[] buf = new byte[(int) f.length()];
            java.io.FileInputStream in = new java.io.FileInputStream(f);
            in.read(buf);
            in.close();
            f.delete();
            for (String line : new String(buf, "UTF-8").split("\n")) {
                if (!line.trim().isEmpty()) note("hook: " + line.trim());
            }
        } catch (Exception e) {
            note("testhook read failed: " + e);
        }
    }

    void note(String msg) {
        Log.i(TAG, msg);
        try (FileOutputStream out = new FileOutputStream(
                new File(getFilesDir(), "testlog.txt"), true);
             OutputStreamWriter w = new OutputStreamWriter(out, "UTF-8")) {
            w.write(String.format(Locale.US, "%.3f %s\n", System.currentTimeMillis() / 1000.0, msg));
        } catch (Exception e) {
            Log.w(TAG, "testlog: " + e);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (wails != null) {
            wails.destroy();
            note("wails: terminated");
        }
    }
}
