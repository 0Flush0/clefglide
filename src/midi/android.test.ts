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

function bridge(ports = 1) {
  const callbacks = new Map<string, (value: never) => void>();
  const removals = [
    vi.fn(async () => {}),
    vi.fn(async () => {}),
    vi.fn(async () => {}),
  ];
  const inputs = [
    { id: "4:0", name: "USB piano — Port 1" },
    { id: "4:1", name: "USB piano — Port 2" },
  ].slice(0, ports);
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
    discoverBluetooth: vi.fn(async () => state()),
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

it("initializes USB without Bluetooth permission and maps native timestamps to the shared event contract", async () => {
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

it("pauses virtual practice and refreshes USB discovery on resume without restarting scoring", async () => {
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
  await vi.waitFor(() => expect(native.plugin.start).toHaveBeenCalledOnce());
  expect(native.plugin.discoverBluetooth).not.toHaveBeenCalled();
  await adapter.dispose();
});

it("scores native input and clears held notes/pedal on disconnect; rejects stale packets after reconnect", async () => {
  vi.spyOn(performance, "now").mockReturnValue(200);
  const native = bridge(2),
    bus = new MidiBus();
  const notes = generate(defaults, "android-input").events.filter(
    (event) => event.kind === "note",
  );
  const scorer = new Scorer(notes, defaults);
  const pause = vi.fn(() => scorer.pause(performance.now()));
  bus.subscribe((event) => scorer.input(event));
  const adapter = new AndroidMidi(bus, vi.fn(), pause, pause, native.plugin);
  await adapter.enable();
  await adapter.select(native.inputs[0].id);
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
  expect(native.plugin.stop).not.toHaveBeenCalled();
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

it("discovers BLE only on request, keeps USB selected, and uses the same bus after switching", async () => {
  vi.spyOn(performance, "now").mockReturnValue(200);
  const native = bridge(),
    bus = new MidiBus(),
    events: MidiEvent[] = [],
    update = vi.fn(),
    pause = vi.fn();
  bus.subscribe((event) => events.push(event));
  const adapter = new AndroidMidi(bus, update, pause, pause, native.plugin);
  await adapter.enable();
  expect(native.plugin.discoverBluetooth).not.toHaveBeenCalled();
  const ble = { id: "ble:01:02:03:04:05:06", name: "Piano (Bluetooth MIDI)" };
  vi.mocked(native.plugin.discoverBluetooth).mockResolvedValue(
    native.state("4:0", { connection: 1 }),
  );
  await adapter.discoverBluetooth();
  native.inputs.push(ble);
  native.emit("state", native.state("4:0", { connection: 1 }));
  expect(adapter.input?.id).toBe("4:0");
  expect(native.plugin.select).toHaveBeenCalledTimes(1);
  await adapter.select(ble.id);
  expect(adapter.input).toEqual(ble);
  native.emit("midi", packet()); // old USB generation
  expect(events).toHaveLength(0);
  for (const pitch of [60, 64, 67])
    native.emit("midi", packet({ pitch, connection: 2 }));
  native.emit(
    "midi",
    packet({ type: "sustain", pitch: 64, velocity: 127, connection: 2 }),
  );
  native.emit("midi", packet({ type: "off", connection: 2 }));
  expect(events.map((event) => [event.type, event.pitch, event.time])).toEqual([
    ["on", 60, 210],
    ["on", 64, 210],
    ["on", 67, 210],
    ["sustain", 64, 210],
    ["off", 60, 210],
  ]);
  native.emit("state", native.state("", { connection: 3 }));
  expect(pause).toHaveBeenCalled();
  expect(adapter.input).toBeUndefined();
  await adapter.select(ble.id);
  expect(adapter.input).toEqual(ble);
  await adapter.dispose();
});

it("keeps USB usable after denied Bluetooth discovery and stops a discovery finishing after disposal", async () => {
  const native = bridge(),
    adapter = new AndroidMidi(
      new MidiBus(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      native.plugin,
    );
  await adapter.enable();
  vi.mocked(native.plugin.discoverBluetooth).mockRejectedValueOnce(
    new Error("Bluetooth permission denied"),
  );
  await expect(adapter.discoverBluetooth()).rejects.toThrow(
    "permission denied",
  );
  expect(adapter.input?.id).toBe("4:0");
  let finish!: (state: NativeMidiState) => void;
  vi.mocked(native.plugin.discoverBluetooth).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const discovering = adapter.discoverBluetooth();
  await vi.waitFor(() =>
    expect(native.plugin.discoverBluetooth).toHaveBeenCalledTimes(2),
  );
  await adapter.dispose();
  finish(native.state());
  await discovering;
  expect(adapter.input).toBeUndefined();
  expect(native.plugin.stop).toHaveBeenCalledTimes(2);
});

it("initializes once, watches USB hotplug, and leaves multiple ports for manual selection", async () => {
  const native = bridge(2),
    update = vi.fn();
  const adapter = new AndroidMidi(
    new MidiBus(),
    update,
    vi.fn(),
    vi.fn(),
    native.plugin,
  );
  await Promise.all([adapter.initialize(), adapter.initialize()]);
  expect(native.plugin.start).toHaveBeenCalledOnce();
  expect(native.plugin.select).not.toHaveBeenCalled();
  expect(native.plugin.discoverBluetooth).not.toHaveBeenCalled();
  native.emit(
    "state",
    native.state("", { inputs: [native.inputs[0]], phase: "idle" }),
  );
  await vi.waitFor(() => expect(adapter.input?.id).toBe("4:0"));
  expect(native.plugin.select).toHaveBeenCalledOnce();
  expect(update.mock.lastCall?.[2]).toMatchObject({
    phase: "connected",
    selectedId: "4:0",
  });
  await adapter.dispose();
});

it("does not auto-select during virtual practice or replace an explicitly selected Bluetooth input", async () => {
  const native = bridge();
  let safe = false;
  const adapter = new AndroidMidi(
    new MidiBus(),
    vi.fn(),
    vi.fn(),
    vi.fn(),
    native.plugin,
    () => safe,
  );
  await adapter.initialize();
  expect(native.plugin.select).not.toHaveBeenCalled();
  safe = true;
  native.emit("state", native.state());
  await vi.waitFor(() => expect(adapter.input?.id).toBe("4:0"));
  const ble = { id: "ble:test", name: "Bluetooth piano" };
  native.inputs.push(ble);
  await adapter.select(ble.id);
  native.emit("state", native.state(ble.id, { connection: 2 }));
  expect(adapter.input?.id).toBe(ble.id);
  expect(native.plugin.select).toHaveBeenCalledTimes(2);
  await adapter.dispose();
});

it("does not loop failed USB opens and retries after detach and reattachment", async () => {
  const native = bridge(),
    update = vi.fn();
  vi.mocked(native.plugin.select).mockRejectedValueOnce(
    new Error("USB timed out"),
  );
  const adapter = new AndroidMidi(
    new MidiBus(),
    update,
    vi.fn(),
    vi.fn(),
    native.plugin,
  );
  await expect(adapter.initialize()).rejects.toThrow("timed out");
  native.emit("state", native.state("", { phase: "failed", connection: 2 }));
  native.emit("state", native.state("", { phase: "failed", connection: 2 }));
  expect(native.plugin.select).toHaveBeenCalledOnce();
  native.emit("state", native.state("", { inputs: [], connection: 2 }));
  native.emit("state", native.state("", { phase: "idle", connection: 2 }));
  await vi.waitFor(() => expect(adapter.input?.id).toBe("4:0"));
  expect(native.plugin.select).toHaveBeenCalledTimes(2);
  await adapter.dispose();
});

it("refreshes and reconnects a sole USB input on resume with no extra subscriptions or Bluetooth scan", async () => {
  const native = bridge(),
    pause = vi.fn();
  const adapter = new AndroidMidi(
    new MidiBus(),
    vi.fn(),
    pause,
    pause,
    native.plugin,
  );
  await adapter.initialize();
  native.emit("lifecycle", { active: false });
  native.emit("state", native.state("", { connection: 2 }));
  native.emit("lifecycle", { active: true });
  await vi.waitFor(() => expect(native.plugin.select).toHaveBeenCalledTimes(2));
  expect(native.plugin.addListener).toHaveBeenCalledTimes(3);
  expect(native.plugin.discoverBluetooth).not.toHaveBeenCalled();
  expect(pause).toHaveBeenCalled();
  await adapter.dispose();
});

it("forwards permission, scan, connection and cancellation phases without changing MIDI packets", async () => {
  const native = bridge(0),
    update = vi.fn();
  const adapter = new AndroidMidi(
    new MidiBus(),
    update,
    vi.fn(),
    vi.fn(),
    native.plugin,
  );
  await adapter.initialize();
  for (const phase of [
    "permission",
    "scanning",
    "connecting",
    "failed",
    "idle",
  ] as const) {
    native.emit(
      "state",
      native.state("", {
        phase,
        pendingId: phase === "connecting" ? "ble:test" : "",
      }),
    );
    expect(update.mock.lastCall?.[2].phase).toBe(phase);
  }
  expect(native.plugin.select).not.toHaveBeenCalled();
  expect(native.plugin.discoverBluetooth).not.toHaveBeenCalled();
  await adapter.dispose();
});

it("ignores a pre-background clock reply and queued MIDI after pausing", async () => {
  vi.spyOn(performance, "now").mockReturnValue(200);
  const native = bridge(),
    bus = new MidiBus(),
    events: MidiEvent[] = [];
  bus.subscribe((event) => events.push(event));
  let finishOldClock!: (value: { nativeTimeMs: number }) => void;
  vi.mocked(native.plugin.clock).mockReturnValueOnce(
    new Promise((resolve) => {
      finishOldClock = resolve;
    }),
  );
  const adapter = new AndroidMidi(
    bus,
    vi.fn(),
    vi.fn(),
    vi.fn(),
    native.plugin,
  );
  const starting = adapter.initialize();
  await vi.waitFor(() => expect(native.plugin.clock).toHaveBeenCalledOnce());
  native.emit("lifecycle", { active: false });
  native.emit("lifecycle", { active: true });
  await vi.waitFor(() => expect(adapter.input?.id).toBe("4:0"));
  finishOldClock({ nativeTimeMs: 0 });
  await starting;
  native.emit("midi", packet());
  expect(events[0].time).toBe(210);
  native.emit("lifecycle", { active: false });
  native.emit("midi", packet());
  expect(events).toHaveLength(1);
  await adapter.dispose();
});

it("reconnects a manually chosen USB input after reattachment with a new native ID", async () => {
  const native = bridge();
  const adapter = new AndroidMidi(
    new MidiBus(),
    vi.fn(),
    vi.fn(),
    vi.fn(),
    native.plugin,
  );
  await adapter.initialize();
  await adapter.select("4:0");
  native.emit("state", native.state("", { inputs: [], connection: 3 }));
  native.inputs.splice(0, 1, { id: "7:0", name: "Reattached USB piano" });
  native.emit("state", native.state("", { connection: 3, phase: "idle" }));
  await vi.waitFor(() => expect(adapter.input?.id).toBe("7:0"));
  expect(native.plugin.discoverBluetooth).not.toHaveBeenCalled();
  await adapter.dispose();
});
