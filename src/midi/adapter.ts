import {
  WebMidi,
  type Input,
  type NoteMessageEvent,
  type ControlChangeMessageEvent,
} from "webmidi";

/** Capability check only: never requests MIDI permission. */
export function midiUnavailableReason(): string | null {
  if (globalThis.isSecureContext !== true) {
    return "MIDI requires HTTPS or localhost. HTTP LAN addresses can use the virtual piano; open ClefGlide over HTTPS to connect a MIDI device.";
  }
  if (typeof globalThis.navigator?.requestMIDIAccess !== "function") {
    return "Web MIDI is unavailable in this browser. Use supported Chrome on HTTPS or localhost, or the virtual piano.";
  }
  return null;
}
export interface MidiEvent {
  type: "on" | "off" | "sustain";
  pitch: number;
  velocity: number;
  time: number;
  source: "hardware" | "simulator";
  channel: number;
}
export class MidiBus {
  listeners = new Set<(e: MidiEvent) => void>();
  emit(e: MidiEvent) {
    this.listeners.forEach((fn) => fn(e));
  }
  subscribe(fn: (e: MidiEvent) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  virtual(pitch: number, type: "on" | "off") {
    this.emit({
      pitch,
      type,
      velocity: type === "on" ? 100 : 0,
      time: performance.now(),
      source: "simulator",
      channel: 1,
    });
  }
}
export class HardwareMidi {
  input?: Input;
  cleanup?: () => void;
  hotplug?: () => void;
  constructor(
    private bus: MidiBus,
    private update: (inputs: Input[], status: string) => void,
    private disconnected: () => void,
  ) {}
  async enable() {
    const unavailable = midiUnavailableReason();
    if (unavailable) throw new Error(unavailable);
    await WebMidi.enable({ sysex: false });
    this.hotplug = () => {
      if (this.input && !WebMidi.inputs.some((i) => i.id === this.input!.id)) {
        this.select("");
        this.disconnected();
      }
      this.update(
        WebMidi.inputs,
        WebMidi.inputs.length
          ? "Choose your piano input."
          : "No MIDI inputs. Check USB/OTG and reconnect.",
      );
    };
    WebMidi.addListener("connected", this.hotplug);
    WebMidi.addListener("disconnected", this.hotplug);
    this.hotplug();
    this.select(this.input?.id ?? WebMidi.inputs[0]?.id ?? "");
  }
  select(id: string) {
    this.cleanup?.();
    this.input = WebMidi.inputs.find((i) => i.id === id);
    const input = this.input;
    if (!input) return;
    const on = (e: NoteMessageEvent) =>
      this.bus.emit({
        type: e.note.rawAttack === 0 ? "off" : "on",
        pitch: e.note.number,
        velocity: e.note.rawAttack,
        time: e.timestamp,
        source: "hardware",
        channel: e.message.channel,
      });
    const off = (e: NoteMessageEvent) =>
      this.bus.emit({
        type: "off",
        pitch: e.note.number,
        velocity: 0,
        time: e.timestamp,
        source: "hardware",
        channel: e.message.channel,
      });
    input.addListener("noteon", on);
    input.addListener("noteoff", off);
    const control = (e: ControlChangeMessageEvent) => {
      if (e.controller.number === 64)
        this.bus.emit({
          type: "sustain",
          pitch: 64,
          velocity: e.rawValue ?? 0,
          time: e.timestamp,
          source: "hardware",
          channel: e.message.channel,
        });
    };
    input.addListener("controlchange", control);
    this.cleanup = () => {
      input.removeListener("noteon", on);
      input.removeListener("noteoff", off);
      input.removeListener("controlchange", control);
    };
  }
  dispose() {
    this.cleanup?.();
    if (this.hotplug) {
      WebMidi.removeListener("connected", this.hotplug);
      WebMidi.removeListener("disconnected", this.hotplug);
    }
  }
}
