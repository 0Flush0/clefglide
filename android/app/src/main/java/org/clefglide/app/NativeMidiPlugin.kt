package org.clefglide.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiManager
import android.media.midi.MidiOutputPort
import android.media.midi.MidiReceiver
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(name = "NativeMidi", permissions = [
    Permission(alias = "bluetooth", strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT]),
    Permission(alias = "bluetoothLocation", strings = [Manifest.permission.ACCESS_FINE_LOCATION]),
])
class NativeMidiPlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())
    private var manager: MidiManager? = null
    private var enabled = false
    private var active = true
    private var destroyed = false
    private var registered = false
    private var device: MidiDevice? = null
    private var port: MidiOutputPort? = null
    private var receiver: MidiReceiver? = null
    private var selectedId = ""
    private var selectedDeviceId: Int? = null
    private var openingDeviceId: Int? = null
    private var pending: PluginCall? = null
    private var connection = 0
    private var bluetooth: BluetoothMidiManager? = null
    private var openingId = ""
    private var bluetoothPermissionCall: PluginCall? = null
    private var failed = false
    private var failureMessage: String? = null
    private var usbTimeout: Runnable? = null

    private val callback = object : MidiManager.DeviceCallback() {
        override fun onDeviceAdded(info: MidiDeviceInfo) {
            if (enabled && active && info.type == MidiDeviceInfo.TYPE_USB) publish()
        }

        override fun onDeviceRemoved(info: MidiDeviceInfo) {
            if (!enabled || !active) return
            if (info.id == selectedDeviceId || info.id == openingDeviceId) {
                val message = if (info.type == MidiDeviceInfo.TYPE_BLUETOOTH)
                    "Bluetooth MIDI disconnected. Discover again, select the piano and press Start."
                    else "Piano disconnected. Check USB/OTG and reconnect."
                closeInput(message)
                publish(message)
            } else if (info.type == MidiDeviceInfo.TYPE_USB) publish()
        }
    }

    private fun inputs(): List<Pair<MidiDeviceInfo, MidiDeviceInfo.PortInfo>> =
        manager?.devices.orEmpty()
            .filter { it.type == MidiDeviceInfo.TYPE_USB }
            .flatMap { info ->
                // Android's OUTPUT ports send keyboard data into our receiver.
                info.ports.filter { it.type == MidiDeviceInfo.PortInfo.TYPE_OUTPUT }
                    .map { info to it }
            }

    private fun id(info: MidiDeviceInfo, portInfo: MidiDeviceInfo.PortInfo) =
        "${info.id}:${portInfo.portNumber}"

    private fun state(message: String? = null): JSObject {
        val list = inputs()
        val result = JSArray()
        list.forEach { (info, portInfo) ->
            val name = info.properties.getString(MidiDeviceInfo.PROPERTY_NAME) ?: "USB MIDI ${info.id}"
            val suffix = portInfo.name.takeIf { it.isNotBlank() } ?: "Port ${portInfo.portNumber + 1}"
            result.put(JSObject().put("id", id(info, portInfo)).put("name", "$name — $suffix"))
        }
        bluetooth?.inputs?.forEach { input ->
            result.put(JSObject().put("id", input.id).put("name", input.name))
        }
        return JSObject()
            .put("inputs", result)
            .put("selectedId", selectedId)
            .put("connection", connection)
            // Additive UI metadata; MIDI packets and connection generations stay unchanged.
            .put("pendingId", openingId)
            .put("phase", when {
                !active -> if (bluetooth?.phase == "permission") "permission" else "idle"
                openingId.isNotEmpty() -> "connecting"
                bluetooth?.phase == "permission" || bluetooth?.phase == "scanning" -> bluetooth!!.phase
                failed -> "failed"
                selectedId.isNotEmpty() -> "connected"
                bluetooth?.phase == "failed" -> "failed"
                else -> "idle"
            })
            .put("nativeTimeMs", System.nanoTime() / 1_000_000.0)
            .put("status", message ?: when {
                !active -> if (bluetooth?.phase == "permission") "Requesting Bluetooth permission…"
                    else "Practice paused. MIDI discovery resumes when you return."
                bluetooth?.phase == "permission" || bluetooth?.phase == "scanning" -> bluetooth!!.status
                failed -> failureMessage
                selectedId.isNotEmpty() -> "Piano connected"
                bluetooth?.status != null -> bluetooth!!.status
                list.isEmpty() && bluetooth?.inputs.orEmpty().isEmpty() -> "No USB MIDI inputs. Check USB/OTG or discover Bluetooth MIDI."
                else -> "Choose your piano input."
            })
    }

    private fun publish(message: String? = null, failure: Boolean = false) {
        if (failure) { failed = true; failureMessage = message }
        notifyListeners("state", state(message))
    }

    private fun register() {
        if (!registered) {
            manager?.registerDeviceCallback(callback, main)
            registered = manager != null
        }
    }

    private fun unregister() {
        if (registered) manager?.unregisterDeviceCallback(callback)
        registered = false
    }

    private fun closeInput(reason: String) {
        // Invalidates queued receiver packets and asynchronous open callbacks.
        connection++
        failed = false
        failureMessage = null
        usbTimeout?.let { main.removeCallbacks(it) }
        usbTimeout = null
        pending?.reject(reason)
        pending = null
        openingId = ""
        openingDeviceId = null
        bluetooth?.cancelConnection()
        val oldPort = port
        val oldReceiver = receiver
        port = null
        receiver = null
        selectedId = ""
        selectedDeviceId = null
        // Drivers may fail close() after physical removal; still release every
        // resource and finish pausing rather than crashing the Activity.
        runCatching { if (oldReceiver != null) oldPort?.disconnect(oldReceiver) }
        runCatching { oldPort?.close() }
        val oldDevice = device
        device = null
        runCatching { oldDevice?.close() }
    }

    @PluginMethod
    fun clock(call: PluginCall) {
        call.resolve(JSObject().put("nativeTimeMs", System.nanoTime() / 1_000_000.0))
    }

    @PluginMethod
    fun start(call: PluginCall) {
        main.post {
            if (enable(call)) call.resolve(state())
        }
    }

    private fun enable(call: PluginCall): Boolean {
        if (destroyed || !active) {
            call.reject("Return to ClefGlide before connecting MIDI.")
            return false
        }
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_MIDI)) {
            call.reject("Android MIDI is unavailable on this device. Use the virtual piano.")
            return false
        }
        try {
            manager = context.getSystemService(Context.MIDI_SERVICE) as? MidiManager
            if (manager == null) {
                call.reject("Android MIDI service is unavailable. Use the virtual piano.")
                return false
            }
            enabled = true
            register()
            return true
        } catch (error: Exception) {
            call.reject("Could not discover USB MIDI devices.", error)
            return false
        }
    }

    @PluginMethod
    fun discoverBluetooth(call: PluginCall) {
        main.post {
            if (!enable(call)) return@post
            val ble = bluetooth ?: BluetoothMidiManager(context, manager!!, main,
                { message -> if (enabled && active && !destroyed) publish(message) },
                { id, message ->
                    if (id == selectedId || id == openingId) {
                        closeInput(message)
                        publish(message)
                    }
                }).also { bluetooth = it }
            ble.resume()
            failed = false
            failureMessage = null
            ble.discover({ alias ->
                bluetoothPermissionCall = call
                requestPermissionForAlias(alias, call, "bluetoothPermissionsResult")
            }) { error ->
                if (error != null) { publish(error, failure = true); call.reject(error) }
                else call.resolve(state())
            }
        }
    }

    @PermissionCallback
    private fun bluetoothPermissionsResult(call: PluginCall) {
        main.post {
            if (bluetoothPermissionCall === call) {
                bluetoothPermissionCall = null
                bluetooth?.permissionsResult()
            }
        }
    }

    private fun attach(opened: MidiDevice, portNumber: Int, deviceId: Int, requested: String, token: Int, call: PluginCall) {
        device = opened
        try {
            val output = opened.openOutputPort(portNumber)
                ?: throw IllegalStateException("MIDI output port is unavailable.")
            port = output
            val parser = MidiStreamParser { type, pitch, velocity, channel, timestamp ->
                val event = JSObject().put("type", type).put("pitch", pitch)
                    .put("velocity", velocity).put("channel", channel)
                    .put("timestampMs", timestamp / 1_000_000.0).put("connection", token)
                main.post {
                    if (active && enabled && token == connection && selectedId == requested) {
                        notifyListeners("midi", event)
                    }
                }
            }
            val inputReceiver = object : MidiReceiver() {
                override fun onSend(data: ByteArray, offset: Int, count: Int, timestamp: Long) {
                    parser.receive(data, offset, count, if (timestamp > 0) timestamp else System.nanoTime())
                }
            }
            receiver = inputReceiver
            selectedId = requested
            selectedDeviceId = deviceId
            output.connect(inputReceiver)
            pending = null
            failed = false
            failureMessage = null
            usbTimeout?.let { main.removeCallbacks(it) }
            usbTimeout = null
            openingId = ""
            openingDeviceId = null
            publish()
            call.resolve(state())
        } catch (error: Exception) {
            val transport = if (requested.startsWith("ble:")) "Bluetooth" else "USB"
            closeInput("Could not open $transport MIDI port: ${error.message}")
            publish("Could not open $transport MIDI port. Retry or use the virtual piano.", failure = true)
        }
    }

    @PluginMethod
    fun select(call: PluginCall) {
        main.post {
            val requested = call.getString("id") ?: ""
            if (!enabled || !active || destroyed) {
                call.reject("Connect MIDI while ClefGlide is in the foreground.")
                return@post
            }
            closeInput("MIDI selection changed.")
            if (requested.isEmpty()) {
                publish()
                call.resolve(state())
                return@post
            }
            if (requested.startsWith("ble:")) {
                val ble = bluetooth
                if (ble == null) { publish("Discover Bluetooth MIDI before selecting a piano.", failure = true); call.reject("Discover Bluetooth MIDI before selecting a piano."); return@post }
                val token = connection
                pending = call
                openingId = requested
                publish("Connecting Bluetooth MIDI…")
                ble.open(requested) { opened, error ->
                    if (token != connection || !enabled || !active || destroyed) {
                        runCatching { opened?.close() }
                    } else if (opened == null) {
                        val message = error ?: "Could not open Bluetooth MIDI. Retry discovery."
                        closeInput(message)
                        publish(message, failure = true)
                    } else {
                        try {
                            val info = opened.info
                            val output = info.ports.firstOrNull { it.type == MidiDeviceInfo.PortInfo.TYPE_OUTPUT }
                            check(output != null) { "Bluetooth MIDI device has no sending port. Choose another input." }
                            attach(opened, output.portNumber, info.id, requested, token, call)
                        } catch (error: Exception) {
                            device = opened
                            val message = error.message ?: "Could not open Bluetooth MIDI port. Retry discovery."
                            closeInput(message)
                            publish(message, failure = true)
                        }
                    }
                }
                return@post
            }
            val entry = inputs().find { (info, portInfo) -> id(info, portInfo) == requested }
            if (entry == null) {
                publish("USB MIDI input is no longer available.", failure = true)
                call.reject("USB MIDI input is no longer available.")
                return@post
            }
            val (info, portInfo) = entry
            val token = connection
            pending = call
            openingId = requested
            openingDeviceId = info.id
            publish("Connecting USB MIDI…")
            val timeout = Runnable {
                if (token == connection && openingId == requested) {
                    val message = "USB MIDI connection timed out. Choose the input to retry."
                    closeInput(message)
                    publish(message, failure = true)
                }
            }
            usbTimeout = timeout
            main.postDelayed(timeout, 15_000L)
            try {
                manager!!.openDevice(info, { opened ->
                    if (token != connection || !enabled || !active || destroyed) {
                        runCatching { opened?.close() }
                        return@openDevice
                    }
                    if (opened == null) {
                        closeInput("Could not open USB MIDI device.")
                        publish("Could not open USB MIDI device. Retry or use the virtual piano.", failure = true)
                        return@openDevice
                    }
                    attach(opened, portInfo.portNumber, info.id, requested, token, call)
                }, main)
            } catch (error: Exception) {
                closeInput("Could not open USB MIDI device: ${error.message}")
                publish("Could not open USB MIDI device. Retry or use the virtual piano.", failure = true)
            }
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        main.post {
            enabled = false
            bluetoothPermissionCall = null
            bluetooth?.stop()
            unregister()
            closeInput("MIDI stopped.")
            call.resolve()
        }
    }

    override fun handleOnPause() {
        active = false
        // Pause shared practice even when only the virtual piano is being used.
        notifyListeners("lifecycle", JSObject().put("active", false))
        unregister()
        bluetooth?.pause()
        closeInput("MIDI paused while the app is in the background.")
        if (enabled) publish()
    }

    override fun handleOnResume() {
        active = true
        notifyListeners("lifecycle", JSObject().put("active", true))
        if (enabled) {
            register()
            bluetooth?.resume()
            // The adapter can select a sole USB input; scoring still requires Start.
            publish()
        }
    }

    override fun handleOnStop() {
        // Cancel permission continuations on actual backgrounding; onPause alone
        // can be caused by Android's permission dialog.
        bluetoothPermissionCall = null
        bluetooth?.stop()
    }

    override fun handleOnDestroy() {
        destroyed = true
        enabled = false
        bluetoothPermissionCall = null
        bluetooth?.stop()
        unregister()
        closeInput("MIDI activity destroyed.")
        // Leave open callbacks able to run: their generation check closes any
        // device delivered after destruction. Removing them could leak it.
    }
}
