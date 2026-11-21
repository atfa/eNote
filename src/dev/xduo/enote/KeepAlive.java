package dev.xduo.enote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

/**
 * P6.5: optional 常驻后台 - a plain foreground service, the only standard way an app can
 * ask not to be frozen while it is in the background.
 *
 * Why it exists: exact alarms are correct in code, but many OEM builds freeze a background
 * process and silently drop its AlarmManager entries (they never fire, and `dumpsys alarm`
 * shows nothing left). A foreground service with an ongoing low-importance notification is
 * the AOSP-sanctioned signal "this process is doing something for the user"; it also gives
 * us a live process to re-assert the alarm set every few minutes, so alarms removed by a
 * freeze come back on their own.
 *
 * It is off by default: it costs a permanent notification and some battery, and the user
 * should choose that. Nothing here is OEM-specific - whether the vendor actually honours
 * the foreground service is up to them, which is why the settings page also offers the
 * standard battery-optimisation exemption.
 */
public final class KeepAlive extends Service {
    static final String TAG = "enote";
    static final String CHANNEL = "keepalive";
    static final String CHANNEL_CLIP = "clipboard";
    /** Deliberately a fixed id so repeated startForeground calls reuse one notification. */
    static final int NOTIFY_ID = 0x4b41;
    static final int CLIP_NOTIFY_ID = 0x4b42;
    /** Tapping the clipboard notification opens the app on the 暂存 page. */
    public static final String EXTRA_OPEN_CLIP = "openClip";
    static final String ACTION_ON = "dev.xduo.enote.KEEPALIVE_ON";
    /** How often we re-assert the alarm set. Cheap: one JSON read + a diff. */
    static final long RESYNC_MS = 10 * 60 * 1000L;
    private static final String PREFS = "keepalive";
    private static final String KEY_ON = "on";
    private static final String KEY_CLIP_CHANGED = "clipChangedAt";
    private static final String KEY_CLIP_CAPTURED = "clipCapturedAt";

    // ---------------------------------------------------------------- clipboard hint
    //
    // A clipboard *listener* is allowed in the background (only the read is restricted), so the
    // service records "the clipboard changed at T". When the user comes back and the focused
    // read is refused, the UI can say "剪贴板刚有更新 · 点这里收进来" instead of failing silently.

    static void markClipChanged(Context c) {
        prefs(c).edit().putLong(KEY_CLIP_CHANGED, System.currentTimeMillis()).apply();
        Log.i(TAG, "clipboard changed (watched by keepalive)");
        // 后台看到变化：发一条通知让用户知道，而不是等他下拉界面去找（标准 API，
        // 部分厂商 ROM 只在后台投递监听，这里发不出去也不算失败）。
        if (!MainActivity.foreground) notifyClip(c, -1);
    }

    static void markClipCaptured(Context c) {
        prefs(c).edit().putLong(KEY_CLIP_CAPTURED, System.currentTimeMillis()).apply();
    }

    /** True when the clipboard changed after our last successful capture. */
    static boolean clipHint(Context c) {
        SharedPreferences p = prefs(c);
        return p.getLong(KEY_CLIP_CHANGED, 0) > p.getLong(KEY_CLIP_CAPTURED, 0);
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private Handler handler;

    // ------------------------------------------------------------------ preference

    static boolean enabled(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ON, false);
    }

    static void setEnabled(Context c, boolean on) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putBoolean(KEY_ON, on).apply();
        if (on) start(c); else stop(c);
        Log.i(TAG, "keepalive enabled=" + on);
    }

    /** Safe from any thread: startForegroundService is fine while we are visible. */
    static void start(Context c) {
        try {
            Intent i = new Intent(c, KeepAlive.class).setAction(ACTION_ON);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i);
            else c.startService(i);
        } catch (Throwable t) {
            // e.g. ForegroundServiceStartNotAllowedException on 12+ from the background:
            // the next time the app is opened EnoteApp/MainActivity retries.
            Log.w(TAG, "keepalive start: " + t);
        }
    }

    static void stop(Context c) {
        try {
            c.stopService(new Intent(c, KeepAlive.class));
        } catch (Throwable t) {
            Log.w(TAG, "keepalive stop: " + t);
        }
    }

    /** Restarts the service after a process death if the user left the switch on. */
    static void resumeIfEnabled(Context c) {
        if (enabled(c)) start(c);
    }

    // ------------------------------------------------------------------ battery (standard APIs)

    /** True when the system is already told not to optimise us. */
    static boolean ignoringBattery(Context c) {
        try {
            PowerManager pm = c.getSystemService(PowerManager.class);
            return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * Opens the standard battery-optimisation exemption dialog, with fallbacks that exist on
     * every AOSP-derived system. Some OEMs rename or re-scope these pages, but the intents
     * are the documented contract - we do not try to guess vendor-specific screens.
     */
    static void askIgnoreBattery(Context c) {
        String pkg = c.getPackageName();
        Intent[] tries;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            tries = new Intent[]{
                    new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                            Uri.parse("package:" + pkg)),
                    new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
                    new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + pkg)),
            };
        } else {
            tries = new Intent[]{new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + pkg))};
        }
        for (Intent i : tries) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                c.startActivity(i);
                Log.i(TAG, "battery settings via " + i.getAction());
                return;
            } catch (Throwable t) {
                Log.w(TAG, "battery settings " + i.getAction() + ": " + t);
            }
        }
    }

    // ------------------------------------------------------------------ service

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        ensureChannel(this);
        ensureClipChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 开关是唯一的真相：粘性重启（intent==null）和「关掉之后才到的 start 请求」都不该拉起服务，
        // 否则用户关了开关后服务会被 START_STICKY 复活，dumpsys 里永远停不掉。
        if (!enabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIFY_ID, build(this));
        watchClipboard();
        if (handler != null) {
            handler.removeCallbacks(resync);
            handler.post(resync);
        }
        // START_STICKY: if the OS kills us it restarts the service, and resync puts the
        // alarms back. (A user force-stop is respected and nothing restarts.)
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (handler != null) handler.removeCallbacksAndMessages(null);
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null && clipWatcher != null) cm.removePrimaryClipChangedListener(clipWatcher);
        } catch (Throwable ignored) {}
        clipWatcher = null;
        super.onDestroy();
    }

    ClipboardManager.OnPrimaryClipChangedListener clipWatcher;

    private void watchClipboard() {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null || clipWatcher != null) return;
            clipWatcher = new ClipboardManager.OnPrimaryClipChangedListener() {
                @Override public void onPrimaryClipChanged() { markClipChanged(KeepAlive.this); }
            };
            cm.addPrimaryClipChangedListener(clipWatcher);
            Log.i(TAG, "keepalive: clipboard watcher registered");
        } catch (Throwable t) {
            Log.w(TAG, "keepalive clipboard watcher: " + t);
        }
    }

    /** Re-asserts the alarm set from the store; the page is not involved. */
    private final Runnable resync = new Runnable() {
        public void run() {
            try {
                Bridge.init(getApplicationContext());
                int n = Reminders.sync(KeepAlive.this, Bridge.remindersFromStore());
                Log.i(TAG, "keepalive resync: pending=" + n);
            } catch (Throwable t) {
                Log.w(TAG, "keepalive resync: " + t);
            }
            if (handler != null) handler.postDelayed(this, RESYNC_MS);
        }
    };

    // ------------------------------------------------------------------ notification

    /** IMPORTANCE_MIN: an ongoing line, no sound, no heads-up. */
    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL, "常驻后台", NotificationManager.IMPORTANCE_MIN);
        ch.setDescription("保持「懒得记」不被系统冻结，到期提醒才靠谱");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        nm.createNotificationChannel(ch);
    }

    static Notification build(Context c) {
        Intent open = new Intent(c, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0x4b41, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int clips = Bridge.clipCount();
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.ic_menu_recent_history)
                .setContentTitle("懒得记正在守护到期提醒")
                .setContentText(clips > 0
                        ? "剪贴板暂存 " + clips + " 条 · 点按整理"
                        : "常驻后台已开启 · 点按打开；不需要可在设置里关闭")
                .setOngoing(true)
                .setShowWhen(false)
                .setPriority(Notification.PRIORITY_MIN)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setContentIntent(pi);
        return b.build();
    }

    /** 常驻通知兼作状态条：条数变了就刷新一下（只在服务确实在跑时）。 */
    static void updateNotification(Context c) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm == null || !enabled(c)) return;
            android.service.notification.StatusBarNotification[] active = nm.getActiveNotifications();
            if (active == null) return;
            for (android.service.notification.StatusBarNotification n : active) {
                if (n.getId() == NOTIFY_ID) { nm.notify(NOTIFY_ID, build(c)); return; }
            }
        } catch (Throwable t) {
            Log.w(TAG, "keepalive notify: " + t);
        }
    }

    /**
     * 剪贴板有新东西：主动发一条可点的通知，而不是等用户自己下拉界面去找。
     * count < 0 表示只知道「变了」还不知道条数（后台监听只能知道变化，读不到内容）。
     */
    static void notifyClip(Context c, int count) {
        try {
            ensureClipChannel(c);
            Intent open = new Intent(c, MainActivity.class)
                    .setAction(Intent.ACTION_VIEW)
                    .putExtra(EXTRA_OPEN_CLIP, "1")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, 0x4b42, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(c, CHANNEL_CLIP) : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_menu_agenda)
                    .setContentTitle(count > 0 ? "剪贴板已暂存 " + count + " 条" : "剪贴板刚复制了内容")
                    .setContentText(count > 0 ? "点按整理（勾选后一键解析 / 原样存为笔记）"
                            : "点一下收进暂存（系统不让后台读，前台才能读）")
                    .setStyle(new Notification.BigTextStyle().bigText(
                            count > 0 ? "已暂存 " + count + " 条，点按勾选后一键解析成笔记 + 待办"
                                    : "在后台看到剪贴板变了，但系统不让后台读内容，点一下收进来"))
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(CLIP_NOTIFY_ID, b.build());
            Log.i(TAG, "clip notify: " + count);
        } catch (Throwable t) {
            Log.w(TAG, "clip notify: " + t);
        }
    }

    /** IMPORTANCE_DEFAULT：普通横幅，不震动不 heads-up 骚扰。 */
    static void ensureClipChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_CLIP) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_CLIP, "剪贴板暂存", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("复制了内容时提醒收进暂存");
        nm.createNotificationChannel(ch);
    }
}
