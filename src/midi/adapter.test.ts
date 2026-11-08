import { afterEach, it, expect, vi } from "vitest";
import type {
  Input,
  NoteMessageEvent,
  ControlChangeMessageEvent,
} from "webmidi";
const mock = vi.hoisted(() => ({
  inputs: [] as unknown[],
  enable: vi.fn(async () => {}),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("webmidi", () => ({ WebMidi: mock }));
import {
  HardwareMidi,
  MidiBus,
  midiUnavailableReason,
  type MidiEvent,
} from "./adapter";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each([false, undefined])(
  "rejects insecure/unknown origins before asking for MIDI permission (%s)",
  async (secure) => {
    vi.stubGlobal("isSecureContext", secure);
    const requestMidi = vi.fn();
    vi.stubGlobal("navigator", { requestMIDIAccess: requestMidi });
    const adapter = new HardwareMidi(
      new MidiBus(),
      () => {},
      () => {},
    );
    expect(midiUnavailableReason()).toContain("HTTPS or localhost");
    await expect(adapter.enable()).rejects.toThrow(/HTTPS or localhost/);
    expect(requestMidi).not.toHaveBeenCalled();
    expect(mock.enable).not.toHaveBeenCalled();
  },
);

it("reports unsupported MIDI on secure origins without calling enable", async () => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {});
  expect(midiUnavailableReason()).toContain("unavailable in this browser");
  const adapter = new HardwareMidi(
    new MidiBus(),
    () => {},
    () => {},
  );
  await expect(adapter.enable()).rejects.toThrow(/unavailable in this browser/);
  expect(mock.enable).not.toHaveBeenCalled();
});
it("requests no permission until enabled, explicitly disables SysEx and normalizes hardware edges", async () => {
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value: vi.fn(),
  });
  const callbacks = new Map<string, (e: NoteMessageEvent) => void>();
  const input = {
    id: "piano",
    name: "Test port",
    addListener: vi.fn((type: string, fn: (e: NoteMessageEvent) => void) =>
      callbacks.set(type, fn),
    ),
    removeListener: vi.fn((type: string) => callbacks.delete(type)),
  };
  mock.inputs = [input];
  const bus = new MidiBus(),
    events: MidiEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const disconnected = vi.fn();
  const adapter = new HardwareMidi(bus, () => {}, disconnected);
  expect(mock.enable).not.toHaveBeenCalled();
  await adapter.enable();
  expect(mock.enable).toHaveBeenCalledWith({ sysex: false });
  adapter.select("piano");
  const event = {
    note: { number: 60, rawAttack: 90 },
    timestamp: 123,
    message: { channel: 2 },
  } as NoteMessageEvent;
  callbacks.get("noteon")!(event);
  callbacks.get("noteoff")!(event);
  callbacks.get("noteon")!({
    ...event,
    note: { ...event.note, rawAttack: 0 },
  } as NoteMessageEvent);
  expect(
    events.map((e) => [
      e.type,
      e.pitch,
      e.velocity,
      e.time,
      e.source,
      e.channel,
    ]),
  ).toEqual([
    ["on", 60, 90, 123, "hardware", 2],
    ["off", 60, 0, 123, "hardware", 2],
    ["off", 60, 0, 123, "hardware", 2],
  ]);
  const control = callbacks.get("controlchange") as unknown as (
    e: ControlChangeMessageEvent,
  ) => void;
  control({
    controller: { number: 64 },
    rawValue: 127,
    timestamp: 200,
    message: { channel: 2 },
  } as ControlChangeMessageEvent);
  control({
    controller: { number: 1 },
    rawValue: 64,
    timestamp: 201,
    message: { channel: 2 },
  } as ControlChangeMessageEvent);
  expect(events.at(-1)).toEqual({
    type: "sustain",
    pitch: 64,
    velocity: 127,
    time: 200,
    source: "hardware",
    channel: 2,
  });
  expect(events).toHaveLength(4);
  mock.inputs = [];
  adapter.hotplug?.();
  expect(disconnected).toHaveBeenCalledOnce();
  expect(input.removeListener).toHaveBeenCalled();
  adapter.dispose();
  vi.unstubAllGlobals();
});
it("selecting a different input releases old subscriptions", () => {
  const old = {
    id: "old",
    addListener: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as Input;
  const next = {
    id: "next",
    addListener: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as Input;
  mock.inputs = [old, next];
  const adapter = new HardwareMidi(
    new MidiBus(),
    () => {},
    () => {},
  );
  adapter.select("old");
  adapter.select("next");
  expect(old.removeListener).toHaveBeenCalledTimes(3);
  expect(next.addListener).toHaveBeenCalledTimes(3);
  adapter.dispose();
});
