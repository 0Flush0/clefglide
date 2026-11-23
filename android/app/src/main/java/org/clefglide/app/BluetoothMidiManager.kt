package org.clefglide.app

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.media.midi.MidiDevice
import android.media.midi.MidiManager
import android.os.Build
import android.os.Handler
import android.os.ParcelUuid
import androidx.core.content.ContextCompat

/** Foreground-only BLE discovery/opening. Android decodes BLE-MIDI, not this class.
 * All mutable state is confined to the main handler. Accepted MidiDevices belong
 * to NativeMidiPlugin; devices returned to obsolete opens are closed here.
 */
internal class BluetoothMidiManager(
    private val context: Context,
    private val midi: MidiManager,
    private val main: Handler,
    private val changed: (String?) -> Unit,
    private val lost: (String, String) -> Unit,
    private val apiLevel: Int = Build.VERSION.SDK_INT,
) {
    companion object {
        const val MIDI_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
        const val SCAN_MS = 10_000L
        const val OPEN_MS = 15_000L
        fun permissions(api: Int): Array<String> = if (api >= 31)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    data class Input(val id: String, val name: String)
    private data class Candidate(val device: BluetoothDevice, val name: String)
    private val candidates = linkedMapOf<String, Candidate>()
    val inputs: List<Input> get() = candidates.map { (id, entry) -> Input(id, "${entry.name} (Bluetooth MIDI)") }
    var status: String? = null
        private set
    var phase = "idle"
        private set
    private var active = true
    private var scanner: BluetoothLeScanner? = null
    private var scan: ScanCallback? = null
    private var scanTimeout: Runnable? = null
    private var scanGeneration = 0
    private var openGeneration = 0
    private var openTimeout: Runnable? = null
    private var currentId: String? = null
    private var registered = false
    private var broadcastGeneration = 0
    private var receiver: BroadcastReceiver? = null
    private var permissionDone: ((String?) -> Unit)? = null
    private var permissionReturned = false

    private fun createReceiver(generation: Int) = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            main.post {
                if (!active || !registered || generation != broadcastGeneration) return@post
                when (intent.action) {
                    BluetoothAdapter.ACTION_STATE_CHANGED -> {
                        if (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR) != BluetoothAdapter.STATE_ON)
                            unavailable("Bluetooth is off. Turn it on in Android settings, then discover again.")
                    }
                    BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                        @Suppress("DEPRECATION")
                        val device = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)
                        val id = runCatching { device?.address?.let { "ble:$it" } }.getOrNull()
                        if (id != null && (candidates.containsKey(id) || id == currentId)) {
                            candidates.remove(id)
                            if (id == currentId) {
                                cancelConnection()
                                lost(id, "Bluetooth MIDI disconnected. Discover again, select the piano and press Start.")
                            }
                            report("Bluetooth MIDI disconnected. Discover again to reconnect.")
                        }
                    }
                }
            }
        }
    }

    private fun report(message: String?, nextPhase: String = "idle") {
        phase = nextPhase
        status = message
        changed(message)
    }

    private fun permitted() = permissions(apiLevel).all {
        context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
    }

    private fun adapter(): BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    /** Called only by the explicit Discover Bluetooth MIDI gesture. */
    fun discover(requestPermission: (String) -> Unit, done: (String?) -> Unit) {
        if (!active) { done("Return to ClefGlide before discovering Bluetooth MIDI."); return }
        if (permissionDone != null || scan != null) { done("Bluetooth discovery is already in progress."); return }
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            done("Bluetooth Low Energy is unavailable. Use USB MIDI or the virtual piano."); return
        }
        if (!permitted()) {
            permissionDone = done
            permissionReturned = false
            report("Requesting Bluetooth permission…", "permission")
            try { requestPermission(if (apiLevel >= 31) "bluetooth" else "bluetoothLocation") }
            catch (_: Exception) { finishPermission("Could not request Bluetooth permission. Retry discovery.") }
            return
        }
        beginScan(done)
    }

    fun permissionsResult() {
        // A permission dialog may pause the Activity. Defer scanning until resume;
        // a real background transition (onStop) cancels the request entirely.
        if (permissionDone == null) return
        permissionReturned = true
        if (active) finishPermission()
    }

    private fun finishPermission(error: String? = null) {
        val done = permissionDone ?: return
        permissionDone = null
        permissionReturned = false
        phase = "idle"
        status = null
        when {
            error != null -> done(error)
            !permitted() -> done("Bluetooth permission denied. Allow Nearby devices (Location on Android 11 or earlier) in app settings, then discover again.")
            else -> beginScan(done)
        }
    }

    private fun beginScan(done: (String?) -> Unit) {
        try {
            val adapter = adapter() ?: throw IllegalStateException("Bluetooth is unavailable on this device.")
            check(adapter.isEnabled) { "Bluetooth is off. Turn it on in Android settings, then discover again." }
            if (apiLevel < 31) {
                val location = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
                check(location != null && (location.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                    location.isProviderEnabled(LocationManager.NETWORK_PROVIDER))) {
                    "Turn on Android Location services for Bluetooth discovery on Android 11 or earlier."
                }
            }
            val nextScanner = adapter.bluetoothLeScanner ?: throw IllegalStateException("Bluetooth scanning is unavailable. Retry discovery.")
            register()
            // A fresh discovery expires old advertisements, but keeps an active input.
            candidates.keys.retainAll(setOfNotNull(currentId))
            val generation = ++scanGeneration
            val callback = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) { main.post {
                    if (generation != scanGeneration || scan !== this || !active) return@post
                    try {
                        if (result.scanRecord?.serviceUuids?.any { it.uuid.toString().equals(MIDI_SERVICE_UUID, true) } != true) return@post
                        val device = result.device
                        val id = "ble:${device.address}"
                        val name = result.scanRecord?.deviceName?.takeIf { it.isNotBlank() }
                            ?: device.name?.takeIf { it.isNotBlank() } ?: "BLE piano"
                        if (candidates[id]?.name != name) {
                            candidates[id] = Candidate(device, name)
                            changed(null)
                        }
                    } catch (_: SecurityException) { unavailable("Bluetooth permission was revoked. Discover again to allow access.") }
                } }
                override fun onBatchScanResults(results: MutableList<ScanResult>) { results.forEach { onScanResult(0, it) } }
                override fun onScanFailed(errorCode: Int) { main.post {
                    if (generation == scanGeneration && scan === this && active) {
                        stopScan()
                        report("Bluetooth discovery failed ($errorCode). Wait a moment and discover again.", "failed")
                    }
                } }
            }
            scanner = nextScanner
            scan = callback
            val timeout = Runnable {
                if (generation == scanGeneration && scan === callback) {
                    stopScan()
                    report(if (candidates.isEmpty()) "No Bluetooth MIDI devices found. Enable BLE-MIDI on the piano and discover again."
                        else "Bluetooth discovery finished. Choose your piano input.")
                }
            }
            scanTimeout = timeout
            val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(MIDI_SERVICE_UUID)).build()
            nextScanner.startScan(listOf(filter), ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback)
            main.postDelayed(timeout, SCAN_MS)
            report("Discovering Bluetooth MIDI for 10 seconds…", "scanning")
            done(null)
        } catch (_: SecurityException) {
            stopScan()
            val message = "Bluetooth permission was revoked. Discover again to allow access."
            report(message, "failed")
            done(message)
        } catch (error: Exception) {
            stopScan()
            val message = error.message ?: "Could not discover Bluetooth MIDI. Retry discovery."
            report(message, "failed")
            done(message)
        }
    }

    /** Transfers ownership of a successful open to the shared native MIDI receiver. */
    fun open(id: String, done: (MidiDevice?, String?) -> Unit) {
        cancelConnection()
        stopScan()
        status = null
        phase = "idle"
        val candidate = candidates[id]
        if (!active || candidate == null) { done(null, "Bluetooth MIDI input expired. Discover again."); return }
        if (!permitted()) { done(null, "Bluetooth permission is missing. Discover again to allow access."); return }
        val generation = openGeneration
        currentId = id
        val timeout = Runnable {
            if (generation == openGeneration && openTimeout != null) {
                cancelConnection()
                done(null, "Bluetooth MIDI connection timed out. Check the piano and retry discovery.")
            }
        }
        openTimeout = timeout
        try {
            check(adapter()?.isEnabled == true) { "Bluetooth is off. Turn it on and discover again." }
            main.postDelayed(timeout, OPEN_MS)
            midi.openBluetoothDevice(candidate.device, { opened ->
                if (generation != openGeneration || !active || currentId != id || openTimeout == null) {
                    runCatching { opened?.close() }
                } else {
                    main.removeCallbacks(timeout)
                    openTimeout = null
                    if (opened == null) currentId = null
                    done(opened, if (opened == null) "Could not open Bluetooth MIDI. Check the piano and retry discovery." else null)
                }
            }, main)
        } catch (error: Exception) {
            cancelConnection()
            done(null, if (error is SecurityException) "Bluetooth permission was revoked. Discover again to allow access."
                else error.message ?: "Could not open Bluetooth MIDI. Retry discovery.")
        }
    }

    fun cancelConnection() {
        ++openGeneration
        openTimeout?.let { main.removeCallbacks(it) }
        openTimeout = null
        currentId = null
    }

    private fun stopScan() {
        if (phase == "scanning") phase = "idle"
        ++scanGeneration
        scanTimeout?.let { main.removeCallbacks(it) }
        scanTimeout = null
        val oldScan = scan
        scan = null
        if (oldScan != null) {
            try { scanner?.stopScan(oldScan) }
            catch (_: SecurityException) { /* Permission can be revoked during a scan. */ }
            catch (_: Exception) { /* Release local state even if the radio/driver is gone. */ }
        }
        scanner = null
    }

    private fun unavailable(message: String) {
        val id = currentId
        stopScan()
        cancelConnection()
        candidates.clear()
        if (id != null) lost(id, message)
        report(message, "failed")
    }

    private fun register() {
        if (registered) return
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED).apply { addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED) }
        val nextReceiver = createReceiver(++broadcastGeneration)
        // Bluetooth broadcasts can originate from the privileged Bluetooth app.
        ContextCompat.registerReceiver(context, nextReceiver, filter, ContextCompat.RECEIVER_EXPORTED)
        receiver = nextReceiver
        registered = true
    }

    fun pause() {
        active = false
        stopScan()
        cancelConnection()
        candidates.clear()
        status = null
        phase = if (permissionDone != null) "permission" else "idle"
        ++broadcastGeneration
        if (registered) runCatching { context.unregisterReceiver(receiver) }
        receiver = null
        registered = false
    }

    fun resume() {
        active = true
        if (permissionReturned) finishPermission()
    }

    fun stop() {
        pause()
        val done = permissionDone
        permissionDone = null
        phase = "idle"
        permissionReturned = false
        done?.invoke("Bluetooth discovery cancelled. Return to ClefGlide and discover again.")
    }
}
