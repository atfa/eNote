package dev.xduo.enote;

import android.app.Application;
import android.content.Context;
import android.util.Log;

/**
 * Process entry: loads libenote.so, hands the files dir to Go (config, store, worker,
 * HTTP server) and warms up the offline OCR engine.
 *
 * The share receiver can start the process without any Activity, so everything the app
 * needs must be initialised here, not in an Activity.
 */
public class EnoteApp extends Application {
    public static final String TAG = "enote";
    static Context app;

    @Override
    public void onCreate() {
        super.onCreate();
        app = getApplicationContext();
        try {
            Bridge.init(app);
        } catch (Throwable t) {
            Log.e(TAG, "Bridge.init failed", t);
        }
        OcrHelper.get(app).initAsync();
        Reminders.ensureChannel(app);
    }
}
