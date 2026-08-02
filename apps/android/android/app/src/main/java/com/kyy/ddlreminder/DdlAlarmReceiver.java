package com.kyy.ddlreminder;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Migration-only receiver for alarms created by app version 1.0.
 *
 * New reminders are handled exclusively by Capacitor Local Notifications.
 * A legacy alarm that races with the first post-upgrade launch is discarded
 * here so it cannot recreate the old alarm-style notification behavior.
 */
public class DdlAlarmReceiver extends BroadcastReceiver {
    static final String ACTION_DDL_ALARM = "com.kyy.ddlreminder.action.DDL_ALARM";
    static final String EXTRA_ID = "id";

    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra(EXTRA_ID, Integer.MIN_VALUE);

        if (id != Integer.MIN_VALUE) {
            DdlAlarmStore.removeAlarmId(context, id);
        }
    }

    static int pendingIntentFlags(int baseFlags) {
        return baseFlags | PendingIntent.FLAG_IMMUTABLE;
    }
}
