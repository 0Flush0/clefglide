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
  chromaticDefaults,
} from "../generation";
import { selectFingeringHints } from "./hints";
import { validateTieSegments } from "./ties";

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

it("validates and engraves multi-phrase chromatic holds with both endpoints outside a rolling window", () => {
  setup();
  const c = resolveGeneratorConfig({
    hands: { active: "both" },
    chromatic: { ...chromaticDefaults, probability: 0.7 },
    rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
    notation: {
      ties: {
        ...tieDefaults,
        probability: 1,
        crossPhrase: true,
        segmentCounts: [34],
        maxDurationTicks: 20000,
        patterns: [{ value: "carry", weight: 1 }],
      },
    },
    noteLifetimes: noteLifetimeDefaults,
  });
  const a = Array.from({ length: 20 }, (_, i) =>
    generateConfigured(c, `chromatic-window-${i}`),
  ).find((p) =>
    p.final.pendingTies!.some(
      (item) =>
        !p.final.hands
          .find((h) => h.hand === item.head.hand)!
          .pitches.includes(item.head.pitch),
    ),
  )!;
  expect(a).toBeDefined();
  const b = generateConfigured(c, a.seed, a.final),
    next = generateConfigured(c, a.seed, b.final),
    last = generateConfigured(c, a.seed, next.final);
  const context = [...a.events, ...b.events, ...next.events, ...last.events];
  const props = {
    hands: a.initial.hands,
    settings: { ...defaults, hand: "both" as const, bars: 2 as const },
    reveal: false,
  };
  const ui = render(<Notation {...props} events={b.events} startBar={4} />);
  for (const startBar of [4, 5, 6, 8, 9, 10]) {
    const phrase = startBar < 8 ? b : next;
    const visible = phrase.events.filter(
      (e) => e.bar >= startBar && e.bar < startBar + 2,
    );
    expect(
      validateTieSegments(
        visible,
        4,
        [],
        startBar * 1920,
        (startBar + 2) * 1920,
        c.notation.ties || undefined,
        context,
      ),
    ).toEqual([]);
    const corrupted = structuredClone(visible);
    corrupted[0].notes![0].tie!.previousId = "missing";
    expect(
      validateTieSegments(
        corrupted,
        4,
        [],
        startBar * 1920,
        (startBar + 2) * 1920,
        c.notation.ties || undefined,
        context,
      ).length,
    ).toBeGreaterThan(0);
    ui.rerender(
      <Notation {...props} events={phrase.events} startBar={startBar} />,
    );
    expect(ui.container.querySelectorAll(".vf-stavetie")).toHaveLength(18);
    for (const path of ui.container.querySelectorAll(".vf-stavetie path"))
      expect(path.getAttribute("d")).not.toMatch(/NaN|Infinity/);
  }
});

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

it("renders partial boundary chords when the held tone changes its sorted engraving index", () => {
  setup();
  const c = resolveGeneratorConfig({
    hands: { active: "both" },
    melody: { maxIntervalSteps: 7 },
    chords: { ...chordDefaults, probability: 1, maxVoiceLeadingSteps: 7 },
    harmony: { progressions: [{ value: [1, 1, 1, 1], weight: 1 }] },
    rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
    notation: {
      ties: {
        ...tieDefaults,
        probability: 1,
        crossPhrase: true,
        chordTones: "any",
        patterns: [{ value: "carry", weight: 1 }],
      },
    },
    noteLifetimes: noteLifetimeDefaults,
  });
  const ordered = (heads: ReturnType<typeof noteheads>) =>
    [...heads].sort((a, b) => a.midi - b.midi);
  const pair = Array.from({ length: 30 }, (_, i) => {
    const a = generateConfigured(c, `indexed-boundary-${i}`);
    return [a, generateConfigured(c, a.seed, a.final)];
  }).find(([a, b]) =>
    a.final.pendingTies!.some((pending) => {
      const source = a.events.find((e) =>
        noteheads(e).some((n) => n.id === pending.head.id),
      )!;
      const target = b.events.find((e) =>
        noteheads(e).some((n) => n.id === pending.nextSegmentId),
      )!;
      return (
        ordered(noteheads(source)).findIndex(
          (n) => n.id === pending.head.id,
        ) !==
        ordered(noteheads(target)).findIndex(
          (n) => n.id === pending.nextSegmentId,
        )
      );
    }),
  )!;
  expect(pair).toBeDefined();
  const [a, b] = pair;
  const props = {
    hands: a.initial.hands,
    settings: { ...defaults, hand: "both" as const, bars: 2 as const },
    reveal: false,
  };
  const ui = render(
    <Notation {...props} events={[...a.events, ...b.events]} startBar={3} />,
  );
  expect(ui.container.querySelectorAll(".vf-stavetie")).toHaveLength(2);
  ui.rerender(<Notation {...props} events={b.events} startBar={4} />);
  expect(ui.container.querySelectorAll(".vf-stavetie")).toHaveLength(2);
  for (const path of ui.container.querySelectorAll(".vf-stavetie path"))
    expect(path.getAttribute("d")).not.toMatch(/NaN|Infinity/);
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
  // Authored engraving fixture isolates accidental state from the generation sampler.
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
