package com.kyy.ddlreminder;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(DdlAlarmPlugin.class);
        registerPlugin(AndroidPowerPlugin.class);
        registerPlugin(AndroidRecentsPlugin.class);
        registerPlugin(AndroidWallpaperPlugin.class);
        registerPlugin(DdlSystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
        AndroidRecentsPlugin.applySavedPreference(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        AndroidRecentsPlugin.applySavedPreference(this);
    }
}
