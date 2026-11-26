package dev.xduo.enote;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * P11 截图捕获：扫描用户选定的监控文件夹（默认截图目录），把新出现的图片复制进
 * files/enote/inbox/shot-*，再交给 Go 侧的暂存区（/api/shots/list）。
 *
 * 为什么走 MediaStore：Android 10+ 读别的 app 的媒体文件只有 MediaStore 一条路，
 * 而它会索引共享存储里的所有图片 —— 所以"用户想监控哪个图片文件夹"都能列出来，
 * 魔法改过的 ROM 把截图放在 Pictures/Screenshots、DCIM/Screenshots 还是自定义目录都无所谓。
 *
 * 水位（watermark）用 DATE_ADDED（秒），首次启用时不回捞历史，否则一台存了 2834 张
 * 截图的机器一开就会糊满屏。
 */
public final class Shots {
    static final String TAG = "enote";
    static final String PREFS = "shots";
    static final String K_ON = "enabled";
    static final String K_LAST = "lastAdded";   // 秒，MediaStore 的 DATE_ADDED 单位
    static final String K_FOLDERS = "folders";  // 相对路径，带结尾斜杠
    static final int MAX_PER_SCAN = 50;          // 一次最多收 50 张，超出下次继续
    static final int OVERLAP_SEC = 300;          // 5 分钟重叠窗口：入库延迟/时钟抖动
    static final int SEEN_MAX = 500;

    private Shots() {}

    // ------------------------------------------------------------------ 配置

    static SharedPreferences p(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context c) {
        return p(c).getBoolean(K_ON, false);
    }

    static void setEnabled(Context c, boolean on) {
        p(c).edit().putBoolean(K_ON, on).apply();
        Log.i(TAG, "shots: enabled=" + on);
    }

    static boolean mediaGranted(Context c) {
        String perm = permName();
        return c.checkSelfPermission(perm) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    static String permName() {
        return Build.VERSION.SDK_INT >= 33
                ? android.Manifest.permission.READ_MEDIA_IMAGES
                : android.Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    static long watermark(Context c) {
        return p(c).getLong(K_LAST, 0L);
    }

    static void setWatermark(Context c, long sec) {
        if (sec > 0) p(c).edit().putLong(K_LAST, sec).apply();
    }

    static Set<String> folders(Context c) {
        Set<String> raw = p(c).getStringSet(K_FOLDERS, null);
        Set<String> out = new LinkedHashSet<String>();
        if (raw != null) {
            for (String s : raw) {
                String v = norm(s);
                if (!v.isEmpty()) out.add(v);
            }
        }
        return out;
    }

    /** 保存多选文件夹；同时把水位重置到现在（否则新加进来的老文件夹会一次性倒出几百张）。 */
    static void setFolders(Context c, Set<String> in) {
        Set<String> clean = new LinkedHashSet<String>();
        if (in != null) for (String s : in) {
            String v = norm(s);
            if (!v.isEmpty()) clean.add(v);
        }
        p(c).edit().putStringSet(K_FOLDERS, clean)
                .putLong(K_LAST, System.currentTimeMillis() / 1000L).apply();
        Log.i(TAG, "shots: folders=" + clean);
    }

    static String norm(String path) {
        if (path == null) return "";
        String v = path.trim().replace('\\', '/');
        while (v.startsWith("/")) v = v.substring(1);
        if (v.isEmpty()) return "";
        if (!v.endsWith("/")) v = v + "/";
        return v;
    }

    // ------------------------------------------------------------------ 文件夹列表

    /** 图片所在相对目录（API 29+ 用 RELATIVE_PATH，更老用 DATA 去掉存储根）。 */
    private static String relPathOf(Cursor c, int iRel, int iData) {
        String rp = iRel >= 0 ? c.getString(iRel) : null;
        if (rp != null && !rp.isEmpty()) return norm(rp);
        String data = iData >= 0 ? c.getString(iData) : null;
        if (data == null) return "";
        String root = Environment.getExternalStorageDirectory().getAbsolutePath();
        if (data.startsWith(root)) data = data.substring(root.length());
        int cut = data.lastIndexOf('/');
        return cut > 0 ? norm(data.substring(0, cut)) : "";
    }

    private static boolean looksLikeShot(String path) {
        String s = path.toLowerCase();
        return s.contains("screenshot") || s.contains("screencap") || s.contains("scrshots")
                || s.contains("screen_shot") || s.contains("截图") || s.contains("截屏");
    }

    /**
     * 枚举共享存储里所有含图片的文件夹：[{path,count,bytes,shot}]
     * shot=true 表示名字像截图目录，向导里默认勾上。
     */
    static String foldersJson(Context c) {
        if (!mediaGranted(c)) return "[]";
        JSONArray out = new JSONArray();
        try {
            java.util.HashMap<String, long[]> agg = queryFolders(c);
            if (agg == null) return "[]";
            for (java.util.Map.Entry<String, long[]> row : sortedFolders(agg)) {
                String k = row.getKey();
                long[] a = row.getValue();
                JSONObject o = new JSONObject();
                o.put("path", k);
                o.put("count", a[0]);
                o.put("bytes", a[1]);
                o.put("shot", looksLikeShot(k));
                out.put(o);
            }
        } catch (Throwable t) {
            Log.w(TAG, "shots: foldersJson failed " + t);
        }
        return out.toString();
    }

    /** 扫一遍 MediaStore 图片表，聚成 目录 -> [张数, 字节]；查询本身没拿到就返回 null。 */
    private static java.util.HashMap<String, long[]> queryFolders(Context c) {
        java.util.HashMap<String, long[]> agg = new java.util.HashMap<String, long[]>();
        Cursor cur = null;
        try {
            Uri uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            boolean newApi = Build.VERSION.SDK_INT >= 29;
            String[] proj = newApi
                    ? new String[]{MediaStore.Images.Media.RELATIVE_PATH, MediaStore.Images.Media.SIZE}
                    : new String[]{MediaStore.Images.Media.DATA, MediaStore.Images.Media.SIZE};
            int iRel = newApi ? 0 : -1;
            int iData = newApi ? -1 : 0;
            cur = c.getContentResolver().query(uri, proj, null, null, null);
            if (cur == null) return null;
            while (cur.moveToNext()) {
                String p = relPathOf(cur, iRel, iData);
                if (p.isEmpty()) continue;
                long[] a = agg.get(p);
                if (a == null) {
                    a = new long[]{0L, 0L};
                    agg.put(p, a);
                }
                a[0]++;
                a[1] += Math.max(0L, cur.getLong(1));
            }
        } catch (Throwable t) {
            Log.w(TAG, "shots: foldersJson failed " + t);
        } finally {
            if (cur != null) try { cur.close(); } catch (Throwable ignored) {}
        }
        return agg;
    }

    /** 按张数降序；同张数按路径字母序（稳定，不依赖 HashMap 的遍历顺序）。 */
    private static List<java.util.Map.Entry<String, long[]>> sortedFolders(
            java.util.HashMap<String, long[]> agg) {
        List<java.util.Map.Entry<String, long[]>> rows =
                new ArrayList<java.util.Map.Entry<String, long[]>>(agg.entrySet());
        Collections.sort(rows, new Comparator<java.util.Map.Entry<String, long[]>>() {
            public int compare(java.util.Map.Entry<String, long[]> a,
                               java.util.Map.Entry<String, long[]> b) {
                long cx = a.getValue()[0], cy = b.getValue()[0];
                return cx == cy ? a.getKey().compareTo(b.getKey()) : (cx < cy ? 1 : -1);
            }
        });
        return rows;
    }

    /** 便宜版状态（不扫 MediaStore）：首页横幅和我的页每帧都能调。 */
    static String flagsJson(Context c) {
        try {
            JSONObject o = new JSONObject();
            o.put("enabled", enabled(c));
            o.put("granted", mediaGranted(c));
            o.put("watermark", watermark(c));
            JSONArray list = new JSONArray();
            Set<String> want = folders(c);
            for (String w : want) list.put(w);
            o.put("list", list);
            o.put("folders", want.size());
            return o.toString();
        } catch (Throwable t) {
            return "{}";
        }
    }

    /** 设置页/向导用：{enabled,granted,folders:[…已选…],watermark,total} */
    static String stateJson(Context c) {
        try {
            JSONObject o = new JSONObject();
            o.put("enabled", enabled(c));
            o.put("granted", mediaGranted(c));
            o.put("watermark", watermark(c));
            o.put("perm", permName());
            JSONArray arr = new JSONArray();
            if (mediaGranted(c)) arr = pickedFolders(new JSONArray(foldersJson(c)), folders(c));
            o.put("folders", arr);
            o.put("total", sumFolderCount(arr));
            return o.toString();
        } catch (Throwable t) {
            return "{\"error\":\"" + t + "\"}";
        }
    }

    /** 已选目录：媒体库里有的照拄，配置里写了但媒体库没有的补一条 missing。 */
    private static JSONArray pickedFolders(JSONArray all, Set<String> want) throws JSONException {
        JSONArray arr = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject f = all.getJSONObject(i);
            if (!want.contains(f.optString("path"))) continue;
            arr.put(f);
        }
        // 配置里写了但媒体库里已经没有的目录，标 missing
        for (String w : want) {
            if (folderHasPath(arr, w)) continue;
            JSONObject f = new JSONObject();
            f.put("path", w);
            f.put("count", 0);
            f.put("bytes", 0);
            f.put("shot", looksLikeShot(w));
            f.put("missing", true);
            arr.put(f);
        }
        return arr;
    }

    private static boolean folderHasPath(JSONArray arr, String path) throws JSONException {
        for (int i = 0; i < arr.length(); i++) {
            if (arr.getJSONObject(i).optString("path").equals(path)) return true;
        }
        return false;
    }

    /** 目录卡里的张数合计（missing 的目录张数是 0，不影响合计）。 */
    private static int sumFolderCount(JSONArray arr) throws JSONException {
        int total = 0;
        for (int i = 0; i < arr.length(); i++) total += arr.getJSONObject(i).optInt("count");
        return total;
    }

    // ------------------------------------------------------------------ 已经见过的图（sha1）

    static File seenFile(Context c) {
        return new File(new File(c.getFilesDir(), "enote"), "shotseen.json");
    }

    static Set<String> loadSeen(Context c) {
        Set<String> out = new LinkedHashSet<String>();
        File f = seenFile(c);
        if (!f.exists()) return out;
        BufferedReader r = null;
        try {
            r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            JSONArray a = new JSONArray(sb.toString());
            for (int i = 0; i < a.length(); i++) out.add(a.optString(i));
        } catch (Throwable t) {
            Log.w(TAG, "shots: loadSeen failed " + t);
        } finally {
            if (r != null) try { r.close(); } catch (Throwable ignored) {}
        }
        return out;
    }

    static void saveSeen(Context c, Set<String> seen) {
        File f = seenFile(c);
        try {
            File dir = f.getParentFile();
            if (dir != null) dir.mkdirs();
            JSONArray a = new JSONArray();
            int skip = Math.max(0, seen.size() - SEEN_MAX);
            int i = 0;
            for (String s : seen) {
                if (i++ < skip) continue;
                a.put(s);
            }
            FileOutputStream out = new FileOutputStream(f);
            try {
                out.write(a.toString().getBytes("UTF-8"));
            } finally {
                out.close();
            }
        } catch (Throwable t) {
            Log.w(TAG, "shots: saveSeen failed " + t);
        }
    }

    // ------------------------------------------------------------------ 扫描

    static final class Hit {
        long dateAdded;
        String name;
        String mime;
        Uri uri;
        long size;
    }
    /**
     * 扫一次。返回新增条数；-1 = 没权限；0 = 没新增。
     * foldersJson 非空时用它覆盖配置（测试用：{"folders":["Pictures/Screenshots"]}）。
     * rangeDays &gt; 0 时按"最近 N 天"回捞（忽略水位，但仍走 sha1 去重）。
     */
    static int scan(Context c, boolean force, JSONArray overrideFolders, int rangeDays) {
        if (!mediaGranted(c)) {
            Log.i(TAG, "shots: scan skipped (no media permission)");
            return -1;
        }
        Set<String> want = wantFolders(c, overrideFolders);
        if (want.isEmpty()) {
            Log.i(TAG, "shots: scan skipped (no folders configured)");
            return 0;
        }
        long last = watermark(c);
        Long since = scanSince(c, rangeDays, last);
        if (since == null) return 0;
        ContentResolver cr = c.getContentResolver();
        List<Hit> hits = queryHits(cr, want, since);
        if (hits.isEmpty()) {
            Log.i(TAG, "shots: scan found nothing since " + since);
            return 0;
        }
        sortHits(hits);
        Scan copy = copyHits(c, cr, hits, last);
        if (copy.maxAdded > 0) setWatermark(c, copy.maxAdded);
        if (copy.copied == 0) {
            saveSeen(c, copy.seen);
            Log.i(TAG, "shots: " + hits.size() + " candidate(s), nothing new after dedupe");
            return 0;
        }
        String resp = Bridge.shotAdd(copy.added.toString());
        int staged = applyShotAddResp(resp, copy);
        saveSeen(c, copy.seen);
        Log.i(TAG, "shots: scanned " + hits.size() + " candidate(s), copied " + copy.copied
                + ", staged " + staged + ", go resp=" + resp);
        return staged;
    }

    /** 要扫哪些文件夹：override 优先（测试钩子用），否则用设置里的配置。 */
    static Set<String> wantFolders(Context c, JSONArray overrideFolders) {
        Set<String> want = new LinkedHashSet<String>();
        if (overrideFolders != null) {
            for (int i = 0; i < overrideFolders.length(); i++) {
                String v = norm(overrideFolders.optString(i));
                if (!v.isEmpty()) want.add(v);
            }
        } else {
            want.addAll(folders(c));
        }
        return want;
    }

    /** 从哪个时间点开始捞。返回 null = 首次启用：只把"现在"记成水位，不回捞历史。 */
    static Long scanSince(Context c, int rangeDays, long last) {
        long now = System.currentTimeMillis() / 1000L;
        if (rangeDays > 0) {
            return now - (long) rangeDays * 86400L;
        }
        if (last > 0) {
            return Math.max(0L, last - OVERLAP_SEC);
        }
        // 首次启用：只把"现在"记成水位，不回捞历史
        setWatermark(c, now);
        Log.i(TAG, "shots: first run, watermark set to now (no backfill)");
        return null;
    }

    /** 每个文件夹一次 MediaStore 查询；不能在 sortOrder 里拼 LIMIT，自己数到上限就停。 */
    static List<Hit> queryHits(ContentResolver cr, Set<String> want, long since) {
        List<Hit> hits = new ArrayList<Hit>();
        boolean newApi = Build.VERSION.SDK_INT >= 29;
        Uri uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        for (String folder : want) queryFolder(cr, uri, newApi, folder, since, hits);
        return hits;
    }

    /** 一个目录的查询：命中的图追加到 hits 尾部，数到 MAX_PER_SCAN 就停；这个目录查不动只记日志。 */
    private static void queryFolder(ContentResolver cr, Uri uri, boolean newApi,
                                    String folder, long since, List<Hit> hits) {
        Cursor cur = null;
        try {
            String relCol = newApi ? MediaStore.Images.Media.RELATIVE_PATH : MediaStore.Images.Media.DATA;
            String[] proj = new String[]{MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.MIME_TYPE, MediaStore.Images.Media.DATE_ADDED,
                    MediaStore.Images.Media.SIZE, relCol};
            String sel = newApi
                    ? MediaStore.Images.Media.RELATIVE_PATH + " LIKE ? AND "
                    + MediaStore.Images.Media.DATE_ADDED + " >= ?"
                    : MediaStore.Images.Media.DATA + " LIKE ? AND "
                    + MediaStore.Images.Media.DATE_ADDED + " >= ?";
            String arg = newApi ? folder + "%" : "%/" + folder + "%";
            // 不能在 sortOrder 里拼 LIMIT：这台机器的 MediaProvider 会抛
            // IllegalArgumentException: Invalid token LIMIT。自己数到上限就停。
            String order = MediaStore.Images.Media.DATE_ADDED + " ASC";
            cur = cr.query(uri, proj, sel, new String[]{arg, String.valueOf(since)}, order);
            if (cur == null) return;
            while (cur.moveToNext() && hits.size() < MAX_PER_SCAN) hits.add(hitFrom(cur, uri));
        } catch (Throwable t) {
            Log.w(TAG, "shots: query " + folder + " failed " + t);
        } finally {
            if (cur != null) try { cur.close(); } catch (Throwable ignored) {}
        }
    }

    /** 游标当前行 → 一条候选（列下标就是上面 proj 的顺序）。 */
    private static Hit hitFrom(Cursor cur, Uri uri) {
        Hit h = new Hit();
        h.uri = ContentUris.withAppendedId(uri, cur.getLong(0));
        h.name = cur.getString(1);
        h.mime = cur.getString(2);
        h.dateAdded = cur.getLong(3);
        h.size = cur.getLong(4);
        return h;
    }

    /** 多文件夹合并后按时间升序，最早的排前面（合并笔记里附件顺序 = 时间顺序）。 */
    static void sortHits(List<Hit> hits) {
        Collections.sort(hits, new Comparator<Hit>() {
            public int compare(Hit a, Hit b) {
                return a.dateAdded == b.dateAdded ? 0 : (a.dateAdded < b.dateAdded ? -1 : 1);
            }
        });
    }

    /** 一次扫描复制下来的东西：交给 Go 的清单、seen 集合、sha1 索引、复制条数、最新时间。 */
    static final class Scan {
        Set<String> seen;
        JSONArray added = new JSONArray();
        java.util.HashMap<String, String> shaByPath = new java.util.HashMap<String, String>();
        int copied;
        long maxAdded;
    }

    /** 逐个复制进暂存区，按 sha1 去重；复制成功的才交给 Go。 */
    static Scan copyHits(Context c, ContentResolver cr, List<Hit> hits, long last) {
        Scan s = new Scan();
        s.seen = loadSeen(c);
        File inbox = new File(new File(c.getFilesDir(), "enote"), "inbox");
        if (!inbox.exists()) inbox.mkdirs();
        s.maxAdded = last;
        for (Hit h : hits) {
            if (s.copied >= MAX_PER_SCAN) break;
            if (h.dateAdded > s.maxAdded) s.maxAdded = h.dateAdded;
            copyOne(cr, inbox, h, s);
        }
        return s;
    }

    /** 一张图：复制 → sha1 去重 → 改名成 shot-<时间>-<sha1 前 8 位> → 记进清单；没成只记日志。 */
    private static void copyOne(ContentResolver cr, File inbox, Hit h, Scan s) {
        String ext = extOf(h.name, h.mime);
        File dst = new File(inbox, "shot-" + h.dateAdded + "-tmp" + ext);
        String sha1 = copyFrom(cr, h.uri, dst);
        if (sha1 == null) {
            Log.w(TAG, "shots: copy failed " + h.name);
            return;
        }
        if (s.seen.contains(sha1)) {
            dst.delete();
            Log.i(TAG, "shots: duplicate sha1 " + sha1.substring(0, 8) + " (" + h.name + ")");
            return;
        }
        File finalFile = new File(inbox, "shot-" + h.dateAdded + "-" + sha1.substring(0, 8) + ext);
        if (finalFile.exists()) finalFile.delete();
        if (!dst.renameTo(finalFile)) {
            Log.w(TAG, "shots: rename failed " + dst);
            dst.delete();
            return;
        }
        s.seen.add(sha1);
        s.shaByPath.put(finalFile.getAbsolutePath(), sha1);
        s.copied++;
        s.added.put(addedJson(finalFile, h));
    }

    /** 交给 Go 的一条清单：名字 / 类型缺了就用落盘的文件名兜底。 */
    private static JSONObject addedJson(File finalFile, Hit h) {
        JSONObject o = new JSONObject();
        try {
            o.put("path", finalFile.getAbsolutePath());
            o.put("name", h.name == null ? finalFile.getName() : h.name);
            o.put("mime", h.mime == null ? "" : h.mime);
            o.put("size", finalFile.length());
            o.put("dateAdded", h.dateAdded);
        } catch (Throwable ignored) {}
        return o;
    }

    /** Go 侧忽略表命中的图：删掉刚复制的副本 + 记进 seen，否则每次扫描都白复制一遍。 */
    static int applyShotAddResp(String resp, Scan s) {
        int staged = s.copied;
        try {
            JSONObject o = new JSONObject(resp == null ? "{}" : resp);
            staged = o.optInt("added", s.copied);
            JSONArray sk = o.optJSONArray("skipped");
            if (sk != null) {
                for (int i = 0; i < sk.length(); i++) {
                    String path = sk.optString(i);
                    String sha = s.shaByPath.get(path);
                    if (sha != null) s.seen.add(sha);
                    File f = new File(path);
                    if (f.exists() && f.delete()) Log.i(TAG, "shots: 忽略表命中，删副本 " + f.getName());
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "shots: parse shotAdd resp failed " + t);
        }
        return staged;
    }

    // ------------------------------------------------------------------ 导入

    /**
     * 导入暂存的截图。json = {"mode":"merge"|"split","raw":false,
     * "shots":[{"path":…,"name":…,"mime":…}]}
     *
     * OCR 只能在 Java 侧做（ML Kit），所以"导入"由这里发起：逐张 OCR 后把文本交给 Go，
     * merge 走一条 kind=images 的请求（N 个附件 + 一次 LLM），split 走 N 条。
     * 返回 {"ok":true,"notes":N} 或 {"ok":false,"error":…}。
     */
    static String importShots(Context c, String json) {
        ImportReq in = ImportReq.parse(json);
        if (in == null) {
            return "{\"ok\":false,\"error\":\"参数解析失败\"}";
        }
        if (in.shots == null || in.shots.length() == 0) {
            return "{\"ok\":false,\"error\":\"没有选择截图\"}";
        }
        OcrBatch batch = ocrShots(c, in.shots);
        if (batch.imgs.length() == 0) {
            return "{\"ok\":false,\"error\":\"没有可用的截图文件\"}";
        }
        String source = "merge".equals(in.mode) ? "shot-merge" : "shot-single";
        ImportRes res = enqueueImgs(batch.imgs, in.mode, source, in.raw);
        Log.i(TAG, "shots: import mode=" + in.mode + " raw=" + in.raw + " shots=" + batch.imgs.length()
                + " notes=" + res.notes + " ocrFailed=" + batch.failed);
        if (res.notes == 0) {
            return "{\"ok\":false,\"error\":\"" + (res.firstErr.isEmpty() ? "导入失败" : res.firstErr) + "\"}";
        }
        return "{\"ok\":true,\"notes\":" + res.notes + ",\"ocrFailed\":" + batch.failed
                + ",\"noteIds\":" + res.noteIds + "}";
    }

    /**
     * 逐张跑本地 OCR。识别文本 / 耗时 / 错误都跟着图走，一张失败不拖垮整批：
     * 失败只记进 failed（日志与返回值用），图本身照样交给 Go。
     */
    private static OcrBatch ocrShots(Context c, JSONArray shots) {
        OcrBatch b = new OcrBatch();
        OcrHelper ocr = OcrHelper.get(c);
        for (int i = 0; i < shots.length(); i++) {
            JSONObject sh = shots.optJSONObject(i);
            if (sh == null) continue;
            String path = sh.optString("path");
            if (path.isEmpty()) continue;
            JSONObject o = new JSONObject();
            try {
                o.put("path", path);
                o.put("name", sh.optString("name"));
                o.put("mime", sh.optString("mime"));
                OcrHelper.Out out = ocr.recognizeFile(path);
                o.put("ocr", out == null || out.text == null ? "" : out.text);
                o.put("ocrMs", out == null ? 0L : out.ms);
                o.put("err", out == null || out.error == null ? "" : out.error);
                if (out == null || (out.text != null && out.text.isEmpty() && out.error != null)) b.failed++;
            } catch (Throwable t) {
                b.failed++;
                try { o.put("err", String.valueOf(t)); } catch (Throwable ignored) {}
            }
            b.imgs.put(o);
        }
        return b;
    }

    /** merge = 全部图合成一条笔记（N 个附件 + 一次 LLM）；split = 一张一条，单张失败只记第一条原因。 */
    private static ImportRes enqueueImgs(JSONArray imgs, String mode, String source, boolean raw) {
        ImportRes r = new ImportRes();
        if ("merge".equals(mode)) {
            String id = enqueuePayload(imgs, source, raw);
            if (!id.isEmpty()) { r.notes = 1; r.noteIds.put(id); }
        } else {
            for (int i = 0; i < imgs.length(); i++) {
                JSONArray one = new JSONArray();
                one.put(imgs.opt(i));
                String id = enqueuePayload(one, source, raw);
                if (!id.isEmpty()) { r.notes++; r.noteIds.put(id); }
                else if (r.firstErr.isEmpty()) r.firstErr = "第 " + (i + 1) + " 张入队失败";
            }
        }
        return r;
    }

    /** 导入请求：mode=merge|split、raw=原样存为笔记（不调 LLM）、shots=选中的截图。 */
    static final class ImportReq {
        String mode = "merge";
        boolean raw;
        JSONArray shots;

        /** 参数解析失败返回 null（调用方回「参数解析失败」）。 */
        static ImportReq parse(String json) {
            ImportReq in = new ImportReq();
            try {
                JSONObject o = new JSONObject(json == null ? "{}" : json);
                in.mode = o.optString("mode", "merge");
                in.raw = o.optBoolean("raw", false);
                in.shots = o.optJSONArray("shots");
            } catch (Throwable t) {
                return null;
            }
            return in;
        }
    }

    /** 一批截图的 OCR 结果：imgs = 交给 Go 的图（每张带 ocr/ocrMs/err），failed = 识别失败张数。 */
    static final class OcrBatch {
        final JSONArray imgs = new JSONArray();
        int failed;
    }

    /** 导入结果：出了几条笔记、笔记 id、第一条入队失败原因（空串 = 没有）。 */
    static final class ImportRes {
        int notes;
        final JSONArray noteIds = new JSONArray();
        String firstErr = "";
    }

    /** 一组图 → 一条 kind=images 的入队请求（N 个附件 + 一次 LLM）。返回新笔记 id。 */
    static String enqueuePayload(JSONArray imgs, String source, boolean raw) {
        try {
            JSONObject req = new JSONObject();
            req.put("kind", "images");
            req.put("source", source);
            req.put("raw", raw);
            req.put("images", imgs);
            String r = Bridge.nativeEnqueue(req.toString());
            Log.i(TAG, "shots: enqueue " + source + " -> " + r);
            if(r == null || r.contains("\"error\"")) return "";
            try { return new JSONObject(r).optString("id"); } catch (Throwable t) { return ""; }
        } catch (Throwable t) {
            Log.w(TAG, "shots: enqueuePayload failed " + t);
            return "";
        }
    }

    static String extOf(String name, String mime) {
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot > 0 && dot > name.length() - 6) return name.substring(dot).toLowerCase();
        }
        String m = mime == null ? "" : mime.toLowerCase();
        if (m.contains("png")) return ".png";
        if (m.contains("webp")) return ".webp";
        if (m.contains("heic")) return ".heic";
        if (m.contains("gif")) return ".gif";
        return ".jpg";
    }

    /** 复制进私有目录，顺便算 sha1；失败返回 null。 */
    static String copyFrom(ContentResolver cr, Uri uri, File dst) {
        InputStream in = null;
        OutputStream out = null;
        try {
            in = cr.openInputStream(uri);
            if (in == null) return null;
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            out = new FileOutputStream(dst);
            long total = streamCopy(in, out, md);
            out.flush();
            if (total == 0) {
                dst.delete();
                return null;
            }
            return sha1Hex(md);
        } catch (Throwable t) {
            Log.w(TAG, "shots: copyFrom failed " + t);
            dst.delete();
            return null;
        } finally {
            if (in != null) try { in.close(); } catch (Throwable ignored) {}
            if (out != null) try { out.close(); } catch (Throwable ignored) {}
        }
    }

    /** 边写边算 sha1，返回写了多少字节。 */
    private static long streamCopy(InputStream in, OutputStream out, MessageDigest md) throws java.io.IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        long total = 0;
        while ((n = in.read(buf)) > 0) {
            md.update(buf, 0, n);
            out.write(buf, 0, n);
            total += n;
            if (total > 64L * 1024 * 1024) break;   // 单张 64MB 以上不当截图处理
        }
        return total;
    }

    private static String sha1Hex(MessageDigest md) {
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    // ---------------------------------------------------------------- 实时监听（P11 用户反馈）

    static ContentObserver watcher;
    static final Handler wHand = new Handler(Looper.getMainLooper());
    static Runnable wTask;

    /**
     * 监听相册变化：截图落盘后 1~2 秒就扫进暂存区。
     * 以前只在 onResume 扫，用户截完图切回来经常看不到横幅（扫描比界面渲染慢，
     * 而横幅刷新又被前端短路掉），要退桌面再进来一次才出现。
     */
    static void watch(Context c) {
        if (watcher != null) return;
        final Context app = c.getApplicationContext();
        watcher = new ContentObserver(wHand) {
            @Override public void onChange(boolean selfChange) { scheduleScan(app); }
            @Override public void onChange(boolean selfChange, Uri uri) { scheduleScan(app); }
        };
        try {
            c.getContentResolver().registerContentObserver(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, watcher);
            Log.i(TAG, "shots: 已监听相册变化");
        } catch (Throwable t) {
            Log.w(TAG, "shots: 相册监听注册失败 " + t);
        }
    }

    /** 一次截图系统会连发好几次 onChange：去抖 1.2s 再扫。 */
    static void scheduleScan(final Context app) {
        wHand.removeCallbacks(wTask);
        wTask = new Runnable() {
            @Override public void run() {
                new Thread(new Runnable() {
                    public void run() {
                        final int n = scan(app, false, null, 0);
                        if (n <= 0) return;
                        Log.i(TAG, "shots: 监听到相册变化，新增 " + n + " 张");
                        MainActivity act = Bridge.current == null ? null : Bridge.current.get();
                        if (act != null) act.shotsFound(n);
                    }
                }, "shot-watch").start();
            }
        };
        wHand.postDelayed(wTask, 1200);
    }
}
