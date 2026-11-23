import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type {
  MidiAdapter,
  MidiBus,
  MidiEvent,
  MidiConnectionPhase,
  MidiInput,
  MidiUpdate,
} from "./adapter";

export interface NativeMidiState {
  inputs: MidiInput[];
  selectedId: string;
  connection: number;
  nativeTimeMs: number;
  status: string;
  phase?: MidiConnectionPhase;
  pendingId?: string;
}
export interface NativeMidiMessage {
  type: MidiEvent["type"];
  pitch: number;
  velocity: number;
  channel: number;
  timestampMs: number;
  connection: number;
}
export interface NativeMidiPlugin {
  clock(): Promise<{ nativeTimeMs: number }>;
  start(): Promise<NativeMidiState>;
  discoverBluetooth(): Promise<NativeMidiState>;
  select(options: { id: string }): Promise<NativeMidiState>;
  stop(): Promise<void>;
  addListener(
    event: "midi",
    listener: (message: NativeMidiMessage) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "state",
    listener: (state: NativeMidiState) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "lifecycle",
    listener: (state: { active: boolean }) => void,
  ): Promise<PluginListenerHandle>;
}

const NativeMidi = registerPlugin<NativeMidiPlugin>("NativeMidi");

export class AndroidMidi implements MidiAdapter {
  input?: MidiInput;
  private disposed = false;
  private connection = -1;
  private clockOffset = 0;
  private listeners: Promise<PluginListenerHandle>[] = [];
  private ready: Promise<void>;
  private request = 0;
  private foreground = true;
  private lifecycle = 0;
  private nativeStarted = false;
  private starting?: Promise<void>;
  private selecting = false;
  private lastAutoId = "";
  private usbAutoSelectionBlocked = false;
  private state?: NativeMidiState;

  constructor(
    private bus: MidiBus,
    private update: MidiUpdate,
    private disconnected: () => void,
    suspended: () => void,
    private plugin: NativeMidiPlugin = NativeMidi,
    private canAutoSelect: () => boolean = () => true,
  ) {
    // Listening for lifecycle changes also pauses virtual-piano practice.
    // initialize() discovers USB only. Bluetooth still needs its explicit action.
    this.listeners = [
      plugin.addListener("lifecycle", ({ active }) => {
        if (this.disposed) return;
        this.foreground = active;
        ++this.lifecycle;
        if (!active) {
          ++this.request;
          this.selecting = false;
          this.starting = undefined;
          suspended();
        } else {
          this.lastAutoId = "";
          this.usbAutoSelectionBlocked = false;
          void this.enable().catch((error: unknown) => this.failed(error));
        }
      }),
      plugin.addListener("state", (state) => {
        if (this.applyState(state))
          void this.autoSelect().catch((error: unknown) => this.failed(error));
      }),
      plugin.addListener("midi", (event) => {
        if (
          this.disposed ||
          !this.foreground ||
          !this.input ||
          event.connection !== this.connection ||
          !Number.isFinite(event.timestampMs) ||
          !["on", "off", "sustain"].includes(event.type) ||
          !Number.isInteger(event.pitch) ||
          event.pitch < 0 ||
          event.pitch > 127 ||
          !Number.isInteger(event.velocity) ||
          event.velocity < 0 ||
          event.velocity > 127 ||
          !Number.isInteger(event.channel) ||
          event.channel < 1 ||
          event.channel > 16
        )
          return;
        this.bus.emit({
          type:
            event.type === "on" && event.velocity === 0 ? "off" : event.type,
          pitch: event.pitch,
          velocity: event.type === "off" ? 0 : event.velocity,
          channel: event.channel,
          source: "hardware",
          // Native monotonic time is mapped into the scorer's performance.now()
          // domain; using JS delivery time would count bridge delay as playing delay.
          time: Math.max(0, event.timestampMs + this.clockOffset),
        });
      }),
    ];
    this.ready = Promise.all(this.listeners).then(() => {});
    void this.ready.catch(() => {
      if (!this.disposed)
        this.update(
          [],
          "Android MIDI bridge unavailable. Use the virtual piano.",
        );
    });
  }

  private applyState(state: NativeMidiState) {
    if (this.disposed || state.connection < this.connection) return false;
    const previous = this.input;
    this.connection = state.connection;
    this.state = state;
    this.input = state.inputs.find((input) => input.id === state.selectedId);
    if (previous && !this.input) this.disconnected();
    if (!state.inputs.some((input) => input.id === this.lastAutoId))
      this.lastAutoId = "";
    this.update(state.inputs, state.status, {
      phase: state.phase ?? (this.input ? "connected" : "idle"),
      selectedId: this.input?.id ?? "",
      pendingId: state.pendingId,
    });
    return true;
  }

  private failed(error: unknown) {
    if (!this.disposed && this.foreground)
      this.update(this.state?.inputs ?? [], String(error), {
        phase: "failed",
        selectedId: this.input?.id ?? "",
      });
  }

  initialize() {
    return this.enable();
  }

  enable(): Promise<void> {
    if (this.starting) return this.starting;
    const lifecycle = this.lifecycle;
    const operation = this.start(lifecycle).finally(() => {
      if (this.starting === operation) this.starting = undefined;
    });
    this.starting = operation;
    return operation;
  }

  private async start(lifecycle: number) {
    await this.ready;
    if (this.disposed) throw new Error("MIDI adapter disposed.");
    if (!this.foreground || lifecycle !== this.lifecycle) return;
    const clockOffset = await this.syncClock();
    if (this.disposed || !this.foreground || lifecycle !== this.lifecycle)
      return;
    this.clockOffset = clockOffset;
    this.nativeStarted = true;
    const state = await this.plugin.start();
    if (this.disposed) {
      await this.plugin.stop();
      return;
    }
    if (!this.foreground || lifecycle !== this.lifecycle) return;
    this.applyState(state);
    await this.autoSelect();
  }

  private async autoSelect() {
    const state = this.state;
    if (
      !state ||
      this.disposed ||
      !this.foreground ||
      this.input ||
      this.usbAutoSelectionBlocked ||
      this.selecting ||
      !this.canAutoSelect() ||
      (state.phase &&
        ["permission", "scanning", "connecting"].includes(state.phase))
    )
      return;
    const usb = state.inputs.filter((input) => !input.id.startsWith("ble:"));
    if (usb.length !== 1 || usb[0].id === this.lastAutoId) return;
    // One attempt per presence/foreground cycle; a failed driver must not loop.
    this.lastAutoId = usb[0].id;
    await this.select(usb[0].id, true);
  }

  async select(id: string, automatic = false) {
    if (this.selecting) return;
    if (!automatic) {
      this.usbAutoSelectionBlocked = !id || id.startsWith("ble:");
      if (id && !id.startsWith("ble:")) this.lastAutoId = id;
    }
    this.selecting = true;
    const request = ++this.request;
    if (!id)
      this.lastAutoId =
        this.state?.inputs.filter((input) => !input.id.startsWith("ble:"))[0]
          ?.id ?? "";
    try {
      await this.ready;
      if (this.disposed || !this.foreground) return;
      const clockOffset = await this.syncClock();
      if (this.disposed || request !== this.request) return;
      this.clockOffset = clockOffset;
      const state = await this.plugin.select({ id });
      if (this.disposed || request !== this.request) return;
      this.applyState(state);
    } finally {
      if (request === this.request) this.selecting = false;
    }
  }

  async discoverBluetooth() {
    await this.ready;
    if (this.disposed) return;
    this.nativeStarted = true;
    const state = await this.plugin.discoverBluetooth();
    if (this.disposed) {
      await this.plugin.stop();
      return;
    }
    // Discovery updates the existing picker; it never changes the selected input.
    this.applyState(state);
  }

  private async syncClock() {
    const started = performance.now();
    const clock = await this.plugin.clock();
    return (started + performance.now()) / 2 - clock.nativeTimeMs;
  }

  async dispose() {
    this.disposed = true;
    this.input = undefined;
    ++this.request;
    const handles = await Promise.allSettled(this.listeners);
    await Promise.allSettled(
      handles.map((result) =>
        result.status === "fulfilled"
          ? result.value.remove()
          : Promise.resolve(),
      ),
    );
    if (this.nativeStarted) await this.plugin.stop().catch(() => {});
  }
}
