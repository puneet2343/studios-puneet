package com.puneetstudios.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.database.ContentObserver;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.MediaStore;

// Always-on backup, like Google Photos: watches the phone's gallery and sends every new
// photo/video to the PC the moment it appears, screen on or off, app open or not.
// Android requires a small ongoing notification for this ("Puneet Studios · All backed up").
// It also re-checks everything every 10 minutes and whenever the internet comes back, so
// nothing is ever left behind. SyncJob stays as a safety net if Android stops the service.
public class SyncService extends Service {
    private static final String CHANNEL = "backup";
    private static final int NOTE = 1;
    private static final long RESCAN_MS = 10 * 60 * 1000L;
    static volatile boolean running = false;

    private HandlerThread thread;
    private Handler handler;
    private ContentObserver observer;
    private ConnectivityManager.NetworkCallback network;
    private volatile boolean stopping = false;
    private PowerManager.WakeLock waitLock;

    private final Runnable sync = new Runnable() {
        @Override
        public void run() {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            PowerManager.WakeLock lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PuneetStudios:backup");
            lock.acquire(30 * 60 * 1000L); // never longer than half an hour per round
            try {
                android.util.Log.i("PuneetSync", "backup round start");
                SyncEngine.run(SyncService.this, () -> stopping);
                android.util.Log.i("PuneetSync", "backup round end, waiting=" + Settings.of(SyncService.this).pending() + " error=" + Settings.of(SyncService.this).error());
                // Is everything healthy? (Tailscale on, PC reachable…) Alerts only if not.
                Health.probe(SyncService.this);
            } finally {
                if (lock.isHeld()) lock.release();
                refresh(SyncService.this);
            }
        }
    };

    // A second look shortly after a change: catches photos that were still being saved
    // (Android marks them "pending" until the camera or app finishes writing them).
    private final Runnable followUp = new Runnable() {
        @Override
        public void run() {
            schedule(0);
        }
    };

    private final Runnable rescan = new Runnable() {
        @Override
        public void run() {
            schedule(0);
            handler.postDelayed(this, RESCAN_MS);
        }
    };

    public static void start(Context c) {
        if (!Settings.of(c).isSignedIn()) return;
        try {
            Intent i = new Intent(c, SyncService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) {
            // Android didn't allow starting it right now (e.g. from the background without
            // battery permission); the next SyncJob run or opening the app starts it.
        }
    }

    public static void stop(Context c) {
        c.stopService(new Intent(c, SyncService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Photo backup", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Shows that new photos and videos are being backed up to your PC");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Notification n = build(this);
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTE, n);
        running = true;

        thread = new HandlerThread("backup");
        thread.start();
        handler = new Handler(thread.getLooper());

        // A new photo or video anywhere in the gallery: back it up in a few seconds
        // (a short wait lets a burst of photos go together).
        observer = new ContentObserver(handler) {
            @Override
            public void onChange(boolean selfChange, Uri uri) {
                android.util.Log.i("PuneetSync", "gallery changed: " + uri);
                schedule(3000);
                handler.removeCallbacks(followUp);
                handler.postDelayed(followUp, 25000);
                waitLock.acquire(40000); // stay awake until the second look has happened
            }
        };
        getContentResolver().registerContentObserver(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, observer);
        getContentResolver().registerContentObserver(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, observer);

        // Internet back (or Wi-Fi joined): send whatever is waiting.
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        network = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network n) {
                schedule(2000);
            }
        };
        try {
            cm.registerDefaultNetworkCallback(network);
        } catch (Exception ignored) {
        }
        handler.postDelayed(rescan, 1000);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!Settings.of(this).isSignedIn()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        schedule(500);
        return START_STICKY; // if Android ends it, it comes back by itself
    }

    private void schedule(long delay) {
        if (handler == null) return;
        // In deep sleep the processor stops at once, which would freeze this short wait until
        // something else wakes the phone. Keep it awake just long enough for the wait to pass
        // (the backup itself then holds its own lock while sending).
        if (waitLock == null) {
            waitLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PuneetStudios:wait");
            waitLock.setReferenceCounted(false);
        }
        waitLock.acquire(delay + 15000);
        handler.removeCallbacks(sync);
        handler.postDelayed(sync, delay);
    }

    @Override
    public void onDestroy() {
        stopping = true;
        running = false;
        try {
            getContentResolver().unregisterContentObserver(observer);
            ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(network);
        } catch (Exception ignored) {
        }
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (waitLock != null && waitLock.isHeld()) waitLock.release();
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ----- The ongoing notification -----
    static Notification build(Context c) {
        Settings s = Settings.of(c);
        String title;
        String text;
        int max = 0;
        int progress = 0;
        if (s.paused()) {
            title = "Backup paused";
            text = "Turn it back on in Puneet Studios › Settings";
        } else if (!s.current().isEmpty()) {
            long left = s.pending();
            title = "Backing up · " + left + (left == 1 ? " left" : " left");
            text = s.current();
            max = 100;
            progress = s.currentPercent();
        } else if (Health.problemText(c) != null) {
            title = Health.problemText(c);
            text = s.pending() > 0 ? s.pending() + " waiting · they'll go as soon as it's fixed" : "New photos will wait until it's fixed";
        } else if (s.pending() > 0) {
            title = s.pending() + " waiting to back up";
            text = s.error().isEmpty() ? "Will send as soon as the PC can be reached" : s.error();
        } else {
            title = "All backed up";
            text = String.format(java.util.Locale.ENGLISH, "%,d photos & videos on your PC", s.synced());
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(tap);
        if (max > 0) b.setProgress(max, progress, false);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    /** Update the notification (called as files go up). */
    static void refresh(Context c) {
        if (!running) return;
        try {
            ((NotificationManager) c.getSystemService(NOTIFICATION_SERVICE)).notify(NOTE, build(c));
        } catch (Exception ignored) {
        }
    }
}
