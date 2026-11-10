package com.puneetstudios.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

// Keeps the app up to date by itself: when the studio PC has a newer version of the app
// (android/dist/PuneetStudios.apk), it is downloaded and installed over this one. Your
// sign-in, backup history and settings stay. Android shows its own "Update" confirmation
// unless it allows the app to update itself silently (Android 12+, after the first time).
public class Updater {
    private static final long CHECK_EVERY_MS = 15 * 60 * 1000L;
    private static volatile boolean busy = false;
    private static volatile long lastCheck = 0;

    public interface Listener {
        void state(String state, String version);
    }

    static void check(final Context c, boolean force, final Listener listener) {
        if (busy || !Settings.of(c).isSignedIn()) return;
        if (!force && System.currentTimeMillis() - lastCheck < CHECK_EVERY_MS) return;
        lastCheck = System.currentTimeMillis();
        busy = true;
        new Thread(() -> {
            String version = "";
            try {
                Settings s = Settings.of(c);
                JSONObject info = new JSONObject(get(s.server() + "/api/sync/app?info=1", s.cookie()));
                int code = info.optInt("versionCode", 0);
                version = info.optString("versionName", "");
                if (code <= BuildInfo.CODE) {
                    if (listener != null) listener.state("latest", BuildInfo.VERSION);
                    return;
                }
                if (listener != null) listener.state("downloading", version);
                File apk = new File(c.getCacheDir(), "update.apk");
                download(s.server() + "/api/sync/app", s.cookie(), apk);
                if (listener != null) listener.state("installing", version);
                install(c, apk);
            } catch (Exception e) {
                if (listener != null) listener.state("failed", version);
            } finally {
                busy = false;
            }
        }, "updater").start();
    }

    private static HttpURLConnection open(String url, String cookie) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(15000);
        h.setReadTimeout(60000);
        if (cookie != null && !cookie.isEmpty()) h.setRequestProperty("Cookie", cookie);
        return h;
    }

    private static String get(String url, String cookie) throws Exception {
        HttpURLConnection h = open(url, cookie);
        if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
        InputStream in = h.getInputStream();
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    private static void download(String url, String cookie, File to) throws Exception {
        HttpURLConnection h = open(url, cookie);
        if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
        long expected = h.getContentLengthLong();
        long got = 0;
        try (InputStream in = h.getInputStream(); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[64 * 1024];
            for (int n; (n = in.read(buf)) > 0; ) {
                out.write(buf, 0, n);
                got += n;
            }
        }
        if (expected > 0 && got != expected) throw new Exception("Incomplete download");
    }

    private static void install(Context c, File apk) throws Exception {
        PackageInstaller installer = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        // Android 14+: claim this app as its own update owner, so later updates need no tap.
        if (Build.VERSION.SDK_INT >= 34) params.setRequestUpdateOwnership(true);
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("app", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent done = new Intent(c, Result.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pi = PendingIntent.getBroadcast(c, id, done, flags);
            session.commit(pi.getIntentSender());
        }
    }

    private static final String CHANNEL = "app_update";
    private static final int NOTE_ID = 4207;

    static void notifyReady(Context c, Intent confirm) {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(new android.app.NotificationChannel(CHANNEL, "App updates", android.app.NotificationManager.IMPORTANCE_HIGH));
            }
            PendingIntent tap = PendingIntent.getActivity(c, NOTE_ID, confirm, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            nm.notify(NOTE_ID, new android.app.Notification.Builder(c, CHANNEL)
                    .setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle("Puneet Studios update ready")
                    .setContentText("Tap to install the new version")
                    .setContentIntent(tap)
                    .setAutoCancel(true)
                    .build());
        } catch (Exception ignored) {
        }
    }

    /** Android's answer: if it wants a confirmation, show its "Update" screen. */
    public static class Result extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        context.startActivity(confirm);
                    } catch (Exception ignored) {
                    }
                    // Android blocks that screen when the app isn't on top (that's how version
                    // 3.6 got stuck). A notification always gets through: tap it to install.
                    notifyReady(context, confirm);
                }
            }
        }
    }
}
