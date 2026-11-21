package __PACKAGE__;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.util.Locale;

/**
 * Minimal starting point - replace the TextView with your own View (Canvas game, list, ...).
 *
 * Test hooks, so a shell script can drive the app and read back what happened:
 *
 *   am start -n __PACKAGE__/.MainActivity --es hook ping   -> "hook: ping"
 *   files/testhook  (one "key=value" line, deleted after reading) -> "hook: key=value"
 *
 * Every notable event goes to BOTH logcat and files/testlog.txt. logcat is unreliable on a
 * busy phone (system noise evicts it within seconds), while the file is only readable by root:
 *   su --mount-master -c "cat /data/data/__PACKAGE__/files/testlog.txt"
 */
public class MainActivity extends Activity {
    static final String TAG = "__TAG__";
    static final String LOGFILE = "testlog.txt";

    /** Append one line to logcat and to files/testlog.txt. */
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
        TextView tv = new TextView(this);
        tv.setText(getString(R.string.app_name) + "\n\nbuilt on the phone");
        tv.setTextSize(24);
        tv.setGravity(Gravity.CENTER);
        tv.setBackgroundColor(0xFF101418);
        tv.setTextColor(0xFFE6EDF3);
        setContentView(tv);

        new File(getFilesDir(), LOGFILE).delete();      // fresh log per process
        Bundle b = getIntent() == null ? null : getIntent().getExtras();
        note("created extras=" + (b == null ? "none" : b.keySet().toString()));
        if (b != null && b.getString("hook") != null) note("hook: " + b.getString("hook"));
    }

    @Override
    protected void onResume() {
        super.onResume();
        note("onResume");
        pollHookFile();
    }

    @Override
    protected void onPause() {
        super.onPause();
        note("onPause");
    }

    /**
     * Hook file fallback: Android 14+ drops intent extras when the activity is already on top,
     * so automated tests write files/testhook instead. Poll it from the render loop of a real
     * app; here onResume is enough for a demo.
     */
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
        f.delete();                                      // one-shot
    }

    /** BACK must be handled in the Activity: a SurfaceView is not focusable by default. */
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
