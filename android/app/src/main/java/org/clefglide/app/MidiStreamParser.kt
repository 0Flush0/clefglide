package org.clefglide.app

/** MIDI 1.0 byte stream decoder. No SysEx data is collected or forwarded. */
internal class MidiStreamParser(
    private val emit: (type: String, pitch: Int, velocity: Int, channel: Int, timestamp: Long) -> Unit
) {
    private var status = 0
    private var count = 0
    private var first = 0
    private var messageTime = 0L

    @Synchronized
    fun receive(bytes: ByteArray, offset: Int, length: Int, timestamp: Long) {
        for (index in offset until offset + length) {
            val value = bytes[index].toInt() and 0xff
            // Real-time bytes may appear between any two message bytes.
            if (value >= 0xf8) continue
            if (value >= 0x80) {
                status = if (value < 0xf0) value else 0
                count = 0
                messageTime = timestamp
                continue
            }
            if (status == 0) continue
            val kind = status and 0xf0
            if (count == 0) {
                first = value
                if (messageTime == 0L) messageTime = timestamp
                count = 1
                // Program change and channel pressure have one data byte.
                if (kind != 0xc0 && kind != 0xd0) continue
            } else {
                val channel = (status and 0x0f) + 1
                when (kind) {
                    0x80 -> emit("off", first, 0, channel, messageTime)
                    0x90 -> emit(if (value == 0) "off" else "on", first, value, channel, messageTime)
                    0xb0 -> if (first == 64) emit("sustain", 64, value, channel, messageTime)
                }
            }
            count = 0
            messageTime = 0L
        }
    }
}
