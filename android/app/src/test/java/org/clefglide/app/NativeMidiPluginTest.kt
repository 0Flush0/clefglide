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

    @Before fun setup() {
        loopers = mockStatic(Looper::class.java)
        logging = mockStatic(Logger::class.java)
        handlers = mockConstruction(Handler::class.java) { handler, _ ->
            `when`(handler.post(any(Runnable::class.java))).thenAnswer {
                it.getArgument<Runnable>(0).run()
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

    private fun select(): PluginCall {
        val call = mock(PluginCall::class.java)
        `when`(call.getString("id")).thenReturn("4:0")
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
}
