package com.kyy.ddlreminder;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidRecents")
public class AndroidRecentsPlugin extends Plugin {
    private static final String PREFERENCES_NAME = "ddl_recents_settings";
    private static final String EXCLUDED_KEY = "excluded_from_recents";

    @PluginMethod
    public void getExcluded(PluginCall call) {
        resolveExcluded(call, isExcluded(getContext()));
    }

    @PluginMethod
    public void setExcluded(PluginCall call) {
        Boolean excluded = call.getBoolean("excluded");

        if (excluded == null) {
            call.reject("后台卡片设置有误，请重试。");
            return;
        }

        Activity activity = getActivity();

        if (activity == null) {
            call.reject("后台卡片设置暂时无法更改，请重试。");
            return;
        }

        boolean previousValue = isExcluded(getContext());
        SharedPreferences preferences = getPreferences(getContext());

        activity.runOnUiThread(() -> {
            if (!applyExcluded(activity, excluded)) {
                call.reject("没能找到当前的后台卡片，请重试。");
                return;
            }

            if (!preferences.edit().putBoolean(EXCLUDED_KEY, excluded).commit()) {
                applyExcluded(activity, previousValue);
                call.reject("后台卡片设置没能保存，请重试。");
                return;
            }

            resolveExcluded(call, excluded);
        });
    }

    static void applySavedPreference(Activity activity) {
        applyExcluded(activity, isExcluded(activity));
    }

    private static boolean isExcluded(Context context) {
        return getPreferences(context).getBoolean(EXCLUDED_KEY, false);
    }

    private static SharedPreferences getPreferences(Context context) {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    @SuppressWarnings("deprecation")
    private static boolean applyExcluded(Activity activity, boolean excluded) {
        ActivityManager activityManager =
            (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);

        if (activityManager == null) {
            return false;
        }

        int currentTaskId = activity.getTaskId();

        try {
            for (ActivityManager.AppTask appTask : activityManager.getAppTasks()) {
                ActivityManager.RecentTaskInfo taskInfo = appTask.getTaskInfo();
                int taskId = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? taskInfo.taskId
                    : taskInfo.id;

                if (taskId != currentTaskId) {
                    continue;
                }

                appTask.setExcludeFromRecents(excluded);
                return true;
            }
        } catch (RuntimeException ignored) {
            return false;
        }

        return false;
    }

    private static void resolveExcluded(PluginCall call, boolean excluded) {
        JSObject result = new JSObject();
        result.put("excluded", excluded);
        call.resolve(result);
    }
}
