package com.puneetstudios.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// After the phone restarts (or the app is updated), start watching for new media again.
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Settings.of(context).isSignedIn()) return;
        SyncJob.schedule(context, true);
        SyncService.start(context); // back to always-on backup after a restart or app update
    }
}
