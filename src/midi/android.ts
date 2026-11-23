import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type {
  MidiAdapter,
  MidiBus,
  MidiEvent,
  MidiInput,
  MidiUpdate,
} from "./adapter";

export interface NativeMidiState {
  inputs: MidiInput[];
  selectedId: string;
  connection: number;
  nativeTimeMs: number;
  status: string;
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

  constructor(
    private bus: MidiBus,
    private update: MidiUpdate,
    private disconnected: () => void,
    suspended: () => void,
    private plugin: NativeMidiPlugin = NativeMidi,
  ) {
    // Listening for lifecycle changes also pauses virtual-piano practice.
    // No device discovery or opening happens before enable()/select().
    this.listeners = [
      plugin.addListener("lifecycle", ({ active }) => {
        if (!this.disposed && !active) suspended();
      }),
      plugin.addListener("state", (state) => this.applyState(state)),
      plugin.addListener("midi", (event) => {
        if (
          this.disposed ||
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
    if (this.disposed || state.connection < this.connection) return;
    const previous = this.input;
    this.connection = state.connection;
    this.input = state.inputs.find((input) => input.id === state.selectedId);
    if (previous && !this.input) this.disconnected();
    this.update(state.inputs, state.status);
  }

  async enable() {
    await this.ready;
    if (this.disposed) throw new Error("MIDI adapter disposed.");
    await this.syncClock();
    if (this.disposed) return;
    const state = await this.plugin.start();
    if (this.disposed) {
      await this.plugin.stop();
      return;
    }
    this.applyState(state);
    if (!this.disposed && !this.input && state.inputs.length) {
      await this.select(state.inputs[0].id);
    }
  }

  async select(id: string) {
    await this.ready;
    if (this.disposed) return;
    const request = ++this.request;
    await this.syncClock();
    if (this.disposed || request !== this.request) return;
    const state = await this.plugin.select({ id });
    if (this.disposed || request !== this.request) return;
    this.applyState(state);
  }

  private async syncClock() {
    const started = performance.now();
    const clock = await this.plugin.clock();
    this.clockOffset = (started + performance.now()) / 2 - clock.nativeTimeMs;
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
    await this.plugin.stop().catch(() => {});
  }
}
