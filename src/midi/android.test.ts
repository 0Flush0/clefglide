import { afterEach, expect, it, vi } from "vitest";
import {
  AndroidMidi,
  type NativeMidiPlugin,
  type NativeMidiMessage,
  type NativeMidiState,
} from "./android";
import { MidiBus, type MidiEvent } from "./adapter";
import { Scorer } from "../scoring/engine";
import { defaults } from "../score/model";
import { generate } from "../generation/planner";

afterEach(() => vi.restoreAllMocks());

function bridge() {
  const callbacks = new Map<string, (value: never) => void>();
  const removals = [
    vi.fn(async () => {}),
    vi.fn(async () => {}),
    vi.fn(async () => {}),
  ];
  const inputs = [
    { id: "4:0", name: "USB piano — Port 1" },
    { id: "4:1", name: "USB piano — Port 2" },
  ];
  let connection = 0;
  const state = (
    selectedId = "",
    overrides: Partial<NativeMidiState> = {},
  ): NativeMidiState => ({
    inputs,
    selectedId,
    connection,
    nativeTimeMs: 10000,
    status: selectedId ? "Piano connected" : "Choose your piano input.",
    ...overrides,
  });
  const plugin = {
    addListener: vi.fn(
      async (name: string, callback: (value: never) => void) => {
        const remove = removals[callbacks.size];
        callbacks.set(name, callback);
        return { remove };
      },
    ),
    clock: vi.fn(async () => ({ nativeTimeMs: 10000 })),
    start: vi.fn(async () => state()),
    select: vi.fn(async ({ id }: { id: string }) =>
      state(id, { connection: ++connection }),
    ),
    stop: vi.fn(async () => {}),
  } as unknown as NativeMidiPlugin;
  return {
    plugin,
    inputs,
    state,
    removals,
    emit: (name: string, value: unknown) => {
      if (name === "state") connection = (value as NativeMidiState).connection;
      callbacks.get(name)!(value as never);
    },
  };
}

const packet = (
  overrides: Partial<NativeMidiMessage> = {},
): NativeMidiMessage => ({
  type: "on",
  pitch: 60,
  velocity: 90,
  channel: 2,
  timestampMs: 10010,
  connection: 1,
  ...overrides,
});

it("waits for a gesture, selects a USB port and maps native timestamps to the shared event contract", async () => {
  vi.spyOn(performance, "now").mockReturnValue(200);
  const native = bridge(),
    bus = new MidiBus(),
    events: MidiEvent[] = [],
    update = vi.fn();
  bus.subscribe((event) => events.push(event));
  const adapter = new AndroidMidi(bus, update, vi.fn(), vi.fn(), native.plugin);
  expect(native.plugin.start).not.toHaveBeenCalled();
  expect(native.plugin.clock).not.toHaveBeenCalled();
  expect(native.plugin.select).not.toHaveBeenCalled();
  await adapter.enable();
  expect(adapter.input).toEqual(native.inputs[0]);
  native.emit("midi", packet());
  native.emit("midi", packet({ velocity: 0 }));
  native.emit("midi", packet({ type: "off", velocity: 100 }));
  native.emit("midi", packet({ type: "sustain", pitch: 64, velocity: 127 }));
  expect(events).toEqual([
    {
      type: "on",
      pitch: 60,
      velocity: 90,
      channel: 2,
      time: 210,
      source: "hardware",
    },
    {
      type: "off",
      pitch: 60,
      velocity: 0,
      channel: 2,
      time: 210,
      source: "hardware",
    },
    {
      type: "off",
      pitch: 60,
      velocity: 0,
      channel: 2,
      time: 210,
      source: "hardware",
    },
    {
      type: "sustain",
      pitch: 64,
      velocity: 127,
      channel: 2,
      time: 210,
      source: "hardware",
    },
  ]);
  native.emit("midi", packet({ pitch: 128 }));
  native.emit("midi", packet({ channel: 0 }));
  native.emit("midi", packet({ timestampMs: NaN }));
  expect(events).toHaveLength(4);
  await adapter.dispose();
});

it("pauses virtual practice before MIDI is enabled and never resumes scoring automatically", async () => {
  const native = bridge(),
    scorer = new Scorer([], defaults);
  scorer.start(performance.now());
  const pause = vi.fn(() => scorer.pause(performance.now()));
  const adapter = new AndroidMidi(
    new MidiBus(),
    vi.fn(),
    vi.fn(),
    pause,
    native.plugin,
  );
  native.emit("lifecycle", { active: false });
  expect(scorer.running).toBe(false);
  native.emit("lifecycle", { active: true });
  expect(scorer.running).toBe(false);
  expect(native.plugin.start).not.toHaveBeenCalled();
  await adapter.dispose();
});

it("scores native input and clears held notes/pedal on disconnect; rejects stale packets after reconnect", async () => {
  vi.spyOn(performance, "now").mockReturnValue(200);
  const native = bridge(),
    bus = new MidiBus();
  const notes = generate(defaults, "android-input").events.filter(
    (event) => event.kind === "note",
  );
  const scorer = new Scorer(notes, defaults);
  const pause = vi.fn(() => scorer.pause(performance.now()));
  bus.subscribe((event) => scorer.input(event));
  const adapter = new AndroidMidi(bus, vi.fn(), pause, pause, native.plugin);
  await adapter.enable();
  scorer.start(200);
  native.emit("midi", packet({ pitch: notes[0].midi }));
  native.emit("midi", packet({ type: "sustain", pitch: 64, velocity: 127 }));
  expect(scorer.results.at(-1)?.kind).toBe("correct");
  expect(scorer.held.size).toBe(1);
  expect(scorer.pedal).toBe(true);
  native.emit("state", native.state("", { inputs: [], connection: 2 }));
  expect(pause).toHaveBeenCalledOnce();
  expect(adapter.input).toBeUndefined();
  expect(scorer.running).toBe(false);
  expect(scorer.held.size).toBe(0);
  expect(scorer.pedal).toBe(false);
  const count = scorer.results.length;
  native.emit("midi", packet({ pitch: notes[1].midi }));
  native.emit("state", native.state("", { connection: 2 }));
  expect(adapter.input).toBeUndefined();
  expect(scorer.running).toBe(false);
  await adapter.select(native.inputs[1].id);
  expect(adapter.input).toEqual(native.inputs[1]);
  scorer.start(220);
  native.emit("midi", packet({ pitch: notes[1].midi, connection: 1 }));
  expect(scorer.results).toHaveLength(count);
  await adapter.dispose();
});

it("removes every listener and ignores queued lifecycle/state/input callbacks after disposal", async () => {
  const native = bridge(),
    update = vi.fn(),
    pause = vi.fn(),
    disconnected = vi.fn(),
    bus = new MidiBus();
  const input = vi.fn();
  bus.subscribe(input);
  const adapter = new AndroidMidi(
    bus,
    update,
    disconnected,
    pause,
    native.plugin,
  );
  await adapter.dispose();
  native.removals.forEach((remove) => expect(remove).toHaveBeenCalledOnce());
  expect(native.plugin.stop).toHaveBeenCalledOnce();
  native.emit("lifecycle", { active: false });
  native.emit("state", native.state("4:0"));
  native.emit("midi", packet());
  expect(update).not.toHaveBeenCalled();
  expect(pause).not.toHaveBeenCalled();
  expect(input).not.toHaveBeenCalled();
  await expect(adapter.enable()).rejects.toThrow("disposed");
});

it("does not start the native device service if disposed during clock synchronization", async () => {
  const native = bridge();
  let finish!: (value: { nativeTimeMs: number }) => void;
  vi.mocked(native.plugin.clock).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const adapter = new AndroidMidi(
    new MidiBus(),
    vi.fn(),
    vi.fn(),
    vi.fn(),
    native.plugin,
  );
  const enabling = adapter.enable();
  await vi.waitFor(() => expect(native.plugin.clock).toHaveBeenCalledOnce());
  await adapter.dispose();
  finish({ nativeTimeMs: 10000 });
  await enabling;
  expect(native.plugin.start).not.toHaveBeenCalled();
});

it("propagates native connection failures while leaving virtual input usable", async () => {
  const native = bridge(),
    bus = new MidiBus(),
    input = vi.fn();
  vi.mocked(native.plugin.start).mockRejectedValue(
    new Error("MIDI unavailable"),
  );
  const adapter = new AndroidMidi(
    bus,
    vi.fn(),
    vi.fn(),
    vi.fn(),
    native.plugin,
  );
  bus.subscribe(input);
  await expect(adapter.enable()).rejects.toThrow("MIDI unavailable");
  bus.virtual(60, "on");
  expect(input).toHaveBeenCalledWith(
    expect.objectContaining({ source: "simulator", pitch: 60 }),
  );
  await adapter.dispose();
});
