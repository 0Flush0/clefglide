package org.clefglide.app

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.util.TypedValue
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AppTheme")
class AppThemePlugin : Plugin() {
    @PluginMethod
    @Suppress("DEPRECATION") // Bar color remains necessary before Android 15.
    fun setTheme(call: PluginCall) {
        activity.runOnUiThread {
            val dark = call.getBoolean("dark", false) == true
            activity.setTheme(if (dark) R.style.AppTheme_ClefGlideDark else R.style.AppTheme_NoActionBar)
            val color = TypedValue().also {
                activity.theme.resolveAttribute(android.R.attr.windowBackground, it, true)
            }.data
            val window = activity.window
            window.setBackgroundDrawable(ColorDrawable(color))
            window.decorView.setBackgroundColor(color)
            bridge.webView.setBackgroundColor(color)
            // The webpage paints behind transparent bars. API 24/25 cannot use
            // dark navigation icons, so retain a legible legacy button background.
            window.navigationBarColor = if (Build.VERSION.SDK_INT >= 26) Color.TRANSPARENT else Color.rgb(25, 43, 37)
            if (Build.VERSION.SDK_INT >= 28) window.navigationBarDividerColor = Color.TRANSPARENT
            // Our padded, solid background and explicit icon style provide contrast
            // without Android adding a differently colored three-button scrim.
            if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
            call.resolve()
        }
    }
}
