package dev.xduo.enote;

import android.app.Activity;
import android.content.ComponentName;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.Locale;

/** Grants external viewers temporary read access to one stored attachment. */
public final class AttachmentProvider extends ContentProvider {
    private static final String[] COLUMNS = {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};

    private static final class Attachment {
        final File file;
        final String name;
        final String mime;

        Attachment(File file, String name, String mime) {
            this.file = file;
            this.name = name;
            this.mime = mime;
        }
    }

    private Attachment lookup(Uri uri) throws FileNotFoundException {
        if (uri.getPathSegments().size() != 2) throw new FileNotFoundException();
        Attachment attachment = lookup(getContext(), uri.getPathSegments().get(0));
        if (!attachment.name.equals(uri.getLastPathSegment())) throw new FileNotFoundException();
        return attachment;
    }

    private static Attachment lookup(Context context, String id) throws FileNotFoundException {
        try {
            JSONObject saved = new JSONObject(Bridge.nativeAttachment(id));
            File inbox = OcrHelper.inboxDir(context).getCanonicalFile();
            File file = new File(saved.getString("path")).getCanonicalFile();
            if (!inbox.equals(file.getParentFile()) || !file.isFile()) throw new FileNotFoundException();
            String name = saved.optString("name").replace('/', '_').replace('\\', '_');
            if (name.isEmpty() || ".".equals(name) || "..".equals(name)) name = file.getName();
            String mime = saved.optString("mime");
            if (mime.isEmpty() || "application/octet-stream".equals(mime)) {
                int dot = name.lastIndexOf('.');
                mime = dot < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(
                        name.substring(dot + 1).toLowerCase(Locale.ROOT));
            }
            return new Attachment(file, name, mime == null ? "application/octet-stream" : mime);
        } catch (IOException | JSONException e) {
            throw new FileNotFoundException("Attachment is unavailable");
        }
    }

    static void open(Activity activity, String id) {
        if (id == null || id.isEmpty()) return;
        try {
            Attachment attachment = lookup(activity, id);
            Uri uri = new Uri.Builder().scheme("content")
                    .authority(activity.getPackageName() + ".attachments")
                    .appendPath(id).appendPath(attachment.name).build();
            Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, attachment.mime)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            boolean hasExternalViewer = false;
            for (ResolveInfo target : activity.getPackageManager().queryIntentActivities(
                    view, PackageManager.MATCH_DEFAULT_ONLY)) {
                if (!activity.getPackageName().equals(target.activityInfo.packageName)) {
                    hasExternalViewer = true;
                    break;
                }
            }
            if (!hasExternalViewer) {
                Toast.makeText(activity, "本机没有可打开此文件的应用", Toast.LENGTH_SHORT).show();
                return;
            }
            Intent chooser = Intent.createChooser(view, "选择应用打开附件");
            chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS,
                    new ComponentName[] {new ComponentName(activity, ShareActivity.class)});
            activity.startActivity(chooser);
        } catch (FileNotFoundException e) {
            Toast.makeText(activity, "附件文件已不在", Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            android.util.Log.w(Bridge.TAG, "Cannot open attachment", e);
            Toast.makeText(activity, "无法打开附件", Toast.LENGTH_SHORT).show();
        }
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) {
        try { return lookup(uri).mime; }
        catch (FileNotFoundException e) { return null; }
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only attachment");
        return ParcelFileDescriptor.open(lookup(uri).file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) {
        MatrixCursor cursor = new MatrixCursor(projection == null ? COLUMNS : projection, 1);
        try {
            Attachment attachment = lookup(uri);
            MatrixCursor.RowBuilder row = cursor.newRow();
            for (String column : cursor.getColumnNames()) {
                if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add(attachment.name);
                else if (OpenableColumns.SIZE.equals(column)) row.add(attachment.file.length());
                else row.add(null);
            }
        } catch (FileNotFoundException ignored) { }
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException();
    }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
