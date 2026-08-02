package com.kyy.ddlreminder;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Set;

@CapacitorPlugin(name = "DdlAlarms")
public class DdlAlarmPlugin extends Plugin {
    @Override
    public void load() {
        super.load();
        cancelAllLegacyAlarms();
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        JSObject result = new JSObject();
        result.put("cancelled", cancelAllLegacyAlarms());
        call.resolve(result);
    }

    private int cancelAllLegacyAlarms() {
        AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);

        if (alarmManager == null) {
            return 0;
        }

        Set<Integer> alarmIds = DdlAlarmStore.getAlarmIds(getContext());

        for (int id : alarmIds) {
            cancelLegacyAlarm(alarmManager, id);
        }

        DdlAlarmStore.clearAlarmIds(getContext());
        return alarmIds.size();
    }

    private void cancelLegacyAlarm(AlarmManager alarmManager, int id) {
        Intent alarmIntent = new Intent(getContext(), DdlAlarmReceiver.class);
        alarmIntent.setAction(DdlAlarmReceiver.ACTION_DDL_ALARM);

        PendingIntent alarmPendingIntent = PendingIntent.getBroadcast(
            getContext(),
            id,
            alarmIntent,
            DdlAlarmReceiver.pendingIntentFlags(PendingIntent.FLAG_NO_CREATE)
        );

        if (alarmPendingIntent != null) {
            alarmManager.cancel(alarmPendingIntent);
            alarmPendingIntent.cancel();
        }
    }
}
