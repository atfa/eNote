package __PACKAGE__;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Thin Java shell: the business logic lives in lib__GO_LIB__.so (Go, -buildmode=c-shared).
 *
 * Java does only what Java must do - create the View, own the Activity lifecycle, and expose
 * the callbacks the Go side calls back into. Everything else is Go.
 *
 * Test hooks (see the skill's references/testing.md):
 *   am start -n __PACKAGE__/.MainActivity --es hook ping
 *   files/testhook with "key=value"
 *   --es hook async | threads | webtest | web | exec
 */
public class MainActivity extends Activity {
    static final String TAG = "__TAG__";
    static final String LOGFILE = "testlog.txt";

    static final long LOAD_NS;
    static {
        long t = System.nanoTime();
        System.loadLibrary("__GO_LIB__");
        LOAD_NS = System.nanoTime() - t;
    }

    // Declared `native`: resolved from the .so by symbol name (see go/main.go).
    static native String nativeInfo();
    static native long nativeFib(int n);
    static native String nativePut(String key);
    static native String nativeBenchmark(int n);
    static native String nativeWriteFile(String filesDir);
    static native int nativeCallback(Object target);
    static native String nativeAsyncCallback(Object target, int ms);
    public static native String nativeStartServer();
    public static native String nativeWebSelfTest();

    final AtomicReference<String> lastCallback = new AtomicReference<>("(none)");
    TextView tv;
    final Handler ui = new Handler(Looper.getMainLooper());

    /** Called from Go through JNI (see jCallOnGoCallback in go/main.go). */
    public void onGoCallback(String msg) {
        lastCallback.set(msg);
        note("go->java callback: " + msg);
    }

    /** Every notable event goes to logcat AND files/testlog.txt (logcat is unreliable). */
    void note(String msg) {
        Log.i(TAG, msg);
        try (FileOutputStream f = new FileOutputStream(new File(getFilesDir(), LOGFILE), true);
             OutputStreamWriter w = new OutputStreamWriter(f, "UTF-8")) {
            w.write(String.format(Locale.US, "%.3f %s\n", System.currentTimeMillis() / 1000.0, msg));
        } catch (Exception e) {
            Log.w(TAG, "testlog: " + e);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tv = new TextView(this);
        tv.setTextSize(15);
        tv.setGravity(Gravity.CENTER);
        tv.setBackgroundColor(0xFF101418);
        tv.setTextColor(0xFFE6EDF3);
        tv.setText("Go on Android\n\nloading lib__GO_LIB__.so ...");
        setContentView(tv);

        new File(getFilesDir(), LOGFILE).delete();
        note("created lib__GO_LIB__.so loaded in " + (LOAD_NS / 1000) + " us");

        // Native calls go on a worker thread: a JNI call that blocks the main thread for
        // five seconds is an ANR. No lambdas here - android.jar has no LambdaMetafactory,
        // so `javac -source 8 -bootclasspath android.jar` cannot compile them.
        new Thread(new Runnable() {
            public void run() { runAll(); }
        }, "go-probe").start();

        Bundle b = getIntent() == null ? null : getIntent().getExtras();
        note("created extras=" + (b == null ? "none" : b.keySet().toString()));
        if (b != null && b.getString("hook") != null) {
            String h = b.getString("hook");
            note("hook: " + h);
            handleHook(h);
        }
    }

    void handleHook(final String h) {
        if ("threads".equals(h)) {
            new Thread(new Runnable() { public void run() { concurrencyTest(); } }, "go-threads").start();
        } else if ("async".equals(h)) {
            note("async: " + nativeAsyncCallback(this, 400));
        } else if ("webtest".equals(h)) {
            new Thread(new Runnable() { public void run() {
                try {
                    note("webtest: url=" + nativeStartServer());
                    note("check go-http: " + nativeWebSelfTest());
                } catch (Throwable t) { note("webtest FAILED: " + t); }
            } }, "go-web").start();
        } else if ("web".equals(h)) {
            final String url = nativeStartServer();
            note("web: server at " + url);
            android.content.Intent i = new android.content.Intent(this, GoWebViewActivity.class);
            i.putExtra("url", url);
            startActivity(i);
        } else if ("exec".equals(h)) {
            new Thread(new Runnable() { public void run() { execGoBinary(); } }, "go-exec").start();
        }
    }

    /** The battery: every JNI direction, Go-side I/O, goroutines, benchmark. */
    void runAll() {
        try {
            note("info: " + nativeInfo());
            note("check fib(25)=" + nativeFib(25) + " expected 75025");
            note("check put(k1)=" + nativePut("k1"));
            note("check file: " + nativeWriteFile(getFilesDir().getAbsolutePath()));
            int rc = nativeCallback(this);
            note("check callback rc=" + rc + " -> " + lastCallback.get());
            note("benchmark " + nativeBenchmark(26));
            note("ALL-GO-CHECKS-DONE");
        } catch (Throwable t) {
            note("GO-CALL-FAILED " + t);
            Log.e(TAG, "go call", t);
        }
    }

    /** 8 Java threads hammering one Go function: the Go runtime handles it, results are right. */
    void concurrencyTest() {
        final int T = 8, N = 22, EXPECT = 17711;
        Thread[] ts = new Thread[T];
        final int[] ok = new int[T];
        for (int i = 0; i < T; i++) {
            final int id = i;
            ts[i] = new Thread(new Runnable() {
                public void run() { ok[id] = nativeFib(N) == EXPECT ? 1 : 0; }
            }, "go-jni-" + i);
            ts[i].start();
        }
        for (int i = 0; i < T; i++) {
            try { ts[i].join(); } catch (InterruptedException ignored) {}
        }
        int good = 0;
        for (int i = 0; i < T; i++) good += ok[i];
        note("check concurrency: " + good + "/" + T + " java threads got fib(" + N + ")=" + EXPECT);
    }

    /** Run the pure-Go binary shipped in the apk (no JNI at all) over pipes. */
    void execGoBinary() {
        String bin = getApplicationInfo().nativeLibraryDir + "/lib__GO_BIN__.so";
        note("exec: " + bin + " exists=" + new File(bin).exists());
        try {
            ProcessBuilder pb = new ProcessBuilder(bin, "hello-from-java");
            pb.redirectErrorStream(true);
            Process p = pb.start();
            java.io.OutputStream os = p.getOutputStream();
            os.write("ping from java\n".getBytes("UTF-8"));
            os.close();
            java.io.BufferedReader r = new java.io.BufferedReader(
                    new java.io.InputStreamReader(p.getInputStream(), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null) note("exec stdout: " + line);
            note("check exec: exit=" + p.waitFor());
        } catch (Exception e) {
            note("check exec FAILED: " + e);
        }
    }

    void render() {
        ui.post(new Runnable() {
            public void run() { tv.setText("Go on Android, built on the phone\n\n" + nativeInfo()); }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        note("onResume");
        render();
        pollHookFile();
    }

    @Override
    protected void onPause() {
        super.onPause();
        note("onPause");
    }

    /** Android 14+ drops intent extras when the activity is already on top: file hook. */
    void pollHookFile() {
        File f = new File(getFilesDir(), "testhook");
        if (!f.exists()) return;
        try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (!line.trim().isEmpty()) note("hook: " + line.trim());
            }
        } catch (Exception e) {
            note("testhook read failed: " + e);
        }
        f.delete();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            note("back key");
            finish();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
