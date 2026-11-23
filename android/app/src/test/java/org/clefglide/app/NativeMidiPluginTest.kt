package org.clefglide.app

import android.content.Context
import android.content.pm.PackageManager
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiManager
import android.media.midi.MidiOutputPort
import android.media.midi.MidiReceiver
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Logger
import com.getcapacitor.PluginCall
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.*
import org.mockito.MockedConstruction
import org.mockito.MockedStatic
import org.mockito.Mockito.*

/** JVM simulation of native lifecycle and MidiManager callbacks, without a device. */
class NativeMidiPluginTest {
    private lateinit var loopers: MockedStatic<Looper>
    private lateinit var logging: MockedStatic<Logger>
    private lateinit var handlers: MockedConstruction<Handler>
    private lateinit var plugin: NativeMidiPlugin
    private lateinit var manager: MidiManager
    private lateinit var usb: MidiDeviceInfo
    private lateinit var opened: MidiDevice
    private lateinit var output: MidiOutputPort
    private lateinit var deviceCallback: MidiManager.DeviceCallback
    private var openCallback: MidiManager.OnDeviceOpenedListener? = null
    private var usbTimeout: Runnable? = null

    @Before fun setup() {
        loopers = mockStatic(Looper::class.java)
        logging = mockStatic(Logger::class.java)
        handlers = mockConstruction(Handler::class.java) { handler, _ ->
            `when`(handler.post(any(Runnable::class.java))).thenAnswer {
                it.getArgument<Runnable>(0).run()
                true
            }
            `when`(handler.postDelayed(any(Runnable::class.java), eq(15_000L))).thenAnswer {
                usbTimeout = it.getArgument(0)
                true
            }
        }
        val context = mock(Context::class.java)
        val packages = mock(PackageManager::class.java)
        val bridge = mock(Bridge::class.java)
        manager = mock(MidiManager::class.java)
        `when`(bridge.context).thenReturn(context)
        `when`(context.packageManager).thenReturn(packages)
        `when`(packages.hasSystemFeature(PackageManager.FEATURE_MIDI)).thenReturn(true)
        `when`(context.getSystemService(Context.MIDI_SERVICE)).thenReturn(manager)
        usb = device(4, MidiDeviceInfo.TYPE_USB)
        val bluetooth = device(9, MidiDeviceInfo.TYPE_BLUETOOTH)
        `when`(manager.devices).thenReturn(arrayOf(usb, bluetooth))
        doAnswer {
            deviceCallback = it.getArgument(0)
            null
        }.`when`(manager).registerDeviceCallback(any(MidiManager.DeviceCallback::class.java), any(Handler::class.java))
        doAnswer {
            openCallback = it.getArgument(1)
            null
        }.`when`(manager).openDevice(any(MidiDeviceInfo::class.java), any(MidiManager.OnDeviceOpenedListener::class.java), any(Handler::class.java))
        opened = mock(MidiDevice::class.java)
        output = mock(MidiOutputPort::class.java)
        `when`(opened.openOutputPort(0)).thenReturn(output)
        plugin = NativeMidiPlugin()
        plugin.setBridge(bridge)
    }

    @After fun cleanup() {
        handlers.close()
        logging.close()
        loopers.close()
    }

    private fun device(id: Int, type: Int): MidiDeviceInfo {
        val info = mock(MidiDeviceInfo::class.java)
        val port = mock(MidiDeviceInfo.PortInfo::class.java)
        val properties = mock(Bundle::class.java)
        `when`(info.id).thenReturn(id)
        `when`(info.type).thenReturn(type)
        `when`(info.properties).thenReturn(properties)
        `when`(properties.getString(MidiDeviceInfo.PROPERTY_NAME)).thenReturn("Test piano")
        `when`(info.ports).thenReturn(arrayOf(port))
        `when`(port.type).thenReturn(MidiDeviceInfo.PortInfo.TYPE_OUTPUT)
        `when`(port.portNumber).thenReturn(0)
        `when`(port.name).thenReturn("")
        return info
    }

    private fun select(id: String = "4:0"): PluginCall {
        val call = mock(PluginCall::class.java)
        `when`(call.getString("id")).thenReturn(id)
        plugin.select(call)
        return call
    }

    private fun lifecycle(name: String) {
        NativeMidiPlugin::class.java.getDeclaredMethod(name).apply { isAccessible = true }.invoke(plugin)
    }

    private fun open() {
        plugin.start(mock(PluginCall::class.java))
        select()
        openCallback!!.onDeviceOpened(opened)
    }

    @Test fun discoveryIsGestureGatedAndUsbOnly() {
        verifyNoInteractions(manager)
        val call = mock(PluginCall::class.java)
        plugin.start(call)
        val result = ArgumentCaptor.forClass(JSObject::class.java)
        verify(call).resolve(result.capture())
        val inputs = result.value.getJSONArray("inputs")
        assertEquals(1, inputs.length())
        assertEquals("4:0", inputs.getJSONObject(0).getString("id"))
        verify(manager, never()).openDevice(any(), any(), any())
        verify(manager, never()).openBluetoothDevice(any(), any(), any())
    }

    @Test fun pauseClosesPortAndResumeOnlyRestartsDiscovery() {
        open()
        lifecycle("handleOnPause")
        verify(output).disconnect(any(MidiReceiver::class.java))
        verify(output).close()
        verify(opened).close()
        verify(manager).unregisterDeviceCallback(deviceCallback)
        lifecycle("handleOnResume")
        verify(manager, times(2)).registerDeviceCallback(any(), any(Handler::class.java))
        verify(manager, times(1)).openDevice(any(), any(), any())
        // Returning to the foreground must not reopen the old port silently.
        val call = mock(PluginCall::class.java)
        plugin.start(call)
        val result = ArgumentCaptor.forClass(JSObject::class.java)
        verify(call).resolve(result.capture())
        assertEquals("", result.value.getString("selectedId"))
    }

    @Test fun disconnectReleasesInputEvenWhenTheDriverThrowsOnClose() {
        open()
        doThrow(java.io.IOException("Detached driver")).`when`(output).close()
        `when`(manager.devices).thenReturn(emptyArray())
        deviceCallback.onDeviceRemoved(usb)
        verify(opened).close()
        val call = mock(PluginCall::class.java)
        plugin.start(call)
        val result = ArgumentCaptor.forClass(JSObject::class.java)
        verify(call).resolve(result.capture())
        assertEquals("", result.value.getString("selectedId"))
        assertEquals(0, result.value.getJSONArray("inputs").length())
    }

    @Test fun lateOpenAfterPauseIsClosedAndCannotAttachAReceiver() {
        plugin.start(mock(PluginCall::class.java))
        val call = select()
        lifecycle("handleOnPause")
        verify(call).reject("MIDI paused while the app is in the background.")
        openCallback!!.onDeviceOpened(opened)
        verify(opened).close()
        verify(opened, never()).openOutputPort(anyInt())
    }

    @Test fun stopAndActivityDestructionUnregisterCallbacksAndClosePorts() {
        open()
        val call = mock(PluginCall::class.java)
        plugin.stop(call)
        verify(call).resolve()
        verify(output).close()
        verify(opened).close()
        verify(manager).unregisterDeviceCallback(deviceCallback)
        lifecycle("handleOnDestroy")
        verify(output, times(1)).close()
        val afterDestroy = mock(PluginCall::class.java)
        plugin.start(afterDestroy)
        verify(afterDestroy).reject("Return to ClefGlide before connecting MIDI.")
    }

    @Test fun lateOpenAfterDestructionIsClosedWithoutAttachingAReceiver() {
        plugin.start(mock(PluginCall::class.java))
        val call = select()
        lifecycle("handleOnDestroy")
        verify(call).reject("MIDI activity destroyed.")
        openCallback!!.onDeviceOpened(opened)
        verify(opened).close()
        verify(opened, never()).openOutputPort(anyInt())
    }

    @Test fun receiverSendsNormalizedPacketsAndIgnoresOldConnectionAfterDetach() {
        val listener = mock(PluginCall::class.java)
        `when`(listener.getString("eventName")).thenReturn("midi")
        plugin.addListener(listener)
        open()
        val capture = ArgumentCaptor.forClass(MidiReceiver::class.java)
        verify(output).connect(capture.capture())
        val bytes = byteArrayOf(0x91.toByte(), 60, 100)
        capture.value.onSend(bytes, 0, bytes.size, 1_000_000L)
        val packet = ArgumentCaptor.forClass(JSObject::class.java)
        verify(listener).resolve(packet.capture())
        assertEquals("on", packet.value.getString("type"))
        assertEquals(60, packet.value.getInt("pitch"))
        assertEquals(2, packet.value.getInt("channel"))
        assertEquals(1.0, packet.value.getDouble("timestampMs"), 0.0)
        deviceCallback.onDeviceRemoved(usb)
        capture.value.onSend(bytes, 0, bytes.size, 2_000_000L)
        verify(listener, times(1)).resolve(any(JSObject::class.java))
    }

    private val bleId = "ble:01:02:03:04:05:06"
    // Mockito's Java matchers return null; Kotlin APIs require non-null arguments.
    private fun anyOpen(): (MidiDevice?, String?) -> Unit = any<(MidiDevice?, String?) -> Unit>() ?: { _, _ -> }
    private fun bluetooth(): BluetoothMidiManager {
        val ble = mock(BluetoothMidiManager::class.java)
        `when`(ble.inputs).thenReturn(listOf(BluetoothMidiManager.Input(bleId, "Test piano (Bluetooth MIDI)")))
        NativeMidiPlugin::class.java.getDeclaredField("bluetooth").apply { isAccessible = true }.set(plugin, ble)
        return ble
    }

    @Test fun bluetoothAndUsbSharePickerAndSwitchClosesUsbBeforeBluetoothOpen() {
        open()
        val ble = bluetooth()
        val call = mock(PluginCall::class.java)
        plugin.start(call)
        val state = ArgumentCaptor.forClass(JSObject::class.java)
        verify(call).resolve(state.capture())
        assertEquals(2, state.value.getJSONArray("inputs").length())
        assertEquals(bleId, state.value.getJSONArray("inputs").getJSONObject(1).getString("id"))
        select(bleId)
        val order = inOrder(output, opened, ble)
        order.verify(output).close()
        order.verify(opened).close()
        order.verify(ble).open(eq(bleId) ?: bleId, anyOpen())
    }

    @Test fun bluetoothUsesSharedParserForChordsNotesAndPedalWithNativeTimestamps() {
        plugin.start(mock(PluginCall::class.java))
        val ble = bluetooth()
        val info = device(9, MidiDeviceInfo.TYPE_BLUETOOTH)
        `when`(opened.info).thenReturn(info)
        doAnswer {
            it.getArgument<(MidiDevice?, String?) -> Unit>(1).invoke(opened, null)
            null
        }.`when`(ble).open(eq(bleId) ?: bleId, anyOpen())
        val listener = mock(PluginCall::class.java)
        `when`(listener.getString("eventName")).thenReturn("midi")
        plugin.addListener(listener)
        val selection = select(bleId)
        val state = ArgumentCaptor.forClass(JSObject::class.java)
        verify(selection).resolve(state.capture())
        assertEquals(bleId, state.value.getString("selectedId"))
        val capture = ArgumentCaptor.forClass(MidiReceiver::class.java)
        verify(output).connect(capture.capture())
        // Native MidiManager has already decoded BLE framing and timestamps.
        val bytes = byteArrayOf(0x91.toByte(), 60, 90, 64, 90, 67, 90, 0xb1.toByte(), 64, 127,
            0x91.toByte(), 60, 0, 0x81.toByte(), 64, 80, 67, 0, 0xb1.toByte(), 64, 0)
        capture.value.onSend(bytes, 0, bytes.size, 123_000_000L)
        val packets = ArgumentCaptor.forClass(JSObject::class.java)
        verify(listener, times(8)).resolve(packets.capture())
        assertEquals(listOf("on", "on", "on", "sustain", "off", "off", "off", "sustain"),
            packets.allValues.map { it.getString("type") })
        assertTrue(packets.allValues.all { it.getDouble("timestampMs") == 123.0 && it.getInt("channel") == 2 })
        deviceCallback.onDeviceRemoved(info)
        verify(output).close()
        verify(opened).close()
        capture.value.onSend(bytes, 0, bytes.size, 124_000_000L)
        verify(listener, times(8)).resolve(any(JSObject::class.java))
    }

    @Test fun switchingToUsbRejectsPendingBluetoothAndClosesItsLateOpen() {
        plugin.start(mock(PluginCall::class.java))
        val ble = bluetooth()
        var complete: ((MidiDevice?, String?) -> Unit)? = null
        doAnswer { complete = it.getArgument(1); null }.`when`(ble).open(eq(bleId) ?: bleId, anyOpen())
        val selection = select(bleId)
        select("4:0")
        verify(selection).reject("MIDI selection changed.")
        val late = mock(MidiDevice::class.java)
        complete!!(late, null)
        verify(late).close()
        verify(late, never()).openOutputPort(anyInt())
        openCallback!!.onDeviceOpened(opened)
        verify(output).connect(any(MidiReceiver::class.java))
    }

    @Test fun bluetoothWithoutSendingPortIsReleasedAndPauseStopsBluetoothResources() {
        plugin.start(mock(PluginCall::class.java))
        val ble = bluetooth()
        val info = device(9, MidiDeviceInfo.TYPE_BLUETOOTH)
        `when`(info.ports).thenReturn(emptyArray())
        `when`(opened.info).thenReturn(info)
        doAnswer { it.getArgument<(MidiDevice?, String?) -> Unit>(1).invoke(opened, null); null }
            .`when`(ble).open(eq(bleId) ?: bleId, anyOpen())
        val selection = select(bleId)
        verify(selection).reject("Bluetooth MIDI device has no sending port. Choose another input.")
        verify(opened).close()
        lifecycle("handleOnPause")
        verify(ble).pause()
        lifecycle("handleOnStop")
        verify(ble).stop()
        lifecycle("handleOnResume")
        verify(ble).resume()
        verify(ble, times(1)).open(eq(bleId) ?: bleId, anyOpen())
    }

    @Test fun usbTimeoutReportsFailureRejectsPendingCallAndClosesLateDevice() {
        plugin.start(mock(PluginCall::class.java))
        val selection = select()
        val connecting = mock(PluginCall::class.java)
        plugin.start(connecting)
        val state = ArgumentCaptor.forClass(JSObject::class.java)
        verify(connecting).resolve(state.capture())
        assertEquals("connecting", state.value.getString("phase"))
        assertEquals("4:0", state.value.getString("pendingId"))
        usbTimeout!!.run()
        verify(selection).reject("USB MIDI connection timed out. Choose the input to retry.")
        openCallback!!.onDeviceOpened(opened)
        verify(opened).close()
        verify(opened, never()).openOutputPort(anyInt())
        val after = mock(PluginCall::class.java)
        plugin.start(after)
        verify(after).resolve(state.capture())
        assertEquals("failed", state.value.getString("phase"))
        assertEquals("", state.value.getString("pendingId"))
        assertTrue(state.value.getString("status")!!.contains("timed out"))
        verify(manager, times(1)).registerDeviceCallback(any(), any(Handler::class.java))
        verify(manager, never()).openBluetoothDevice(any(), any(), any())
    }
}
