package dev.apkdbg;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.view.Display;

import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * A virtual display nobody can see on the physical panel, for headless APK debugging.
 *
 * Run through app_process as root (see scripts/vd.sh):
 *
 *   CLASSPATH=/data/local/tmp/vd.jar app_process /system/bin dev.apkdbg.Vd \
 *       <w> <h> <dpi> <cmdFile> <idFile>
 *
 * Protocol - the driver writes "<seq> <op> [args]" into cmdFile; seq must increase:
 *   shot <path>    write an upright PNG of the display to <path> (atomic)
 *   size           report the upright geometry and the mapping for touch coordinates
 *   rotate <deg>   extra rotation applied to shots (the driver derives it from the app)
 *   power <state>  Display power state (2 = on) so the display survives screen-off
 *   ping           liveness
 *   quit           release the display, delete idFile, exit
 *
 * stdout is the log; the launcher redirects it to a file.
 */
public class Vd {
    /**
     * Flag values move between Android versions (TRUSTED is 0x40 on 10-13, 0x400 on 16), so they
     * are read from the framework by name at runtime; the fallbacks are Android 16's.
     */
    static int F_PUBLIC, F_TRUSTED, F_OWN_CONTENT_ONLY, F_SUPPORTS_TOUCH, F_OWN_FOCUS,
               F_STEAL_TOP_FOCUS_DISABLED, F_SHOW_DECORATIONS, F_ALWAYS_UNLOCKED,
               F_OWN_DISPLAY_GROUP, F_ROTATES_WITH_CONTENT, F_DESTROY_ON_REMOVAL;

    static final Object LOCK = new Object();
    static volatile Image last;
    static VirtualDisplay vd;
    static ImageReader reader;
    static DisplayManager dm;
    static int displayId = -1;
    static File idFile;
    static long lastSeq = -1;
    static int baseW, baseH;
    static int userRot = 0;   // extra rotation (deg) applied to shots, set by the driver

    public static void main(String[] args) throws Exception {
        if (args.length < 5) {
            log("usage: Vd <w> <h> <dpi> <cmdFile> <idFile>");
            System.exit(2);
        }
        int w = Integer.parseInt(args[0]);
        int h = Integer.parseInt(args[1]);
        int dpi = Integer.parseInt(args[2]);
        baseW = w;
        baseH = h;
        File cmd = new File(args[3]);
        idFile = new File(args[4]);

        exempt();
        loadFlags();
        // app_process has no Looper; ActivityThread.systemMain() deadlocks without one.
        Looper.prepareMainLooper();
        Context ctx = systemContext();
        dm = (DisplayManager) ctx.getSystemService(Context.DISPLAY_SERVICE);

        reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
        HandlerThread ht = new HandlerThread("vd-capture");
        ht.start();
        reader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
            public void onImageAvailable(ImageReader r) {
                Image img = r.acquireLatestImage();
                if (img == null) return;
                synchronized (LOCK) {
                    if (last != null) last.close();
                    last = img;
                }
            }
        }, new Handler(ht.getLooper()));

        int flags = F_PUBLIC | F_TRUSTED | F_OWN_CONTENT_ONLY | F_SUPPORTS_TOUCH
                | F_OWN_FOCUS | F_STEAL_TOP_FOCUS_DISABLED | F_SHOW_DECORATIONS
                | F_ALWAYS_UNLOCKED | F_OWN_DISPLAY_GROUP | F_ROTATES_WITH_CONTENT
                // Without this the system *moves* the app onto the user's panel when the
                // display is released - the app pops up in front of them at teardown.
                | F_DESTROY_ON_REMOVAL;
        vd = dm.createVirtualDisplay("apkdbg", w, h, dpi, reader.getSurface(), flags);
        if (vd == null) { log("ERROR createVirtualDisplay returned null"); System.exit(2); }
        displayId = vd.getDisplay().getDisplayId();
        log("DISPLAY_ID=" + displayId + " " + w + "x" + h + "@" + dpi
                + " flags=0x" + Integer.toHexString(flags));
        write(idFile, String.valueOf(displayId));
        // A display in its own group starts OFF, and an OFF display renders nothing.
        power(2 /* Display.STATE_ON */);

        Runtime.getRuntime().addShutdownHook(new Thread() {
            public void run() { close(); }
        });

        long lastM = -1;
        while (true) {
            String line = null;
            if (cmd.lastModified() != lastM) {
                lastM = cmd.lastModified();
                line = read(cmd);
            }
            if (line != null) {
                line = line.trim();
                int sp = line.indexOf(' ');
                if (sp > 0) {
                    try {
                        long seq = Long.parseLong(line.substring(0, sp));
                        if (seq > lastSeq) {
                            lastSeq = seq;
                            handle(line.substring(sp + 1).trim());
                        }
                    } catch (Exception e) { log("ERR bad cmd: " + line); }
                }
            }
            Thread.sleep(80);
        }
    }

    static void loadFlags() {
        F_PUBLIC = flag("VIRTUAL_DISPLAY_FLAG_PUBLIC", 0x1);
        F_TRUSTED = flag("VIRTUAL_DISPLAY_FLAG_TRUSTED", 0x400);
        F_OWN_CONTENT_ONLY = flag("VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY", 0x8);
        F_SUPPORTS_TOUCH = flag("VIRTUAL_DISPLAY_FLAG_SUPPORTS_TOUCH", 0x40);
        F_OWN_FOCUS = flag("VIRTUAL_DISPLAY_FLAG_OWN_FOCUS", 0x4000);
        F_STEAL_TOP_FOCUS_DISABLED = flag("VIRTUAL_DISPLAY_FLAG_STEAL_TOP_FOCUS_DISABLED", 0x10000);
        F_SHOW_DECORATIONS = flag("VIRTUAL_DISPLAY_FLAG_SHOULD_SHOW_SYSTEM_DECORATIONS", 0x200);
        F_ALWAYS_UNLOCKED = flag("VIRTUAL_DISPLAY_FLAG_ALWAYS_UNLOCKED", 0x1000);
        F_OWN_DISPLAY_GROUP = flag("VIRTUAL_DISPLAY_FLAG_OWN_DISPLAY_GROUP", 0x800);
        F_ROTATES_WITH_CONTENT = flag("VIRTUAL_DISPLAY_FLAG_ROTATES_WITH_CONTENT", 0x80);
        F_DESTROY_ON_REMOVAL = flag("VIRTUAL_DISPLAY_FLAG_DESTROY_CONTENT_ON_REMOVAL", 0x100);
    }

    static int flag(String name, int fallback) {
        try {
            return Class.forName("android.hardware.display.DisplayManager")
                        .getField(name).getInt(null);
        } catch (Throwable e) {
            log("info: " + name + " not found, using 0x" + Integer.toHexString(fallback));
            return fallback;
        }
    }

    static void handle(String line) {
        String[] parts = line.split(" ");
        String op = parts[0];
        try {
            if (op.equals("shot")) {
                shot(new File(parts[1]));
            } else if (op.equals("size")) {
                int[] g = geometry();
                log("OK size " + g[0] + "x" + g[1] + " buffer " + g[2] + "x" + g[3]
                        + " rot=" + g[4]);
            } else if (op.equals("rotate")) {
                userRot = Integer.parseInt(parts[1]);
                log("OK rotate " + userRot);
            } else if (op.equals("power")) {
                power(Integer.parseInt(parts[1]));
            } else if (op.equals("ping")) {
                log("OK pong " + displayId);
            } else if (op.equals("quit")) {
                log("OK bye");
                close();
                System.exit(0);
            } else {
                log("ERR unknown op: " + op);
            }
        } catch (Throwable e) {
            log("ERR " + op + ": " + e);
        }
    }

    static void shot(File out) throws Exception {
        int[] px = null;
        int cw = 0, ch = 0;
        for (int i = 0; i < 80 && px == null; i++) {
            synchronized (LOCK) {
                if (last != null) {
                    try {
                        px = toPixels(last);
                        cw = last.getWidth();
                        ch = last.getHeight();
                    } catch (Throwable e) { px = null; }
                }
            }
            if (px == null) Thread.sleep(50);
        }
        if (px == null) { log("ERR no frame (is the display showing anything?)"); return; }

        Bitmap bmp = Bitmap.createBitmap(px, cw, ch, Bitmap.Config.ARGB_8888);
        Bitmap up = upright(bmp);
        File tmp = new File(out.getParentFile(), out.getName() + ".tmp");
        FileOutputStream fos = new FileOutputStream(tmp);
        boolean ok = up.compress(Bitmap.CompressFormat.PNG, 100, fos);
        fos.close();
        if (up != bmp) bmp.recycle();
        int uw = up.getWidth(), uh = up.getHeight();
        up.recycle();
        if (!ok) { tmp.delete(); log("ERR png encode failed"); return; }
        if (out.exists()) out.delete();
        if (!tmp.renameTo(out)) { log("ERR rename to " + out); return; }
        out.setReadable(true, false);
        log("OK shot " + out + " " + uw + "x" + uh);
    }

    /**
     * SurfaceFlinger renders into the display's *base* (natural) size; a landscape app on a
     * portrait display is drawn rotated inside it. Display.getRealSize() reports the logical size
     * the app sees - which is also the coordinate space `input -d <display>` uses - so rotate the
     * buffer to match it and the PNG and the touch coordinates agree.
     */
    static Bitmap upright(Bitmap src) {
        float deg = shotRotation(src.getWidth(), src.getHeight());
        if (deg == 0) return src;
        Matrix m = new Matrix();
        m.postRotate(deg);
        return Bitmap.createBitmap(src, 0, 0, src.getWidth(), src.getHeight(), m, false);
    }

    /** Total rotation applied to a shot of a buffer of the given size. */
    static float shotRotation(int bufW, int bufH) {
        Display d = dm.getDisplay(displayId);
        android.graphics.Point sz = new android.graphics.Point();
        if (d != null) d.getRealSize(sz);
        float deg = userRot;
        if (sz.x > sz.y && bufW < bufH) deg += -90;
        else if (sz.x < sz.y && bufW > bufH) deg += 90;
        return deg;
    }

    /** upright W, upright H, buffer W, buffer H, effective rotation (deg). */
    static int[] geometry() {
        int deg = (int) shotRotation(baseW, baseH);
        int uw = baseW, uh = baseH;
        if (deg % 180 != 0) { uw = baseH; uh = baseW; }
        return new int[] { uw, uh, baseW, baseH, deg };
    }

    /** Needs DEVICE_POWER (root). The API name moved around between Android versions. */
    static void power(int state) {
        String[] dmMethods = { "setOverrideDisplayState", "setForceDisplayStateOn" };
        for (String name : dmMethods) {
            try {
                Method m = find(dm.getClass(), name, 2);
                if (name.equals("setForceDisplayStateOn")) {
                    m.invoke(dm, displayId, state == 2, "apkdbg");
                } else {
                    m.invoke(dm, displayId, state);
                }
                log("OK power " + state + " via DisplayManager." + name);
                return;
            } catch (Throwable e) { log("info: " + name + ": " + cause(e)); }
        }
        try {
            Class<?> c = Class.forName("android.hardware.display.DisplayManagerGlobal");
            Object dmg = c.getMethod("getInstance").invoke(null);
            find(c, "requestDisplayPower", 2).invoke(dmg, displayId, state);
            log("OK power " + state + " via DisplayManagerGlobal.requestDisplayPower");
        } catch (Throwable e) {
            log("WARN power(" + state + ") failed: " + cause(e)
                + " - the display only renders while the screen is on");
        }
    }

    static Method find(Class<?> c, String name, int nParams) throws Exception {
        for (Method m : c.getMethods()) {
            if (m.getName().equals(name) && m.getParameterTypes().length == nParams) return m;
        }
        throw new NoSuchMethodException(name + "/" + nParams + " on " + c.getName());
    }

    static String cause(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null) t = t.getCause();
        return t.toString();
    }

    static int[] toPixels(Image img) {
        int w = img.getWidth(), h = img.getHeight();
        Image.Plane p = img.getPlanes()[0];
        ByteBuffer bb = p.getBuffer().order(ByteOrder.LITTLE_ENDIAN);
        int rowStride = p.getRowStride(), pixStride = p.getPixelStride();
        int[] px = new int[w * h];
        for (int y = 0; y < h; y++) {
            int off = y * rowStride;
            for (int x = 0; x < w; x++) {
                int o = off + x * pixStride;
                int r = bb.get(o) & 0xff, g = bb.get(o + 1) & 0xff, b = bb.get(o + 2) & 0xff;
                int a = bb.get(o + 3) & 0xff;
                px[y * w + x] = (a << 24) | (r << 16) | (g << 8) | b;
            }
        }
        return px;
    }

    static void close() {
        try { if (vd != null) vd.release(); } catch (Throwable e) { /* ignore */ }
        try { if (reader != null) reader.close(); } catch (Throwable e) { /* ignore */ }
        if (idFile != null) idFile.delete();
        sleep(400);   // let the binder call reach display manager before the process dies
    }

    static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { }
    }

    static void exempt() throws Exception {
        Class<?> vmrt = Class.forName("dalvik.system.VMRuntime");
        Object rt = vmrt.getMethod("getRuntime").invoke(null);
        vmrt.getMethod("setHiddenApiExemptions", String[].class)
            .invoke(rt, (Object) new String[] { "L" });
    }

    static Context systemContext() throws Exception {
        Class<?> at = Class.forName("android.app.ActivityThread");
        Object thread = at.getMethod("systemMain").invoke(null);
        return (Context) thread.getClass().getMethod("getSystemContext").invoke(thread);
    }

    static String read(File f) {
        try {
            RandomAccessFile raf = new RandomAccessFile(f, "r");
            byte[] b = new byte[(int) raf.length()];
            raf.readFully(b);
            raf.close();
            return new String(b, "UTF-8");
        } catch (Exception e) { return ""; }
    }

    static void write(File f, String s) {
        try {
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(s.getBytes("UTF-8"));
            fos.close();
            f.setReadable(true, false);
        } catch (Exception e) { /* ignore */ }
    }

    static void log(String s) {
        System.out.println(s);
        System.out.flush();
    }
}
