# Practice guide

## Start an exercise

Choose your difficulty, note range, hand and clef. Select **Start practice**, then play the highlighted note or chord. Expand **Virtual piano** for touch input or use the computer keys `A W S E D F T G Y H U J K O L P ;`. The virtual piano uses the shared scoring engine and is silent.

The five difficulty controls independently adjust note jumps, hand movements, finger spacing, accidentals and chords. Ranges and other difficulty settings are preserved when you change a level. A narrow range can limit available positions and chord shapes. **Advanced settings** contains the key, meter, rhythm, seed and precise limits. See the [implementation decisions](DECISIONS.md) for the rules and supported musical scope.

Apply structural changes with **Apply & generate**, **New exercise**, or **Apply & play**. The last option starts the new exercise immediately. **Restart** reproduces the seed. Pause or select **Save & finish** to save progress.

## Hints and scoring

**Smart** shows starting fingers, necessary spacing exceptions and planned landings. A cue on the preceding rest gives time to prepare for a move. **All** shows each planned finger, and **None** hides automatic hints. **Reveal hint** shows passage fingering and the next planned move. Hint changes take effect during practice while the score and grading continue. Once hints have been used, the attempt counts as assisted. Start a fresh exercise with **None** for independent practice. Benchmark mode disables reveal.

Guided practice waits for the correct pitches and reports correct notes per active minute, including thinking time. Timed practice counts in for one bar and reports timing accuracy using the selected tolerance and input offset. The timed pitch-match window is ±450 ms. Chords have a 120 ms simultaneous attack window and separate chord-event and note accuracy. Release and strike again for repeated notes, including when using sustain. MIDI measures key events. The finger numbers describe a suggested plan.

## Connect a MIDI keyboard

Use Chrome on HTTPS or localhost. Attach the keyboard, select **Connect MIDI**, grant permission and choose an input. SysEx is disabled. Use all channels unless you need a filter. If the keyboard disconnects, reconnect and resume manually.

- For USB, use a data cable in the instrument’s USB MIDI port. A keyboard with five-pin DIN MIDI needs a USB MIDI interface connected from the keyboard’s MIDI OUT to the interface’s MIDI IN. Android may need a USB-C/OTG adapter and external power.
- For Bluetooth, use a BLE-MIDI keyboard or adapter and expose it as a MIDI input through a compatible system tool or bridge. **Settings & help** has platform-specific instructions. Compatibility depends on the instrument, operating system and bridge.
- If no input appears, check system device detection, the keyboard’s MIDI mode, the cable, power, Chrome permissions and other apps using the port.

Ordinary HTTP pages on a LAN can use the simulator. Safari on iPadOS is outside the supported MIDI setup. See the [physical QA checklist](QA_CHECKLIST.md#physical-piano-outstanding) for the device checks still due.

## Local data and backups

Practice settings and sessions are stored in IndexedDB on the current browser and site origin. Sessions include timestamps, exercise settings, seeds and derived pitch and timing outcomes. The language preference is stored in localStorage. Recent input diagnostics are displayed in memory. The app does not upload practice data.

Use **Progress** to export a JSON backup or a CSV summary. The JSON file contains detailed session data, so share it only with people you want to have that history. Delete individual sessions from Progress or clear the site’s browser data to remove its local history and settings. Export first if you want to restore them later.

Progress compares matching difficulty, mode, generator version and assistance by default. Legacy histories retain their original settings and comparison fingerprints. Exact seed replay depends on the original generator version. JSON backups from SightFlow remain compatible with ClefGlide on import.
