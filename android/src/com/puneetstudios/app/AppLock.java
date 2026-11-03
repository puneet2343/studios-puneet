package com.puneetstudios.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.security.MessageDigest;

// Locks the app (not the background backup) behind the fingerprint, with a PIN as the
// other way in. After unlocking it stays open for 1 hour, even if you leave and come
// back, then asks again. "Lock now" in the app locks it straight away.
public class AppLock {
    private static final long OPEN_FOR_MS = 60 * 60 * 1000L; // open for 1 hour after unlocking
    // SHA-256 of the PIN (from android/secrets.properties at build time, never in the code).
    private static final String PIN_SHA256 = Secrets.PIN_SHA256;
    private static final int MAX_TRIES = 5;

    private final MainActivity activity;
    private final FrameLayout root;
    private FrameLayout screen;
    private TextView dots;
    private TextView message;
    private final StringBuilder entered = new StringBuilder();
    private CancellationSignal cancel;
    // True while Android's fingerprint prompt is on screen. Closing the prompt brings the app
    // back to the front, which would otherwise ask again before the "accepted" answer lands.
    private boolean prompting = false;
    private int wrong = 0;
    private long blockedUntil = 0;

    AppLock(MainActivity activity, FrameLayout root) {
        this.activity = activity;
        this.root = root;
    }

    private SharedPreferences prefs() {
        return activity.getSharedPreferences("lock", Context.MODE_PRIVATE);
    }

    boolean isOpen() {
        long at = prefs().getLong("unlockedAt", 0);
        long now = System.currentTimeMillis();
        return at > 0 && now >= at && now - at < OPEN_FOR_MS;
    }

    /** Called when the app comes to the front: lock if the 10 minutes are up. */
    void check() {
        if (isOpen()) {
            hide();
            return;
        }
        if (prompting) return;
        show();
    }

    /** "Lock now": ask for the fingerprint / PIN again right away. */
    void lockNow() {
        prefs().edit().putLong("unlockedAt", 0).apply();
        show();
    }

    private void unlocked() {
        prefs().edit().putLong("unlockedAt", System.currentTimeMillis()).apply();
        wrong = 0;
        hide();
    }

    private void hide() {
        if (cancel != null && prompting) cancel.cancel();
        cancel = null;
        prompting = false;
        if (screen != null) {
            root.removeView(screen);
            screen = null;
        }
    }

    static boolean fingerprintAvailable(Context c) {
        if (Build.VERSION.SDK_INT < 29) return Build.VERSION.SDK_INT >= 28;
        BiometricManager bm = c.getSystemService(BiometricManager.class);
        if (bm == null) return false;
        if (Build.VERSION.SDK_INT >= 30) {
            return bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS;
        }
        return bm.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private void askFingerprint() {
        if (Build.VERSION.SDK_INT < 28 || !fingerprintAvailable(activity)) {
            setMessage("Enter your PIN", false);
            return;
        }
        if (prompting) return;
        cancel = new CancellationSignal();
        BiometricPrompt.Builder b = new BiometricPrompt.Builder(activity)
                .setTitle("Unlock Puneet Studios")
                .setSubtitle("Touch the fingerprint sensor")
                .setNegativeButton("Use PIN", activity.getMainExecutor(), (d, w) -> {
                    prompting = false;
                    setMessage("Enter your PIN", false);
                });
        if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK);
        try {
            prompting = true;
            b.build().authenticate(cancel, activity.getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    prompting = false;
                    unlocked();
                }

                @Override
                public void onAuthenticationError(int code, CharSequence text) {
                    prompting = false;
                    setMessage("Enter your PIN", false);
                }
            });
        } catch (Exception e) {
            prompting = false;
            setMessage("Enter your PIN", false);
        }
    }

    // ----- The lock screen: logo, PIN dots and a number pad -----
    private void show() {
        if (screen == null) build();
        askFingerprint();
    }

    private int dp(int v) {
        return activity.dp(v);
    }

    private void build() {
        int bg = Color.parseColor("#09090B");
        int text = Color.parseColor("#FAFAFA");
        int muted = Color.parseColor("#A1A1AA");
        screen = new FrameLayout(activity);
        screen.setBackgroundColor(bg);
        screen.setClickable(true); // nothing behind it can be touched

        LinearLayout col = new LinearLayout(activity);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(24), dp(72), dp(24), dp(32));

        View logo = new View(activity);
        logo.setBackgroundResource(R.mipmap.ic_launcher);
        col.addView(logo, new LinearLayout.LayoutParams(dp(72), dp(72)));

        TextView title = new TextView(activity);
        title.setText("Puneet Studios");
        title.setTextColor(text);
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(16), 0, dp(4));
        col.addView(title);

        message = new TextView(activity);
        message.setTextColor(muted);
        message.setTextSize(15);
        message.setGravity(Gravity.CENTER);
        message.setText(fingerprintAvailable(activity) ? "Use your fingerprint or enter your PIN" : "Enter your PIN");
        col.addView(message);

        dots = new TextView(activity);
        dots.setTextColor(text);
        dots.setTextSize(30);
        dots.setGravity(Gravity.CENTER);
        dots.setLetterSpacing(0.5f);
        dots.setPadding(0, dp(28), 0, dp(28));
        col.addView(dots);
        drawDots();

        GridLayout pad = new GridLayout(activity);
        pad.setColumnCount(3);
        String[] keys = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "fp", "0", "del"};
        for (String k : keys) pad.addView(key(k));
        col.addView(pad, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        screen.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(screen, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private View key(final String k) {
        TextView b = new TextView(activity);
        b.setGravity(Gravity.CENTER);
        b.setTextColor(Color.parseColor("#FAFAFA"));
        b.setTextSize(k.length() == 1 ? 28 : 15);
        b.setText(k.equals("fp") ? (fingerprintAvailable(activity) ? "Fingerprint" : "") : k.equals("del") ? "⌫" : k);
        if (k.equals("del")) b.setTextSize(24);
        if (k.length() == 1) {
            GradientDrawable circle = new GradientDrawable();
            circle.setShape(GradientDrawable.OVAL);
            circle.setColor(Color.parseColor("#1B1B1F"));
            b.setBackground(circle);
        }
        GridLayout.LayoutParams lp = new GridLayout.LayoutParams();
        lp.width = dp(80);
        lp.height = dp(80);
        lp.setMargins(dp(10), dp(8), dp(10), dp(8));
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> press(k));
        b.setContentDescription(k.equals("fp") ? "Use fingerprint" : k.equals("del") ? "Delete" : k);
        return b;
    }

    private void press(String k) {
        if (k.equals("fp")) {
            askFingerprint();
            return;
        }
        if (System.currentTimeMillis() < blockedUntil) {
            setMessage("Too many tries. Wait a moment.", true);
            return;
        }
        if (k.equals("del")) {
            if (entered.length() > 0) entered.deleteCharAt(entered.length() - 1);
        } else if (entered.length() < 6) {
            entered.append(k);
        }
        drawDots();
        if (entered.length() == 6) {
            if (sha256(entered.toString()).equals(PIN_SHA256)) {
                entered.setLength(0);
                unlocked();
            } else {
                entered.setLength(0);
                wrong++;
                if (wrong >= MAX_TRIES) {
                    wrong = 0;
                    blockedUntil = System.currentTimeMillis() + 30000;
                    setMessage("Wrong PIN. Try again in 30 seconds.", true);
                } else {
                    setMessage("Wrong PIN. Try again.", true);
                }
                screen.animate().translationX(dp(12)).setDuration(60).withEndAction(() -> screen.animate().translationX(0).setDuration(60).start()).start();
                drawDots();
            }
        }
    }

    private void drawDots() {
        StringBuilder d = new StringBuilder();
        for (int i = 0; i < 6; i++) d.append(i < entered.length() ? "●" : "○");
        dots.setText(d.toString());
    }

    private void setMessage(String m, boolean error) {
        if (message == null) return;
        message.setText(m);
        message.setTextColor(Color.parseColor(error ? "#F87171" : "#A1A1AA"));
    }

    static String sha256(String s) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(s.getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder();
            for (byte b : h) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            return "";
        }
    }
}
