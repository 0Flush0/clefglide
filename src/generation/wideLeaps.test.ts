import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Note } from "tonal";
import { TPQ, VERSION, type Hand, type StreamState } from "../score/model";
import { inferFingeringHints, movementAnnotation } from "../score/hints";
import {
  generateConfigured,
  inspectGeneratorFeasibility,
  resolveGeneratorConfig,
  wideLeapDefaults,
  repositionDefaults,
  chromaticDefaults,
  chordDefaults,
  generatorConfigFingerprint,
  type GeneratorOverrides,
} from "./index";
import { validateGeneratedPhrase } from "./phraseValidator";
import { positionsForConfig, diatonicIndex } from "./positionMaps";
import type { GeneratedPhrase } from "./model";
import { hash } from "./random";

function config(overrides: GeneratorOverrides = {}) {
  return resolveGeneratorConfig(
    overrides,
    resolveGeneratorConfig({
      hands: { right: { min: 21, max: 108 }, left: { min: 21, max: 108 } },
      wideLeaps: {
        ...wideLeapDefaults,
        probability: 1,
        eligibleBars: [1, 2, 3],
      },
    }),
  );
}
function endpoint(
  c: ReturnType<typeof config>,
  hand: Hand,
  high = false,
): StreamState {
  const positions = positionsForConfig(c, hand);
  const h = structuredClone(high ? positions.at(-1)! : positions[0]);
  const midi = Note.midi(h.pitches[0])!;
  h.lastPitch = h.pitches[0];
  h.lastIndex = 0;
  h.lastFingering = [{ midi, finger: h.fingerToMidi.indexOf(midi) + 1 }];
  h.lastNoteEnd = 0;
  return { rng: 12345, bar: 0, hands: [h], hints: {} };
}
const wideMoves = (p: GeneratedPhrase) =>
  p.movements.filter((m) => m.technique === "lifted-wide-leap");

describe("lifted wide hand leaps", () => {
  it.each(["right", "left"] as const)(
    "realizes minimum and full-keyboard maximum distances for %s",
    (hand) => {
      for (const distance of [5, 47]) {
        for (const high of [false, true]) {
          const c = config({
            hands: { active: hand },
            wideLeaps: {
              minDistanceSteps: distance,
              maxDistanceSteps: distance,
              maxLandingIntervalSteps: 51,
              additionalPreparationBeatsPerOctave: 0,
              eligibleBars: [1],
            },
          });
          const p = generateConfigured(
            c,
            `endpoint-${hand}-${distance}-${high}`,
            endpoint(c, hand, high),
          );
          expect(validateGeneratedPhrase(p)).toEqual([]);
          expect(wideMoves(p)).toHaveLength(1);
          expect(wideMoves(p)[0].distance).toBe((high ? -1 : 1) * distance);
          const to = p.positions.find(
            (h) => h.id === wideMoves(p)[0].toPositionId,
          )!;
          expect(to.fingerToMidi).toContain(wideMoves(p)[0].landingMidi);
        }
      }
    },
  );

  it("rejects contradictory parameters and reports structurally valid but impossible capabilities", () => {
    const invalid: GeneratorOverrides[] = [
      { wideLeaps: { minDistanceSteps: 4 } },
      { wideLeaps: { maxDistanceSteps: 52 } },
      { wideLeaps: { minDistanceSteps: 15, maxDistanceSteps: 14 } },
      { wideLeaps: { probability: 1.1 } },
      { wideLeaps: { landingFingers: [0] } },
      { wideLeaps: { landingFingers: [2, 2] } },
      { wideLeaps: { eligibleBars: [0, 0] } },
      { wideLeaps: { preparationBeats: 1 } },
      { wideLeaps: { preparationBeats: 4 } },
      { wideLeaps: { eligibleBars: [1], preparationBeats: 16 } },
      {
        movement: { ...repositionDefaults, probability: 1, eligibleBars: [1] },
        wideLeaps: { eligibleBars: [2], preparationBeats: 5 },
      },
    ];
    invalid.forEach((o) => expect(() => config(o)).toThrow());
    for (const o of [
      { hands: { right: { min: 60, max: 67 } } },
      {
        wideLeaps: {
          minDistanceSteps: 48,
          maxDistanceSteps: 51,
          additionalPreparationBeatsPerOctave: 0,
        },
      },
      {
        wideLeaps: {
          minDistanceSteps: 14,
          maxDistanceSteps: 14,
          maxLandingIntervalSteps: 1,
        },
      },
    ] satisfies GeneratorOverrides[]) {
      const c = config(o);
      expect(inspectGeneratorFeasibility(c).errors.join(" ")).toContain(
        "wide leaps are infeasible",
      );
      expect(() => generateConfigured(c, "impossible")).toThrow(/infeasible/);
    }
  });

  it.each(["C", "G", "F", "D"] as const)(
    "reaches both extreme valid map anchors in %s without lowering the requested distance",
    (key) => {
      const base = config({ notation: { key } });
      const positions = positionsForConfig(base, "right");
      const distance =
        diatonicIndex(positions.at(-1)!.pitches[0]) -
        diatonicIndex(positions[0].pitches[0]);
      const c = config({
        notation: { key },
        wideLeaps: {
          eligibleBars: [1],
          minDistanceSteps: distance,
          maxDistanceSteps: distance,
          maxLandingIntervalSteps: 51,
          additionalPreparationBeatsPerOctave: 0,
        },
      });
      const p = generateConfigured(c, `extreme-${key}`, endpoint(c, "right"));
      expect(wideMoves(p)).toHaveLength(1);
      expect(wideMoves(p)[0].distance).toBe(distance);
      expect(wideMoves(p)[0].toPositionId).toBe(positions.at(-1)!.id);
    },
  );

  it("enforces distance-dependent preparation and independently rejects underprepared moves", () => {
    const c = config({
      wideLeaps: {
        eligibleBars: [1],
        minDistanceSteps: 14,
        maxDistanceSteps: 47,
        maxLandingIntervalSteps: 51,
        preparationBeats: 3,
        minimumPreparationBeats: 1,
        additionalPreparationBeatsPerOctave: 1,
      },
    });
    const p = generateConfigured(
      c,
      "distance-preparation",
      endpoint(c, "right"),
    );
    expect(wideMoves(p)).toHaveLength(1);
    expect(Math.abs(wideMoves(p)[0].distance)).toBe(14);
    const bad = structuredClone(p);
    bad.config = config({
      wideLeaps: {
        eligibleBars: [1],
        minDistanceSteps: 5,
        maxDistanceSteps: 47,
        maxLandingIntervalSteps: 51,
        preparationBeats: 3,
        minimumPreparationBeats: 1,
        additionalPreparationBeatsPerOctave: 1.2,
      },
    });
    // The minimum distance still fits, but this actual 14-step move needs 3.4 beats.
    bad.configFingerprint = generatorConfigFingerprint(bad.config);
    expect(validateGeneratedPhrase(bad)).toContain(
      "Invalid movement, landing or advance preparation cue.",
    );
  });

  it("uses only the separate landing interval limit, then resumes ordinary melody and chord rules", () => {
    const c = config({
      melody: { maxIntervalSteps: 1 },
      wideLeaps: {
        minDistanceSteps: 14,
        maxDistanceSteps: 14,
        maxLandingIntervalSteps: 18,
      },
      chords: { ...chordDefaults, probability: 1, maxVoiceLeadingSteps: 1 },
      chromatic: chromaticDefaults,
    });
    const p = generateConfigured(c, "leap-intervals", endpoint(c, "right"));
    expect(wideMoves(p).length).toBeGreaterThan(0);
    const hints = inferFingeringHints(p.events, p.positions, p.movements).hints;
    for (const m of wideMoves(p)) {
      const landing = p.events.find((e) => e.id === m.landingNoteId)!;
      expect(landing.notes).toHaveLength(1);
      expect(hints.find((h) => h.noteId === landing.id)).toMatchObject({
        show: true,
        reasons: ["position-change"],
      });
      expect(movementAnnotation(m)).toMatch(/^Leap RH/);
    }
    expect(validateGeneratedPhrase(p)).toEqual([]);
    const corrupted = structuredClone(p);
    const ordinary = corrupted.events.find(
      (e) =>
        e.kind === "note" &&
        !p.movements.some((m) => m.landingNoteId === e.id) &&
        e.onset > 0,
    )!;
    ordinary.pitch = "C8";
    ordinary.midi = 108;
    expect(validateGeneratedPhrase(corrupted)).toContain(
      "Maximum diatonic interval exceeded.",
    );
  });

  it.each(
    ([3, 4] as const).flatMap((beats) =>
      [0, 1, 2, 3].map((landingBar) => ({ beats, landingBar })),
    ),
  )(
    "carries long preparation into landing bar $landingBar in $beats/4 across phrase boundaries",
    ({ beats, landingBar }) => {
      const preparationBeats = beats * 4 - 1;
      const c = config({
        notation: { beats },
        wideLeaps: {
          eligibleBars: [landingBar],
          preparationBeats,
          minimumPreparationBeats: 2,
          additionalPreparationBeatsPerOctave: 1,
          maxDistanceSteps: 47,
          maxLandingIntervalSteps: 51,
        },
      });
      const first = generateConfigured(c, "long-preparation");
      const next = generateConfigured(c, "long-preparation", first.final);
      expect(validateGeneratedPhrase(first)).toEqual([]);
      expect(validateGeneratedPhrase(next)).toEqual([]);
      expect(wideMoves(next)).toHaveLength(1);
      const m = wideMoves(next)[0];
      expect(m.landingTick - m.cueTick).toBe(preparationBeats * TPQ);
      expect(next.initial.hands[0].lastNoteEnd).toBeLessThanOrEqual(m.cueTick);
      expect(first.final.wideLeapPreparation?.cueTick).toBe(m.cueTick);
      expect(next.initial).toEqual(first.final);
      const without = structuredClone(next);
      delete without.initial.wideLeapPreparation;
      expect(validateGeneratedPhrase(without).join(" ")).toContain(
        "preparation",
      );
      const bad = structuredClone(first);
      bad.final.wideLeapPreparation!.cueTick++;
      expect(validateGeneratedPhrase(bad)).toContain(
        "Missing or invalid wide-leap preparation state.",
      );
      const incoming = structuredClone(next);
      incoming.initial.wideLeapPreparation!.landingTick++;
      expect(validateGeneratedPhrase(incoming)).toContain(
        "Invalid incoming wide-leap preparation state.",
      );
      expect(() =>
        generateConfigured(
          resolveGeneratorConfig(
            { wideLeaps: { distanceWeightExponent: 2 } },
            c,
          ),
          "long-preparation",
          first.final,
        ),
      ).toThrow(/same configuration/);
    },
  );

  it("does not fabricate a phrase-entry rest or silently drop impossible sampled targets", () => {
    const c = config({
      wideLeaps: { eligibleBars: [0, 1, 2, 3], targetSelection: "higher" },
    });
    const p = generateConfigured(c, "blocked", endpoint(c, "right", true));
    expect(p.movementDiagnostics).toContainEqual({
      hand: "right",
      landingTick: 0,
      reason: "no-preparation",
    });
    expect(p.movementDiagnostics).toContainEqual({
      hand: "right",
      landingTick: 4 * TPQ,
      reason: "no-legal-target",
    });
    expect(p.movements).toEqual([]);
  });

  it("independently rejects tampered movement identity, timing, distance and landing fingers", () => {
    const p = generateConfigured(config(), "tamper");
    expect(wideMoves(p).length).toBeGreaterThan(0);
    const mutations: ((p: GeneratedPhrase) => void)[] = [
      (p) => p.movements[0].cueTick++,
      (p) => p.movements[0].distance++,
      (p) => (p.movements[0].landingFinger = 0),
      (p) => (p.movements[0].landingTick += TPQ),
      (p) => (p.movements[0].fromPositionId = "wrong"),
      (p) => (p.movements[0].landingNoteId = "wrong"),
      (p) => (p.initial.hands[0].lastNoteEnd = 100000),
      (p) => {
        const e = p.events.find((e) => e.kind === "rest")!;
        e.kind = "note";
        e.action = "PLAY_WITHIN_POSITION";
      },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(p);
      mutate(bad);
      expect(validateGeneratedPhrase(bad).length).toBeGreaterThan(0);
    }
  });

  it("keeps disabled configuration fingerprints and explicit zero-probability notes stable", () => {
    const disabled = resolveGeneratorConfig();
    const { wideLeaps: _wide, ...old } = disabled;
    void _wide;
    expect(generatorConfigFingerprint(disabled)).toBe(
      `${VERSION}:parameters:${JSON.stringify(old)}`,
    );
    const zero = resolveGeneratorConfig({
      wideLeaps: { ...wideLeapDefaults, probability: 0 },
    });
    const a = generateConfigured(disabled, "disabled"),
      b = generateConfigured(zero, "disabled");
    expect(a.events).toEqual(b.events);
    expect(a.final).toEqual(b.final);
    expect(b.version).toBe("6.0.0");
    expect(a.configFingerprint).not.toBe(b.configFingerprint);
    const moving = resolveGeneratorConfig({
      hands: {
        active: "both",
        right: { min: 48, max: 96 },
        left: { min: 21, max: 72 },
      },
      movement: {
        ...repositionDefaults,
        probability: 1,
        maxDistanceSteps: 4,
        eligibleBars: [1, 2, 3],
      },
      melody: { maxIntervalSteps: 7 },
    });
    const inactive = resolveGeneratorConfig(
      { wideLeaps: { ...wideLeapDefaults, probability: 0 } },
      moving,
    );
    for (let i = 0; i < 10; i++) {
      const plain = generateConfigured(moving, `zero-${i}`),
        zero = generateConfigured(inactive, `zero-${i}`);
      expect(zero.events).toEqual(plain.events);
      expect(zero.movements).toEqual(plain.movements);
      expect(zero.final).toEqual(plain.final);
    }
    expect(
      generatorConfigFingerprint(
        config({ wideLeaps: { distanceWeightExponent: 2 } }),
      ),
    ).not.toBe(generatorConfigFingerprint(config()));
  });

  it("uses the configured distance weighting across seeded target draws", () => {
    const means = [-4, 4].map((exponent) => {
      const c = config({
        wideLeaps: {
          eligibleBars: [1],
          maxDistanceSteps: 28,
          maxLandingIntervalSteps: 32,
          preparationBeats: 3,
          distanceWeightExponent: exponent,
        },
      });
      let sum = 0;
      for (let i = 0; i < 60; i++) {
        const state = endpoint(c, "right");
        state.rng = hash(`weight-${i}`);
        const p = generateConfigured(c, "weighting", state);
        sum += Math.abs(wideMoves(p)[0].distance);
      }
      return sum / 60;
    });
    expect(means[1] - means[0]).toBeGreaterThan(8);
  });

  it("retains small repositioning alongside separately enabled leaps", () => {
    const c = config({
      movement: {
        ...repositionDefaults,
        probability: 1,
        maxDistanceSteps: 4,
        eligibleBars: [1, 3],
      },
      wideLeaps: { eligibleBars: [2] },
      melody: { maxIntervalSteps: 7 },
    });
    const techniques = new Set<string>();
    for (let i = 0; i < 10; i++)
      generateConfigured(c, `combined-${i}`).movements.forEach((m) =>
        techniques.add(m.technique),
      );
    expect(techniques).toEqual(
      new Set(["lift-and-reposition", "lifted-wide-leap"]),
    );
  });

  it("provides an exact leap cue inside longer breathing or small-movement rests", () => {
    for (const small of [true, false]) {
      const c = config({
        wideLeaps: {
          eligibleBars: [1],
          preparationBeats: 1,
          minimumPreparationBeats: 1,
          additionalPreparationBeatsPerOctave: 0,
        },
        ...(small
          ? {
              movement: {
                ...repositionDefaults,
                probability: 1,
                eligibleBars: [1],
                preparationBeats: 2,
              },
            }
          : { rhythm: { breathBars: [0], breathBeats: 2 } }),
      });
      const p = generateConfigured(c, `nested-cue-${small}`);
      expect(wideMoves(p)).toHaveLength(1);
      const m = wideMoves(p)[0];
      expect(
        p.events.find(
          (e) => e.kind === "rest" && e.bar * 4 * TPQ + e.onset === m.cueTick,
        ),
      ).toBeDefined();
      expect(validateGeneratedPhrase(p)).toEqual([]);
    }
  });

  it("checks both-hand swept envelopes even when all endpoint maps are disjoint", () => {
    const c = config({
      hands: {
        active: "both",
        right: { min: 60, max: 108 },
        left: { min: 21, max: 59 },
      },
    });
    const p = generateConfigured(c, "sweeps");
    expect(new Set(wideMoves(p).map((m) => m.hand))).toEqual(
      new Set(["right", "left"]),
    );
    expect(validateGeneratedPhrase(p)).toEqual([]);
    const bad = structuredClone(p);
    const m = bad.movements.find((m) => m.hand === "right")!;
    const left = bad.positions.find((h) => h.hand === "left")!;
    // Travel crosses a stationary hand while the new RH endpoint sits above it.
    const source = bad.positions.find((h) => h.id === m.fromPositionId)!;
    source.fingerToMidi = left.fingerToMidi.map((n) => n - 12);
    expect(validateGeneratedPhrase(bad)).toContain(
      "Wide-leap travel envelopes collide with the other hand.",
    );
  });

  it("keeps two-hand travel separated inside overlapping configured ranges", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const c = config({
          hands: { active: "both" },
          wideLeaps: {
            maxDistanceSteps: 28,
            maxLandingIntervalSteps: 32,
            additionalPreparationBeatsPerOctave: 0.25,
          },
        });
        const p = generateConfigured(c, `overlap-${seed}`);
        expect(validateGeneratedPhrase(p)).toEqual([]);
        const next = generateConfigured(c, `overlap-${seed}`, p.final);
        expect(validateGeneratedPhrase(next)).toEqual([]);
      }),
      { seed: 602024, numRuns: 30 },
    );
  });

  it("preserves cyclic preparation under varied opportunity schedules and meters", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom(3, 4),
        fc.uniqueArray(fc.integer({ min: 0, max: 3 }), {
          minLength: 1,
          maxLength: 4,
        }),
        fc.integer({ min: 0, max: 14 }),
        (seed, beats, eligibleBars, offset) => {
          const sorted = [...eligibleBars].sort((a, b) => a - b);
          const gap = Math.min(
            ...sorted.map(
              (b, i) =>
                ((sorted[(i + 1) % sorted.length] - b + 4) % 4 || 4) * beats,
            ),
          );
          const c = config({
            notation: { beats },
            wideLeaps: {
              eligibleBars,
              preparationBeats: 1 + (offset % (gap - 1)),
              additionalPreparationBeatsPerOctave: 0,
              maxDistanceSteps: 47,
              maxLandingIntervalSteps: 51,
            },
          });
          const first = generateConfigured(c, `schedule-${seed}`);
          const second = generateConfigured(c, `schedule-${seed}`, first.final);
          expect(validateGeneratedPhrase(first)).toEqual([]);
          expect(validateGeneratedPhrase(second)).toEqual([]);
        },
      ),
      { seed: 602025, numRuns: 30 },
    );
  });

  it("is reproducible and independently valid over seeded configurations and continued phrases", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom("C", "G", "F", "D"),
        fc.constantFrom("right", "left", "both"),
        fc.constantFrom("anywhere", "higher", "lower", "range-edges"),
        fc.integer({ min: -4, max: 4 }),
        fc.boolean(),
        fc.constantFrom(3, 4),
        (seed, key, hand, targetSelection, exponent, variable, beats) => {
          const c = config({
            notation: { key, beats },
            hands: {
              active: hand,
              right: { min: hand === "both" ? 60 : 21, max: 108 },
              left: { min: 21, max: hand === "both" ? 59 : 108 },
            },
            wideLeaps: {
              targetSelection,
              distanceWeightExponent: exponent,
              eligibleBars: [0, 1, 2, 3],
              landingFingers: [1, 3, 5],
              landingSelection: variable
                ? "uniform-landings"
                : "uniform-positions",
            },
            fingering: variable
              ? {
                  patterns: [
                    { value: "natural", weight: 1 },
                    { value: "thumbGap", weight: 1 },
                    { value: "twoGaps", weight: 1 },
                  ],
                  variablePositionProbability: 1,
                }
              : {},
            chromatic: { ...chromaticDefaults, probability: 0.5 },
            chords: { ...chordDefaults, probability: 0.8 },
          });
          let state: StreamState | undefined;
          for (let i = 0; i < 3; i++) {
            const before = structuredClone(state);
            const p = generateConfigured(c, String(seed), state);
            expect(generateConfigured(c, String(seed), state)).toEqual(p);
            expect(state).toEqual(before);
            expect(validateGeneratedPhrase(p)).toEqual([]);
            for (const m of wideMoves(p)) {
              expect(Math.abs(m.distance)).toBeGreaterThanOrEqual(5);
              expect(Math.abs(m.distance)).toBeLessThanOrEqual(14);
              const last = p.events
                .filter(
                  (e) =>
                    e.hand === m.hand &&
                    e.kind === "note" &&
                    e.bar * c.notation.beats * TPQ + e.onset < m.landingTick,
                )
                .at(-1);
              if (last)
                expect(
                  Math.abs(
                    diatonicIndex(last.pitch) -
                      diatonicIndex(
                        p.events.find((e) => e.id === m.landingNoteId)!.pitch,
                      ),
                  ),
                ).toBeLessThanOrEqual(18);
            }
            state = p.final;
          }
        },
      ),
      { seed: 602023, numRuns: 40 },
    );
  });
});
