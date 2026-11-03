package com.puneetstudios.app;

import android.app.PendingIntent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

// window.PuneetApp for the web app (see components/appBridge.js): this phone's backup
// status and switches, signing in/out, and freeing up space. Slow answers come back as a
// "puneetapp" event on the page, e.g. { type: "freeable", count, bytes }.
public class Bridge {
    private final MainActivity activity;
    private final WebView web;
    private volatile int waiting = -1;
    private volatile long waitingAt = 0;
    private volatile boolean counting = false;
    private List<SyncEngine.Item> freeable = new ArrayList<>();

    Bridge(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    private void emit(JSONObject detail) {
        final String js = "window.dispatchEvent(new CustomEvent('puneetapp',{detail:" + detail.toString() + "}))";
        activity.runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    // ----- Status -----
    @JavascriptInterface
    public String status() {
        Settings s = Settings.of(activity);
        refreshWaiting();
        try {
            ConnectivityManager cm = (ConnectivityManager) activity.getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
            NetworkCapabilities caps = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
            PowerManager pm = (PowerManager) activity.getSystemService(android.content.Context.POWER_SERVICE);
            return new JSONObject()
                    .put("signedIn", s.isSignedIn())
                    .put("device", SyncEngine.deviceName(activity))
                    .put("synced", s.synced())
                    .put("waiting", waiting >= 0 ? waiting : s.pending())
                    .put("lastUpload", s.lastUpload())
                    .put("lastName", s.lastName())
                    .put("error", s.error())
                    .put("current", s.current())
                    .put("percent", s.currentPercent())
                    .put("wifiOnly", s.wifiOnly())
                    .put("paused", s.paused())
                    .put("allOld", s.since() == 0)
                    .put("photosAllowed", SyncEngine.hasPermission(activity))
                    .put("backgroundAllowed", pm != null && pm.isIgnoringBatteryOptimizations(activity.getPackageName()))
                    .put("online", caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
                    .put("version", BuildInfo.VERSION)
                    .put("alwaysOn", SyncService.running)
                    .put("versionCode", BuildInfo.CODE)
                    .toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    // Counted on the phone, so it's right even when the PC can't be reached.
    private void refreshWaiting() {
        if (counting || System.currentTimeMillis() - waitingAt < 3000) return;
        counting = true;
        new Thread(() -> {
            try {
                waiting = SyncEngine.countWaiting(activity);
            } finally {
                waitingAt = System.currentTimeMillis();
                counting = false;
            }
        }).start();
    }

    // ----- Signing in / out (the web login screen tells the app) -----
    @JavascriptInterface
    public void signedIn(final String username, final String password) {
        new Thread(() -> {
            Settings s = Settings.of(activity);
            try {
                String cookie = Api.login(s.server(), username, password);
                boolean first = !s.isSignedIn();
                // Everything in the gallery is backed up, old and new (duplicates are skipped by
                // fingerprint, so nothing already on the PC is sent again).
                s.signIn(s.server(), username, password, cookie, first ? 0 : s.since());
                activity.runOnUiThread(() -> {
                    if (!SyncEngine.hasPermission(activity)) activity.askPhotoPermission();
                    SyncJob.schedule(activity, true);
                    SyncService.start(activity);
                });
            } catch (Exception ignored) {
                // The web app is signed in anyway; backup will start once this works.
            }
        }).start();
    }

    @JavascriptInterface
    public void signOut() {
        SyncService.stop(activity);
        SyncJob.cancelAll(activity);
        Settings.of(activity).signOut();
    }

    // ----- Switches -----
    @JavascriptInterface
    public void syncNow() {
        if (!Settings.of(activity).isSignedIn()) return;
        SyncService.start(activity);
        SyncJob.syncNow(activity);
    }

    @JavascriptInterface
    public void setWifiOnly(boolean on) {
        Settings.of(activity).setWifiOnly(on);
        SyncJob.schedule(activity, true);
        SyncJob.syncNow(activity);
    }

    @JavascriptInterface
    public void setPaused(boolean on) {
        Settings.of(activity).setPaused(on);
        if (!on) SyncJob.syncNow(activity);
    }

    @JavascriptInterface
    public void backupAll() {
        Settings.of(activity).setSince(0);
        waitingAt = 0;
        SyncJob.syncNow(activity);
    }

    @JavascriptInterface
    public void allowPhotos() {
        activity.runOnUiThread(activity::askPhotoPermission);
    }

    @JavascriptInterface
    public void allowBackground() {
        activity.runOnUiThread(activity::askBackground);
    }

    // "Check for updates" in Settings: download and install a newer app from the PC.
    @JavascriptInterface
    public void checkUpdate() {
        Updater.check(activity, true, (state, version) -> {
            try {
                emit(new JSONObject().put("type", "update").put("state", state).put("version", version));
            } catch (Exception ignored) {
            }
        });
    }

    // The lock button in the app.
    @JavascriptInterface
    public void lockNow() {
        activity.runOnUiThread(activity::lockNow);
    }

    @JavascriptInterface
    public void setTheme(boolean dark) {
        activity.setDark(dark);
    }

    // ----- Free up space -----
    // Only files the PC confirms it has (same name and size) are offered for removal.
    @JavascriptInterface
    public void checkFreeable() {
        new Thread(() -> {
            JSONObject out = new JSONObject();
            try {
                out.put("type", "freeable");
                if (Build.VERSION.SDK_INT < 30) {
                    out.put("error", "Freeing up space needs Android 11 or newer.");
                } else if (!SyncEngine.hasPermission(activity)) {
                    out.put("error", "Allow photos & videos first.");
                } else {
                    List<SyncEngine.Item> safe = SyncEngine.freeable(activity);
                    long bytes = 0;
                    for (SyncEngine.Item i : safe) bytes += i.size;
                    synchronized (this) {
                        freeable = safe;
                    }
                    out.put("count", safe.size()).put("bytes", bytes);
                }
            } catch (Exception e) {
                try {
                    out.put("error", "Can't check with the PC right now. Is Tailscale on?");
                } catch (Exception ignored) {
                }
            }
            emit(out);
        }).start();
    }

    @JavascriptInterface
    public void freeUpSpace() {
        activity.runOnUiThread(() -> {
            List<SyncEngine.Item> list;
            synchronized (this) {
                list = freeable;
            }
            if (Build.VERSION.SDK_INT < 30 || list.isEmpty()) return;
            List<Uri> uris = new ArrayList<>();
            for (SyncEngine.Item i : list) uris.add(i.uri);
            try {
                // Android asks the person to confirm; nothing is removed without that.
                PendingIntent pi = MediaStore.createDeleteRequest(activity.getContentResolver(), uris);
                activity.startIntentSenderForResult(pi.getIntentSender(), MainActivity.REQ_DELETE, null, 0, 0, 0);
            } catch (Exception e) {
                try {
                    emit(new JSONObject().put("type", "freeable").put("error", "Android didn't allow it. Try again."));
                } catch (Exception ignored) {
                }
            }
        });
    }

    void onDeleted(boolean ok) {
        List<SyncEngine.Item> list;
        synchronized (this) {
            list = freeable;
            if (ok) freeable = new ArrayList<>();
        }
        long bytes = 0;
        for (SyncEngine.Item i : list) bytes += i.size;
        try {
            emit(new JSONObject().put("type", "freed").put("count", ok ? list.size() : 0).put("bytes", ok ? bytes : 0));
        } catch (Exception ignored) {
        }
    }
}
