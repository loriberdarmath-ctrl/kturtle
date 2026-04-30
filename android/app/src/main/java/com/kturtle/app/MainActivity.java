package com.kturtle.app;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "KTurtleDownloads";
    private static final String SUBDIR = "KTurtle";

    @Override
    public void onStart() {
        super.onStart();
        // Expose a tiny JS bridge on window.KTurtleDownloads so the web
        // layer can drop files into the device's public Downloads/KTurtle
        // folder. Uses MediaStore on Android 10+ (no permission needed)
        // and falls back to the legacy public Downloads directory on
        // older versions.
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().addJavascriptInterface(new Downloads(), "KTurtleDownloads");
        }
    }

    /**
     * JS bridge. Methods are called as e.g.
     *     window.KTurtleDownloads.saveText("hello.turtle", "...")
     *     window.KTurtleDownloads.saveBase64("draw.png", "image/png", "iVBOR…")
     *
     * Both return the public URI string on success, or null on failure.
     * Every exception is swallowed and logged — the web layer falls back
     * to Capacitor Filesystem + share sheet if we return null.
     */
    public class Downloads {
        @JavascriptInterface
        public String saveText(String filename, String mime, String contents) {
            try {
                byte[] bytes = contents.getBytes("UTF-8");
                return writeToDownloads(filename, mime, bytes);
            } catch (Exception e) {
                Log.e(TAG, "saveText failed", e);
                return null;
            }
        }

        @JavascriptInterface
        public String saveBase64(String filename, String mime, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                return writeToDownloads(filename, mime, bytes);
            } catch (Exception e) {
                Log.e(TAG, "saveBase64 failed", e);
                return null;
            }
        }
    }

    private String writeToDownloads(String filename, String mime, byte[] bytes) {
        if (filename == null || filename.isEmpty()) return null;
        if (mime == null || mime.isEmpty()) mime = "application/octet-stream";

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // MediaStore path (Android 10+). Lands in /Download/KTurtle/<name>
                // and is visible to the user in any file manager and in the
                // system Downloads UI.
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, mime);
                values.put(
                    MediaStore.Downloads.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/" + SUBDIR
                );
                Uri collection = MediaStore.Downloads.getContentUri(
                    MediaStore.VOLUME_EXTERNAL_PRIMARY
                );
                Uri item = getContentResolver().insert(collection, values);
                if (item == null) return null;
                try (OutputStream out = getContentResolver().openOutputStream(item)) {
                    if (out == null) return null;
                    out.write(bytes);
                    out.flush();
                }
                return item.toString();
            } else {
                // Pre-Q path: write straight to the legacy public Downloads
                // folder. This works on Android 9 and below; on Android 10+
                // we never take this branch.
                File dir = new File(
                    Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS
                    ),
                    SUBDIR
                );
                if (!dir.exists() && !dir.mkdirs()) return null;
                File target = new File(dir, filename);
                try (FileOutputStream out = new FileOutputStream(target)) {
                    out.write(bytes);
                    out.flush();
                }
                return Uri.fromFile(target).toString();
            }
        } catch (Exception e) {
            Log.e(TAG, "writeToDownloads failed", e);
            return null;
        }
    }
}
