package com.kyy.ddlreminder;

import android.graphics.Color;
import android.content.res.Configuration;
import android.view.Window;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DdlSystemBars")
public class DdlSystemBarsPlugin extends Plugin {
    private static final int LIGHT_BAR_COLOR = Color.parseColor("#F7FAF4");
    private static final int DARK_BAR_COLOR = Color.parseColor("#0C0D0B");
    private int currentBarColor = DARK_BAR_COLOR;

    @PluginMethod
    public void apply(PluginCall call) {
        String theme = call.getString("theme", "dark");
        boolean isLightTheme = "light".equals(theme);

        currentBarColor = isLightTheme ? LIGHT_BAR_COLOR : DARK_BAR_COLOR;

        getActivity().runOnUiThread(() -> {
            applyBarBackground();
            call.resolve();
        });
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration newConfig) {
        super.handleOnConfigurationChanged(newConfig);

        // Capacitor reapplies the Android theme's window background after an
        // orientation change. Post our user-selected color so landscape
        // cutout/status-bar insets do not revert to the light launch theme.
        getActivity().runOnUiThread(() ->
            getActivity().getWindow().getDecorView().post(this::applyBarBackground)
        );
    }

    @SuppressWarnings("deprecation")
    private void applyBarBackground() {
        Window window = getActivity().getWindow();

        // Android 15+ renders edge-to-edge and may ignore the explicit bar
        // colors. The decor background remains visible behind transparent
        // system-bar and display-cutout insets, while these setters cover older
        // Android versions and vendor implementations.
        window.getDecorView().setBackgroundColor(currentBarColor);
        window.setStatusBarColor(currentBarColor);
        window.setNavigationBarColor(currentBarColor);
    }
}
