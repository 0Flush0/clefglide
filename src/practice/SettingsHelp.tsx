import {
  Bluetooth,
  Hand,
  Keyboard,
  Moon,
  Music2,
  Plug,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import type { MidiEvent } from "../midi/adapter";
import { useTranslation, type Language } from "../shared/i18n";
import { MidiConnectionButton } from "./MidiConnectionButton";

function GuideLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function SettingsHelp({
  dark,
  onToggleTheme,
  language,
  onLanguage,
  onConnect,
  onDiscoverBluetooth,
  connectionBusy = false,
  bluetoothBusy = false,
  selectionBusy = false,
  inputs,
  device,
  onSelectDevice,
  status,
  diagnostic,
  onPractice,
  onSimulator,
}: {
  dark: boolean;
  onToggleTheme: () => void;
  language: Language;
  onLanguage: (language: Language) => void;
  onConnect: () => void;
  onDiscoverBluetooth?: () => void;
  connectionBusy?: boolean;
  bluetoothBusy?: boolean;
  selectionBusy?: boolean;
  inputs: { id: string; name: string }[];
  device: string;
  onSelectDevice: (id: string) => void;
  status: string;
  diagnostic?: MidiEvent;
  onPractice: () => void;
  onSimulator: () => void;
}) {
  const tr = useTranslation();
  return (
    <>
      <div className="eyebrow">{tr("GET CONNECTED, GET PLAYING")}</div>
      <h1>{tr("Settings & help")}</h1>
      <p className="page-intro">
        {tr(
          "Connect your keyboard, find your starting position, and play your first notes.",
        )}
      </p>

      <div className="help-preferences panel">
        <div>
          <h2>{tr("Make it yours")}</h2>
          <p>{tr("Choose your language and appearance.")}</p>
        </div>
        <div className="help-preference-controls">
          <button onClick={onToggleTheme}>
            {dark ? (
              <Sun size={17} aria-hidden="true" />
            ) : (
              <Moon size={17} aria-hidden="true" />
            )}
            {tr(dark ? "Light" : "Dark")} {tr("appearance")}
          </button>
          <label>
            {tr("Language")}
            <select
              aria-label={tr("Help language")}
              value={language}
              onChange={(event) => onLanguage(event.target.value as Language)}
            >
              <option value="en">{tr("English")}</option>
              <option value="de">{tr("Deutsch")}</option>
            </select>
          </label>
        </div>
      </div>

      <section
        className="panel keyboard-setup"
        aria-labelledby="keyboard-setup-title"
      >
        <h2 id="keyboard-setup-title">{tr("1. Connect your keyboard")}</h2>
        <p>
          {tr(
            onDiscoverBluetooth
              ? "USB MIDI is discovered automatically. Use the Bluetooth button to discover BLE-MIDI devices."
              : "Choose a USB cable or Bluetooth MIDI. Use Chrome and open ClefGlide over HTTPS.",
          )}
        </p>
        <div className="connection-methods">
          <article className="connection-method">
            <h3>
              <Plug size={20} aria-hidden="true" />
              {tr("USB cable")}
            </h3>
            <p>{tr("A good place to start for a stable connection.")}</p>
            <ol>
              <li>
                {tr(
                  "Turn on your keyboard. Connect its USB TO HOST / USB MIDI port to your computer with a cable that carries data.",
                )}
              </li>
              <li>
                {tr(
                  "On an Android tablet, use a compatible USB-C or OTG adapter. Some keyboards also need their own power supply or a powered USB hub.",
                )}
              </li>
              <li>
                {tr(
                  "Once connected, allow MIDI access below and choose your keyboard.",
                )}
              </li>
            </ol>
            <details className="help-inline-details">
              <summary>{tr("My keyboard only has round MIDI sockets")}</summary>
              <p>
                {tr(
                  "Use a USB MIDI interface. Connect the keyboard’s MIDI OUT to the interface’s MIDI IN, then plug the interface into your computer or tablet. An audio cable cannot carry MIDI notes.",
                )}
              </p>
            </details>
          </article>
          <article className="connection-method">
            <h3>
              <Bluetooth size={20} aria-hidden="true" />
              {tr("Bluetooth MIDI")}
            </h3>
            <p>
              {tr(
                onDiscoverBluetooth
                  ? "Tap Discover Bluetooth MIDI, allow access, then choose your piano input."
                  : "Connect in a MIDI connector app first, then return here.",
              )}
            </p>
            {onDiscoverBluetooth && (
              <MidiConnectionButton
                busy={bluetoothBusy}
                disabled={connectionBusy}
                icon={<Bluetooth size={17} aria-hidden="true" />}
                onClick={onDiscoverBluetooth}
              >
                {tr("Discover Bluetooth MIDI")}
              </MidiConnectionButton>
            )}
            <ol>
              <li>
                {tr(
                  "Enable Bluetooth MIDI (BLE-MIDI) on your keyboard, or attach a compatible Bluetooth MIDI adapter. Bluetooth audio alone does not send notes.",
                )}
              </li>
              {!onDiscoverBluetooth && (
                <li>
                  {tr(
                    "On the same computer or tablet running ClefGlide, open a compatible MIDI connector app and connect to your keyboard there. Bluetooth pairing alone may not create a MIDI input.",
                  )}
                </li>
              )}
              {!onDiscoverBluetooth && (
                <li>
                  {tr(
                    "Keep any MIDI bridge app running. Return to ClefGlide, allow MIDI access below, and choose the keyboard or the bridge’s MIDI port.",
                  )}
                </li>
              )}
            </ol>
            {!onDiscoverBluetooth && (
              <details className="help-inline-details">
                <summary>{tr("Which connector do I use?")}</summary>
                <div className="platform-guides">
                  <section>
                    <h4>{tr("Android")}</h4>
                    <p>
                      {tr(
                        "For example, Bluetooth MIDI Connect by ROCKRELAY connects BLE-MIDI devices to Android’s MIDI service. Open the app, allow the Bluetooth scanning permissions it requests, and select your keyboard before returning to Chrome.",
                      )}
                    </p>
                    <GuideLink href="https://play.google.com/store/apps/details?id=bluetooth.midi.connect">
                      {tr("Bluetooth MIDI Connect on Google Play")}
                    </GuideLink>
                  </section>
                  <section>
                    <h4>macOS</h4>
                    <p>
                      {tr(
                        "Open Audio MIDI Setup, choose Window → Show MIDI Studio, open the Bluetooth configuration, and connect your keyboard. Then select it in ClefGlide in Chrome.",
                      )}
                    </p>
                    <GuideLink href="https://support.apple.com/guide/audio-midi-setup/set-up-bluetooth-midi-devices-ams33f013765/mac">
                      {tr("Apple’s Bluetooth MIDI guide")}
                    </GuideLink>
                  </section>
                  <section>
                    <h4>Windows</h4>
                    <p>
                      {tr(
                        "Use a BLE-MIDI connector or bridge compatible with your Windows version and keyboard. If using MIDIberry with loopMIDI, create a virtual port in loopMIDI, choose your keyboard as MIDIberry’s input and that port as its output. Select the same port in ClefGlide. Keep both apps running.",
                      )}
                    </p>
                    <div className="help-guide-links">
                      <GuideLink href="https://apps.microsoft.com/detail/9n39720h2m05">
                        MIDIberry
                      </GuideLink>
                      <GuideLink href="https://www.tobias-erichsen.de/software/loopmidi.html">
                        loopMIDI
                      </GuideLink>
                    </div>
                  </section>
                </div>
              </details>
            )}
          </article>
        </div>
        <div className="help-connect">
          <div>
            <h3>{tr("Allow access, then play a key")}</h3>
            <p>
              {tr(
                onDiscoverBluetooth
                  ? "USB MIDI is discovered automatically. Use the Bluetooth button to discover BLE-MIDI devices."
                  : "Click Connect MIDI and allow access when Chrome asks. The first input connects automatically; choose another if needed.",
              )}
            </p>
          </div>
          {!onDiscoverBluetooth && (
            <MidiConnectionButton
              busy={connectionBusy}
              icon={<Plug size={17} aria-hidden="true" />}
              className="primary"
              onClick={onConnect}
            >
              {tr("Connect MIDI")}
            </MidiConnectionButton>
          )}
          {inputs.length > 0 && (
            <label className="help-input-picker">
              {tr("Piano input")}
              <select
                value={device}
                disabled={selectionBusy}
                onChange={(event) => onSelectDevice(event.target.value)}
              >
                <option value="">{tr("Choose piano input")}</option>
                {inputs.map((input) => (
                  <option key={input.id} value={input.id}>
                    {input.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="help-connection-status" role="status">
            {tr(status)}
          </p>
          <p className="help-input-check">
            {tr(
              device && diagnostic?.source === "hardware"
                ? diagnostic.type === "sustain"
                  ? "Pedal input received."
                  : `Last MIDI input: note ${diagnostic.pitch}.`
                : "Press a key on your piano to check that MIDI notes arrive here.",
            )}
          </p>
        </div>
        <p className="help-compatibility">
          {tr(
            onDiscoverBluetooth
              ? "Bluetooth MIDI works directly in the Android app. Enable Bluetooth and BLE-MIDI on the piano, discover, then select its input. No connector app is needed."
              : "Android requires compatible hardware and Chrome. Safari and iPadOS MIDI are not supported by ClefGlide. Bluetooth support depends on your keyboard, operating system and connector app.",
          )}
        </p>
      </section>

      <section
        className="panel help-troubleshooting"
        aria-labelledby="connection-help-title"
      >
        <h2 id="connection-help-title">{tr("Connection troubleshooting")}</h2>
        <details className="help-disclosure">
          <summary>{tr("My keyboard does not appear")}</summary>
          <ul>
            <li>
              {tr(
                "USB: check the data cable, keyboard power and USB MIDI setting. Try another USB port. Install the manufacturer’s MIDI driver only if your keyboard requires it.",
              )}
            </li>
            <li>
              {tr(
                onDiscoverBluetooth
                  ? "Bluetooth: allow Nearby devices in Android settings (Location on Android 11 or earlier), turn Bluetooth on, and discover again. Disconnect the piano from other phones or apps first."
                  : "Bluetooth: check that the connector app shows your keyboard as connected and exposes a MIDI port. Keep bridge apps open, and disconnect the keyboard from other phones or tablets.",
              )}
            </li>
            <li>
              {tr(
                onDiscoverBluetooth
                  ? "Reconnect the USB cable or choose the input to retry. For Bluetooth, tap Discover Bluetooth MIDI. Practice stays paused until you press Start."
                  : "Close other apps that may be using the MIDI port, then click Connect MIDI again. If Chrome still has an old device list, reload the page after connecting.",
              )}
            </li>
          </ul>
        </details>
        {!onDiscoverBluetooth && (
          <details className="help-disclosure">
            <summary>{tr("Chrome blocked MIDI access")}</summary>
            <p>
              {tr(
                "Open Chrome’s site controls beside the address bar, allow MIDI devices in the site permissions, and try Connect MIDI again. Use the HTTPS address; an ordinary HTTP address on your local network cannot request MIDI access.",
              )}
            </p>
          </details>
        )}
        <details className="help-disclosure">
          <summary>{tr("Connected, but no notes arrive")}</summary>
          <p>
            {tr(
              "Try another piano input; some keyboards expose several ports. In Practice → Advanced settings, leave MIDI channel on All channels unless you need a specific channel. For Bluetooth bridges, check that the keyboard input is routed to the same port selected in ClefGlide.",
            )}
          </p>
        </details>
      </section>

      <div className="help-next-steps">
        <article className="panel">
          <h2>
            <Hand size={20} aria-hidden="true" />
            {tr("2. Find your position")}
          </h2>
          <p>
            {tr(
              "In Practice, the Before you play banner shows where to put your thumb and which finger starts. Begin with the Guided profile for a fixed five-note position.",
            )}
          </p>
        </article>
        <article className="panel">
          <h2>
            <Music2 size={20} aria-hidden="true" />
            {tr("3. Read and play")}
          </h2>
          <p>
            {tr(
              "Start with Wait for correct notes: the score waits while you find each pitch. Release a key before playing it again. Try Timed playing when you are ready to follow a steady beat.",
            )}
          </p>
          <button onClick={onPractice}>{tr("Go to practice")}</button>
        </article>
      </div>

      <section
        className="panel help-reference"
        aria-labelledby="practice-help-title"
      >
        <h2 id="practice-help-title">{tr("Practice at your own pace")}</h2>
        <details className="help-disclosure">
          <summary>{tr("Choose what to practice")}</summary>
          <p>
            {tr(
              "Choose Guided for fixed-position practice or Advanced to edit the generator parameters. Choose wait, timed or benchmark scoring with either profile.",
            )}
          </p>
          <p>
            {tr(
              "Choose Edit range to select the lowest and highest piano keys for each hand; middle C is C4. Apply saves the range for your next exercise. Clefs, key, meter, timing calibration and MIDI diagnostics are in Advanced settings.",
            )}
          </p>
        </details>
        <details className="help-disclosure">
          <summary>{tr("Apply settings and use hints")}</summary>
          <p>
            {tr(
              "Use Apply & generate, Apply & play or New exercise to apply exercise changes. Hint changes take effect immediately, keeping the same notes and score.",
            )}
          </p>
          <dl>
            <div>
              <dt>{tr("All")}</dt>
              <dd>{tr("Shows every planned finger.")}</dd>
            </div>
            <div>
              <dt>{tr("Smart")}</dt>
              <dd>
                {tr(
                  "Shows starting fingers, spacing exceptions and movement landings.",
                )}
              </dd>
            </div>
            <div>
              <dt>{tr("None")}</dt>
              <dd>
                {tr(
                  "Hides automatic finger numbers. Generate a fresh exercise with None for an unassisted attempt.",
                )}
              </dd>
            </div>
          </dl>
          <p>
            {tr(
              "Reveal hint temporarily shows guidance. Hiding hints later does not undo assistance already used. Independent benchmark hides hints and disables Reveal. MIDI checks pitch and timing, never which finger you use.",
            )}
          </p>
        </details>
        <details className="help-disclosure">
          <summary>{tr("Read your progress")}</summary>
          <p>
            {tr(
              "Wait mode shows pitch results and correct notes per active minute, including thinking time. Timed mode reports timing accuracy separately. Progress compares matching settings, tempo, assistance and generator version by default; mixed settings are not an improvement comparison.",
            )}
          </p>
          <p>
            {tr(
              "Chord-event accuracy requires all required pitches without extra notes. Replaying an exercise records a new attempt. Older generator history stays separate.",
            )}
          </p>
        </details>
        <details className="help-disclosure">
          <summary>{tr("Timing & local data")}</summary>
          <p>
            {tr(
              "Timed playing counts in for one bar and continues through missed notes. Chord and two-hand attacks must arrive within 120 ms. Pitch matching accepts onsets within 450 ms; timing accuracy uses your chosen tolerance. A positive input offset subtracts device latency.",
            )}
          </p>
          <p>
            {tr(
              "Changing tabs or hiding the page pauses practice. Settings and sessions stay on this device. Clearing browser data removes them, so export a JSON backup from Progress regularly. CSV exports contain summary metrics.",
            )}
          </p>
        </details>
        <details className="help-disclosure">
          <summary>{tr("Current teaching scope")}</summary>
          <p>
            {tr(
              "Advanced parameters can enable wide leaps, sustained notes, ties, independent voices, dynamic fingering and articulation. Every generated phrase must pass the configured musical and hand-position rules.",
            )}
          </p>
          <p>
            {tr(
              "MIDI observations cover played pitches, timing, releases and velocity. The fingering plan follows software constraints, and comfort varies by pianist.",
            )}
          </p>
        </details>
      </section>

      <aside className="panel help-simulator">
        <Keyboard size={22} aria-hidden="true" />
        <div>
          <h2>{tr("No keyboard connected?")}</h2>
          <p>
            {tr(
              "You can still try ClefGlide. Open the Virtual piano in Practice and use its keys or your computer keyboard.",
            )}
          </p>
        </div>
        <button onClick={onSimulator}>{tr("Try the virtual piano")}</button>
      </aside>
    </>
  );
}
