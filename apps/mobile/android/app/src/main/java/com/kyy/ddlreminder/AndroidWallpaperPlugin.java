package com.kyy.ddlreminder;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.exifinterface.media.ExifInterface;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

@CapacitorPlugin(name = "AndroidWallpaper")
public class AndroidWallpaperPlugin extends Plugin {
    private static final long MAX_SOURCE_BYTES = 30L * 1024L * 1024L;
    private static final long MAX_MAIN_BYTES = 5L * 1024L * 1024L;
    private static final long MAX_BLUR_BYTES = 300L * 1024L;
    private static final int MAX_EDGE = 2880;
    private static final long MAX_PIXELS = 8_000_000L;
    private static final int BLUR_MAX_EDGE = 640;
    private static final int[] MAIN_QUALITIES = { 86, 78, 70, 62, 54 };
    private static final int[] BLUR_QUALITIES = { 76, 66, 56, 46 };

    @PluginMethod
    public void chooseAndPrepare(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        try {
            startActivityForResult(call, intent, "processSelectedWallpaper");
        } catch (RuntimeException openDocumentError) {
            Intent fallbackIntent = new Intent(Intent.ACTION_GET_CONTENT);
            fallbackIntent.addCategory(Intent.CATEGORY_OPENABLE);
            fallbackIntent.setType("image/*");
            fallbackIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            try {
                startActivityForResult(call, fallbackIntent, "processSelectedWallpaper");
            } catch (RuntimeException fallbackError) {
                call.reject("没能打开图片选择器，请稍后再试。", "WALLPAPER_PICKER_UNAVAILABLE");
            }
        }
    }

    @ActivityCallback
    private void processSelectedWallpaper(PluginCall call, ActivityResult activityResult) {
        if (call == null) {
            return;
        }

        Intent resultData = activityResult.getData();
        Uri sourceUri = resultData == null ? null : resultData.getData();

        if (activityResult.getResultCode() != Activity.RESULT_OK || sourceUri == null) {
            call.reject("已取消选择图片。", "WALLPAPER_PICKER_CANCELLED");
            return;
        }

        execute(() -> {
            try {
                call.resolve(prepareWallpaper(sourceUri));
            } catch (WallpaperException error) {
                call.reject(error.getMessage(), error.code);
            } catch (OutOfMemoryError error) {
                call.reject(
                    "这张图片分辨率太高，手机内存不够。请先在相册中缩小图片，再试一次。",
                    "WALLPAPER_OUT_OF_MEMORY"
                );
            } catch (Exception error) {
                call.reject("处理背景图片时出了点问题，请换张图片再试。", "WALLPAPER_PROCESSING_FAILED", error);
            }
        });
    }

    private JSObject prepareWallpaper(Uri sourceUri) throws Exception {
        File sourceFile = copySourceToCache(sourceUri);
        Bitmap decoded = null;
        Bitmap scaled = null;
        Bitmap oriented = null;
        Bitmap blur = null;
        File mainTemp = null;
        File blurTemp = null;
        File mainFile = null;
        File blurFile = null;

        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(sourceFile.getAbsolutePath(), bounds);

            if (
                bounds.outWidth <= 0 ||
                bounds.outHeight <= 0 ||
                bounds.outMimeType == null ||
                !bounds.outMimeType.startsWith("image/")
            ) {
                throw new WallpaperException(
                    "WALLPAPER_UNSUPPORTED_IMAGE",
                    "这张图片无法识别。请选择 JPEG、PNG、WebP 或 HEIF 格式的图片。"
                );
            }

            int orientation = readExifOrientation(sourceFile);
            boolean swapsDimensions = swapsDimensions(orientation);
            int orientedWidth = swapsDimensions ? bounds.outHeight : bounds.outWidth;
            int orientedHeight = swapsDimensions ? bounds.outWidth : bounds.outHeight;
            Dimensions target = calculateDimensions(
                orientedWidth,
                orientedHeight,
                MAX_EDGE,
                MAX_PIXELS
            );
            int rawTargetWidth = swapsDimensions ? target.height : target.width;
            int rawTargetHeight = swapsDimensions ? target.width : target.height;

            BitmapFactory.Options decodeOptions = new BitmapFactory.Options();
            decodeOptions.inSampleSize = calculateInSampleSize(
                bounds.outWidth,
                bounds.outHeight,
                rawTargetWidth,
                rawTargetHeight
            );
            decodeOptions.inPreferredConfig = Bitmap.Config.ARGB_8888;
            decoded = BitmapFactory.decodeFile(sourceFile.getAbsolutePath(), decodeOptions);

            if (decoded == null) {
                throw new WallpaperException(
                    "WALLPAPER_DECODE_FAILED",
                    "这张图片无法读取，请换一张或转换格式后再试。"
                );
            }

            scaled = scaleBitmap(decoded, rawTargetWidth, rawTargetHeight);

            if (scaled != decoded) {
                decoded.recycle();
                decoded = null;
            }

            oriented = applyExifOrientation(scaled, orientation);

            if (oriented != scaled) {
                scaled.recycle();
                scaled = null;
            }

            Dimensions blurDimensions = calculateDimensions(
                oriented.getWidth(),
                oriented.getHeight(),
                BLUR_MAX_EDGE,
                (long) BLUR_MAX_EDGE * BLUR_MAX_EDGE
            );
            blur = scaleBitmap(oriented, blurDimensions.width, blurDimensions.height);

            EncodedBitmap mainEncoded = encodeWithinLimit(
                oriented,
                MAX_MAIN_BYTES,
                MAIN_QUALITIES
            );
            EncodedBitmap blurEncoded = encodeWithinLimit(
                blur,
                MAX_BLUR_BYTES,
                BLUR_QUALITIES
            );

            File wallpaperDirectory = new File(getContext().getFilesDir(), "wallpapers");

            if (!wallpaperDirectory.exists() && !wallpaperDirectory.mkdirs()) {
                throw new IOException("Unable to create wallpaper directory");
            }

            String revision = UUID.randomUUID().toString();
            mainTemp = new File(wallpaperDirectory, revision + "-main.jpg.tmp");
            blurTemp = new File(wallpaperDirectory, revision + "-blur.jpg.tmp");
            mainFile = new File(wallpaperDirectory, revision + "-main.jpg");
            blurFile = new File(wallpaperDirectory, revision + "-blur.jpg");
            writeBytes(mainTemp, mainEncoded.data);
            writeBytes(blurTemp, blurEncoded.data);

            if (!mainTemp.renameTo(mainFile) || !blurTemp.renameTo(blurFile)) {
                throw new IOException("Unable to commit wallpaper files");
            }

            JSObject result = new JSObject();
            result.put(
                "main",
                createAssetResult(
                    "wallpapers/" + mainFile.getName(),
                    mainEncoded.width,
                    mainEncoded.height,
                    mainFile.length()
                )
            );
            result.put(
                "blur",
                createAssetResult(
                    "wallpapers/" + blurFile.getName(),
                    blurEncoded.width,
                    blurEncoded.height,
                    blurFile.length()
                )
            );
            return result;
        } finally {
            sourceFile.delete();
            recycleBitmap(decoded);
            recycleBitmap(scaled);
            recycleBitmap(oriented);

            if (blur != oriented) {
                recycleBitmap(blur);
            }

            deleteIfTemporary(mainTemp);
            deleteIfTemporary(blurTemp);

            if ((mainFile == null || !mainFile.exists()) && blurFile != null) {
                blurFile.delete();
            }

            if ((blurFile == null || !blurFile.exists()) && mainFile != null) {
                mainFile.delete();
            }
        }
    }

    private File copySourceToCache(Uri sourceUri) throws Exception {
        File sourceFile = new File(
            getContext().getCacheDir(),
            "wallpaper-source-" + UUID.randomUUID()
        );
        ContentResolver resolver = getContext().getContentResolver();
        long totalBytes = 0;

        try (
            InputStream input = resolver.openInputStream(sourceUri);
            OutputStream output = new FileOutputStream(sourceFile)
        ) {
            if (input == null) {
                throw new WallpaperException(
                    "WALLPAPER_READ_FAILED",
                    "没能读取所选图片，请重新选择。"
                );
            }

            byte[] buffer = new byte[64 * 1024];
            int read;

            while ((read = input.read(buffer)) != -1) {
                totalBytes += read;

                if (totalBytes > MAX_SOURCE_BYTES) {
                    throw new WallpaperException(
                        "WALLPAPER_SOURCE_TOO_LARGE",
                        "图片不能超过 30 MB。"
                    );
                }

                output.write(buffer, 0, read);
            }
        } catch (Exception error) {
            sourceFile.delete();
            throw error;
        }

        if (totalBytes <= 0) {
            sourceFile.delete();
            throw new WallpaperException(
                "WALLPAPER_EMPTY_SOURCE",
                "这张图片是空文件，请重新选择。"
            );
        }

        return sourceFile;
    }

    private int readExifOrientation(File sourceFile) {
        try (InputStream input = new FileInputStream(sourceFile)) {
            ExifInterface exif = new ExifInterface(input);
            return exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            );
        } catch (IOException ignored) {
            return ExifInterface.ORIENTATION_NORMAL;
        }
    }

    private boolean swapsDimensions(int orientation) {
        return (
            orientation == ExifInterface.ORIENTATION_TRANSPOSE ||
            orientation == ExifInterface.ORIENTATION_ROTATE_90 ||
            orientation == ExifInterface.ORIENTATION_TRANSVERSE ||
            orientation == ExifInterface.ORIENTATION_ROTATE_270
        );
    }

    private Bitmap applyExifOrientation(Bitmap source, int orientation) {
        Matrix matrix = new Matrix();

        switch (orientation) {
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                matrix.setScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                matrix.setRotate(180);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                matrix.setRotate(180);
                matrix.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                matrix.setRotate(90);
                matrix.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_ROTATE_90:
                matrix.setRotate(90);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                matrix.setRotate(-90);
                matrix.postScale(-1, 1);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                matrix.setRotate(-90);
                break;
            default:
                return source;
        }

        return Bitmap.createBitmap(
            source,
            0,
            0,
            source.getWidth(),
            source.getHeight(),
            matrix,
            true
        );
    }

    private int calculateInSampleSize(
        int width,
        int height,
        int targetWidth,
        int targetHeight
    ) {
        int sampleSize = 1;

        while (
            width / (sampleSize * 2) >= targetWidth &&
            height / (sampleSize * 2) >= targetHeight
        ) {
            sampleSize *= 2;
        }

        return sampleSize;
    }

    private Bitmap scaleBitmap(Bitmap source, int targetWidth, int targetHeight) {
        if (source.getWidth() == targetWidth && source.getHeight() == targetHeight) {
            return source;
        }

        return Bitmap.createScaledBitmap(source, targetWidth, targetHeight, true);
    }

    private Dimensions calculateDimensions(
        int width,
        int height,
        int maxEdge,
        long maxPixels
    ) {
        double edgeScale = (double) maxEdge / Math.max(width, height);
        double pixelScale = Math.sqrt((double) maxPixels / ((double) width * height));
        double scale = Math.min(1.0, Math.min(edgeScale, pixelScale));

        return new Dimensions(
            Math.max(1, (int) Math.round(width * scale)),
            Math.max(1, (int) Math.round(height * scale))
        );
    }

    private EncodedBitmap encodeWithinLimit(
        Bitmap source,
        long maxBytes,
        int[] qualities
    ) throws WallpaperException {
        Bitmap current = source;
        boolean ownsCurrent = false;

        try {
            for (int resizeAttempt = 0; resizeAttempt < 5; resizeAttempt++) {
                for (int quality : qualities) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();

                    if (!current.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                        throw new WallpaperException(
                            "WALLPAPER_ENCODE_FAILED",
                            "没能保存处理后的背景图片，请重试。"
                        );
                    }

                    byte[] data = output.toByteArray();

                    if (data.length <= maxBytes) {
                        return new EncodedBitmap(
                            data,
                            current.getWidth(),
                            current.getHeight()
                        );
                    }
                }

                int nextWidth = Math.max(1, Math.round(current.getWidth() * 0.85f));
                int nextHeight = Math.max(1, Math.round(current.getHeight() * 0.85f));
                Bitmap next = Bitmap.createScaledBitmap(
                    current,
                    nextWidth,
                    nextHeight,
                    true
                );

                if (ownsCurrent) {
                    current.recycle();
                }

                current = next;
                ownsCurrent = true;
            }
        } finally {
            if (ownsCurrent) {
                current.recycle();
            }
        }

        throw new WallpaperException(
            "WALLPAPER_OUTPUT_TOO_LARGE",
            "压缩后的图片还是太大，请换张图片再试。"
        );
    }

    private void writeBytes(File target, byte[] data) throws IOException {
        try (FileOutputStream output = new FileOutputStream(target)) {
            output.write(data);
            output.getFD().sync();
        }

        if (target.length() != data.length || target.length() <= 0) {
            throw new IOException("Wallpaper write verification failed");
        }
    }

    private JSObject createAssetResult(
        String path,
        int width,
        int height,
        long bytes
    ) {
        JSObject asset = new JSObject();
        asset.put("bytes", bytes);
        asset.put("height", height);
        asset.put("mimeType", "image/jpeg");
        asset.put("path", path);
        asset.put("width", width);
        return asset;
    }

    private void recycleBitmap(Bitmap bitmap) {
        if (bitmap != null && !bitmap.isRecycled()) {
            bitmap.recycle();
        }
    }

    private void deleteIfTemporary(File file) {
        if (file != null && file.exists() && file.getName().endsWith(".tmp")) {
            file.delete();
        }
    }

    private static final class Dimensions {
        final int width;
        final int height;

        Dimensions(int width, int height) {
            this.width = width;
            this.height = height;
        }
    }

    private static final class EncodedBitmap {
        final byte[] data;
        final int width;
        final int height;

        EncodedBitmap(byte[] data, int width, int height) {
            this.data = data;
            this.width = width;
            this.height = height;
        }
    }

    private static final class WallpaperException extends Exception {
        final String code;

        WallpaperException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
