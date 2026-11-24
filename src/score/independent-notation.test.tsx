import { cleanup, render } from "@testing-library/react";
import { createCanvas } from "@napi-rs/canvas";
import { afterEach, expect, it, vi } from "vitest";
import {
  generateConfigured,
  noteLifetimeDefaults,
  resolveGeneratorConfig,
  tieDefaults,
} from "../generation";
import { movingTrebleWithHeldBass } from "../generation/examples";
import { Scorer } from "../scoring/engine";
import { defaults, noteheads, TPQ } from "./model";
import { Notation } from "./Notation";
import { lifetimeNotes } from "./lifetimes";
import { inferFingeringHints, movementAnnotation } from "./hints";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function installCanvas() {
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

it("engraves independently timed voice lanes, displaced rests and rolling per-head ties on a grand staff", () => {
  installCanvas();
  const c = resolveGeneratorConfig({
    hands: { active: "both" },
    rhythm: { breathBars: [] },
    notation: {
      voices: "independent",
      ties: {
        ...tieDefaults,
        probability: 1,
        crossPhrase: true,
        voices: ["right:2"],
        patterns: [{ value: "carry", weight: 1 }],
      },
    },
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: {
      right: {
        minPolyphony: 2,
        voices: [
          {
            fingers: [3, 4, 5],
            activity: 0.65,
            durations: [{ value: 240, weight: 1 }],
          },
          { fingers: [1, 2], durations: [{ value: 960, weight: 1 }] },
        ],
      },
      left: { voices: [{ durations: [{ value: 480, weight: 1 }] }] },
    },
  });
  const a = generateConfigured(c, "voices-svg");
  const b = generateConfigured(c, a.seed, a.final);
  const settings = { ...defaults, hand: "both" as const, bars: 2 as const };
  const carried = b.events.find((e) =>
    noteheads(e).some((n) => n.tie?.previousId),
  )!;
  expect(carried.voiceId).toBe("right:2");
  const props = {
    hands: a.initial.hands,
    settings,
    reveal: false,
    currentId: carried.id,
  };
  const ui = render(
    <Notation {...props} events={[...a.events, ...b.events]} startBar={3} />,
  );
  const svg = ui.container.querySelector("svg")!;
  expect(svg.getAttribute("data-staff-count")).toBe("2");
  expect(svg.querySelectorAll(".vf-stavetie")).toHaveLength(1);
  expect(svg.querySelector(".current-note")?.id).toBe(`vf-${carried.id}`);
  const visible = [...a.events, ...b.events].filter(
    (e) => e.bar === 3 || e.bar === 4,
  );
  expect(svg.querySelectorAll(".vf-stavenote").length).toBe(visible.length);
  expect(visible.some((e) => e.kind === "rest")).toBe(true);
  const glyph = (id: string) =>
    [...svg.querySelectorAll(".vf-stavenote")].find((n) => n.id === `vf-${id}`);
  const main = b.events.find(
    (e) => e.bar === 4 && e.voiceId === "right:main" && e.kind === "note",
  )!;
  expect(glyph(main.id)?.querySelector(".vf-stem")).toBeTruthy();
  expect(glyph(carried.id)?.querySelector(".vf-stem")).toBeTruthy();
  ui.rerender(<Notation {...props} events={b.events} startBar={4} />);
  const tie = ui.container.querySelector(".vf-stavetie path");
  expect(tie?.getAttribute("d")).toBeTruthy();
  expect(tie?.getAttribute("d")).not.toMatch(/NaN|Infinity/);
});

it("engraves a cross-phrase leap cue over a tied chord and scores the same held keys once", () => {
  installCanvas();
  const c = movingTrebleWithHeldBass();
  const seed = "engraved-leap-over-bass";
  const phrases = [generateConfigured(c, seed)];
  for (let i = 0; i < 5; i++)
    phrases.push(generateConfigured(c, seed, phrases.at(-1)!.final));
  const events = phrases.flatMap((p) => p.events);
  const positions = phrases.flatMap((p) => p.positions);
  const movements = phrases.flatMap((p) => p.movements);
  const notes = lifetimeNotes(events);
  const move = movements.find(
    (m) =>
      m.landingTick % (16 * TPQ) === 0 &&
      notes.filter(
        ({ hand, lifetime }) =>
          hand === "left" &&
          lifetime.onsetTick < m.landingTick &&
          lifetime.releaseTick > m.landingTick,
      ).length >= 2,
  )!;
  expect(move).toBeDefined();
  const carry = notes.filter(
    ({ hand, lifetime }) =>
      hand === "left" &&
      lifetime.onsetTick < move.landingTick &&
      lifetime.releaseTick > move.landingTick,
  );
  const settings = {
    ...defaults,
    mode: "timed" as const,
    bpm: 60,
    hand: "both" as const,
    bars: 2 as const,
    hints: "smart" as const,
  };
  const { hints } = inferFingeringHints(events, positions, movements);
  expect(hints.find((h) => h.noteId === move.landingNoteId)).toMatchObject({
    reasons: expect.arrayContaining(["position-change"]),
    plannedFinger: move.landingFinger,
  });
  const ui = render(
    <Notation
      hands={phrases[0].initial.hands}
      settings={settings}
      events={events}
      positions={positions}
      movements={movements}
      currentId={move.landingNoteId}
      reveal={false}
      startBar={Math.floor(move.cueTick / (4 * TPQ))}
    />,
  );
  const svg = ui.container.querySelector("svg")!;
  expect(svg.textContent).toContain(movementAnnotation(move));
  expect(svg.querySelectorAll(".vf-stavetie").length).toBeGreaterThanOrEqual(
    carry.length,
  );
  expect(svg.querySelector(".current-note")?.id).toBe(
    `vf-${move.landingNoteId}`,
  );
  expect(svg.innerHTML).not.toMatch(/NaN|Infinity/);

  const scorer = new Scorer(phrases[0].events, settings, 120, c);
  for (const p of phrases.slice(1)) scorer.appendNotes(p.events);
  scorer.start(0);
  const edges = notes
    .flatMap(({ midi, lifetime }) => [
      { midi, tick: lifetime.onsetTick, type: "on" as const },
      { midi, tick: lifetime.releaseTick, type: "off" as const },
    ])
    .sort(
      (a, b) =>
        a.tick - b.tick || Number(a.type === "on") - Number(b.type === "on"),
    );
  for (const { midi, tick, type } of edges)
    scorer.input({
      pitch: midi,
      type,
      channel: 1,
      source: "simulator",
      time: 4000 + (tick * 1000) / TPQ,
      velocity: type === "on" ? 90 : 0,
    });
  expect(scorer.results).toHaveLength(notes.length);
  expect(
    scorer.results.every((r) => r.kind === "correct" && r.errorMs === 0),
  ).toBe(true);
  expect(scorer.durationResults).toHaveLength(notes.length);
  expect(scorer.durationResults.every((r) => r.status === "correct")).toBe(
    true,
  );
});
