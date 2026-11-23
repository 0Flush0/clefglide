import { afterEach, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createCanvas } from "@napi-rs/canvas";
import { Notation } from "./Notation";
import { defaults, noteheads } from "./model";
import {
  generateConfigured,
  resolveGeneratorConfig,
  tieDefaults,
  noteLifetimeDefaults,
  chordDefaults,
} from "../generation";
import { selectFingeringHints } from "./hints";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => createCanvas(10, 10).getContext("2d"),
  });
}

it("renders VexFlow ties across barlines and both edges of the rolling viewport", () => {
  setup();
  const c = resolveGeneratorConfig({
    hands: { active: "both" },
    rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
    notation: {
      ties: {
        ...tieDefaults,
        probability: 1,
        crossPhrase: true,
        patterns: [{ value: "carry", weight: 1 }],
      },
    },
    noteLifetimes: noteLifetimeDefaults,
  });
  const a = generateConfigured(c, "rolling-tie"),
    b = generateConfigured(c, "rolling-tie", a.final);
  const events = [...a.events, ...b.events];
  const props = {
    events,
    hands: a.initial.hands,
    settings: {
      ...defaults,
      hand: "both" as const,
      bars: 2 as const,
      hints: "all" as const,
    },
    reveal: false,
  };
  const ui = render(
    <Notation {...props} startBar={3} currentId={b.events[0].id} />,
  );
  expect(ui.container.querySelectorAll(".vf-stavetie")).toHaveLength(2);
  expect(
    ui.container.querySelectorAll(".vf-stavetie path").length,
  ).toBeGreaterThan(0);
  expect(ui.container.querySelectorAll(".current-note")).toHaveLength(1);
  const fingers = () =>
    [...ui.container.querySelectorAll("svg text")].filter((n) =>
      /^[1-5]$/.test(n.textContent ?? ""),
    );
  expect(fingers()).toHaveLength(14); // sixteen heads, two incoming continuations
  const paths = [...ui.container.querySelectorAll(".vf-stavetie path")].map(
    (p) => p.getAttribute("d"),
  );
  ui.rerender(<Notation {...props} startBar={2} />);
  expect(ui.container.querySelectorAll(".vf-stavetie")).toHaveLength(2);
  expect(
    [...ui.container.querySelectorAll(".vf-stavetie path")].map((p) =>
      p.getAttribute("d"),
    ),
  ).not.toEqual(paths);
  ui.rerender(<Notation {...props} events={b.events} startBar={4} />);
  expect(ui.container.querySelectorAll(".vf-stavetie")).toHaveLength(2);
  expect(fingers()).toHaveLength(14);
  for (const path of ui.container.querySelectorAll(".vf-stavetie path"))
    expect(path.getAttribute("d")).not.toMatch(/NaN|Infinity/);
});

it("retains per-head chord tie curves and suppresses duplicate hints in All, Smart and reveal modes", () => {
  setup();
  const c = resolveGeneratorConfig({
    chords: { ...chordDefaults, probability: 1 },
    harmony: { progressions: [{ value: [1, 1, 1, 1], weight: 1 }] },
    rhythm: { durations: [{ value: 960, weight: 1 }], breathBars: [] },
    notation: {
      ties: {
        ...tieDefaults,
        probability: 1,
        chordTones: "any",
        patterns: [{ value: "subdivide", weight: 1 }],
      },
    },
    noteLifetimes: noteLifetimeDefaults,
  });
  const p = generateConfigured(c, "chord-tie-svg");
  const continuations = p.events
    .flatMap(noteheads)
    .filter((n) => n.tie?.index === 1);
  expect(continuations.length).toBeGreaterThan(0);
  for (const mode of ["all", "smart", "hidden"] as const)
    for (const reveal of [false, true]) {
      const hints = selectFingeringHints(
        p.events,
        p.positions,
        p.movements,
        mode,
        reveal,
      );
      expect(
        hints.some((h) => continuations.some((n) => n.id === h.noteId)),
      ).toBe(false);
    }
  const ui = render(
    <Notation
      events={p.events}
      hands={p.initial.hands}
      settings={defaults}
      startBar={0}
      reveal={false}
    />,
  );
  expect(ui.container.querySelectorAll(".vf-stavetie")).toHaveLength(
    continuations.length,
  );
});

it("suppresses a tied chromatic accidental across the barline without suppressing a later attack's accidental", () => {
  setup();
  const c = resolveGeneratorConfig({
    rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
    notation: {
      ties: {
        ...tieDefaults,
        probability: 1,
        crossPhrase: true,
        patterns: [{ value: "carry", weight: 1 }],
      },
    },
    noteLifetimes: noteLifetimeDefaults,
  });
  const a = generateConfigured(c, "accidental-tie"),
    b = generateConfigured(c, "accidental-tie", a.final);
  const events = [...a.events, ...b.events];
  // Authored engraving fixture: the generator deliberately limits phrase carry to diatonic notes.
  const source = events.find((e) => e.tie?.index === 0)!;
  const continuation = events.find((e) => e.id === source.tie!.nextId)!;
  const later = events.find((e) => e.bar === 4 && e.onset === 480)!;
  for (const e of [source, continuation, later]) {
    e.pitch = "F#4";
    e.midi = 66;
    e.finger = 4;
    e.notes![0].pitch = "F#4";
    e.notes![0].midi = 66;
    e.notes![0].finger = 4;
  }
  const ui = render(
    <Notation
      events={events}
      hands={a.initial.hands}
      settings={{ ...defaults, bars: 2 }}
      startBar={3}
      reveal={false}
    />,
  );
  const node = (id: string) =>
    [...ui.container.querySelectorAll(".vf-stavenote")].find(
      (n) => n.id === `vf-${id}`,
    )!;
  const signs = (id: string) =>
    [...node(id).querySelectorAll("text")]
      .map((n) => n.textContent)
      .join("")
      .match(/[\uE260-\uE262]/g) ?? [];
  expect(signs(source.id)).toEqual(["\uE262"]);
  expect(signs(continuation.id)).toEqual([]);
  expect(signs(later.id)).toEqual(["\uE262"]);
});
