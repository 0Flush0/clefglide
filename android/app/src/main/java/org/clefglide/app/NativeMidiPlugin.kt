package org.clefglide.app

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

@CapacitorPlugin(name = "NativeMidi")
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

    private val callback = object : MidiManager.DeviceCallback() {
        override fun onDeviceAdded(info: MidiDeviceInfo) {
            if (enabled && active && info.type == MidiDeviceInfo.TYPE_USB) publish()
        }

        override fun onDeviceRemoved(info: MidiDeviceInfo) {
            if (!enabled || !active || info.type != MidiDeviceInfo.TYPE_USB) return
            if (info.id == selectedDeviceId || info.id == openingDeviceId) {
                closeInput("USB MIDI device disconnected.")
                publish("Piano disconnected. Check USB/OTG and reconnect.")
            } else publish()
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
        return JSObject()
            .put("inputs", result)
            .put("selectedId", selectedId)
            .put("connection", connection)
            .put("nativeTimeMs", System.nanoTime() / 1_000_000.0)
            .put("status", message ?: when {
                !active -> "Practice paused. Reconnect MIDI after returning to the app."
                selectedId.isNotEmpty() -> "Piano connected"
                list.isEmpty() -> "No USB MIDI inputs. Check USB/OTG and reconnect."
                else -> "Choose your piano input."
            })
    }

    private fun publish(message: String? = null) = notifyListeners("state", state(message))

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
        pending?.reject(reason)
        pending = null
        openingDeviceId = null
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
            if (destroyed || !active) {
                call.reject("Return to ClefGlide before connecting MIDI.")
                return@post
            }
            if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_MIDI)) {
                call.reject("Android MIDI is unavailable on this device. Use the virtual piano.")
                return@post
            }
            try {
                manager = context.getSystemService(Context.MIDI_SERVICE) as? MidiManager
                if (manager == null) {
                    call.reject("Android MIDI service is unavailable. Use the virtual piano.")
                    return@post
                }
                enabled = true
                register()
                call.resolve(state())
            } catch (error: Exception) {
                call.reject("Could not discover USB MIDI devices.", error)
            }
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
            val entry = inputs().find { (info, portInfo) -> id(info, portInfo) == requested }
            if (entry == null) {
                publish()
                call.reject("USB MIDI input is no longer available.")
                return@post
            }
            val (info, portInfo) = entry
            val token = connection
            pending = call
            openingDeviceId = info.id
            publish("Connecting USB MIDI…")
            try {
                manager!!.openDevice(info, { opened ->
                    if (token != connection || !enabled || !active || destroyed) {
                        opened?.close()
                        return@openDevice
                    }
                    if (opened == null) {
                        closeInput("Could not open USB MIDI device.")
                        publish("Could not open USB MIDI device. Retry or use the virtual piano.")
                        return@openDevice
                    }
                    device = opened
                    try {
                        val output = opened.openOutputPort(portInfo.portNumber)
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
                        selectedDeviceId = info.id
                        output.connect(inputReceiver)
                        pending = null
                        openingDeviceId = null
                        publish()
                        call.resolve(state())
                    } catch (error: Exception) {
                        closeInput("Could not open USB MIDI port: ${error.message}")
                        publish("Could not open USB MIDI port. Retry or use the virtual piano.")
                    }
                }, main)
            } catch (error: Exception) {
                closeInput("Could not open USB MIDI device: ${error.message}")
                publish("Could not open USB MIDI device. Retry or use the virtual piano.")
            }
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        main.post {
            enabled = false
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
        closeInput("MIDI paused while the app is in the background.")
        if (enabled) publish()
    }

    override fun handleOnResume() {
        active = true
        notifyListeners("lifecycle", JSObject().put("active", true))
        if (enabled) {
            register()
            // Refresh discovery, but require a selection and manual Start.
            publish()
        }
    }

    override fun handleOnDestroy() {
        destroyed = true
        enabled = false
        unregister()
        closeInput("MIDI activity destroyed.")
        // Leave open callbacks able to run: their generation check closes any
        // device delivered after destruction. Removing them could leak it.
    }
}
