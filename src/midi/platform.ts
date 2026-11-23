import { Capacitor } from "@capacitor/core";
import {
  HardwareMidi,
  midiUnavailableReason as webUnavailableReason,
} from "./adapter";
import type { MidiAdapter, MidiBus, MidiUpdate } from "./adapter";
import { AndroidMidi } from "./android";

export function midiUnavailableReason(): string | null {
  return Capacitor.getPlatform() === "android" ? null : webUnavailableReason();
}

export function createMidiAdapter(
  bus: MidiBus,
  update: MidiUpdate,
  disconnected: () => void,
  suspended: () => void,
): MidiAdapter {
  return Capacitor.getPlatform() === "android"
    ? new AndroidMidi(bus, update, disconnected, suspended)
    : new HardwareMidi(bus, update, disconnected);
}
