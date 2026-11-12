import { describe, expect, it, vi } from "vitest";
import {
  defaults,
  noteheads,
  type Settings,
  type StreamState,
} from "../score/model";
import { applyHandMovements } from "./difficulty";
import { generate } from "./planner";
import { hash } from "./random";
import { validatePhrase } from "./validator";
import { diatonicIndex } from "./positions";
import * as coverage from "./rangeCoverage";

const input = {
  min: 48,
  max: 72,
  context: "test",
  position: 52,
  destinations: [52, 54, 56, 58, 60, 62, 64, 66, 68],
};
function memory(): coverage.RangeCoverage {
  return {
    min: 48,
    max: 72,
    context: "test",
    usage: [0, 0, 0, 0, 0],
    target: 68,
    remaining: 5,
  };
}
function session(s: Settings, seed: string, phrases = 96) {
  let state: StreamState | undefined;
  const pitches = new Set<number>(),
    latePitches = new Set<number>();
  const histogram = [0, 0, 0, 0, 0],
    moves: number[] = [],
    positions: string[] = [];
  const phrasesSeen = new Set<string>();
  let steps = 0,
    intervals = 0;
  for (let i = 0; i < phrases; i++) {
    // generate independently validates every phrase, including continuity.
    const p = generate(s, seed, state);
    p.events.flatMap(noteheads).forEach((n) => {
      pitches.add(n.midi);
      if (i >= phrases / 2) latePitches.add(n.midi);
      histogram[
        Math.min(4, Math.floor(((n.midi - s.min) / (s.max - s.min + 1)) * 5))
      ]++;
    });
    const line = p.events.filter((e) => e.kind === "note");
    for (let j = 1; j < line.length; j++) {
      if (
        Math.abs(
          diatonicIndex(line[j].pitch) - diatonicIndex(line[j - 1].pitch),
        ) <= 1
      )
        steps++;
      intervals++;
    }
    moves.push(...p.movements.map((m) => m.distance));
    positions.push(...p.movements.map((m) => m.toPositionId));
    phrasesSeen.add(p.events.map((e) => `${e.midi}:${e.duration}`).join(","));
    state = p.final;
  }
  const total = histogram.reduce((a, b) => a + b, 0);
  return {
    span: Math.max(...pitches) - Math.min(...pitches),
    lateSpan: Math.max(...latePitches) - Math.min(...latePitches),
    diversity: 1 / histogram.reduce((sum, n) => sum + (n / total) ** 2, 0),
    moves,
    positions,
    phrasesSeen: phrasesSeen.size,
    stepShare: steps / intervals,
  };
}
type Session = ReturnType<typeof session>;
const mean = (
  xs: Session[],
  key: "span" | "lateSpan" | "diversity" | "stepShare",
) => xs.reduce((sum, x) => sum + x[key], 0) / xs.length;

describe("range coverage memory", () => {
  it("counts actual pitches in five regions, decays old use and stays bounded", () => {
    const state = memory();
    coverage.recordRangeCoverage(state, [48, 49, 53, 58, 63, 68, 72]);
    expect(state.usage[0]).toBeCloseTo((0.05 * 2) / 7);
    expect(state.usage[4]).toBeCloseTo((0.05 * 2) / 7);
    expect(state.usage.reduce((sum, n) => sum + n)).toBeCloseTo(0.05);
    const old = state.usage[0];
    coverage.recordRangeCoverage(state, [72]);
    expect(state.usage[0]).toBeCloseTo(old * 0.95);
    for (let i = 0; i < 2000; i++) coverage.recordRangeCoverage(state, [72]);
    expect(state.usage).toHaveLength(5);
    expect(state.usage[0]).toBeLessThan(0.0001);
    expect(state.usage[4]).toBeCloseTo(1);
  });
  it("prefers underused regions statistically while retaining other destinations", () => {
    const previous = { ...memory(), remaining: 0, usage: [1, 1, 1, 1, 0] };
    const targets = Array.from(
      { length: 400 },
      (_, i) =>
        coverage.planRangeCoverage(previous, input, {
          rng: hash(`target-${i}`),
        }).target,
    );
    expect(targets.filter((n) => n === 68).length).toBeGreaterThan(260);
    expect(new Set(targets).size).toBeGreaterThan(3);
    expect(previous.usage).toEqual([1, 1, 1, 1, 0]);
  });
  it("holds a target across phrases, then releases reached or expired goals", () => {
    const previous = memory(),
      rng = { rng: hash("hold") };
    const retained = coverage.planRangeCoverage(previous, input, rng);
    expect(retained.target).toBe(previous.target);
    expect(retained.remaining).toBe(4);
    expect(rng.rng).toBe(hash("hold"));
    expect(previous.remaining).toBe(5);
    for (const [state, position] of [
      [{ ...previous, remaining: 0 }, 52],
      [previous, 68],
    ] as const) {
      const next = coverage.planRangeCoverage(
        state,
        { ...input, position },
        { rng: hash("release") },
      );
      expect(next.remaining).toBeGreaterThan(5);
      expect(input.destinations).toContain(next.target);
    }
  });
  it("resets on range or generation-context changes and bounds preferences", () => {
    const previous = { ...memory(), usage: [1, 1, 1, 1, 1] };
    for (const change of [
      { min: 47 },
      { max: 74 },
      { context: "new-settings" },
    ]) {
      expect(
        coverage.planRangeCoverage(
          previous,
          { ...input, ...change },
          { rng: 123 },
        ).usage,
      ).toEqual([0, 0, 0, 0, 0]);
    }
    for (let to = 40; to <= 80; to++) {
      const weight = coverage.coverageMoveWeight(memory(), 60, to);
      expect(weight).toBeGreaterThanOrEqual(0.1 - 1e-12);
      expect(weight).toBeLessThanOrEqual(1);
    }
    expect(coverage.coverageMoveWeight(memory(), 60, 62)).toBeGreaterThan(
      coverage.coverageMoveWeight(memory(), 60, 58),
    );
  });
});

describe("coverage-guided exploration", () => {
  it.each([72, 84])(
    "explores a broader register over long sessions ending at MIDI %i",
    (max) => {
      const s = applyHandMovements({ ...defaults, min: 48, max }, "medium");
      const seeds = Array.from({ length: 24 }, (_, i) => `exploration-${i}`);
      const guided = seeds.map((seed) => session(s, seed));
      // Ablation restores the original contours, small-move weights and RNG
      // consumption. A weight of one reproduces the old relocation sampler.
      const plan = coverage.planRangeCoverage;
      vi.spyOn(coverage, "planRangeCoverage").mockImplementation(
        (previous, settings, rng) => plan(previous, settings, { ...rng }),
      );
      vi.spyOn(coverage, "coverageMoveWeight").mockReturnValue(1);
      vi.spyOn(coverage, "coveragePhraseShape").mockImplementation(
        (_state, _position, shape) => shape,
      );
      let baseline: Session[];
      try {
        baseline = seeds.map((seed) => session(s, seed));
      } finally {
        vi.restoreAllMocks();
      }
      expect(mean(guided, "lateSpan")).toBeGreaterThan(
        mean(baseline, "lateSpan") * 1.15,
      );
      expect(mean(guided, "span")).toBeGreaterThan((max - 48) * 0.9);
      if (max === 84) {
        expect(mean(guided, "span")).toBeGreaterThan(
          mean(baseline, "span") * 1.1,
        );
        expect(mean(guided, "diversity")).toBeGreaterThan(
          mean(baseline, "diversity") * 1.05,
        );
      }
    },
    120000,
  );
  it("retains varied short phrases and avoids mechanical reversals or pendulums", () => {
    const s = applyHandMovements({ ...defaults, min: 48, max: 72 }, "medium");
    const short = Array.from({ length: 16 }, (_, i) =>
      session(s, `short-${i}`, 4),
    );
    expect(short.every((x) => x.phrasesSeen === 4)).toBe(true);
    expect(mean(short, "stepShare")).toBeGreaterThan(0.55);
    expect(mean(short, "span")).toBeLessThan(20);
    const long = Array.from({ length: 16 }, (_, i) =>
      session(s, `motion-${i}`, 64),
    );
    let reversals = 0,
      comparisons = 0,
      pendulums = 0,
      windows = 0;
    for (const x of long) {
      for (let i = 1; i < x.moves.length; i++) {
        comparisons++;
        if (Math.sign(x.moves[i]) !== Math.sign(x.moves[i - 1])) reversals++;
      }
      for (let i = 3; i < x.positions.length; i++) {
        windows++;
        if (
          x.positions[i] === x.positions[i - 2] &&
          x.positions[i - 1] === x.positions[i - 3]
        )
          pendulums++;
      }
    }
    expect(reversals / comparisons).toBeGreaterThan(0.05);
    expect(reversals / comparisons).toBeLessThan(0.75);
    expect(pendulums / windows).toBeLessThan(0.15);
  });
  it("keeps movement levels and overrides authoritative over continuations", () => {
    const counts: number[] = [];
    for (const level of ["off", "easy", "medium", "hard"] as const) {
      let count = 0;
      for (let seed = 0; seed < 8; seed++) {
        const s = applyHandMovements({ ...defaults, min: 48, max: 72 }, level);
        const run = session(s, `limits-${seed}`, 48);
        count += run.moves.length;
        expect(run.moves.every((d) => Math.abs(d) <= s.maxShift)).toBe(true);
        expect(
          session({ ...s, shiftFrequency: 0 }, `zero-${seed}`, 8).moves,
        ).toEqual([]);
        expect(
          session({ ...s, maxShift: 0 }, `distance-zero-${seed}`, 8).moves,
        ).toEqual([]);
      }
      counts.push(count);
    }
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[3]).toBeGreaterThan(counts[2]);
  });
  it("preserves independent hands, deterministic continuation and narrow/chromatic/chord plans", () => {
    for (const key of ["C", "G", "F", "D"] as const)
      for (const narrow of [false, true]) {
        const s: Settings = applyHandMovements(
          {
            ...defaults,
            hand: "both",
            key,
            min: 60,
            max: narrow ? 69 : 84,
            leftMin: 36,
            leftMax: narrow ? 45 : 60,
            accidentals: "hard",
            chords: "hard",
            fingerSpacing: "hard",
            noteJumps: "large",
            interval: 7,
          },
          "hard",
        );
        let state: StreamState | undefined;
        for (let i = 0; i < 16; i++) {
          const seed = `combined-${key}-${narrow}`,
            before = structuredClone(state);
          const p = generate(s, seed, state);
          expect(generate(s, seed, state)).toEqual(p);
          expect(state).toEqual(before);
          if (state) expect(p.initial).toEqual(state);
          expect(validatePhrase(p)).toEqual([]);
          for (const n of p.events.flatMap(noteheads)) {
            expect(n.midi).toBeGreaterThanOrEqual(
              n.hand === "left" ? s.leftMin : s.min,
            );
            expect(n.midi).toBeLessThanOrEqual(
              n.hand === "left" ? s.leftMax : s.max,
            );
          }
          for (const hand of ["right", "left"] as const) {
            const recorded = structuredClone(p.final.coverage![hand]!);
            recorded.usage = [
              ...(p.initial.coverage?.[hand]?.usage ?? [0, 0, 0, 0, 0]),
            ];
            coverage.recordRangeCoverage(
              recorded,
              p.events
                .filter((e) => e.hand === hand)
                .flatMap(noteheads)
                .map((n) => n.midi),
            );
            expect(recorded.usage).toEqual(p.final.coverage![hand]!.usage);
          }
          expect(p.final.coverage!.left).not.toBe(p.final.coverage!.right);
          state = p.final;
        }
      }
  });
  it("resets with new exercises/settings and ignores assistance changes", () => {
    const s = applyHandMovements({ ...defaults, min: 48, max: 72 }, "medium");
    const first = generate(s, "settings"),
      next = generate(s, "settings", first.final);
    const hints = generate({ ...s, hints: "hidden" }, "settings", first.final);
    expect(hints.final).toEqual(next.final);
    expect(hints.events).toEqual(next.events);
    expect(generate(s, "settings")).toEqual(first);
    const changed = generate(
      { ...s, rhythm: "mixed" },
      "settings",
      first.final,
    );
    const expected = structuredClone(first.final);
    delete expected.coverage;
    expect(changed.final).toEqual(
      generate({ ...s, rhythm: "mixed" }, "settings", expected).final,
    );
    expect(
      generate({ ...s, min: 60, max: 84 }, "settings").final.coverage!.right,
    ).toMatchObject({ min: 60, max: 84 });
  });
});
