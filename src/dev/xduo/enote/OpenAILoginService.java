package dev.xduo.enote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/** Keeps the loopback OAuth callback reachable while the user is in the system browser. */
public final class OpenAILoginService extends Service {
    private static final String CHANNEL = "chatgpt_sign_in";
    private static final int NOTIFICATION_ID = 71;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable checkPending = new Runnable() {
        @Override public void run() {
            if (Bridge.loaded && Bridge.nativeOpenAILoginPending()) {
                handler.postDelayed(this, 1000);
            } else {
                stopSelf();
            }
        }
    };

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, "ChatGPT 登录", NotificationManager.IMPORTANCE_LOW));
        Intent openApp = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(this, 0, openApp, PendingIntent.FLAG_IMMUTABLE);
        startForeground(NOTIFICATION_ID, new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("等待 ChatGPT 授权")
                .setContentText("请在浏览器完成登录，再返回懒得记。")
                .setContentIntent(open)
                .setOngoing(true)
                .build());
        handler.removeCallbacks(checkPending);
        handler.post(checkPending);
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        handler.removeCallbacks(checkPending);
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
