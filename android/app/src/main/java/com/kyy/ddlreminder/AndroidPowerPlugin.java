package com.kyy.ddlreminder;

import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "AndroidPower")
public class AndroidPowerPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        SettingsCandidate vendorSettings = findVendorSettingsCandidate();
        JSObject result = new JSObject();
        result.put("batteryOptimizationIgnored", isIgnoringBatteryOptimizations());
        result.put("backgroundRestricted", isBackgroundRestricted());
        result.put("manufacturer", safeBuildValue(Build.MANUFACTURER));
        result.put("brand", safeBuildValue(Build.BRAND));
        result.put("model", safeBuildValue(Build.MODEL));
        result.put("sdkInt", Build.VERSION.SDK_INT);
        result.put("vendorFamily", getVendorFamily());
        result.put("vendorSettingsAvailable", vendorSettings != null);
        result.put(
            "vendorSettingsLabel",
            vendorSettings == null ? getFallbackSettingsLabel() : vendorSettings.label
        );
        call.resolve(result);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (isIgnoringBatteryOptimizations()) {
            JSObject result = new JSObject();
            result.put("opened", false);
            result.put("alreadyAllowed", true);
            call.resolve(result);
            return;
        }

        openBatteryOptimizationSettings(call);
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);

        if (startIntentSafely(intent)) {
            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("destination", "battery-optimization");
            call.resolve(result);
            return;
        }

        resolveAppSettingsCall(call);
    }

    @PluginMethod
    public void openVendorBackgroundSettings(PluginCall call) {
        for (SettingsCandidate candidate : getVendorSettingsCandidates()) {
            Intent launchIntent = resolveSafeExplicitIntent(candidate.intent);

            if (launchIntent != null && startIntentSafely(launchIntent)) {
                JSObject result = new JSObject();
                result.put("opened", true);
                result.put("destination", "vendor");
                result.put("fallbackUsed", false);
                result.put(
                    "component",
                    launchIntent.getComponent() == null
                        ? candidate.componentName
                        : launchIntent.getComponent().flattenToShortString()
                );
                result.put("label", candidate.label);
                result.put("vendorFamily", getVendorFamily());
                call.resolve(result);
                return;
            }
        }

        Intent fallbackIntent = createAppDetailsIntent();
        boolean opened = startIntentSafely(fallbackIntent);
        JSObject result = new JSObject();
        result.put("opened", opened);
        result.put("destination", "app-details");
        result.put("fallbackUsed", true);
        result.put("label", getFallbackSettingsLabel());
        result.put("vendorFamily", getVendorFamily());

        if (opened) {
            call.resolve(result);
        } else {
            call.reject("没能打开后台管理或应用信息，请稍后重试。");
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        resolveAppSettingsCall(call);
    }

    @PluginMethod
    public void openNotificationChannelSettings(PluginCall call) {
        String channelId = call.getString("channelId");

        if (channelId == null || channelId.isEmpty()) {
            call.reject("通知设置暂时无法打开，请重试。");
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            resolveAppSettingsCall(call);
            return;
        }

        Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        intent.putExtra(Settings.EXTRA_CHANNEL_ID, channelId);

        if (startIntentSafely(intent)) {
            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("destination", "notification-channel");
            call.resolve(result);
        } else {
            resolveAppSettingsCall(call);
        }
    }

    private void resolveAppSettingsCall(PluginCall call) {
        if (startIntentSafely(createAppDetailsIntent())) {
            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("destination", "app-details");
            call.resolve(result);
        } else {
            call.reject("没能打开应用信息，请稍后重试。");
        }
    }

    private Intent createAppDetailsIntent() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        return intent;
    }

    private boolean isIgnoringBatteryOptimizations() {
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);

        return powerManager != null && powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private boolean isBackgroundRestricted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return false;
        }

        ActivityManager activityManager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        return activityManager != null && activityManager.isBackgroundRestricted();
    }

    private SettingsCandidate findVendorSettingsCandidate() {
        for (SettingsCandidate candidate : getVendorSettingsCandidates()) {
            Intent launchIntent = resolveSafeExplicitIntent(candidate.intent);

            if (launchIntent != null) {
                return new SettingsCandidate(
                    launchIntent,
                    candidate.label,
                    launchIntent.getComponent() == null
                        ? ""
                        : launchIntent.getComponent().flattenToShortString()
                );
            }
        }

        return null;
    }

    private List<SettingsCandidate> getVendorSettingsCandidates() {
        String vendor = getVendorFamily();
        List<SettingsCandidate> candidates = new ArrayList<>();

        if ("honor".equals(vendor)) {
            candidates.add(componentCandidate(
                "com.hihonor.systemmanager",
                ".startupmgr.ui.StartupNormalAppListActivity",
                "应用启动管理"
            ));
            addHuaweiCandidates(candidates);
        } else if ("huawei".equals(vendor)) {
            addHuaweiCandidates(candidates);
        } else if ("xiaomi".equals(vendor)) {
            candidates.add(componentCandidate(
                "com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity",
                "自启动管理"
            ));
        } else if ("oplus".equals(vendor)) {
            candidates.add(componentCandidate(
                "com.oplus.safe",
                "com.oplus.safe.permission.startup.StartupAppListActivity",
                "自启动管理"
            ));
            candidates.add(componentCandidate(
                "com.coloros.safecenter",
                "com.coloros.safecenter.permission.startup.StartupAppListActivity",
                "自启动管理"
            ));
            candidates.add(componentCandidate(
                "com.coloros.safecenter",
                "com.coloros.safecenter.startupapp.StartupAppListActivity",
                "自启动管理"
            ));
            candidates.add(componentCandidate(
                "com.coloros.safe",
                "com.coloros.safe.permission.startup.StartupAppListActivity",
                "自启动管理"
            ));
            candidates.add(componentCandidate(
                "com.oppo.safe",
                "com.oppo.safe.permission.startup.StartupAppListActivity",
                "自启动管理"
            ));
            candidates.add(componentCandidate(
                "com.oneplus.security",
                "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity",
                "关联启动管理"
            ));
        } else if ("vivo".equals(vendor)) {
            candidates.add(componentCandidate(
                "com.vivo.permissionmanager",
                "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
                "自启动管理"
            ));
            candidates.add(componentCandidate(
                "com.iqoo.secure",
                "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
                "后台启动管理"
            ));
            candidates.add(componentCandidate(
                "com.iqoo.secure",
                "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
                "后台白名单"
            ));
        } else if ("samsung".equals(vendor)) {
            candidates.add(componentCandidate(
                "com.samsung.android.lool",
                "com.samsung.android.sm.ui.battery.BatteryActivity",
                "电池设置"
            ));
            candidates.add(componentCandidate(
                "com.samsung.android.sm",
                "com.samsung.android.sm.ui.battery.BatteryActivity",
                "电池设置"
            ));
            candidates.add(componentCandidate(
                "com.samsung.android.sm_cn",
                "com.samsung.android.sm.ui.battery.BatteryActivity",
                "电池设置"
            ));
        } else if ("meizu".equals(vendor)) {
            candidates.add(componentCandidate(
                "com.meizu.safe",
                "com.meizu.safe.permission.SmartBGActivity",
                "后台管理"
            ));
        } else if ("asus".equals(vendor)) {
            candidates.add(componentCandidate(
                "com.asus.mobilemanager",
                "com.asus.mobilemanager.autostart.AutoStartActivity",
                "自启动管理"
            ));
            candidates.add(componentCandidate(
                "com.asus.mobilemanager",
                "com.asus.mobilemanager.powersaver.PowerSaverSettings",
                "省电管理"
            ));
        }

        return candidates;
    }

    private void addHuaweiCandidates(List<SettingsCandidate> candidates) {
        candidates.add(componentCandidate(
            "com.huawei.systemmanager",
            "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "应用启动管理"
        ));
        candidates.add(componentCandidate(
            "com.huawei.systemmanager",
            "com.huawei.systemmanager.optimize.process.ProtectActivity",
            "受保护应用"
        ));
    }

    private SettingsCandidate componentCandidate(String packageName, String className, String label) {
        String expandedClassName = className.startsWith(".") ? packageName + className : className;
        Intent intent = new Intent();
        intent.setComponent(new ComponentName(packageName, expandedClassName));
        return new SettingsCandidate(intent, label, packageName + "/" + className);
    }

    private Intent resolveSafeExplicitIntent(Intent sourceIntent) {
        PackageManager packageManager = getContext().getPackageManager();
        ResolveInfo resolveInfo = packageManager.resolveActivity(sourceIntent, PackageManager.MATCH_DEFAULT_ONLY);

        if (resolveInfo == null || resolveInfo.activityInfo == null) {
            return null;
        }

        ActivityInfo activityInfo = resolveInfo.activityInfo;

        if (
            !activityInfo.exported ||
            !activityInfo.enabled ||
            activityInfo.applicationInfo == null ||
            !activityInfo.applicationInfo.enabled
        ) {
            return null;
        }

        String requiredPermission = activityInfo.permission;

        if (
            requiredPermission != null &&
            !requiredPermission.isEmpty() &&
            getContext().checkSelfPermission(requiredPermission) != PackageManager.PERMISSION_GRANTED
        ) {
            return null;
        }

        Intent resolvedIntent = new Intent(sourceIntent);
        resolvedIntent.setComponent(new ComponentName(activityInfo.packageName, activityInfo.name));
        return resolvedIntent;
    }

    private boolean startIntentSafely(Intent intent) {
        try {
            getActivity().startActivity(intent);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    private String getVendorFamily() {
        String identity = (
            safeBuildValue(Build.MANUFACTURER) + " " + safeBuildValue(Build.BRAND)
        ).toLowerCase(Locale.ROOT);

        if (identity.contains("honor")) {
            return "honor";
        }
        if (identity.contains("huawei")) {
            return "huawei";
        }
        if (
            identity.contains("xiaomi") ||
            identity.contains("redmi") ||
            identity.contains("poco")
        ) {
            return "xiaomi";
        }
        if (
            identity.contains("oppo") ||
            identity.contains("oplus") ||
            identity.contains("oneplus") ||
            identity.contains("realme")
        ) {
            return "oplus";
        }
        if (identity.contains("vivo") || identity.contains("iqoo")) {
            return "vivo";
        }
        if (identity.contains("samsung")) {
            return "samsung";
        }
        if (identity.contains("meizu")) {
            return "meizu";
        }
        if (identity.contains("asus")) {
            return "asus";
        }
        if (identity.contains("google") || identity.contains("pixel")) {
            return "pixel";
        }

        return "other";
    }

    private String getFallbackSettingsLabel() {
        return "应用信息";
    }

    private String safeBuildValue(String value) {
        return value == null ? "" : value;
    }

    private static final class SettingsCandidate {
        final Intent intent;
        final String label;
        final String componentName;

        SettingsCandidate(Intent intent, String label, String componentName) {
            this.intent = intent;
            this.label = label;
            this.componentName = componentName;
        }
    }
}
