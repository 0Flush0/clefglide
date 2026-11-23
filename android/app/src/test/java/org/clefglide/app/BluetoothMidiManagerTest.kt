package org.clefglide.app

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanRecord
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.media.midi.MidiDevice
import android.media.midi.MidiManager
import android.os.Handler
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.ArgumentMatchers.*
import org.mockito.MockedConstruction
import org.mockito.MockedStatic
import org.mockito.Mockito.*
import java.util.UUID

/** JVM simulations only: no radio, Android permission UI, GATT or real MIDI hardware. */
class BluetoothMidiManagerTest {
    private lateinit var context: Context
    private lateinit var packages: PackageManager
    private lateinit var midi: MidiManager
    private lateinit var adapter: BluetoothAdapter
    private lateinit var scanner: BluetoothLeScanner
    private lateinit var main: Handler
    private lateinit var manager: BluetoothMidiManager
    private lateinit var compat: MockedStatic<ContextCompat>
    private lateinit var uuids: MockedStatic<ParcelUuid>
    private lateinit var filters: MockedConstruction<ScanFilter.Builder>
    private lateinit var settings: MockedConstruction<ScanSettings.Builder>
    private lateinit var intents: MockedConstruction<android.content.IntentFilter>
    private var callback: ScanCallback? = null
    private var receiver: BroadcastReceiver? = null
    private val timers = mutableMapOf<Long, Runnable>()
    private val openCallbacks = mutableListOf<MidiManager.OnDeviceOpenedListener>()
    private val messages = mutableListOf<String?>()
    private val losses = mutableListOf<Pair<String, String>>()
    private val permissionRequests = mutableListOf<String>()
    private val completions = mutableListOf<String?>()
    private val opens = mutableListOf<Pair<MidiDevice?, String?>>()
    private val id = "ble:01:02:03:04:05:06"

    @Before fun setup() {
        context = mock(Context::class.java)
        packages = mock(PackageManager::class.java)
        midi = mock(MidiManager::class.java)
        adapter = mock(BluetoothAdapter::class.java)
        scanner = mock(BluetoothLeScanner::class.java)
        main = mock(Handler::class.java)
        val bluetooth = mock(BluetoothManager::class.java)
        `when`(context.packageManager).thenReturn(packages)
        `when`(packages.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)).thenReturn(true)
        `when`(context.checkSelfPermission(anyString())).thenReturn(PackageManager.PERMISSION_GRANTED)
        `when`(context.getSystemService(Context.BLUETOOTH_SERVICE)).thenReturn(bluetooth)
        `when`(bluetooth.adapter).thenReturn(adapter)
        `when`(adapter.isEnabled).thenReturn(true)
        `when`(adapter.bluetoothLeScanner).thenReturn(scanner)
        `when`(main.post(any(Runnable::class.java))).thenAnswer { it.getArgument<Runnable>(0).run(); true }
        `when`(main.postDelayed(any(Runnable::class.java), anyLong())).thenAnswer {
            timers[it.getArgument(1)] = it.getArgument(0); true
        }
        doAnswer { invocation ->
            val task = invocation.getArgument<Runnable>(0)
            timers.entries.removeAll { it.value === task }
            null
        }.`when`(main).removeCallbacks(any(Runnable::class.java))
        doAnswer { callback = it.getArgument(2); null }.`when`(scanner).startScan(anyList(), any(ScanSettings::class.java), any(ScanCallback::class.java))
        doAnswer { openCallbacks += it.getArgument<MidiManager.OnDeviceOpenedListener>(1); null }
            .`when`(midi).openBluetoothDevice(any(BluetoothDevice::class.java), any(MidiManager.OnDeviceOpenedListener::class.java), any(Handler::class.java))
        compat = mockStatic(ContextCompat::class.java)
        compat.`when`<Intent?> { ContextCompat.registerReceiver(eq(context), any(BroadcastReceiver::class.java), any(android.content.IntentFilter::class.java), eq(ContextCompat.RECEIVER_EXPORTED)) }
            .thenAnswer { receiver = it.getArgument(1); null }
        uuids = mockStatic(ParcelUuid::class.java)
        val serviceUuid = uuid(BluetoothMidiManager.MIDI_SERVICE_UUID)
        uuids.`when`<ParcelUuid> { ParcelUuid.fromString(BluetoothMidiManager.MIDI_SERVICE_UUID) }.thenReturn(serviceUuid)
        filters = mockConstruction(ScanFilter.Builder::class.java) { builder, _ ->
            `when`(builder.setServiceUuid(any(ParcelUuid::class.java))).thenReturn(builder)
            `when`(builder.build()).thenReturn(mock(ScanFilter::class.java))
        }
        settings = mockConstruction(ScanSettings.Builder::class.java) { builder, _ ->
            `when`(builder.setScanMode(anyInt())).thenReturn(builder)
            `when`(builder.build()).thenReturn(mock(ScanSettings::class.java))
        }
        intents = mockConstruction(android.content.IntentFilter::class.java)
        manager = create(36)
    }

    @After fun cleanup() {
        intents.close(); settings.close(); filters.close(); uuids.close(); compat.close()
    }

    private fun create(api: Int) = BluetoothMidiManager(context, midi, main,
        { messages += it }, { device, message -> losses += device to message }, api)

    private fun discover() = manager.discover({ permissionRequests += it }, { completions += it })
    private fun open() = manager.open(id) { device, error -> opens += device to error }
    private fun expire(ms: Long) = timers.getValue(ms).run()
    private fun uuid(value: String): ParcelUuid = mock(ParcelUuid::class.java).also {
        `when`(it.uuid).thenReturn(UUID.fromString(value))
    }
    private fun advertise(service: String = BluetoothMidiManager.MIDI_SERVICE_UUID, address: String = "01:02:03:04:05:06") {
        val result = mock(ScanResult::class.java)
        val record = mock(ScanRecord::class.java)
        val device = mock(BluetoothDevice::class.java)
        `when`(result.device).thenReturn(device)
        `when`(result.scanRecord).thenReturn(record)
        val advertisedUuid = uuid(service)
        `when`(record.serviceUuids).thenReturn(listOf(advertisedUuid))
        `when`(record.deviceName).thenReturn("Test piano")
        `when`(device.address).thenReturn(address)
        callback!!.onScanResult(0, result)
    }

    @Test fun constructionDoesNothingAndPermissionsAreVersionedAndGestureGated() {
        verifyNoInteractions(adapter, scanner, midi)
        assertEquals(listOf(Manifest.permission.ACCESS_FINE_LOCATION), BluetoothMidiManager.permissions(30).toList())
        assertEquals(listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT), BluetoothMidiManager.permissions(31).toList())
        `when`(context.checkSelfPermission(anyString())).thenReturn(PackageManager.PERMISSION_DENIED)
        discover()
        assertEquals(listOf("bluetooth"), permissionRequests)
        assertEquals("permission", manager.phase)
        verifyNoInteractions(scanner)
        manager.permissionsResult()
        assertTrue(completions.single()!!.contains("permission denied"))
        assertEquals("idle", manager.phase)
        verifyNoInteractions(scanner, midi)
        manager = create(30)
        discover()
        assertEquals("bluetoothLocation", permissionRequests.last())
        manager.stop()
    }

    @Test fun permissionGrantAfterDialogPauseWaitsForResumeButBackgroundCancels() {
        `when`(context.checkSelfPermission(anyString())).thenReturn(PackageManager.PERMISSION_DENIED)
        discover()
        manager.pause()
        `when`(context.checkSelfPermission(anyString())).thenReturn(PackageManager.PERMISSION_GRANTED)
        manager.permissionsResult()
        verifyNoInteractions(scanner)
        manager.resume()
        assertEquals(listOf<String?>(null), completions)
        assertNotNull(callback)
        manager.stop()
        `when`(context.checkSelfPermission(anyString())).thenReturn(PackageManager.PERMISSION_DENIED)
        manager.resume()
        discover()
        manager.stop()
        assertTrue(completions.last()!!.contains("cancelled"))
        val starts = filters.constructed().size
        `when`(context.checkSelfPermission(anyString())).thenReturn(PackageManager.PERMISSION_GRANTED)
        manager.permissionsResult()
        manager.resume()
        assertEquals(starts, filters.constructed().size)
    }

    @Test fun filtersMidiServiceDeduplicatesAndBoundsDiscovery() {
        discover()
        assertEquals("scanning", manager.phase)
        verify(filters.constructed().single()).setServiceUuid(ParcelUuid.fromString(BluetoothMidiManager.MIDI_SERVICE_UUID))
        advertise("0000180f-0000-1000-8000-00805f9b34fb")
        assertTrue(manager.inputs.isEmpty())
        advertise(); advertise()
        assertEquals(listOf(BluetoothMidiManager.Input(id, "Test piano (Bluetooth MIDI)")), manager.inputs)
        val old = callback!!
        expire(BluetoothMidiManager.SCAN_MS)
        verify(scanner).stopScan(old)
        assertTrue(manager.status!!.contains("finished"))
        assertEquals("idle", manager.phase)
        advertise(address = "11:22:33:44:55:66")
        assertEquals(1, manager.inputs.size)
        discover()
        assertTrue(manager.inputs.isEmpty())
        old.onScanFailed(3)
        assertTrue(manager.status!!.contains("Discovering"))
        expire(BluetoothMidiManager.SCAN_MS)
        assertTrue(manager.status!!.contains("No Bluetooth MIDI"))
    }

    @Test fun unavailableDisabledLocationAndScanFailureAreActionable() {
        `when`(packages.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)).thenReturn(false)
        discover()
        assertTrue(completions.last()!!.contains("unavailable"))
        `when`(packages.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)).thenReturn(true)
        `when`(adapter.isEnabled).thenReturn(false)
        discover()
        assertTrue(completions.last()!!.contains("Bluetooth is off"))
        `when`(adapter.isEnabled).thenReturn(true)
        manager = create(30)
        discover()
        assertTrue(completions.last()!!.contains("Location services"))
        val location = mock(LocationManager::class.java)
        `when`(context.getSystemService(Context.LOCATION_SERVICE)).thenReturn(location)
        `when`(location.isProviderEnabled(LocationManager.GPS_PROVIDER)).thenReturn(true)
        discover()
        callback!!.onScanFailed(2)
        assertTrue(manager.status!!.contains("failed (2)"))
        assertEquals("failed", manager.phase)
        assertFalse(timers.containsKey(BluetoothMidiManager.SCAN_MS))
        verifyNoInteractions(midi)
    }

    @Test fun usesNativeBluetoothOpenAndTransfersOnlyOneDevice() {
        discover(); advertise(); open()
        verify(scanner).stopScan(any(ScanCallback::class.java))
        verify(midi, never()).openDevice(any(), any(), any())
        val opened = mock(MidiDevice::class.java)
        openCallbacks.single().onDeviceOpened(opened)
        assertEquals(listOf(opened to null), opens)
        assertFalse(timers.containsKey(BluetoothMidiManager.OPEN_MS))
        manager.cancelConnection()
        // The plugin owns accepted devices and their ports.
        verify(opened, never()).close()
        open()
        val stale = mock(MidiDevice::class.java)
        manager.pause()
        openCallbacks.last().onDeviceOpened(stale)
        verify(stale).close()
        verify(context).unregisterReceiver(receiver)
        manager.resume()
        assertTrue(manager.inputs.isEmpty())
        assertEquals(1, opens.size)
    }

    @Test fun timeoutSwitchAndDuplicateCallbacksCloseLateDevices() {
        discover(); advertise(); open()
        val first = openCallbacks.single()
        expire(BluetoothMidiManager.OPEN_MS)
        assertTrue(opens.single().second!!.contains("timed out"))
        val late = mock(MidiDevice::class.java)
        first.onDeviceOpened(late)
        verify(late).close()
        open()
        val second = openCallbacks.last()
        manager.cancelConnection()
        open()
        val obsolete = mock(MidiDevice::class.java)
        second.onDeviceOpened(obsolete)
        verify(obsolete).close()
        val accepted = mock(MidiDevice::class.java)
        openCallbacks.last().onDeviceOpened(accepted)
        val duplicate = mock(MidiDevice::class.java)
        openCallbacks.last().onDeviceOpened(duplicate)
        verify(duplicate).close()
        assertEquals(2, opens.size)
    }

    @Test fun nullAndPermissionRevocationFailWithoutPromptingOnSelection() {
        discover(); advertise(); open()
        openCallbacks.single().onDeviceOpened(null)
        assertTrue(opens.last().second!!.contains("Could not open"))
        `when`(context.checkSelfPermission(anyString())).thenReturn(PackageManager.PERMISSION_DENIED)
        open()
        assertTrue(opens.last().second!!.contains("permission is missing"))
        assertTrue(permissionRequests.isEmpty())
        verify(midi, times(1)).openBluetoothDevice(any(), any(), any())
    }

    @Test fun radioOffCancelsScanAndPendingOpenAndIgnoresBroadcastsAfterPause() {
        discover(); advertise(); open()
        val intent = mock(Intent::class.java)
        `when`(intent.action).thenReturn(BluetoothAdapter.ACTION_STATE_CHANGED)
        `when`(intent.getIntExtra(eq(BluetoothAdapter.EXTRA_STATE), anyInt())).thenReturn(BluetoothAdapter.STATE_OFF)
        receiver!!.onReceive(context, intent)
        assertEquals(id, losses.single().first)
        assertTrue(manager.inputs.isEmpty())
        val late = mock(MidiDevice::class.java)
        openCallbacks.single().onDeviceOpened(late)
        verify(late).close()
        manager.pause()
        receiver!!.onReceive(context, intent)
        assertEquals(1, losses.size)
    }

    @Test fun physicalDisconnectRemovesCandidateAndReconnectionRequiresFreshDiscovery() {
        discover(); advertise(); open()
        openCallbacks.single().onDeviceOpened(mock(MidiDevice::class.java))
        val intent = mock(Intent::class.java)
        val disconnected = mock(BluetoothDevice::class.java)
        `when`(intent.action).thenReturn(BluetoothDevice.ACTION_ACL_DISCONNECTED)
        `when`(intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)).thenReturn(disconnected)
        `when`(disconnected.address).thenReturn("11:22:33:44:55:66")
        receiver!!.onReceive(context, intent)
        assertTrue(losses.isEmpty())
        `when`(disconnected.address).thenReturn("01:02:03:04:05:06")
        receiver!!.onReceive(context, intent)
        assertEquals(id, losses.single().first)
        assertTrue(manager.inputs.isEmpty())
        assertEquals(1, openCallbacks.size)
        discover(); advertise(); open()
        assertEquals(2, openCallbacks.size)
    }

    @Test fun securityExceptionsReleaseResourcesAndReportRetryWithoutCrashing() {
        doThrow(SecurityException("revoked")).`when`(scanner).startScan(anyList(), any(ScanSettings::class.java), any(ScanCallback::class.java))
        discover()
        assertTrue(completions.single()!!.contains("permission was revoked"))
        assertTrue(timers.isEmpty())
        doAnswer { callback = it.getArgument(2); null }.`when`(scanner).startScan(anyList(), any(ScanSettings::class.java), any(ScanCallback::class.java))
        discover(); advertise()
        doThrow(SecurityException("revoked")).`when`(midi).openBluetoothDevice(any(), any(), any())
        open()
        assertTrue(opens.single().second!!.contains("permission was revoked"))
        assertTrue(timers.isEmpty())
    }

    @Test fun staleRadioBroadcastAfterResumeCannotInvalidateNewDiscovery() {
        discover()
        val oldReceiver = receiver!!
        manager.pause()
        manager.resume()
        discover(); advertise()
        val intent = mock(Intent::class.java)
        `when`(intent.action).thenReturn(BluetoothAdapter.ACTION_STATE_CHANGED)
        `when`(intent.getIntExtra(eq(BluetoothAdapter.EXTRA_STATE), anyInt())).thenReturn(BluetoothAdapter.STATE_OFF)
        oldReceiver.onReceive(context, intent)
        assertEquals(1, manager.inputs.size)
        assertTrue(manager.status!!.contains("Discovering"))
        assertTrue(losses.isEmpty())
    }
}
