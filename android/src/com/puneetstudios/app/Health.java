package com.puneetstudios.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import org.json.JSONObject;

// Backup health on the phone (research: reports/Photo backup alerts and best shot.md).
// Every few minutes the app asks the PC "are you there?" (GET /api/health) and works out
// what's wrong when backup can't happen: Tailscale is off, the PC is off/asleep, Puneet
// Studios isn't running on the PC, you're signed out, or the PC reports its own problem.
// Rules so it never nags:
//  - the ongoing "backup" notification text changes at once (silently);
//  - a real alert only after 30 minutes (6 hours if nothing is waiting to be sent);
//  - one alert per problem, one reminder after 24 hours, then quiet until it's fixed;
//  - nothing between 22:00 and 08:00;
//  - "working again" only after two good checks in a row, and silently.
public class Health {
    static final String CHANNEL = "backup_problem";
    static final String SUMMARY_CHANNEL = "backup_summary";
    static final int NOTE = 2;
    static final int SUMMARY_NOTE = 3;
    static final String TAILSCALE = "com.tailscale.ipn";

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("health", Context.MODE_PRIVATE);
    }

    /** The current problem in plain words (for the ongoing notification), or null. */
    static String problemText(Context c) {
        String p = prefs(c).getString("problem", "");
        switch (p) {
            case "tailscale_off": return "Not backing up: Tailscale is off";
            case "pc_unreachable": return "Not backing up: can't reach the studio PC";
            case "server_down": return "Not backing up: Puneet Studios isn't running on the PC";
            case "signed_out": return "Not backing up: sign in again";
            case "pc_disk_full": return "The studio PC is almost full";
            default: return null;
        }
    }

    // ----- One check -----
    static void probe(Context c) {
        Settings s = Settings.of(c);
        if (!s.isSignedIn()) return;
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        boolean online = false;
        boolean vpn = false;
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(n);
                if (caps == null) continue;
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) online = true;
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) vpn = true;
            }
        } catch (Exception ignored) {
        }

        String problem = null;
        JSONObject info = null;
        try {
            HttpURLConnection h = (HttpURLConnection) new URL(s.server() + "/api/health").openConnection();
            h.setConnectTimeout(8000);
            h.setReadTimeout(8000);
            h.setRequestProperty("Cookie", s.cookie());
            int code = h.getResponseCode();
            if (code == 200) {
                java.io.InputStream in = h.getInputStream();
                info = new JSONObject(new String(readAll(in), "UTF-8"));
                in.close();
                if ("critical".equals(info.optJSONObject("disk") != null ? info.optJSONObject("disk").optString("level") : "")) problem = "pc_disk_full";
            } else if (code == 401) {
                // Login expired: sign in again quietly; only a problem if that fails too.
                try {
                    s.setCookie(Api.login(s.server(), s.username(), s.password()));
                } catch (Exception e) {
                    problem = "signed_out";
                }
            } else if (code >= 500) {
                problem = "server_down"; // Tailscale answered, but the app on the PC didn't
            }
            h.disconnect();
        } catch (ConnectException e) {
            problem = !online ? null : vpn ? "server_down" : "tailscale_off";
        } catch (Exception e) {
            // Timed out / name not found: no internet at all is normal (not a problem);
            // internet but no VPN means Tailscale is off; VPN on means the PC isn't answering.
            problem = !online ? null : vpn ? "pc_unreachable" : "tailscale_off";
        }
        update(c, problem, online);
        weeklySummary(c);
    }

    private static byte[] readAll(java.io.InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return out.toByteArray();
    }

    // ----- Incident rules -----
    static void update(Context c, String problem, boolean online) {
        SharedPreferences p = prefs(c);
        SharedPreferences.Editor e = p.edit();
        long now = System.currentTimeMillis();
        String current = p.getString("problem", "");
        if (problem == null) {
            if (current.isEmpty()) return;
            if (!online) return; // offline: wait for a real answer before calling it fixed
            int streak = p.getInt("okStreak", 0) + 1;
            if (streak < 2) {
                e.putInt("okStreak", streak).apply();
                return;
            }
            boolean alerted = p.getLong("alertedAt", 0) > 0;
            e.remove("problem").remove("since").remove("alertedAt").remove("remindedAt").putInt("okStreak", 0).apply();
            if (alerted) post(c, "Backup is working again", "Everything waiting is being sent to your PC.", null, true);
            else cancel(c);
            SyncService.refresh(c);
            return;
        }
        e.putInt("okStreak", 0);
        if (!problem.equals(current)) {
            e.putString("problem", problem).putLong("since", now).putLong("alertedAt", 0).putLong("remindedAt", 0);
        }
        e.apply();
        SyncService.refresh(c); // the ongoing notification text changes at once, silently

        long since = p.getLong("since", now);
        long alertedAt = p.getLong("alertedAt", 0);
        long waiting = Settings.of(c).pending();
        long grace = p.getLong("graceMs", waiting > 0 ? 30 * 60 * 1000L : 6 * 3600 * 1000L);
        if (quietHours()) return;
        long lastOfType = p.getLong("last_" + problem, 0);
        if (alertedAt == 0 && now - since >= grace && now - lastOfType >= 6 * 3600 * 1000L) {
            alert(c, problem, waiting, false);
            p.edit().putLong("alertedAt", now).putLong("last_" + problem, now).apply();
        } else if (alertedAt > 0 && p.getLong("remindedAt", 0) == 0 && now - alertedAt >= 24 * 3600 * 1000L) {
            alert(c, problem, waiting, true);
            p.edit().putLong("remindedAt", now).apply();
        }
    }

    static boolean quietHours() {
        int h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        return h >= 22 || h < 8;
    }

    private static void alert(Context c, String problem, long waiting, boolean reminder) {
        String w = waiting > 0 ? waiting + (waiting == 1 ? " photo is" : " photos are") + " waiting." : "New photos will wait until it's fixed.";
        String title;
        String text;
        switch (problem) {
            case "tailscale_off":
                title = "Backup paused: Tailscale is off";
                text = w + " Turn Tailscale on to continue.";
                break;
            case "pc_unreachable":
                title = "Can't reach your studio PC";
                text = w + " Check the PC is on and Tailscale is running on it.";
                break;
            case "server_down":
                title = "Puneet Studios isn't running on the PC";
                text = w + " On the PC, double-click Start Puneet Studios.";
                break;
            case "signed_out":
                title = "Sign in again to keep backing up";
                text = "Open Puneet Studios and sign in. " + w;
                break;
            case "pc_disk_full":
                title = "Your studio PC is almost full";
                text = "Backups may fail soon. Empty the Recycle Bin or remove duplicates.";
                break;
            default:
                return;
        }
        if (reminder) title = "Still: " + title.substring(0, 1).toLowerCase() + title.substring(1);
        post(c, title, text, problem, false);
    }

    // ----- Notifications -----
    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Backup problems", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("When backup stops (Tailscale off, PC off…), with a one-tap fix");
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(SUMMARY_CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(SUMMARY_CHANNEL, "Weekly backup summary", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Once a week: how many photos and videos were backed up");
            nm.createNotificationChannel(ch);
        }
    }

    private static void post(Context c, String title, String text, String problem, boolean silent) {
        channels(c);
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Notification.Builder b = (Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, silent ? SUMMARY_CHANNEL : CHANNEL) : new Notification.Builder(c))
                .setSmallIcon(silent ? android.R.drawable.stat_sys_upload_done : android.R.drawable.stat_notify_error)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(PendingIntent.getActivity(c, 10, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        if (silent && Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(60 * 60 * 1000L);
        if ("tailscale_off".equals(problem)) {
            // One-tap fix: ask Tailscale to connect (falls back to opening Tailscale).
            Intent connect = new Intent("com.tailscale.ipn.CONNECT_VPN").setClassName(TAILSCALE, TAILSCALE + ".IPNReceiver");
            b.addAction(new Notification.Action.Builder(null, "Reconnect", PendingIntent.getBroadcast(c, 11, connect, PendingIntent.FLAG_IMMUTABLE)).build());
            Intent launch = c.getPackageManager().getLaunchIntentForPackage(TAILSCALE);
            if (launch != null) b.addAction(new Notification.Action.Builder(null, "Open Tailscale", PendingIntent.getActivity(c, 12, launch, PendingIntent.FLAG_IMMUTABLE)).build());
        }
        try {
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTE, b.build());
        } catch (Exception ignored) {
        }
    }

    private static void cancel(Context c) {
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE);
    }

    // ----- Once a week: a short, silent summary (Sunday from 10:00) -----
    private static void weeklySummary(Context c) {
        Calendar cal = Calendar.getInstance();
        if (cal.get(Calendar.DAY_OF_WEEK) != Calendar.SUNDAY || cal.get(Calendar.HOUR_OF_DAY) < 10) return;
        String week = cal.get(Calendar.YEAR) + "-" + cal.get(Calendar.WEEK_OF_YEAR);
        SharedPreferences p = prefs(c);
        if (week.equals(p.getString("summaryWeek", ""))) return;
        long synced = Settings.of(c).synced();
        long before = p.getLong("summarySynced", synced);
        long n = Math.max(0, synced - before);
        p.edit().putString("summaryWeek", week).putLong("summarySynced", synced).apply();
        if (!p.contains("summarySyncedSet")) {
            p.edit().putBoolean("summarySyncedSet", true).apply();
            return; // first week: nothing to compare with yet
        }
        channels(c);
        Notification.Builder b = (Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, SUMMARY_CHANNEL) : new Notification.Builder(c))
                .setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .setContentTitle("This week: " + n + (n == 1 ? " photo or video" : " photos and videos") + " backed up")
                .setContentText(problemText(c) == null ? "Everything is safe on your PC." : problemText(c))
                .setAutoCancel(true);
        try {
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(SUMMARY_NOTE, b.build());
        } catch (Exception ignored) {
        }
    }
}
