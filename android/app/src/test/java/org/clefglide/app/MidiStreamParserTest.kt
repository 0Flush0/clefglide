package org.clefglide.app

import org.junit.Assert.assertEquals
import org.junit.Test

class MidiStreamParserTest {
    private data class Event(val type: String, val pitch: Int, val velocity: Int, val channel: Int, val time: Long)
    private val events = mutableListOf<Event>()
    private val parser = MidiStreamParser { type, pitch, velocity, channel, time ->
        events += Event(type, pitch, velocity, channel, time)
    }

    private fun send(vararg values: Int, time: Long = 100L) {
        val bytes = values.map { it.toByte() }.toByteArray()
        parser.receive(bytes, 0, bytes.size, time)
    }

    @Test fun normalizesNotesAndSustainAcrossChannels() {
        send(0x91, 60, 100, 60, 0, 0x81, 61, 70, 0xb1, 64, 127, 64, 0)
        assertEquals(listOf(
            Event("on", 60, 100, 2, 100), Event("off", 60, 0, 2, 100),
            Event("off", 61, 0, 2, 100), Event("sustain", 64, 127, 2, 100),
            Event("sustain", 64, 0, 2, 100)
        ), events)
    }

    @Test fun retainsPartialMessagesAndRunningStatusWithRealTimeInterleaving() {
        send(0x9f, 60, time = 100)
        send(0xf8, 100, 61, time = 200)
        send(90, time = 300)
        assertEquals(listOf(Event("on", 60, 100, 16, 100), Event("on", 61, 90, 16, 200)), events)
    }

    @Test fun ignoresSysExSystemMessagesAndOtherControllers() {
        send(0x90, 60, 100, 0xf0, 1, 2, 0xf8, 3, 0xf7, 60, 90)
        send(0xf2, 0, 0, 0xb0, 1, 127, 0xc0, 42, 0xd0, 40, 0x90, 62, 90)
        assertEquals(listOf(Event("on", 60, 100, 1, 100), Event("on", 62, 90, 1, 100)), events)
    }

    @Test fun respectsReceiverOffsetAndLength() {
        val bytes = byteArrayOf(0, 0x90.toByte(), 60, 80, 0)
        parser.receive(bytes, 1, 3, 900)
        assertEquals(listOf(Event("on", 60, 80, 1, 900)), events)
    }

    @Test fun separateConnectionsDoNotInheritPartialOrRunningStatus() {
        send(0x90, 60)
        val replacement = MidiStreamParser { type, pitch, velocity, channel, time ->
            events += Event(type, pitch, velocity, channel, time)
        }
        replacement.receive(byteArrayOf(100, 61, 90), 0, 3, 200)
        assertEquals(emptyList<Event>(), events)
    }
}
