package dev.xduo.enote;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * R13-E / P6.5: our own due reminders, built only on standard Android APIs so the
 * behaviour is identical on every OEM.
 *
 * AlarmManager.setExactAndAllowWhileIdle fires an AlarmReceiver at the due minute;
 * the receiver posts a notification on the "reminder" channel. Exact alarms need
 * SCHEDULE_EXACT_ALARM on API 31+; when the user has not granted it we degrade to
 * setAndAllowWhileIdle (may be delayed, never dropped).
 *
 * State lives in Go (notes.json), not here: the page pushes the full list of pending
 * reminders after every render via Bridge.syncReminders, and we rebuild the alarm set
 * from it. Idempotent, no drift, nothing to migrate.
 */
public final class Reminders {
    static final String TAG = "enote";
    static final String CHANNEL = "reminder";
    static final String ACTION_FIRE = "dev.xduo.enote.REMIND";
    static final String EXTRA_ID = "reminderId";
    static final String EXTRA_TEXT = "reminderText";
    /** Note title, shown as the notification's second line. */
    static final String EXTRA_NOTE = "reminderNote";
    /** Real ids, so tapping the notification opens that note *and* that todo. */
    static final String EXTRA_NOTE_ID = "reminderNoteId";
    static final String EXTRA_TODO_ID = "reminderTodoId";
    static final String EXTRA_DUE = "reminderDueMs";
    static final String EXTRA_KIND = "reminderKind";   // lead | due
    /** 提前量：到期前 15 分钟弹通知。 */
    static final long LEAD_MS = 15 * 60 * 1000L;
    /**
     * Keys ("noteId|todoId@dueMs") we have an alarm for. Persisted, because the process
     * dies often and a fresh in-memory set would leave orphaned alarms in AlarmManager
     * forever (they fired late, for todos the user had already finished).
     */
    private static final String PREFS = "reminders";
    private static final String KEY_SET = "scheduled";
    /** 最后一次推送的提醒载荷：重启时 Go 还没加载也能按它重排。 */
    private static final String KEY_PAYLOAD = "payload";

    private static Set<String> load(Context c) {
        Set<String> out = new LinkedHashSet<>();
        String raw = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SET, "");
        if (raw != null) for (String k : raw.split("\n")) if (!k.isEmpty()) out.add(k);
        return out;
    }

    private static void save(Context c, Set<String> keys) {
        StringBuilder b = new StringBuilder();
        for (String k : keys) b.append(k).append('\n');
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_SET, b.toString()).apply();
    }

    private Reminders() {}

    /** Channel for due reminders; IMPORTANCE_HIGH so it shows as a heads-up. */
    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL, "待办提醒", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("待办到期前 15 分钟提醒你");
        ch.enableVibration(true);
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        nm.createNotificationChannel(ch);
    }

    /**
     * Replaces the whole alarm set with {@code json} (from Go: [{id,text,note,dueMs}]).
     * Returns how many alarms are pending.
     */
    /**
     * Bumped when the way we arm alarms changes: the persisted key set is only a cache of
     * "we already have a PendingIntent for this", so on an upgrade we cancel what the old
     * scheme left behind and let the new one arm everything again.
     */
    private static final int SCHEME = 2; // 2 = setAlarmClock
    private static final String KEY_SCHEME = "scheme";

    static int sync(Context c, String json) {
        ensureChannel(c);
        try {
            c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putString(KEY_PAYLOAD, json == null ? "[]" : json).apply();
        } catch (Throwable ignored) { }
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return 0;
        migrateScheme(c, am);
        List<JSONObject> want = parseWants(json);
        Set<String> scheduled = load(c);
        cancelGone(c, am, scheduled, want);
        boolean exact = canExact(am);
        for (JSONObject o : want) arm(c, am, o, exact, scheduled);
        save(c, scheduled);
        int n = scheduled.size();
        Log.i(TAG, "syncReminders: want=" + want.size() + " pending=" + n + " exact=" + exact);
        return want.size();
    }

    /** 闹钟登记方式换版：旧方式排的键要清掉，否则升级后同一条提醒会响两遍。 */
    private static void migrateScheme(Context c, AlarmManager am) {
        SharedPreferences sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (sp.getInt(KEY_SCHEME, 0) != SCHEME) {
                // drop alarms armed by the previous scheme so they cannot fire as duplicates
                for (String old : load(c)) {
                    try { am.cancel(pending(c, old, null, null, null, null, 0L, null)); } catch (Throwable ignored) {}
                }
                save(c, new LinkedHashSet<String>());
                sp.edit().putInt(KEY_SCHEME, SCHEME).apply();
                Log.i(TAG, "reminder scheme -> " + SCHEME);
            }
    }

    /** 只保留还没到点的提醒（过期的排上去会立刻响）。 */
    private static List<JSONObject> parseWants(String json) {
                List<JSONObject> want = new ArrayList<>();
                try {
                    JSONArray a = new JSONArray(json == null || json.isEmpty() ? "[]" : json);
                    for (int i = 0; i < a.length(); i++) {
                        JSONObject o = a.optJSONObject(i);
                        if (o == null) continue;
                        String id = o.optString("id");
                        long due = o.optLong("dueMs");
                        // Only future alarms are useful; overdue ones would fire immediately.
                        if (id.isEmpty() || due <= System.currentTimeMillis() + 5000) continue;
                        want.add(o);
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "syncReminders parse: " + t);
                }
        return want;
    }

    /** 完成 / 删除 / 改了时间 → 由 want 重新覆盖，旧的取消。 */
    private static void cancelGone(Context c, AlarmManager am, Set<String> scheduled,
                                    List<JSONObject> want) {
                // Cancel what disappeared (完成/删除/改了时间 → 由 want 重新覆盖)。
                // key 里带上 dueMs，时间一改就是新 key，旧的自动取消。
                Set<String> wantKeys = new LinkedHashSet<>();
                for (JSONObject o : want) {
                    wantKeys.add(keyOf(o, "lead"));
                    wantKeys.add(keyOf(o, "due"));
                }
                for (String key : new ArrayList<>(scheduled)) {
                    if (wantKeys.contains(key)) continue;
                    am.cancel(pending(c, key, null, null, null, null, 0L, null));
                    scheduled.remove(key);
                }
    }

    /** 排一条闹钟；setAlarmClock 被厂商策略拒了就退回 setAndAllowWhileIdle。 */
    private static void arm(Context c, AlarmManager am, JSONObject o, boolean exact,
                            Set<String> scheduled) {
                String[] ids = resolveIds(o);
                long due = o.optLong("dueMs");
                long now = System.currentTimeMillis();
                // 两条：提前 15 分钟一次，到点再一次。
                armOne(c, am, o, ids, due - LEAD_MS, "lead", exact, scheduled, now);
                armOne(c, am, o, ids, due, "due", exact, scheduled, now);
    }

    private static void armOne(Context c, AlarmManager am, JSONObject o, String[] ids,
                               long when, String kind, boolean exact,
                               Set<String> scheduled, long now) {
                String key = keyOf(o, kind);
                if (scheduled.contains(key)) return;
                long trigger = Math.max(now + 5000L, when);
                PendingIntent pi = pending(c, key, o.optString("text"), o.optString("note"),
                        ids[0], ids[1], o.optLong("dueMs"), kind);
                scheduleAlarm(c, am, pi, trigger, exact, scheduled,
                        key, ids[0], ids[1]);
    }

    /** 从载荷里取 noteId/todoId；老载荷是 "<noteId>|<todoId>" 一个字段的要拆开。 */
    private static String[] resolveIds(JSONObject o) {
                String noteId = o.optString("noteId");
                String todoId = o.optString("todoId");
                if (noteId.isEmpty() || todoId.isEmpty()) {
                    // older payload: "<noteId>|<todoId>"
                    String id = o.optString("id");
                    int bar = id.indexOf('|');
                    if (bar > 0) {
                        noteId = id.substring(0, bar);
                        todoId = id.substring(bar + 1);
                    }
                }
                return new String[]{noteId, todoId};
    }

    /** 排进去（setAlarmClock 优先）；厂商拒了退回 setAndAllowWhileIdle；排成记进 scheduled。 */
    private static void scheduleAlarm(Context c, AlarmManager am, PendingIntent pi, long trigger,
                                      boolean exact, Set<String> scheduled,
                                      String key, String noteId, String todoId) {
                try {
                    // setAlarmClock 是“必须响”的登记方式（系统时钟 app 自己的闹钟就是这么排的）：
                    // Doze / 应用待机 / 厂商冻结都不会静默丢弃它，到点还会唤醒进程。
                    // setExactAndAllowWhileIdle 在厂商冻结策略下会被无声吞掉（实测）。
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        am.setAlarmClock(new AlarmManager.AlarmClockInfo(trigger, showIntent(c, noteId, todoId)), pi);
                    } else if (exact) {
                        am.setExact(AlarmManager.RTC_WAKEUP, trigger, pi);
                    } else {
                        am.set(AlarmManager.RTC_WAKEUP, trigger, pi);
                    }
                    scheduled.add(key);
                } catch (SecurityException se) {
                    Log.w(TAG, "setAlarmClock denied, retry idle-safe: " + se);
                    try {
                        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi);
                        scheduled.add(key);
                    } catch (Throwable t2) {
                        Log.w(TAG, "alarm not scheduled: " + t2);
                    }
                }
    }

    private static String keyOf(JSONObject o, String kind) {
        return o.optString("id") + "@" + o.optLong("dueMs") + "#" + kind;
    }

    /** What opens when the user taps the alarm icon the system shows for setAlarmClock. */
    private static PendingIntent showIntent(Context c, String noteId, String todoId) {
        Intent i = new Intent(c, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .putExtra("openNote", noteId == null ? "" : noteId)
                .putExtra("openTodoId", todoId == null ? "" : todoId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, (noteId + "|" + todoId).hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent pending(Context c, String key, String text, String note,
                                         String noteId, String todoId, long due, String kind) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE)
                .putExtra(EXTRA_ID, key)
                .putExtra(EXTRA_TEXT, text == null ? "" : text)
                .putExtra(EXTRA_NOTE, note == null ? "" : note)
                .putExtra(EXTRA_NOTE_ID, noteId == null ? "" : noteId)
                .putExtra(EXTRA_TODO_ID, todoId == null ? "" : todoId)
                .putExtra(EXTRA_DUE, due)
                .putExtra(EXTRA_KIND, kind);
        // Stable per-key request code: cancel() needs the same PendingIntent back.
        return PendingIntent.getBroadcast(c, key.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** True when we may use setExactAndAllowWhileIdle (all systems before 31 always can). */
    /** 清掉所有旧 alarm（重启/改时间后系统里的登记已不可信）。 */
    static void reset(Context c) {
        Set<String> keys = load(c);
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am != null) {
            for (String key : keys) {
                try { am.cancel(pending(c, key, null, null, null, null, 0L, null)); } catch (Throwable ignored) { }
            }
        }
        save(c, new LinkedHashSet<String>());
    }

    /** 重建：优先用 Go store（权威），没有就回退到最后一轮页面推的 payload。 */
    static void resync(Context c) {
        String json = null;
        try { json = Bridge.remindersFromStore(); } catch (Throwable ignored) { }
        if (json == null || json.isEmpty() || "[]".equals(json)) {
            json = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString(KEY_PAYLOAD, "[]");
        }
        sync(c, json);
    }

    /** 开机 / 应用升级 / 改时间 / 改时区：系统里的闹钟会丢或落在旧绝对时刻。 */
    public static class BootReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            if (intent == null) return;
            String a = intent.getAction();
            if (!Intent.ACTION_BOOT_COMPLETED.equals(a)
                    && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
                    && !Intent.ACTION_TIME_CHANGED.equals(a)
                    && !Intent.ACTION_TIMEZONE_CHANGED.equals(a)) return;
            Log.i(TAG, "reminder resync: " + a);
            ensureChannel(c);
            reset(c);
            resync(c);
        }
    }

    static boolean exactGranted(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return am != null && canExact(am);
    }

    /** Settings button: post one notification now (delayMs=0) or after a delay. */
    static String testNotification(Context c) { return testNotification(c, 0); }

    static String testNotification(Context c, long delayMs) {
        ensureChannel(c);
        if (delayMs > 0) {
            final Context app = c.getApplicationContext();
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
                public void run() { postTest(app); }
            }, delayMs);
            return "{\"posted\":true,\"delayed\":" + delayMs + "}";
        }
        return postTest(c);
    }

    private static String postTest(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return "{\"posted\":false,\"error\":\"no manager\"}";
        boolean enabled = Build.VERSION.SDK_INT < 24 || nm.areNotificationsEnabled();
        int imp = -1;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = nm.getNotificationChannel(CHANNEL);
            if (ch != null) imp = ch.getImportance();
        }
        Intent open = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0x7E57, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle("测试通知")
                .setContentText("能看到这条，说明本地通知是通的")
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setDefaults(Notification.DEFAULT_ALL);
        try {
            nm.notify(0x7E57, b.build());
        } catch (Throwable t) {
            return "{\"posted\":false,\"error\":\"" + t.getClass().getSimpleName() + "\"}";
        }
        return "{\"posted\":true,\"enabled\":" + enabled + ",\"importance\":" + imp + "}";
    }

    /** Open the system page for this app's notifications (banner / importance toggles). */
    static void openNotificationSettings(Context c) {
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, c.getPackageName())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Throwable t) { Log.w(TAG, "openNotificationSettings: " + t); }
    }

    /** Sends the user to the system page where exact alarms are allowed (API 31+). */
    static void askExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    android.net.Uri.parse("package:" + c.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Throwable t) {
            Log.w(TAG, "askExact: " + t);
        }
    }

    /** API 31+ lets the user revoke exact alarms; older versions always allow them. */
    private static boolean canExact(AlarmManager am) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return am.canScheduleExactAlarms();
    }

    /** Fires at the due minute: one notification per todo, tapping opens that note. */
    public static class AlarmReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            if (intent == null || !ACTION_FIRE.equals(intent.getAction())) return;
            String text = intent.getStringExtra(EXTRA_TEXT);
            String note = intent.getStringExtra(EXTRA_NOTE);
            String noteId = intent.getStringExtra(EXTRA_NOTE_ID);
            String todoId = intent.getStringExtra(EXTRA_TODO_ID);
            String key = intent.getStringExtra(EXTRA_ID);
            long due = intent.getLongExtra(EXTRA_DUE, 0L);
            String kind = intent.getStringExtra(EXTRA_KIND);
            // 每条 todo 有 lead/due 两个 key，各自响一次；响过的 key 留在 scheduled 里，
            // 下一次 sync 不会重复排。
            if (text == null || text.isEmpty()) return;
            fireNotification(c, text, note, noteId, todoId, due, kind, key);
        }

        /** 建通知并弹出来：点通知打开对应笔记（待办高亮）。 */
        private static void fireNotification(Context c, String text, String note,
                                             String noteId, String todoId, long due,
                                             String kind, String key) {
            ensureChannel(c);
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm == null) return;
            Intent open = new Intent(c, MainActivity.class)
                    .setAction(Intent.ACTION_VIEW)
                    .putExtra("openNote", noteId == null ? "" : noteId)
                    .putExtra("openTodoId", todoId == null ? "" : todoId)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, text.hashCode(), open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
            long left = due > 0 ? due - System.currentTimeMillis() : 0;
            String title;
            if ("due".equals(kind)) {
                title = "已到期：" + text;
            } else if (due > 0 && left > 60000) {
                title = "还有 " + Math.max(1, Math.round(left / 60000.0)) + " 分钟：" + text;
            } else {
                title = "即将到期：" + text;
            }
            b.setSmallIcon(android.R.drawable.ic_popup_reminder)
                    .setContentTitle(title)
                    .setContentText(note == null || note.isEmpty() ? "点按查看" : note)
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .setCategory(Notification.CATEGORY_REMINDER)
                    .setDefaults(Notification.DEFAULT_ALL);
            nm.notify((key != null && !key.isEmpty() ? key : text).hashCode(), b.build());
            Log.i(TAG, "reminder fired: " + text);
        }
    }
}
