package com.kyy.ddlreminder;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Set;

final class DdlAlarmStore {
    private static final String STORE_NAME = "ddl_alarm_store";
    private static final String ALARM_IDS_KEY = "alarm_ids";

    private DdlAlarmStore() {}

    static void removeAlarmId(Context context, int id) {
        Set<String> ids = getAlarmIdSet(context);
        ids.remove(Integer.toString(id));
        saveAlarmIdSet(context, ids);
    }

    static Set<Integer> getAlarmIds(Context context) {
        Set<Integer> ids = new HashSet<>();

        for (String storedId : getAlarmIdSet(context)) {
            try {
                ids.add(Integer.parseInt(storedId));
            } catch (NumberFormatException ignored) {}
        }

        return ids;
    }

    static void clearAlarmIds(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(STORE_NAME, Context.MODE_PRIVATE);
        preferences.edit().remove(ALARM_IDS_KEY).apply();
    }

    private static Set<String> getAlarmIdSet(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(STORE_NAME, Context.MODE_PRIVATE);
        Set<String> storedIds = preferences.getStringSet(ALARM_IDS_KEY, null);

        return storedIds == null ? new HashSet<>() : new HashSet<>(storedIds);
    }

    private static void saveAlarmIdSet(Context context, Set<String> ids) {
        SharedPreferences preferences = context.getSharedPreferences(STORE_NAME, Context.MODE_PRIVATE);
        preferences.edit().putStringSet(ALARM_IDS_KEY, ids).apply();
    }
}
