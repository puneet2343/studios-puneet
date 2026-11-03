package com.puneetstudios.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

// Talks to Puneet Studios on the PC: the same login and resumable upload the web app uses.
public class Api {
    /** The PC answered 401: the saved login no longer works. */
    public static class AuthException extends IOException {
        AuthException() { super("Not logged in"); }
    }

    /** The PC answered, but said no (e.g. not enough space). */
    public static class ServerException extends IOException {
        public final int status;
        ServerException(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    public static class Result {
        public final int status;
        public final JSONObject json;
        Result(int status, JSONObject json) {
            this.status = status;
            this.json = json;
        }
    }

    public interface Progress {
        void sent(long bytes);
    }

    private final String server;
    private final String cookie;

    public Api(String server, String cookie) {
        this.server = server.replaceAll("/+$", "");
        this.cookie = cookie;
    }

    private HttpURLConnection open(String path, String method) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(server + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(20000);
        c.setReadTimeout(120000);
        c.setUseCaches(false);
        if (cookie != null && !cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        return c;
    }

    private static Result read(HttpURLConnection c) throws IOException {
        int status = c.getResponseCode();
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        String text = "";
        if (in != null) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            in.close();
            text = out.toString("UTF-8");
        }
        JSONObject json;
        try {
            json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } catch (JSONException e) {
            json = new JSONObject();
        }
        c.disconnect();
        if (status == 401) throw new AuthException();
        return new Result(status, json);
    }

    private static void check(Result r) throws ServerException {
        if (r.status >= 400 && r.status != 409) {
            throw new ServerException(r.status, r.json.optString("error", "The PC said error " + r.status));
        }
    }

    public Result postJson(String path, JSONObject body) throws IOException {
        HttpURLConnection c = open(path, "POST");
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setFixedLengthStreamingMode(bytes.length);
        OutputStream out = c.getOutputStream();
        out.write(bytes);
        out.close();
        Result r = read(c);
        check(r);
        return r;
    }

    /** Returns the session cookie ("media_session=…"), or throws if the login is wrong. */
    public static String login(String server, String username, String password) throws IOException {
        Api api = new Api(server, null);
        HttpURLConnection c = api.open("/api/login", "POST");
        JSONObject body = new JSONObject();
        try {
            body.put("username", username).put("password", password);
        } catch (JSONException ignored) {
        }
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        c.setFixedLengthStreamingMode(bytes.length);
        OutputStream out = c.getOutputStream();
        out.write(bytes);
        out.close();
        String setCookie = c.getHeaderField("Set-Cookie");
        Result r;
        try {
            r = read(c);
        } catch (AuthException e) {
            throw new ServerException(401, "Wrong username or password");
        }
        check(r);
        if (setCookie == null || !setCookie.contains("=")) throw new IOException("The PC didn't send a login");
        return setCookie.split(";", 2)[0];
    }

    /** Sends the next `length` bytes of `in` as one piece. Returns the PC's reply. */
    public Result putChunk(String id, long offset, InputStream in, long length, Progress progress) throws IOException {
        String q = "/api/upload?id=" + URLEncoder.encode(id, "UTF-8") + "&offset=" + offset;
        HttpURLConnection c = open(q, "PUT");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/octet-stream");
        c.setFixedLengthStreamingMode(length);
        OutputStream out = c.getOutputStream();
        byte[] buf = new byte[64 * 1024];
        long left = length;
        while (left > 0) {
            int n = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (n < 0) throw new IOException("The file got shorter while uploading");
            out.write(buf, 0, n);
            left -= n;
            if (progress != null) progress.sent(length - left);
        }
        out.close();
        Result r = read(c);
        check(r);
        return r;
    }
}
