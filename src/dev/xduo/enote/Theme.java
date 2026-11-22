package dev.xduo.enote;

import android.app.Activity;
import android.content.res.Configuration;
import android.os.Build;
import android.view.View;
import android.view.Window;

/**
 * Keeps the system bars in sync with the WebView theme. The UI owns the palette (CSS
 * variables in go/ui/css/tokens.css); Java only paints the status/navigation bars to match, so the
 * status bar never shows a strip of the wrong colour when the theme changes.
 */
public class Theme {
    public static final int BG_LIGHT = 0xFFF5F7FB, BG_DARK = 0xFF0B0F14;
    static volatile String mode = "light";

    /** Resolves light | dark | auto against the system night mode. */
    public static boolean isNight(String mode) {
        if ("dark".equals(mode)) return true;
        if (!"auto".equals(mode)) return false;
        Activity a = Bridge.current.get();
        if (a == null) return false;
        int m = a.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return m == Configuration.UI_MODE_NIGHT_YES;
    }

    public static String resolve() {
        return isNight(mode) ? "dark" : "light";
    }

    /** Reads the saved theme straight out of settings.json so the very first frame is right. */
    public static String loadMode(android.content.Context c) {
        try {
            java.io.File f = new java.io.File(c.getFilesDir(), "enote/settings.json");
            byte[] b = new byte[(int) f.length()];
            java.io.InputStream in = new java.io.FileInputStream(f);
            try {
                int n = 0;
                while (n < b.length) {
                    int k = in.read(b, n, b.length - n);
                    if (k <= 0) break;
                    n += k;
                }
            } finally {
                in.close();
            }
            String m = new org.json.JSONObject(new String(b, "UTF-8")).optString("theme", "light");
            return ("dark".equals(m) || "auto".equals(m)) ? m : "light";
        } catch (Throwable t) {
            return "light";
        }
    }

    /** Called from onCreate/onResume and from JS via Android.setTheme(mode). */
    @SuppressWarnings("deprecation")
    public static void apply(Activity a, String m) {
        if (a == null) return;
        if (m != null && m.length() > 0) mode = m;
        boolean night = isNight(mode);
        Window w = a.getWindow();
        w.setStatusBarColor(night ? BG_DARK : BG_LIGHT);
        w.setNavigationBarColor(night ? BG_DARK : 0xFFFFFFFF);
        int vis = w.getDecorView().getSystemUiVisibility();
        vis &= ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (!night) {
            // Dark icons need a light background behind them, which the status bar now has.
            vis |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 27) vis |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        w.getDecorView().setSystemUiVisibility(vis);
    }
}
