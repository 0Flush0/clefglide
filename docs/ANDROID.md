# Android

ClefGlide uses the same React/Vite application on the web and in an Android Capacitor WebView. Capacitor copies the existing `dist/` production build into the APK; it does not load the hosted website. Virtual-piano practice works without a MIDI device. Bluetooth MIDI and iOS are outside this version.

## Run on your phone from Windows

Use Node.js 24 and Android Studio 2025.2.1 or newer. In Android Studio's SDK Manager, install Android SDK Platform 36 and the SDK build/platform tools. Use Android Studio's bundled JDK 21 for Gradle. The app supports Android 7.0/API 24 or later with a current Android System WebView.

From the repository root:

```powershell
npm ci
npm run android:sync
npm run android:open
```

On your phone, enable **Developer options → USB debugging**. Connect it to the PC with a data cable, unlock it, and accept the debugging prompt. In Android Studio, wait for Gradle sync, select your **physical phone** and the **app** run configuration, then press **Run**. No emulator is needed. Select **Start practice** and open **Virtual piano** to try the shared application first.

Once installed, disconnect the PC and connect a class-compliant USB MIDI keyboard using a suitable USB-C/OTG adapter (and a powered hub if the keyboard needs it). In ClefGlide, select **Connect MIDI**, choose the keyboard's sending port, and start practice. The app stays installed and runs locally without the PC or a server.

After changing web code, run `npm run android:sync` again before running from Android Studio. After changing only Kotlin, rebuild/run in Android Studio. Keep `org.clefglide.app` and Capacitor's local origin stable so updates retain the app's IndexedDB data.

If `android:open` cannot find a nonstandard Android Studio installation, open the `android/` folder from Android Studio directly, or set `CAPACITOR_ANDROID_STUDIO_PATH` to the full path of `studio64.exe`.

For command-line builds, set `JAVA_HOME` to your JDK 21 and `ANDROID_HOME` to your SDK directory, then run:

```powershell
npm run android:sync
.\android\gradlew.bat -p android :app:assembleDebug :app:testDebugUnitTest
```

The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Release signing and Play Store publication are separate tasks. Signing keys and local SDK configuration are ignored by Git.

If using the optional workspace Node installation, follow [the Windows fallback](DEVELOPMENT.md#windows-workspace-fallback). The equivalent sync is `npm run build` with that npm entry point followed by `.tools/node.exe node_modules/@capacitor/cli/bin/capacitor sync android`; Android Studio can open `android/` directly.

## MIDI and lifecycle architecture

- `src/midi/adapter.ts` retains `MidiBus`, `MidiEvent` and the WEBMIDI.js adapter. `MidiAdapter` exposes only enable, input selection, selected input and disposal; construction never requests MIDI access.
- `src/midi/platform.ts` selects WEBMIDI.js in browsers and `AndroidMidi` on Android. Shared React practice, generation, notation, scoring and progress use the same contracts. A future native adapter can extend this selection without changing scoring.
- `src/midi/android.ts` subscribes to the local `NativeMidi` Capacitor plugin. Kotlin's `NativeMidiPlugin` uses Android `MidiManager` and exposes only USB devices with MIDI 1.0 byte-stream output ports. Android calls these **output** ports because the keyboard sends data to the app. No Bluetooth permission or SysEx request is made.
- `MidiStreamParser` decodes note-on/off, velocity-zero note-off and CC64 sustain, including running status and messages split across callbacks. Other controllers, system messages and SysEx payloads are ignored. Channels stay 1–16 and C4 stays MIDI 60. Native monotonic timestamps are calibrated to `performance.now()` through a short clock round trip rather than using JS delivery time; actual device and bridge latency still need measurement.
- Pause closes the selected port/device, unregisters discovery and invalidates pending opens and queued MIDI packets. The lifecycle listener pauses shared practice even with virtual input. Resume refreshes discovery; reconnect/select the keyboard and press **Start** manually. Removal closes the port and pauses practice. Disposal removes JS listeners and stops discovery; Activity destruction also releases native resources. Connection generations reject stale packets/callbacks after switching, pausing or disconnecting.

The app keeps the existing IndexedDB schema, export format and import validator. Android's WebView has its own local storage, separate from Chrome's website data; use JSON export/import to transfer history. App uninstall/data clearing removes local history. Android automatic cloud backup is disabled. `src/platform/download.ts` keeps the original browser download function and uses the local `ProgressFiles` plugin on Android to save identical JSON/CSV through the system document picker, without storage permissions. Imports use Capacitor's WebView file chooser and the existing importer.

The Vite web build, browser persistence implementation and deployment configuration remain unchanged.

## Verification and phone checks

### System bars and edge-to-edge layout

Capacitor 8.6.2's `SystemBars` uses `insetsHandling: "native"` with `initialViewportFitValueHint: "cover"`. `MainActivity.java` calls AndroidX `EdgeToEdge.enable`; the active WebView is Capacitor's match-parent bridge layout, not the unused template `activity_main.xml`. Android startup adds `viewport-fit=cover` before React mounts. The browser viewport remains unchanged.

The previous viewport omitted `cover`, so Capacitor padded the native decor and shortened the WebView. The resulting full-width native strip could never display the webpage's sidebar, regardless of its background color. The page also had no main-column safe-area spacing. `src/platform/android.css` now applies measured `env(safe-area-inset-*)` values inside the sidebar and main column, leaving their backgrounds edge-to-edge. The sidebar retains its existing responsive design padding; the phone header alone clears the top inset. The existing full-screen range dialog already handles safe areas. No root/body inset or additional native inset listener is added. Navigation bars are transparent where dark navigation icons are supported; system indicators remain visible.

WebView 140 or newer is required for this full edge-to-edge path. On older WebViews, Capacitor deliberately retains native padding and reports zero CSS insets; this avoids double compensation but can retain a native border. Update Android System WebView/Chrome before checking edge-to-edge behavior. See [Capacitor's SystemBars documentation](https://capacitorjs.com/docs/apis/system-bars).

Browser regression tests simulate changing safe-area values across portrait/landscape phones, tablets and both themes, including zero-inset fallback. They check sidebar coverage, heading clearance, footer accessibility and unchanged regular-web spacing. Physical verification must still cover actual inset delivery, screen cutouts, status/gesture indicator contrast, gesture and three-button navigation, rotation, keyboard open/close, and light/dark switching. No emulator or phone run is implied by browser simulations or an APK build.

Android's app shell stays viewport-sized; its main column owns vertical scrolling with `overscroll-behavior-y: contain`. The rail is outside that scroll container, including the horizontal phone header, so main-content boundary gestures cannot stretch the shared document and navigation. Regular web pages and the separate legal-notice route keep document scrolling. A browser regression checks actual wheel scrolling, bottom-boundary containment, stable rail geometry and working navigation; the Android stretch animation itself still needs a physical-device swipe check.

`npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:e2e` and `npm run build` cover the shared application. `:app:testDebugUnitTest` runs Kotlin parser tests and mocked Android `MidiManager` tests for USB-only discovery, pause/resume cleanup, detach errors, late opens and destruction. These are simulations; they do not prove that a USB keyboard works. No Android emulator is needed for these unit tests.

On your physical phone, verify:

- Virtual-piano touch input, notation, timed/count-in mode and metronome. Background or lock the phone while practicing; confirm practice pauses and does not restart by itself after returning.
- Connect/discover/select an actual USB MIDI keyboard, including multiple ports if available. Check C4, other registers, channels, repeated/held notes, chords and velocity-zero note-off.
- Press/release sustain, release notes while holding the pedal, and repeat notes. MIDI checks pitch/timing, never which human finger was used.
- Unplug while holding notes/pedal; practice must pause with a disconnect message. Replug, select/reconnect and manually start; there must be no stuck keys, duplicate subscriptions or stale note attacks. Repeat while backgrounding/resuming the app and while a connection is opening.
- Save real outcomes, force-close/reopen the app, then export JSON and CSV through the file picker. Reimport the JSON and verify outcomes/history/settings. Cancel a file picker and retry. Browser and app backups must retain comparable fingerprints without mixing legacy results.
- Test long timed sessions and input latency against the actual keyboard. An APK build and simulated tests do not establish native WebView behavior, hardware compatibility, latency or comfortable human fingering.

References: [Capacitor environment](https://capacitorjs.com/docs/getting-started/environment-setup), [local Android plugins](https://capacitorjs.com/docs/android/custom-code), [Android MidiManager](https://developer.android.com/reference/android/media/midi/MidiManager), [MidiReceiver timestamps](https://developer.android.com/reference/android/media/midi/MidiReceiver).
