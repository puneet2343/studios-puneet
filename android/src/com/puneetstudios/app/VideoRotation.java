package com.puneetstudios.app;

import android.content.pm.ActivityInfo;
import android.hardware.SensorManager;
import android.os.SystemClock;
import android.view.OrientationEventListener;

/**
 * YouTube-style rotation for videos.
 *
 * While a sideways (landscape) video is open, the phone's tilt is watched: hold the phone
 * sideways and the video fills the screen (bars hidden), hold it upright and it goes back
 * to the watch page. This works even with the phone's own auto-rotate switched off, like
 * the YouTube app.
 *
 * In full screen ({@link #enterFullScreen}) the screen follows the phone ANY way it is
 * turned (all four directions), ignoring the phone's rotation lock, like YouTube. A sideways
 * video starts sideways straight away; once the phone has been turned sideways, it follows
 * freely. Leaving full screen keeps the screen upright until the phone is held upright once.
 */
final class VideoRotation {
    interface Listener {
        void onSideways(boolean sideways);
    }

    private static final long STEADY_MS = 350; // the phone must stay at an angle this long

    private final MainActivity activity;
    private final Listener listener;
    private OrientationEventListener sensor;
    private boolean watching;
    private boolean full; // a video is in full screen
    private boolean free; // full screen: following the phone in every direction
    private boolean sideways; // what the screen shows now
    private boolean forced; // full-screen button: wait for a real sideways turn
    private boolean seenSideways;
    private boolean holdUpright; // left full screen: wait for the phone to be upright once
    private int pending = -1;
    private long pendingSince;

    VideoRotation(MainActivity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    /** A sideways video is open (true) or closed (false). */
    void watch(boolean on) {
        watching = on;
        if (on) {
            if (sensor == null) {
                sensor = new OrientationEventListener(activity, SensorManager.SENSOR_DELAY_UI) {
                    @Override
                    public void onOrientationChanged(int degrees) {
                        onAngle(degrees);
                    }
                };
            }
            if (sensor.canDetectOrientation()) sensor.enable();
        } else {
            if (sensor != null && !full) sensor.disable();
            forced = false;
            holdUpright = false;
            if (sideways && !full) apply(false, false);
        }
    }

    /** A video went full screen: follow the phone any way it's turned. */
    void enterFullScreen(boolean wide) {
        full = true;
        holdUpright = false;
        free = !wide; // a sideways video starts sideways, then follows freely
        if (sensor == null) {
            sensor = new OrientationEventListener(activity, SensorManager.SENSOR_DELAY_UI) {
                @Override
                public void onOrientationChanged(int degrees) {
                    onAngle(degrees);
                }
            };
        }
        if (sensor.canDetectOrientation()) sensor.enable();
        sideways = wide;
        activity.runOnUiThread(() -> activity.setRequestedOrientation(wide ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR));
    }

    /** Left full screen with the button or Back. */
    void leftFullScreen() {
        boolean was = full;
        full = false;
        free = false;
        forced = false;
        holdUpright = watching;
        if (!watching && sensor != null) sensor.disable();
        if (sideways || was) apply(false, false);
    }

    boolean isFull() {
        return full;
    }

    void pause() {
        if (sensor != null) sensor.disable();
    }

    void resume() {
        if ((watching || full) && sensor != null && sensor.canDetectOrientation()) sensor.enable();
    }

    private void onAngle(int degrees) {
        if (degrees == OrientationEventListener.ORIENTATION_UNKNOWN) return; // lying flat
        if (full) {
            // Full screen: once the phone has been turned sideways, let it rotate every way.
            boolean side = (degrees >= 60 && degrees <= 120) || (degrees >= 240 && degrees <= 300);
            if (!free && side) {
                free = true;
                activity.runOnUiThread(() -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR));
            }
            return;
        }
        int state;
        if ((degrees >= 60 && degrees <= 120) || (degrees >= 240 && degrees <= 300)) state = 1; // sideways
        else if (degrees <= 25 || degrees >= 335) state = 0; // upright
        else return; // in between: keep what we have
        long now = SystemClock.uptimeMillis();
        if (state != pending) {
            pending = state;
            pendingSince = now;
            return;
        }
        if (now - pendingSince < STEADY_MS) return;

        boolean wantSideways = state == 1;
        if (wantSideways) {
            seenSideways = true;
            if (holdUpright) return;
        } else {
            holdUpright = false;
            if (forced && !seenSideways) return; // pressed full screen while holding it upright
            forced = false;
        }
        if (wantSideways != sideways) apply(wantSideways, true);
    }

    private void apply(boolean on, boolean tell) {
        sideways = on;
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            activity.videoBars(on);
        });
        if (tell) listener.onSideways(on);
    }
}
