package dev.xduo.enote;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
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
    static final String EXTRA_NOTE = "reminderNote";
    /**
     * Keys ("noteId|todoId@dueMs") we have an alarm for. Persisted, because the process
     * dies often and a fresh in-memory set would leave orphaned alarms in AlarmManager
     * forever (they fired late, for todos the user had already finished).
     */
    private static final String PREFS = "reminders";
    private static final String KEY_SET = "scheduled";

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
                CHANNEL, "待办到期提醒", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("待办到期时提醒你");
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
    static int sync(Context c, String json) {
        ensureChannel(c);
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return 0;
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
        Set<String> scheduled = load(c);
        // Cancel what disappeared (完成/删除/改了时间 → 由 want 重新覆盖)。
        // key 里带上 dueMs，时间一改就是新 key，旧的自动取消。
        Set<String> wantKeys = new LinkedHashSet<>();
        for (JSONObject o : want) wantKeys.add(keyOf(o));
        for (String key : new ArrayList<>(scheduled)) {
            if (wantKeys.contains(key)) continue;
            am.cancel(pending(c, key, null, null));
            scheduled.remove(key);
        }
        boolean exact = canExact(am);
        for (JSONObject o : want) {
            String key = keyOf(o);
            if (scheduled.contains(key)) continue;
            PendingIntent pi = pending(c, key, o.optString("text"), o.optString("note"));
            long due = o.optLong("dueMs");
            try {
                if (exact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, pi);
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, pi);
                } else {
                    am.set(AlarmManager.RTC_WAKEUP, due, pi);
                }
                scheduled.add(key);
            } catch (SecurityException se) {
                Log.w(TAG, "setExact denied, retry inexact: " + se);
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, pi);
                scheduled.add(key);
            }
        }
        save(c, scheduled);
        int n = scheduled.size();
        Log.i(TAG, "syncReminders: want=" + want.size() + " pending=" + n + " exact=" + exact);
        return n;
    }

    private static String keyOf(JSONObject o) {
        return o.optString("id") + "@" + o.optLong("dueMs");
    }

    private static PendingIntent pending(Context c, String key, String text, String note) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE)
                .putExtra(EXTRA_ID, key)
                .putExtra(EXTRA_TEXT, text == null ? "" : text)
                .putExtra(EXTRA_NOTE, note == null ? "" : note);
        // Stable per-key request code: cancel() needs the same PendingIntent back.
        return PendingIntent.getBroadcast(c, key.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** True when we may use setExactAndAllowWhileIdle (all systems before 31 always can). */
    static boolean exactGranted(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return am != null && canExact(am);
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
            String key = intent.getStringExtra(EXTRA_ID);
            // 响过就不再排：把它从持久化的集合里摘掉，否则集合只增不减
            if (key != null && !key.isEmpty()) {
                Set<String> left = load(c);
                if (left.remove(key)) save(c, left);
            }
            if (text == null || text.isEmpty()) return;
            ensureChannel(c);
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm == null) return;
            Intent open = new Intent(c, MainActivity.class)
                    .setAction(Intent.ACTION_VIEW)
                    .putExtra("openTodo", note == null ? "" : note)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(c, text.hashCode(), open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_popup_reminder)
                    .setContentTitle("待办到期：" + text)
                    .setContentText(note == null || note.isEmpty() ? "点按查看" : note)
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .setCategory(Notification.CATEGORY_REMINDER)
                    .setDefaults(Notification.DEFAULT_ALL);
            nm.notify(text.hashCode(), b.build());
            Log.i(TAG, "reminder fired: " + text);
        }
    }
}
