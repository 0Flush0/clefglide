import { expect, it } from "vitest";
import { defaults, noteheads, type Settings } from "../score/model";
import { generate } from "./planner";
import { rangeError } from "./positions";
import { validatePhrase } from "./validator";

it("enforces independent hand ranges for chords, chromatic notes and movement across chunks", () => {
  let chords = 0,
    accidentals = 0,
    movements = 0;
  for (const hand of ["left", "right", "both"] as const) {
    for (const key of ["C", "G", "F", "D"] as const) {
      for (let seed = 0; seed < 12; seed++) {
        const s: Settings = {
          ...defaults,
          hand,
          key,
          min: 66,
          max: 88,
          leftMin: 33,
          leftMax: 57,
          handMovements: "hard",
          shiftFrequency: 1,
          maxShift: 4,
          noteJumps: "large",
          interval: 7,
          accidentals: "hard",
          chords: "hard",
          fingerSpacing: "hard",
        };
        const a = generate(s, `ranges-${seed}`);
        const b = generate(s, `ranges-${seed}`, a.final);
        expect(b.initial).toEqual(a.final);
        for (const p of [a, b]) {
          expect(validatePhrase(p)).toEqual([]);
          movements += p.movements.length;
          for (const e of p.events) {
            if (noteheads(e).length > 1) chords++;
            for (const n of noteheads(e)) {
              expect(n.midi).toBeGreaterThanOrEqual(
                n.hand === "left" ? s.leftMin : s.min,
              );
              expect(n.midi).toBeLessThanOrEqual(
                n.hand === "left" ? s.leftMax : s.max,
              );
              if (n.written?.accidental) accidentals++;
            }
          }
        }
      }
    }
  }
  expect(chords).toBeGreaterThan(0);
  expect(accidentals).toBeGreaterThan(0);
  expect(movements).toBeGreaterThan(0);
});

it("uses either end of the 88-key piano and permits feasible overlapping ranges", () => {
  for (const s of [
    { ...defaults, hand: "left" as const, leftMin: 21, leftMax: 29 },
    { ...defaults, min: 101, max: 108 },
    {
      ...defaults,
      hand: "both" as const,
      min: 48,
      max: 84,
      leftMin: 36,
      leftMax: 72,
    },
  ]) {
    expect(rangeError(s)).toBeUndefined();
    for (let seed = 0; seed < 10; seed++)
      expect(validatePhrase(generate(s, String(seed)))).toEqual([]);
  }
});

it("rejects an infeasible active hand while ignoring the unused hand range", () => {
  const s = { ...defaults, hand: "left" as const, leftMin: 61, leftMax: 67 };
  expect(rangeError(s)).toContain("Left hand");
  expect(() => generate(s, "narrow-left")).toThrow(/five consecutive/);
  expect(() => generate({ ...s, hand: "right" }, "unused-left")).not.toThrow();
  expect(() =>
    generate(
      { ...defaults, hand: "both", leftMin: 60, leftMax: 67 },
      "collision",
    ),
  ).toThrow(/non-overlapping/);
  const p = generate({ ...defaults, hand: "left" }, "validator-left");
  // A corrupt configuration cannot pass just because the notes fit RH min/max.
  p.settings = { ...p.settings, leftMin: 72, leftMax: 79 };
  expect(validatePhrase(p)).toContain(
    "Invalid diatonic position, spelling or range.",
  );
});
