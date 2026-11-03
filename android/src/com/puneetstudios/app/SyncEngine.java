package com.puneetstudios.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;
import org.json.JSONObject;

// Finds photos and videos the PC doesn't have yet and uploads them, newest first.
// Each file goes up in 8 MB pieces through the PC's resumable upload, so if Android
// pauses the app or the signal drops, the next run carries on from the last piece.
public class SyncEngine {
    public interface Stop {
        boolean stopped();
    }

    private static final long CHUNK = 8L * 1024 * 1024;
    /** Where the app saves downloads (Downloads/Puneet Studios); never backed up again. */
    public static final String DOWNLOAD_FOLDER = "Puneet Studios";
    private static final AtomicBoolean running = new AtomicBoolean(false);
    private static final AtomicBoolean again = new AtomicBoolean(false);

    static class Item {
        String key; // "i123:2048:1700000000" = photo id 123, its size and modified time (remembered once on the PC)
        String legacyKey; // "i123": how app 1.x remembered it
        Uri uri;
        String name;
        String folder;
        long size;
        long added;
        long taken; // when the photo was taken (ms), so the PC can put it in the right trip
    }

    public static boolean hasPermission(Context c) {
        if (Build.VERSION.SDK_INT >= 33) {
            return c.checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
                    && c.checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED;
        }
        return c.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    // Lets the app read photos exactly as the camera saved them, location included.
    // (Without it Android hands over a copy with the location removed: not the original.)
    static boolean canReadOriginals(Context c) {
        return Build.VERSION.SDK_INT < 29 || c.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static Uri original(Context c, Uri uri) {
        if (Build.VERSION.SDK_INT >= 29 && canReadOriginals(c)) return MediaStore.setRequireOriginal(uri);
        return uri;
    }

    public static String deviceName(Context c) {
        String name = null;
        try {
            name = android.provider.Settings.Global.getString(c.getContentResolver(), "device_name");
        } catch (Exception ignored) {
        }
        if (name == null || name.trim().isEmpty()) {
            String model = Build.MODEL;
            name = model.toLowerCase().startsWith(Build.MANUFACTURER.toLowerCase()) ? model : Build.MANUFACTURER + " " + model;
        }
        return name.trim();
    }

    public static void run(Context context, Stop stop) {
        if (!running.compareAndSet(false, true)) {
            android.util.Log.i("PuneetSync", "a round is already running; it will look again");
            again.set(true); // a run is already going; it will look again before stopping
            return;
        }
        try {
            do {
                again.set(false);
                runOnce(context.getApplicationContext(), stop);
            } while (again.get() && !stop.stopped());
        } finally {
            running.set(false);
        }
    }

    private static void runOnce(Context c, Stop stop) {
        Settings s = Settings.of(c);
        if (!s.isSignedIn() || s.paused()) return;
        if (!hasPermission(c)) {
            s.finishedRun(s.pending(), "Allow Puneet Studios to see your photos and videos");
            report(c, s);
            return;
        }
        Set<String> done = loadDone(c);
        String device = deviceName(c);
        String error = null;
        boolean relogged = false;
        List<Item> items = scan(c, s.since(), done);
        android.util.Log.i("PuneetSync", "scan: " + items.size() + " to send (since=" + s.since() + ", done=" + done.size() + ")");
        long pending = items.size();
        s.finishedRun(pending, s.error());

        for (int i = 0; i < items.size(); i++) {
            if (stop.stopped() || Settings.of(c).paused()) break;
            Item item = items.get(i);
            try {
                upload(c, s, device, item, stop);
                if (stop.stopped()) break;
                markDone(c, item.key);
                pending--;
                s.uploaded(item.name);
                s.finishedRun(pending, null);
                SyncService.refresh(c);
                if (pending % 10 == 0) report(c, s);
            } catch (Api.AuthException e) {
                // The PC's password changed or the login expired: sign in again once.
                if (!relogged && relogin(s)) {
                    relogged = true;
                    i--;
                    continue;
                }
                error = "The PC rejected the login. Open the app and sign in again.";
                break;
            } catch (Api.ServerException e) {
                android.util.Log.w("PuneetSync", "PC said no for " + item.name + ": " + e.getMessage());
                error = e.getMessage();
                if (e.status == 507) break; // PC full: no point trying the rest
                // Anything else (e.g. 422: arrived damaged): this file is tried again next round.
            } catch (SecurityException e) {
                error = "Allow Puneet Studios to see your photos and videos";
                break;
            } catch (IOException e) {
                android.util.Log.w("PuneetSync", "send failed: " + item.name, e);
                // Lost the connection or the file vanished. Try again on the next run.
                error = "Can't reach the studio PC right now. It will retry by itself.";
                break;
            }
        }
        s.finishedRun(pending, error);
        report(c, s);
    }

    /** How many photos/videos on the phone the PC doesn't have yet (for the status screen). */
    public static int countWaiting(Context c) {
        if (!hasPermission(c)) return 0;
        return scan(c, Settings.of(c).since(), loadDone(c)).size();
    }

    /** Photos/videos this app backed up that are still on the phone AND that the PC confirms it has. */
    public static List<Item> freeable(Context c) throws IOException {
        Set<String> done = loadDone(c);
        List<Item> onPhone = new ArrayList<>();
        query(c, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "i", 0, new HashSet<String>(), onPhone);
        query(c, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "v", 0, new HashSet<String>(), onPhone);
        List<Item> backedUp = new ArrayList<>();
        for (Item i : onPhone) if (done.contains(i.key) || done.contains(i.legacyKey)) backedUp.add(i);
        List<Item> safe = new ArrayList<>();
        Settings s = Settings.of(c);
        for (int from = 0; from < backedUp.size(); from += 500) {
            List<Item> batch = backedUp.subList(from, Math.min(backedUp.size(), from + 500));
            org.json.JSONArray items = new org.json.JSONArray();
            try {
                for (Item i : batch) items.put(new JSONObject().put("name", i.name).put("size", i.size));
                JSONObject body = new JSONObject().put("action", "verify").put("items", items);
                org.json.JSONArray present;
                try {
                    present = new Api(s.server(), s.cookie()).postJson("/api/sync", body).json.getJSONArray("present");
                } catch (Api.AuthException e) {
                    if (!relogin(s)) throw e;
                    present = new Api(s.server(), Settings.of(c).cookie()).postJson("/api/sync", body).json.getJSONArray("present");
                }
                for (int k = 0; k < batch.size(); k++) if (present.optBoolean(k)) safe.add(batch.get(k));
            } catch (JSONException e) {
                throw new IOException("Bad answer from the PC");
            }
        }
        return safe;
    }

    private static boolean relogin(Settings s) {
        if (s.password().isEmpty()) return false;
        try {
            s.setCookie(Api.login(s.server(), s.username(), s.password()));
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private static List<Item> scan(Context c, long since, Set<String> done) {
        List<Item> items = new ArrayList<>();
        query(c, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "i", since, done, items);
        query(c, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "v", since, done, items);
        Collections.sort(items, new Comparator<Item>() {
            @Override
            public int compare(Item a, Item b) {
                return Long.compare(b.added, a.added);
            }
        });
        return items;
    }

    private static void query(Context c, Uri table, String prefix, long since, Set<String> done, List<Item> out) {
        String[] cols = {
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_ADDED,
            MediaStore.Images.ImageColumns.BUCKET_DISPLAY_NAME,
            "datetaken",
            MediaStore.MediaColumns.DATE_MODIFIED,
        };
        String where = MediaStore.MediaColumns.DATE_ADDED + " >= ?";
        // Android 10+: skip files still being written (e.g. a video being recorded).
        if (Build.VERSION.SDK_INT >= 29) where += " AND " + MediaStore.MediaColumns.IS_PENDING + " = 0";
        ContentResolver cr = c.getContentResolver();
        try (Cursor cur = cr.query(table, cols, where, new String[] {String.valueOf(since)}, null)) {
            if (cur == null) return;
            while (cur.moveToNext()) {
                long id = cur.getLong(0);
                long size = cur.getLong(2);
                String key = prefix + id + ":" + size + ":" + cur.getLong(6);
                if (done.contains(key) || done.contains(prefix + id) || size <= 0) continue;
                if (DOWNLOAD_FOLDER.equals(cur.getString(4))) continue; // saved from this app: already on the PC
                Item item = new Item();
                item.key = key;
                item.legacyKey = prefix + id;
                item.uri = ContentUris.withAppendedId(table, id);
                item.name = cur.getString(1);
                item.size = size;
                item.added = cur.getLong(3);
                item.folder = cur.getString(4);
                item.taken = cur.isNull(5) ? 0 : cur.getLong(5); // 0 = unknown: the PC reads it from the file
                if (item.name == null) item.name = key + (prefix.equals("v") ? ".mp4" : ".jpg");
                if (item.folder == null) item.folder = "Other";
                out.add(item);
            }
        }
    }

    private static String uploadId(String device, Item item) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-1");
            byte[] hash = sha.digest((device + "|" + item.key + "|" + item.size).getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            return ("ps" + Math.abs((device + item.key + item.size).hashCode()) + "x00000000").substring(0, 16);
        }
    }

    private static void upload(Context c, Settings s, String device, final Item item, Stop stop) throws IOException {
        Api api = new Api(s.server(), Settings.of(c).cookie());
        String id = uploadId(device, item);
        String sha256 = fingerprint(c, item, stop);
        if (sha256 == null) return; // stopped while reading
        JSONObject start = new JSONObject();
        try {
            start.put("action", "start").put("id", id).put("device", device).put("folder", item.folder)
                    .put("name", item.name).put("size", item.size).put("taken", item.taken).put("sha256", sha256);
        } catch (JSONException ignored) {
        }
        JSONObject reply = api.postJson("/api/sync", start).json;
        if (reply.optBoolean("skip")) return; // already on the PC
        long offset = reply.optLong("offset", 0);
        final Settings progress = Settings.of(c);

        while (offset < item.size) {
            if (stop.stopped()) return;
            // The exact file as saved by the camera: not one byte changed.
            InputStream in = c.getContentResolver().openInputStream(original(c, item.uri));
            if (in == null) throw new IOException("Can't open " + item.name);
            try {
                skipFully(in, offset);
                while (offset < item.size) {
                    if (stop.stopped()) return;
                    long length = Math.min(CHUNK, item.size - offset);
                    final long base = offset;
                    Api.Result r = api.putChunk(id, offset, in, length, new Api.Progress() {
                        long lastPercent = -1;

                        @Override
                        public void sent(long bytes) {
                            long percent = (base + bytes) * 100 / item.size;
                            if (percent != lastPercent) {
                                lastPercent = percent;
                                progress.setProgress(item.name, (int) percent);
                            }
                        }
                    });
                    if (r.json.optBoolean("done")) return;
                    long next = r.json.optLong("offset", offset + length);
                    if (r.status == 409 || next != offset + length) {
                        offset = next; // the PC has a different amount: reopen and continue from there
                        break;
                    }
                    offset = next;
                }
            } finally {
                in.close();
            }
        }
    }

    // SHA-256 of the exact file: the PC uses it to skip duplicates and to check the upload
    // arrived byte for byte.
    private static String fingerprint(Context c, Item item, Stop stop) throws IOException {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            InputStream in = c.getContentResolver().openInputStream(original(c, item.uri));
            if (in == null) throw new IOException("Can't open " + item.name);
            try {
                byte[] buf = new byte[256 * 1024];
                for (int n; (n = in.read(buf)) > 0; ) {
                    if (stop.stopped()) return null;
                    sha.update(buf, 0, n);
                }
            } finally {
                in.close();
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : sha.digest()) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException("SHA-256 missing");
        }
    }

    private static void skipFully(InputStream in, long n) throws IOException {
        byte[] buf = null;
        while (n > 0) {
            long skipped = in.skip(n);
            if (skipped <= 0) {
                if (buf == null) buf = new byte[64 * 1024];
                int read = in.read(buf, 0, (int) Math.min(buf.length, n));
                if (read < 0) throw new IOException("File is shorter than expected");
                skipped = read;
            }
            n -= skipped;
        }
    }

    static void report(Context c, Settings s) {
        try {
            JSONObject body = new JSONObject();
            body.put("action", "report").put("device", deviceName(c)).put("synced", s.synced())
                    .put("pending", s.pending()).put("lastUpload", s.lastUpload()).put("lastName", s.lastName())
                    .put("error", s.error()).put("version", BuildInfo.VERSION).put("wifiOnly", s.wifiOnly());
            new Api(s.server(), s.cookie()).postJson("/api/sync", body);
        } catch (Exception ignored) {
            // Only a status update; the next run sends it again.
        }
    }

    // ----- Which files are already on the PC (MediaStore ids, one per line) -----
    private static File doneFile(Context c) {
        return new File(c.getFilesDir(), "synced.txt");
    }

    static Set<String> loadDone(Context c) {
        Set<String> done = new HashSet<>();
        File f = doneFile(c);
        if (!f.exists()) return done;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            for (String line; (line = r.readLine()) != null; ) if (!line.isEmpty()) done.add(line);
        } catch (IOException ignored) {
        }
        return done;
    }

    private static synchronized void markDone(Context c, String key) throws IOException {
        try (FileWriter w = new FileWriter(doneFile(c), true)) {
            w.write(key + "\n");
        }
    }
}
