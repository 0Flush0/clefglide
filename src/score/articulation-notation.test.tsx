import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createCanvas } from "@napi-rs/canvas";
import { Notation } from "./Notation";
import { defaults, noteheads, TPQ } from "./model";
import { MidiBus, type MidiEvent } from "../midi/adapter";
import { Scorer } from "../scoring/engine";
import { articulatedDuet } from "../generation/examples";
import {
  chordDefaults,
  generateConfigured,
  noteLifetimeDefaults,
  resolveGeneratorConfig,
  tieDefaults,
  validateGeneratedPhrase,
} from "../generation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("clips both ends when a rolling window contains only continuations of a slurred tied attack", () => {
  setup();
  const c = resolveGeneratorConfig({
    rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
    notation: {
      ties: {
        ...tieDefaults,
        patterns: [{ value: "carry", weight: 1 }],
        probability: 1,
        crossPhrase: true,
        subdivisions: [480],
        segmentCounts: [12],
        maxDurationTicks: 5760,
      },
    },
    noteLifetimes: noteLifetimeDefaults,
    articulation: {
      kind: "enabled",
      voices: ["right:main"],
      slurs: { probability: 1, lengths: [{ value: 3 }], crossPhrase: true },
      interactions: { ties: "preserve-hold" },
    },
  });
  const first = generateConfigured(c, "tied-through-window");
  const next = generateConfigured(c, first.seed, first.final);
  expect(validateGeneratedPhrase(next, first)).toEqual([]);
  const visible = next.events.filter((e) => e.bar < 6);
  expect(visible.every((e) => !e.slur && e.tie && e.tie.index > 0)).toBe(true);
  const { container } = render(
    <Notation
      events={visible}
      hintEvents={[...first.events, ...next.events]}
      hands={first.initial.hands}
      settings={{ ...defaults, bars: 2 }}
      startBar={4}
      reveal={false}
    />,
  );
  expect(
    container.querySelector(
      '[data-clipped-start="true"][data-clipped-end="true"] path',
    ),
  ).toBeTruthy();
  expect(container.querySelectorAll(".vf-stavetie").length).toBeGreaterThan(0);
});
function setup() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => createCanvas(10, 10).getContext("2d"),
  });
}

it("engraves a phrase-level portato curve and chord-wide glyphs with viewport clipping", () => {
  setup();
  const c = resolveGeneratorConfig({
    hands: { active: "both" },
    chords: { ...chordDefaults, probability: 1 },
    noteLifetimes: noteLifetimeDefaults,
    rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
    articulation: {
      kind: "enabled",
      voices: ["right:main", "left:main"],
      emphasis: [{ value: "marcato" }],
      slurs: {
        probability: 1,
        crossPhrase: true,
        lengths: [{ value: 3 }],
        styles: [{ value: "portato" }],
      },
    },
  });
  const p = generateConfigured(c, "portato");
  const q = generateConfigured(c, p.seed, p.final);
  const events = [...p.events, ...q.events];
  const cross = p.final.articulation!.groups[0];
  const props = {
    events,
    hands: p.initial.hands,
    reveal: false,
    settings: {
      ...defaults,
      hand: "both" as const,
      hints: "all" as const,
      bars: 2 as const,
    },
  };
  const { container, rerender } = render(<Notation {...props} startBar={3} />);
  const group = () =>
    [...container.querySelectorAll(".vf-articulation-slur")].find(
      (n) => n.getAttribute("data-slur-id") === cross.id,
    );
  expect(group()?.getAttribute("data-slur-style")).toBe("portato");
  expect(group()?.getAttribute("data-clipped-start")).toBe("false");
  expect(group()?.getAttribute("data-clipped-end")).toBe("false");
  expect(group()?.querySelector("path")?.getAttribute("d")).toMatch(/C/);
  const chord = events.find(
    (e) => e.bar >= 3 && e.bar <= 4 && noteheads(e).length > 1,
  )!;
  const glyphs =
    container.ownerDocument.getElementById("vf-" + chord.id)?.textContent ?? "";
  expect(glyphs.match(/[\uE4A4\uE4A5]/gu)).toHaveLength(1);
  expect(glyphs.match(/[\uE4AC\uE4AD]/gu)).toHaveLength(1);
  expect(glyphs).toMatch(/[1-5]/);
  rerender(<Notation {...props} startBar={2} />);
  expect(group()?.getAttribute("data-clipped-end")).toBe("true");
  rerender(<Notation {...props} startBar={4} />);
  expect(group()?.getAttribute("data-clipped-start")).toBe("true");
});

it("renders slurs alongside ties and independent voices without changing tick accounting", () => {
  setup();
  const c = resolveGeneratorConfig({
    notation: {
      key: "G",
      voices: "independent",
      ties: {
        ...tieDefaults,
        voices: ["left:main"],
        probability: 1,
        patterns: [{ value: "subdivide", weight: 1 }],
      },
    },
    hands: { active: "both" },
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: {
      right: {
        voices: [
          {
            durations: [{ value: 480, weight: 1 }],
            fingers: [3, 4, 5],
            minAttacksPerPhrase: 3,
          },
          {
            durations: [{ value: 960, weight: 1 }],
            fingers: [1, 2],
            minAttacksPerPhrase: 3,
          },
        ],
      },
      left: { voices: [{ durations: [{ value: 960, weight: 1 }] }] },
    },
    articulation: {
      kind: "enabled",
      voices: ["right:main", "right:2"],
      touch: [{ value: "staccatissimo" }],
      emphasis: [{ value: "accent" }],
      slurs: { probability: 1, lengths: [{ value: 2 }] },
    },
  });
  const p = generateConfigured(c, "concurrent-engraving");
  const { container } = render(
    <Notation
      events={p.events}
      hands={p.initial.hands}
      positions={p.positions}
      settings={{ ...defaults, key: "G" }}
      startBar={0}
      reveal={false}
    />,
  );
  expect(container.querySelectorAll(".vf-stavetie").length).toBeGreaterThan(0);
  const groups = [...container.querySelectorAll(".vf-articulation-slur")];
  const voices = new Set(
    groups.map((group) => JSON.parse(group.getAttribute("data-slur-id")!)[0]),
  );
  expect([...voices].sort()).toEqual(["right:2", "right:main"]);
  expect(container.querySelector("svg")?.textContent).toMatch(
    /[\uE4A6\uE4A7]/u,
  );
  expect(container.querySelector("svg")?.textContent).toMatch(
    /[\uE4A0\uE4A1]/u,
  );
});

it("engraves and scores a streamed wide leap over an independently carried bass chord", () => {
  setup();
  const config = resolveGeneratorConfig(
    {
      articulation: { evaluation: { kind: "evaluate" } },
    },
    articulatedDuet(),
  );
  const first = generateConfigured(config, "mixed-notation-midi");
  const second = generateConfigured(config, first.seed, first.final);
  expect(validateGeneratedPhrase(second, first)).toEqual([]);
  const events = [...first.events, ...second.events];
  const movements = [...first.movements, ...second.movements];
  expect(movements.some((m) => m.technique === "lifted-wide-leap")).toBe(true);
  expect(first.final.activeLifetimes?.length).toBeGreaterThan(1);
  expect(events.some((e) => e.slur)).toBe(true);
  const settings = {
    ...defaults,
    hand: "both" as const,
    mode: "timed" as const,
    bars: 2 as const,
    bpm: 60,
  };
  const { container } = render(
    <Notation
      events={events}
      hands={first.initial.hands}
      positions={[...first.positions, ...second.positions]}
      movements={movements}
      settings={settings}
      startBar={3}
      reveal={false}
    />,
  );
  expect(container.querySelector(".vf-stavetie path")).toBeTruthy();
  const scorer = new Scorer(first.events, settings, 120, config);
  const bus = new MidiBus();
  const disconnect = bus.subscribe((event) => scorer.input(event));
  scorer.start(0);
  const tickMs = 60_000 / (settings.bpm * TPQ);
  const midi: MidiEvent[] = events.flatMap((e) =>
    noteheads(e).flatMap((n) => {
      if (n.tie?.index) return [];
      const life = n.lifetime!;
      const release = e.articulation?.timing
        ? life.onsetTick + e.articulation.timing.ticks
        : life.releaseTick;
      return [
        { type: "on", tick: life.onsetTick },
        { type: "off", tick: release },
      ].map(({ type, tick }) => ({
        type: type as "on" | "off",
        time: scorer.origin + tick * tickMs,
        pitch: n.midi,
        velocity: type === "on" ? 80 : 0,
        channel: 1,
        source: "simulator",
      }));
    }),
  );
  // Equal score ticks still require the old key to release before a repeated attack.
  midi.sort(
    (a, b) =>
      a.time - b.time || Number(a.type === "on") - Number(b.type === "on"),
  );
  const boundary =
    scorer.origin + second.initial.bar * settings.beats * TPQ * tickMs;
  for (const event of midi.filter((e) => e.time < boundary)) bus.emit(event);
  scorer.appendNotes(second.events);
  for (const event of midi.filter((e) => e.time >= boundary)) bus.emit(event);
  disconnect();
  expect(scorer.results).toHaveLength(midi.length / 2);
  expect(
    scorer.results.filter(
      (r) => r.kind !== "correct" || Math.abs(r.errorMs ?? Infinity) > 1e-8,
    ),
  ).toEqual([]);
  expect(scorer.durationResults.length).toBeGreaterThan(0);
  expect(scorer.durationResults.every((r) => r.status === "correct")).toBe(
    true,
  );
  expect(scorer.articulationResults.length).toBeGreaterThan(0);
  expect(scorer.articulationResults.every((r) => r.status === "correct")).toBe(
    true,
  );
});
