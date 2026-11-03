package com.puneetstudios.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.List;

// The whole Puneet Studios app in one window: the library, albums, map and settings are
// the same screens as the website (served by the studio PC over Tailscale), and this
// native shell adds what a website can't do: back up every new photo/video by itself
// (SyncJob), free up space on the phone, and save downloads straight to the phone.
public class MainActivity extends Activity {
    static final int REQ_FILES = 10;
    static final int REQ_DELETE = 11;
    static final int REQ_PERMS = 12;

    private FrameLayout root;
    private WebView web;
    private View errorView;
    private Bridge bridge;
    private AppLock lock;
    private ValueCallback<Uri[]> fileCallback;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private boolean dark = true;
    private boolean loadFailed = false;
    // While the PC can't be reached, try again by itself every few seconds.
    private final Runnable retry = new Runnable() {
        @Override
        public void run() {
            if (errorView == null) return;
            web.loadUrl(Settings.of(MainActivity.this).server());
            root.postDelayed(this, 5000);
        }
    };

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#09090B"));
        // Keep the web page clear of the status bar, gesture bar and keyboard.
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int top, bottom, left, right;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    top = bars.top;
                    left = bars.left;
                    right = bars.right;
                    bottom = Math.max(bars.bottom, ime.bottom);
                } else {
                    top = insets.getSystemWindowInsetTop();
                    left = insets.getSystemWindowInsetLeft();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                v.setPadding(customView != null ? 0 : left, customView != null ? 0 : top, customView != null ? 0 : right, customView != null ? 0 : bottom);
                return insets;
            }
        });

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " PuneetStudiosApp/" + BuildInfo.VERSION);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setBackgroundColor(Color.TRANSPARENT);

        bridge = new Bridge(this, web);
        web.addJavascriptInterface(bridge, "PuneetApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                Uri home = Uri.parse(Settings.of(MainActivity.this).server());
                if (home.getHost() != null && home.getHost().equalsIgnoreCase(url.getHost())) return false;
                // Links to other sites (e.g. the map's credits) open in the browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (!url.startsWith("about:")) loadFailed = false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    loadFailed = true;
                    showError();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Only hide the "can't reach" screen once the app really loaded.
                if (errorView != null && !loadFailed && !url.startsWith("about:")) {
                    root.removeView(errorView);
                    errorView = null;
                    root.removeCallbacks(retry);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/*", "video/*"});
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(pick, "Upload photos & videos"), REQ_FILES);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            // Full-screen video.
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                root.requestApplyInsets();
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                root.removeView(customView);
                customView = null;
                web.setVisibility(View.VISIBLE);
                applyBars();
                if (customCallback != null) customCallback.onCustomViewHidden();
                root.requestApplyInsets();
            }
        });
        // Downloads: the original file, saved to Downloads/Puneet Studios on the phone.
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> download(url, disposition, mime));

        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        applyBars();
        // Fingerprint / PIN before anything is shown (stays open 10 minutes after unlocking).
        lock = new AppLock(this, root);
        lock.check();
        keepCacheSmall();
        web.loadUrl(Settings.of(this).server());
        if (Settings.of(this).isSignedIn()) {
            SyncJob.schedule(this, false);
            SyncService.start(this);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (lock != null) lock.check();
        Updater.check(this, false, null);
        if (Settings.of(this).isSignedIn()) SyncService.start(this);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            if (customCallback != null) customCallback.onCustomViewHidden();
            return;
        }
        // The web app keeps a Back step for every open photo, menu or dialog.
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    // ----- Status/navigation bar colours follow the app's light/dark theme -----
    void setDark(boolean on) {
        dark = on;
        runOnUiThread(this::applyBars);
    }

    private void applyBars() {
        int bg = Color.parseColor(dark ? "#09090B" : "#FFFFFF");
        root.setBackgroundColor(bg);
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        int flags = 0;
        if (!dark) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    // ----- Can't reach the PC -----
    private void showError() {
        if (errorView != null) return;
        root.removeCallbacks(retry);
        root.postDelayed(retry, 5000);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));
        box.setBackgroundColor(Color.parseColor(dark ? "#09090B" : "#FFFFFF"));
        int text = Color.parseColor(dark ? "#FAFAFA" : "#18181B");
        int muted = Color.parseColor("#8A8A93");

        View logo = new View(this);
        logo.setBackgroundResource(R.mipmap.ic_launcher);
        box.addView(logo, new LinearLayout.LayoutParams(dp(72), dp(72)));
        TextView title = new TextView(this);
        title.setText("Can't reach your PC");
        title.setTextSize(22);
        title.setTextColor(text);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(20), 0, dp(6));
        box.addView(title);
        TextView hint = new TextView(this);
        hint.setText("Turn on Tailscale on this phone and make sure Puneet Studios is running on the PC. Trying again by itself every few seconds.");
        hint.setTextSize(15);
        hint.setTextColor(muted);
        hint.setGravity(Gravity.CENTER);
        box.addView(hint);

        final EditText address = new EditText(this);
        address.setText(Settings.of(this).server());
        address.setTextColor(text);
        address.setTextSize(14);
        address.setSingleLine(true);
        address.setVisibility(View.GONE);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        ap.setMargins(0, dp(16), 0, 0);
        box.addView(address, ap);

        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setAllCaps(false);
        retry.setTextColor(Color.WHITE);
        retry.setTextSize(16);
        android.graphics.drawable.GradientDrawable pill = new android.graphics.drawable.GradientDrawable();
        pill.setColor(Color.parseColor("#4F46E5"));
        pill.setCornerRadius(dp(28));
        retry.setBackground(pill);
        retry.setStateListAnimator(null);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        rp.setMargins(0, dp(24), 0, dp(8));
        box.addView(retry, rp);
        retry.setOnClickListener(v -> {
            String a = address.getText().toString().trim().replaceAll("/+$", "");
            if (!a.isEmpty() && !a.equals(Settings.of(this).server())) Settings.of(this).setServer(a);
            web.loadUrl(Settings.of(this).server());
        });

        TextView change = new TextView(this);
        change.setText("Change PC address");
        change.setTextColor(Color.parseColor("#8B93FF"));
        change.setTextSize(14);
        change.setGravity(Gravity.CENTER);
        change.setPadding(0, dp(12), 0, dp(12));
        change.setOnClickListener(v -> address.setVisibility(View.VISIBLE));
        box.addView(change);

        errorView = box;
        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    // ----- Downloads -----
    private void download(String url, String disposition, String mime) {
        String name = null;
        if (disposition != null) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("filename\\*=UTF-8''([^;]+)").matcher(disposition);
            if (m.find()) {
                try {
                    name = URLDecoder.decode(m.group(1), "UTF-8");
                } catch (Exception ignored) {
                }
            }
        }
        if (name == null) name = URLUtil.guessFileName(url, disposition, mime);
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) r.addRequestHeader("Cookie", cookie);
            r.setTitle(name);
            r.setMimeType(mime);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, SyncEngine.DOWNLOAD_FOLDER + "/" + name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Downloading the original: " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Couldn't start the download", Toast.LENGTH_LONG).show();
        }
    }

    // ----- Permissions -----
    void askPhotoPermission() {
        List<String> wanted = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            wanted.add(Manifest.permission.READ_MEDIA_IMAGES);
            wanted.add(Manifest.permission.READ_MEDIA_VIDEO);
        } else {
            wanted.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        // Without this, Android strips the location out of photos as the app reads them,
        // which would change the files (and leave the Map empty).
        if (Build.VERSION.SDK_INT >= 29) wanted.add(Manifest.permission.ACCESS_MEDIA_LOCATION);
        // The small "All backed up" notification of the always-on backup.
        if (Build.VERSION.SDK_INT >= 33) wanted.add(Manifest.permission.POST_NOTIFICATIONS);
        boolean asked = getSharedPreferences("ui", MODE_PRIVATE).getBoolean("askedPermission", false);
        if (asked && !SyncEngine.hasPermission(this) && !shouldShowRequestPermissionRationale(wanted.get(0))) {
            startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
            return;
        }
        getSharedPreferences("ui", MODE_PRIVATE).edit().putBoolean("askedPermission", true).apply();
        requestPermissions(wanted.toArray(new String[0]), REQ_PERMS);
    }

    void askBackground() {
        try {
            startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (!SyncEngine.hasPermission(this)) return;
        SyncService.start(this);
        // Once: ask to run unrestricted, so backup keeps going while the screen is off.
        android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
        boolean asked = getSharedPreferences("ui", MODE_PRIVATE).getBoolean("askedBattery", false);
        if (!asked && pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            getSharedPreferences("ui", MODE_PRIVATE).edit().putBoolean("askedBattery", true).apply();
            askBackground();
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILES) {
            Uri[] picked = null;
            if (result == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    picked = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) picked[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    picked = new Uri[] {data.getData()};
                }
            }
            if (fileCallback != null) fileCallback.onReceiveValue(picked);
            fileCallback = null;
        } else if (code == REQ_DELETE) {
            bridge.onDeleted(result == RESULT_OK);
        }
    }

    // The app should never grow on its own: originals are never cached (the PC says so),
    // and if the browser cache still passes 100 MB it's cleared (sign-in and settings stay).
    // A leftover downloaded update is removed too.
    private void keepCacheSmall() {
        new java.io.File(getCacheDir(), "update.apk").delete();
        new Thread(() -> {
            long size = folderSize(getCacheDir());
            if (size > 100L * 1024 * 1024) runOnUiThread(() -> web.clearCache(true));
        }).start();
    }

    private static long folderSize(java.io.File f) {
        if (f.isFile()) return f.length();
        long total = 0;
        java.io.File[] list = f.listFiles();
        if (list != null) for (java.io.File c : list) total += folderSize(c);
        return total;
    }

    int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
