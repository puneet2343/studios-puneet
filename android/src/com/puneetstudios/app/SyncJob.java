package com.puneetstudios.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.provider.MediaStore;

// Android wakes this up by itself:
//  - WATCH: the moment a new photo or video is saved anywhere on the phone
//    (camera, WhatsApp, screenshots, downloads…). It fires once, so it is set again after each run.
//  - REGULAR: every 15 minutes as a safety net (and to carry on big uploads Android paused).
//  - NOW: the "Sync now" button.
public class SyncJob extends JobService {
    static final int WATCH = 1;
    static final int REGULAR = 2;
    static final int NOW = 3;

    private volatile boolean stopped;

    @Override
    public boolean onStartJob(final JobParameters params) {
        stopped = false;
        // Safety net: bring the always-on backup back if Android stopped it.
        if (!SyncService.running) SyncService.start(this);
        new Thread(new Runnable() {
            @Override
            public void run() {
                SyncEngine.run(SyncJob.this, new SyncEngine.Stop() {
                    @Override
                    public boolean stopped() {
                        return stopped;
                    }
                });
                if (!SyncService.running) Health.probe(SyncJob.this);
                jobFinished(params, false);
                // Watch for the next new photo. (Re-arming before finishing would cancel this very run.)
                if (params.getJobId() == WATCH) scheduleWatch(SyncJob.this);
            }
        }, "puneet-sync").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        // Android needs the phone back (battery saver, lost signal…): stop after this piece,
        // and run again later (returning true asks for that). The upload resumes where it stopped.
        stopped = true;
        return true;
    }

    private static int network(Context context) {
        return Settings.of(context).wifiOnly() ? JobInfo.NETWORK_TYPE_UNMETERED : JobInfo.NETWORK_TYPE_ANY;
    }

    private static JobScheduler scheduler(Context context) {
        return (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
    }

    static void scheduleWatch(Context context) {
        JobInfo job = new JobInfo.Builder(WATCH, new ComponentName(context, SyncJob.class))
                .addTriggerContentUri(new JobInfo.TriggerContentUri(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI, JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS))
                .addTriggerContentUri(new JobInfo.TriggerContentUri(
                        MediaStore.Video.Media.EXTERNAL_CONTENT_URI, JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS))
                // Wait a few seconds so a burst of photos goes up in one go.
                .setTriggerContentUpdateDelay(3000)
                .setTriggerContentMaxDelay(20000)
                .setRequiredNetworkType(network(context))
                .build();
        scheduler(context).schedule(job);
    }

    /** Sets up both background jobs. `force` re-creates the 15-minute one (e.g. Wi-Fi setting changed). */
    static void schedule(Context context, boolean force) {
        scheduleWatch(context);
        JobScheduler js = scheduler(context);
        JobInfo existing = js.getPendingJob(REGULAR);
        if (existing == null || force || existing.getNetworkType() != network(context)) {
            js.schedule(new JobInfo.Builder(REGULAR, new ComponentName(context, SyncJob.class))
                    .setPeriodic(15 * 60 * 1000L)
                    .setPersisted(true)
                    .setRequiredNetworkType(network(context))
                    .build());
        }
    }

    static void syncNow(Context context) {
        scheduler(context).schedule(new JobInfo.Builder(NOW, new ComponentName(context, SyncJob.class))
                .setRequiredNetworkType(network(context))
                .build());
    }

    static void cancelAll(Context context) {
        scheduler(context).cancelAll();
    }
}
