package org.clefglide.app

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/** Uses Android's document picker; no storage permissions or DB changes. */
@CapacitorPlugin(name = "ProgressFiles")
class ProgressFilesPlugin : Plugin() {
    private var saving = false

    @PluginMethod
    fun save(call: PluginCall) {
        activity.runOnUiThread {
            if (saving) {
                call.reject("Finish the current export first.")
                return@runOnUiThread
            }
            if (call.getString("body") == null) {
                call.reject("Export content is missing.")
                return@runOnUiThread
            }
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = call.getString("type") ?: "application/json"
                putExtra(Intent.EXTRA_TITLE, call.getString("name") ?: "clefglide-progress.json")
            }
            saving = true
            try {
                startActivityForResult(call, intent, "saved")
            } catch (error: Exception) {
                saving = false
                call.reject("Could not open Android's file picker.", error)
            }
        }
    }

    @ActivityCallback
    private fun saved(call: PluginCall?, result: ActivityResult) {
        saving = false
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve() // User cancelled; no file was written.
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            call.reject("Android did not return an export destination.")
            return
        }
        try {
            val output = context.contentResolver.openOutputStream(uri, "wt")
                ?: throw IllegalStateException("Cannot open export destination.")
            output.bufferedWriter(Charsets.UTF_8).use { it.write(call.getString("body") ?: "") }
            call.resolve()
        } catch (error: Exception) {
            call.reject("Could not save the progress export.", error)
        }
    }
}
