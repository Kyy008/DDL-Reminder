package com.kyy.ddlreminder;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.json.JSONObject;

@CapacitorPlugin(name = "DataBackup")
public class DataBackupPlugin extends Plugin {
    private File preparedFile;
    private boolean preparing;

    @PluginMethod
    public synchronized void exportBackup(PluginCall call) {
        if (preparing || preparedFile != null) { call.reject("已有备份正在导出，请先完成或取消。", "BACKUP_BUSY"); return; }
        preparing = true;
        execute(() -> {
            File staged = null;
            try {
                String payload = call.getString("document", "");
                if (payload.length() > 16_000_000) throw new Exception("backup too large");
                JSONObject document = new JSONObject(payload);
                if (!"ddl-reminder-backup".equals(document.optString("format")) || document.optInt("version") != 1 || document.optJSONObject("state") == null) throw new Exception("invalid snapshot");
                document.put("appVersion", BuildConfig.VERSION_NAME);
                document.put("versionCode", BuildConfig.VERSION_CODE);
                document.put("packageName", getContext().getPackageName());
                staged = File.createTempFile("ddl-backup-", ".zip", getContext().getCacheDir());
                createArchive(staged, document);
                synchronized (this) { preparedFile = staged; preparing = false; }
                String filename = "DDL-Reminder-backup-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date()) + ".zip";
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip").putExtra(Intent.EXTRA_TITLE, filename);
                getActivity().runOnUiThread(() -> {
                    try { startActivityForResult(call, intent, "saveBackup"); }
                    catch (RuntimeException error) { clearStaged(); call.reject("无法打开保存位置，请稍后再试。", "BACKUP_PICKER_FAILED"); }
                });
            } catch (Exception error) {
                if (staged != null) staged.delete();
                synchronized (this) { preparing = false; }
                call.reject("备份未能生成。原数据没有改动，请稍后重试。", "BACKUP_PREPARE_FAILED");
            }
        });
    }

    @ActivityCallback
    private void saveBackup(PluginCall call, ActivityResult activityResult) {
        if (call == null) { clearStaged(); return; }
        Intent data = activityResult.getData();
        Uri destination = data == null ? null : data.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || destination == null) {
            clearStaged(); JSObject result = new JSObject(); result.put("cancelled", true); call.resolve(result); return;
        }
        execute(() -> {
            try {
                File source;
                synchronized (this) { source = preparedFile; }
                if (source == null || !source.isFile()) throw new Exception("snapshot unavailable");
                try (InputStream input = new FileInputStream(source); OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new Exception("output unavailable");
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush();
                }
                JSObject result = new JSObject(); result.put("cancelled", false); result.put("uri", destination.toString()); result.put("bytes", source.length()); call.resolve(result);
            } catch (Exception error) {
                // Best effort removal of an incomplete document, never source data.
                try { android.provider.DocumentsContract.deleteDocument(getContext().getContentResolver(), destination); } catch (Exception ignored) {}
                call.reject("备份文件没有保存完整，请换个位置重试。原数据没有改动。", "BACKUP_SAVE_FAILED");
            } finally { clearStaged(); }
        });
    }

    private void createArchive(File destination, JSONObject document) throws Exception {
        StringBuilder checksums = new StringBuilder();
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(destination))) {
            String wallpaperValue = getContext().getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("ddl-reminder:wallpaper-config", null);
            if (wallpaperValue != null) {
                JSONObject wallpaper = new JSONObject(wallpaperValue);
                document.put("wallpaper", wallpaper);
                JSONObject custom = wallpaper.optJSONObject("custom");
                if (custom != null) {
                    for (String role : new String[] { "main", "blur" }) {
                        JSONObject asset = custom.getJSONObject(role);
                        String relative = asset.getString("path");
                        if (!relative.matches("wallpapers/[A-Za-z0-9_-]+-" + role + "\\.jpg")) throw new Exception("invalid wallpaper path");
                        File source = new File(getContext().getFilesDir(), relative);
                        if (!source.isFile() || source.length() == 0 || source.length() > 6L * 1024 * 1024) throw new Exception("wallpaper missing");
                        try (InputStream input = new FileInputStream(source)) { addEntry(zip, relative, input, checksums); }
                    }
                }
            }
            try (InputStream input = new java.io.ByteArrayInputStream(document.toString(2).getBytes(StandardCharsets.UTF_8))) { addEntry(zip, "backup.json", input, checksums); }
            zip.putNextEntry(new ZipEntry("SHA256SUMS.txt")); zip.write(checksums.toString().getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
        }
    }
    private void addEntry(ZipOutputStream zip, String name, InputStream input, StringBuilder checksums) throws Exception {
        zip.putNextEntry(new ZipEntry(name));
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) { zip.write(buffer, 0, count); digest.update(buffer, 0, count); }
        zip.closeEntry();
        for (byte value : digest.digest()) checksums.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        checksums.append("  ").append(name).append('\n');
    }
    private synchronized void clearStaged() {
        if (preparedFile != null) preparedFile.delete();
        preparedFile = null; preparing = false;
    }
}
