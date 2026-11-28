package dev.xduo.enote;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

final class BackupFiles {
    private static final String PREFIX = "enote-backup-";
    private static final Pattern NAME = Pattern.compile(
            "enote-backup-\\d{8}-\\d{6}-\\d{3}-[0-9a-f]{8}\\.json");
    private static final long MAX_BYTES = 64L * 1024 * 1024;
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static final String DOWNLOAD_PATH = Environment.DIRECTORY_DOWNLOADS + "/";

    private final MainActivity activity;
    private final ContentResolver resolver;
    private final File directory;

    private BackupFiles(MainActivity activity) {
        this.activity = activity;
        resolver = activity.getContentResolver();
        directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
    }

    static void request(MainActivity activity, String id, String action, String name) {
        WORKER.execute(new Runnable() {
            @Override public void run() {
                JSONObject result;
                try {
                    BackupFiles files = new BackupFiles(activity);
                    switch (action) {
                        case "list": result = files.list(); break;
                        case "export": result = files.export(); break;
                        case "import": result = files.restore(name); break;
                        default: throw new IllegalArgumentException("无效的备份操作");
                    }
                } catch (Exception error) {
                    Log.w(Bridge.TAG, "backup " + action + " failed", error);
                    result = new JSONObject();
                    String message = error.getMessage();
                    try { result.put("ok", false).put("error", message == null ? "备份操作失败" : message); }
                    catch (Exception ignored) { }
                }
                activity.runJs("window.enoteBackupResult?.(" + JSONObject.quote(id) + ","
                        + JSONObject.quote(result.toString()) + ")");
            }
        });
    }

    static void requestAccess(MainActivity activity) {
        if (Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager()) {
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + activity.getPackageName()));
                activity.startActivityForResult(settings, MainActivity.REQ_BACKUP_STORAGE);
            } catch (RuntimeException unavailable) {
                activity.toast("无法打开文件访问设置");
            }
        } else if (Build.VERSION.SDK_INT < 29 && !canReadDirectory(activity)) {
            activity.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                    MainActivity.REQ_BACKUP_STORAGE);
        } else if (Build.VERSION.SDK_INT == 29 && !canReadDirectory(activity)) {
            activity.requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE},
                    MainActivity.REQ_BACKUP_STORAGE);
        }
    }

    private static boolean canReadDirectory(MainActivity activity) {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        String permission = Build.VERSION.SDK_INT == 29 ? Manifest.permission.READ_EXTERNAL_STORAGE
                : Manifest.permission.WRITE_EXTERNAL_STORAGE;
        return (Build.VERSION.SDK_INT < 29 || Environment.isExternalStorageLegacy())
                && activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private JSONObject list() throws Exception {
        boolean directoryAccess = canReadDirectory(activity);
        ArrayList<Backup> files = find(null);
        files.sort(new Comparator<Backup>() {
            @Override public int compare(Backup a, Backup b) {
                int byDate = Long.compare(b.modified, a.modified);
                return byDate != 0 ? byDate : b.name.compareTo(a.name);
            }
        });
        JSONArray entries = new JSONArray();
        for (Backup item : files) {
            entries.put(new JSONObject().put("name", item.name)
                    .put("size", item.size).put("modified", item.modified));
        }
        return new JSONObject().put("ok", true).put("files", entries)
                .put("access", directoryAccess ? "full" : Build.VERSION.SDK_INT == 29
                        && !Environment.isExternalStorageLegacy() ? "own" : "ask")
                .put("legacy", Build.VERSION.SDK_INT < 29);
    }

    private ArrayList<Backup> find(String name) throws IOException {
        ArrayList<Backup> files = new ArrayList<>();
        if (canReadDirectory(activity)) {
            File[] candidates = directory.listFiles();
            if (candidates == null && directory.isDirectory()) throw new IOException("无法读取 Download");
            if (candidates != null) {
                File parent = directory.getCanonicalFile();
                for (File file : candidates) {
                    String fileName = file.getName();
                    if ((name == null || name.equals(fileName)) && NAME.matcher(fileName).matches()
                            && file.isFile() && parent.equals(file.getCanonicalFile().getParentFile())) {
                        files.add(new Backup(fileName, file.length(), file.lastModified(), file, null));
                    }
                }
            }
        } else if (Build.VERSION.SDK_INT >= 29) {
            Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            String[] fields = {"_id", "_display_name", "_size", "date_modified"};
            String filter = "relative_path = ? AND is_pending = 0 AND _display_name "
                    + (name == null ? "LIKE ?" : "= ?");
            try (Cursor cursor = resolver.query(collection, fields, filter,
                    new String[]{DOWNLOAD_PATH, name == null ? PREFIX + "%.json" : name}, null)) {
                if (cursor == null) throw new IOException("无法读取 Download");
                while (cursor.moveToNext()) {
                    String fileName = cursor.getString(1);
                    if (fileName != null && NAME.matcher(fileName).matches()) {
                        files.add(new Backup(fileName, cursor.getLong(2), 1000L * cursor.getLong(3),
                                null, ContentUris.withAppendedId(collection, cursor.getLong(0))));
                    }
                }
            }
        }
        return files;
    }

    private JSONObject export() throws Exception {
        if (Build.VERSION.SDK_INT < 29 && !canReadDirectory(activity)) {
            return new JSONObject().put("ok", false).put("needsAccess", true)
                    .put("error", "请授权后保存到 Download");
        }
        HttpURLConnection connection = connect("api/export");
        String name;
        try {
            if (connection.getResponseCode() != 200) throw new IOException("无法生成备份");
            String disposition = connection.getHeaderField("Content-Disposition");
            String prefix = "attachment; filename=\"";
            if (disposition == null || !disposition.startsWith(prefix) || !disposition.endsWith("\"")) {
                throw new IOException("备份文件名无效");
            }
            name = disposition.substring(prefix.length(), disposition.length() - 1);
            if (!NAME.matcher(name).matches()) throw new IOException("备份文件名无效");
            try (InputStream input = connection.getInputStream()) {
                if (Build.VERSION.SDK_INT >= 29) saveToMediaStore(name, input);
                else saveToDirectory(name, input);
            }
        } finally {
            connection.disconnect();
        }
        return new JSONObject().put("ok", true).put("name", name);
    }

    private void saveToMediaStore(String name, InputStream input) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
        values.put(MediaStore.Downloads.RELATIVE_PATH, DOWNLOAD_PATH);
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri entry = resolver.insert(collection, values);
        if (entry == null) throw new IOException("无法在 Download 创建文件");
        boolean finished = false;
        try {
            try (OutputStream out = resolver.openOutputStream(entry)) {
                if (out == null) throw new IOException("无法写入备份文件");
                copy(input, out);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            if (resolver.update(entry, values, null, null) != 1) throw new IOException("无法完成备份");
            finished = true;
        } finally {
            if (!finished) resolver.delete(entry, null, null);
        }
    }

    private void saveToDirectory(String name, InputStream input) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建 Download");
        File temporary = File.createTempFile(PREFIX, ".tmp", directory);
        boolean finished = false;
        try {
            try (OutputStream out = new FileOutputStream(temporary)) {
                copy(input, out);
            }
            if (!temporary.renameTo(new File(directory, name))) throw new IOException("无法完成备份");
            finished = true;
        } finally {
            if (!finished) temporary.delete();
        }
    }

    private JSONObject restore(String name) throws Exception {
        if (name == null || !NAME.matcher(name).matches()) throw new IOException("备份文件名不符合规则");
        ArrayList<Backup> files = find(name);
        if (files.isEmpty()) throw new IOException("备份已移动或无法读取，请重新扫描");
        Backup backup = files.get(0);
        if (backup.size > MAX_BYTES) throw new IOException("备份文件超过 64 MB");
        HttpURLConnection connection = connect("api/import");
        try {
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setChunkedStreamingMode(65536);
            connection.setRequestProperty("Content-Type", "application/json");
            try (InputStream input = backup.file != null ? new FileInputStream(backup.file)
                    : resolver.openInputStream(backup.uri)) {
                if (input == null) throw new IOException("无法读取备份文件");
                try (OutputStream out = connection.getOutputStream()) {
                    copy(input, out);
                }
            }
            if (connection.getResponseCode() != 200) throw new IOException("导入请求失败");
            return new JSONObject(new String(
                    MainActivity.readAll(connection.getInputStream(), 1 << 20), "UTF-8"));
        } finally {
            connection.disconnect();
        }
    }

    private static HttpURLConnection connect(String path) throws IOException {
        String base = Bridge.serverUrl;
        if (base == null || base.isEmpty()) base = Bridge.startServer();
        if (base == null || base.isEmpty()) throw new IOException("Go 服务未启动");
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(120000);
        return connection;
    }

    private static void copy(InputStream input, OutputStream out) throws IOException {
        byte[] buffer = new byte[65536];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > MAX_BYTES) throw new IOException("备份文件超过 64 MB");
            out.write(buffer, 0, count);
        }
    }

    private static final class Backup {
        final String name;
        final long size;
        final long modified;
        final File file;
        final Uri uri;

        Backup(String name, long size, long modified, File file, Uri uri) {
            this.name = name;
            this.size = size;
            this.modified = modified;
            this.file = file;
            this.uri = uri;
        }
    }
}
