package com.puneetstudios.app;

import android.content.Context;
import android.content.SharedPreferences;

// Everything the app remembers: where the PC is, the login, choices and sync status.
public class Settings {
    public static final String DEFAULT_SERVER = "https://ssiplit1399-1.tail7b1858.ts.net";

    private final SharedPreferences p;

    private Settings(Context context) {
        p = context.getApplicationContext().getSharedPreferences("sync", Context.MODE_PRIVATE);
    }

    public static Settings of(Context context) {
        return new Settings(context);
    }

    public String server() { return p.getString("server", DEFAULT_SERVER); }
    public String username() { return p.getString("username", ""); }
    public String password() { return p.getString("password", ""); }
    public String cookie() { return p.getString("cookie", ""); }
    public boolean isSignedIn() { return !username().isEmpty() && !password().isEmpty(); }
    public boolean wifiOnly() { return p.getBoolean("wifiOnly", false); }
    public boolean paused() { return p.getBoolean("paused", false); }
    /** Only media added after this time (seconds) is synced; 0 = everything on the phone. */
    public long since() { return p.getLong("since", 0); }

    public long synced() { return p.getLong("synced", 0); }
    public long pending() { return p.getLong("pending", 0); }
    public long lastUpload() { return p.getLong("lastUpload", 0); }
    public String lastName() { return p.getString("lastName", ""); }
    public long lastRun() { return p.getLong("lastRun", 0); }
    public String error() { return p.getString("error", ""); }
    public String current() { return p.getString("current", ""); }
    public int currentPercent() { return p.getInt("currentPercent", 0); }

    public void signIn(String server, String username, String password, String cookie, long since) {
        p.edit().putString("server", server).putString("username", username).putString("password", password)
                .putString("cookie", cookie).putLong("since", since).putString("error", "").apply();
    }

    public void setCookie(String cookie) { p.edit().putString("cookie", cookie).apply(); }
    public void setServer(String server) { p.edit().putString("server", server).apply(); }
    public void setSince(long since) { p.edit().putLong("since", since).apply(); }
    public void setWifiOnly(boolean on) { p.edit().putBoolean("wifiOnly", on).apply(); }
    public void setPaused(boolean on) { p.edit().putBoolean("paused", on).apply(); }

    public void signOut() {
        p.edit().remove("cookie").remove("password").apply();
    }

    public void setProgress(String name, int percent) {
        p.edit().putString("current", name).putInt("currentPercent", percent).apply();
    }

    public void uploaded(String name) {
        p.edit().putLong("synced", synced() + 1).putLong("lastUpload", System.currentTimeMillis())
                .putString("lastName", name).putString("current", "").putString("error", "").apply();
    }

    public void finishedRun(long pending, String error) {
        p.edit().putLong("pending", pending).putLong("lastRun", System.currentTimeMillis())
                .putString("error", error == null ? "" : error).putString("current", "").apply();
    }
}
