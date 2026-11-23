import { describe, expect, expectTypeOf, it } from "vitest";
import fc from "fast-check";
import { defaults, fingerprint, type Settings } from "../../score/model";
import { generateConfigured } from "../engine";
import { validateGeneratedPhrase } from "../validator";
import { inspectGeneratorFeasibility } from "../feasibility";
import { applyHandMovements } from "../difficulty";
import { resolveSettings } from "./presets";
import {
  generatorDefaults,
  repositionDefaults,
  coverageDefaults,
  chordDefaults,
  chromaticDefaults,
  normalizeGeneratorConfig,
  resolveGeneratorConfig,
  generatorConfigFingerprint,
  type GeneratorConfig,
  type ValidatedGeneratorConfig,
} from "./index";

describe("configuration boundary", () => {
  it("resolves canonical defaults without changing legacy settings or fingerprints", () => {
    const saved = structuredClone(defaults),
      before = fingerprint(defaults);
    expect(resolveSettings(defaults)).toEqual(resolveGeneratorConfig());
    expect(resolveGeneratorConfig()).toEqual(generatorDefaults);
    expect(defaults).toEqual(saved);
    expect(fingerprint(defaults)).toBe(before);
    expect(generatorConfigFingerprint(resolveGeneratorConfig())).not.toBe(
      before,
    );
    expectTypeOf<GeneratorConfig>().not.toMatchTypeOf<ValidatedGeneratorConfig>();
    expectTypeOf<
      Parameters<typeof generateConfigured>[0]
    >().toEqualTypeOf<ValidatedGeneratorConfig>();
  });
  it("applies defaults < preset < explicit override, replaces arrays, and freezes the result", () => {
    const base = resolveSettings({
      ...defaults,
      noteJumps: "small",
      interval: 1,
    });
    const saved = structuredClone(generatorDefaults);
    const config = resolveGeneratorConfig(
      { melody: { stepBonus: 19, motifs: [{ value: [4, 0], weight: 2 }] } },
      base,
    );
    expect(config.melody).toMatchObject({
      maxIntervalSteps: 1,
      stepBonus: 19,
      repetitionBonus: 0,
      motifs: [{ value: [4, 0], weight: 2 }],
    });
    expect(base.melody.stepBonus).toBe(7);
    expect(generatorDefaults).toEqual(saved);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.melody.motifs[0].value)).toBe(true);
    expect(() => Object.assign(config.melody, { stepBonus: 2 })).toThrow();
    expect(
      resolveSettings(
        { ...defaults, noteJumps: "small", interval: 1 },
        {
          melody: { maxIntervalSteps: 4, stepBonus: 0 },
        },
      ).melody,
    ).toMatchObject({ maxIntervalSteps: 4, stepBonus: 0 });
  });
  it("replaces union branches atomically and rejects incomplete enabled branches", () => {
    const enabled = resolveGeneratorConfig({
      movement: repositionDefaults,
      coverage: coverageDefaults,
    });
    const fixed = resolveGeneratorConfig(
      { movement: { kind: "fixed" }, coverage: { kind: "disabled" } },
      enabled,
    );
    expect(fixed.movement).toEqual({ kind: "fixed" });
    expect(
      resolveGeneratorConfig({ movement: { kind: undefined } }).movement,
    ).toEqual({ kind: "fixed" });
    expect(() =>
      resolveGeneratorConfig({
        movement: { kind: "rested-reposition", probability: 0.7 },
      }),
    ).toThrow(/maxDistanceSteps/);
    expect(() =>
      normalizeGeneratorConfig({
        ...generatorDefaults,
        movement: { kind: "fixed", probability: 0.5 },
      }),
    ).toThrow(/Unrecognized/);
  });
  it.each([-0.1, 1.1, NaN, Infinity])(
    "rejects invalid probability %s with a parameter path",
    (probability) => {
      expect(() =>
        resolveGeneratorConfig({
          fingering: { variablePositionProbability: probability },
        }),
      ).toThrow(/fingering.variablePositionProbability/);
    },
  );
  it("accepts probability boundaries and rejects unsupported notation/movement capabilities", () => {
    for (const probability of [0, 1])
      expect(
        resolveGeneratorConfig({
          chromatic: { ...chromaticDefaults, probability },
        }).chromatic,
      ).toMatchObject({ probability });
    for (const change of [
      { notation: { ...generatorDefaults.notation, ties: true } },
      { notation: { ...generatorDefaults.notation, voices: "independent" } },
      { notation: { ...generatorDefaults.notation, phraseBars: 8 } },
      { movement: { kind: "thumb-under" } },
      { difficulty: "hard" },
    ])
      expect(() =>
        normalizeGeneratorConfig({ ...generatorDefaults, ...change }),
      ).toThrow(/Invalid generator configuration/);
  });
  it("rejects malformed distributions, duplicate choices and unapproved patterns/shapes", () => {
    for (const change of [
      { rhythm: { ...generatorDefaults.rhythm, durations: [] } },
      {
        rhythm: {
          ...generatorDefaults.rhythm,
          durations: [{ value: 480, weight: 0 }],
        },
      },
      {
        rhythm: {
          ...generatorDefaults.rhythm,
          durations: [{ value: 720, weight: 1 }],
        },
      },
      {
        rhythm: {
          ...generatorDefaults.rhythm,
          durations: [
            { value: 480, weight: 1 },
            { value: 480, weight: 1 },
          ],
        },
      },
      {
        melody: {
          ...generatorDefaults.melody,
          contours: [{ value: [0, 1], weight: 1 }],
        },
      },
      {
        fingering: {
          ...generatorDefaults.fingering,
          patterns: [{ value: "stretch", weight: 1 }],
        },
      },
      {
        fingering: {
          ...generatorDefaults.fingering,
          patterns: [{ value: "thumbGap", weight: 1 }],
        },
      },
      { chords: { ...chordDefaults, shapes: [{ value: "12", weight: 1 }] } },
    ])
      expect(() =>
        normalizeGeneratorConfig({ ...generatorDefaults, ...change }),
      ).toThrow();
  });
  it("validates rhythm tiling, coverage dependencies, chord spans and voice-leading limits", () => {
    expect(() =>
      resolveGeneratorConfig({ fingering: { variablePositionProbability: 1 } }),
    ).toThrow(/variable pattern/);
    expect(() =>
      resolveGeneratorConfig({ coverage: coverageDefaults }),
    ).toThrow(/requires active rested/);
    expect(() =>
      resolveGeneratorConfig({
        movement: { ...repositionDefaults, probability: 0 },
        coverage: coverageDefaults,
      }),
    ).toThrow(/requires active rested/);
    expect(() =>
      resolveGeneratorConfig({
        notation: { beats: 3 },
        rhythm: { durations: [{ value: 960, weight: 1 }] },
      }),
    ).toThrow(/fill.*beat sounded budget/);
    expect(() =>
      resolveGeneratorConfig({
        chords: { ...chordDefaults, maxVoiceLeadingSteps: 3 },
      }),
    ).toThrow(/Voice leading/);
    expect(() =>
      resolveGeneratorConfig({
        chords: {
          ...chordDefaults,
          shapes: [{ value: "135", weight: 1 }],
          maxSpanSemitones: 3,
        },
      }),
    ).toThrow(/triads require/);
    expect(() =>
      resolveGeneratorConfig({
        chords: { ...chordDefaults, shapes: [{ value: "1235", weight: 1 }] },
      }),
    ).toThrow(/harmonic extension/);
    expect(() =>
      resolveGeneratorConfig({
        movement: { ...repositionDefaults, eligibleBars: [0] },
      }),
    ).toThrow(/eligibleBars/);
    expect(() =>
      resolveGeneratorConfig({
        coverage: { ...coverageDefaults, minMoveAcceptance: 1e-320 },
        movement: repositionDefaults,
      }),
    ).toThrow(/minMoveAcceptance/);
  });
  it("distinguishes structural validity from range feasibility and soft spacing opportunities", () => {
    const narrow = resolveGeneratorConfig({
      hands: { right: { min: 60, max: 62 } },
    });
    expect(inspectGeneratorFeasibility(narrow).errors.join(" ")).toMatch(
      /five consecutive/,
    );
    expect(() => generateConfigured(narrow, "narrow")).toThrow(
      /five consecutive/,
    );
    const spacing = resolveSettings({ ...defaults, fingerSpacing: "hard" });
    expect(inspectGeneratorFeasibility(spacing)).toMatchObject({
      errors: [],
      warnings: [expect.stringContaining("conventional position")],
    });
    expect(() => generateConfigured(spacing, "fallback")).not.toThrow();
    const collision = resolveGeneratorConfig({
      hands: { active: "both", left: { min: 60, max: 67 } },
    });
    expect(inspectGeneratorFeasibility(collision).errors).toContainEqual(
      expect.stringContaining("separate positions"),
    );
  });
  it("reports optional chord and movement infeasibility without relaxing their limits", () => {
    const c = resolveGeneratorConfig({
      movement: repositionDefaults,
      chords: {
        ...chordDefaults,
        shapes: [{ value: "1235", weight: 1 }],
        maxSpanSemitones: 9,
        majorExtension: "sixth",
      },
    });
    const report = inspectGeneratorFeasibility(c);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toContainEqual(
      expect.stringContaining("no legal same-shape repositioning"),
    );
    expect(report.warnings).toContainEqual(
      expect.stringContaining("no approved chord voicing"),
    );
    const phrase = generateConfigured(c, "feasible-single-fallback");
    expect(phrase.movements).toEqual([]);
    expect(
      phrase.events
        .filter((e) => e.kind === "note")
        .every((e) => e.notes?.length === 1),
    ).toBe(true);
    expect(validateGeneratedPhrase(phrase)).toEqual([]);
  });
});

describe("preset boundary", () => {
  it("rejects malformed preset inputs before inactive branches can hide them", () => {
    for (const value of [-1, NaN, Infinity, 1.1])
      expect(() =>
        resolveSettings({ ...defaults, shiftFrequency: value }),
      ).toThrow(/shiftFrequency/);
    expect(() => resolveSettings({ ...defaults, maxShift: -1 })).toThrow(
      /maxShift/,
    );
  });
  it.each([
    ["small", 1, 7],
    ["easy", 2, 4],
    ["medium", 4, 2],
    ["large", 7, 0],
  ] as const)(
    "resolves %s jumps to independent limits and weights",
    (noteJumps, interval, stepBonus) => {
      expect(
        resolveSettings({ ...defaults, noteJumps, interval }).melody,
      ).toMatchObject({ maxIntervalSteps: interval, stepBonus });
    },
  );
  it.each([
    ["easy", 0.25, 1, [2]],
    ["medium", 0.55, 2, [1, 3]],
    ["hard", 0.85, 4, [1, 2, 3]],
  ] as const)(
    "resolves %s movements, including numerical overrides",
    (level, probability, maxDistanceSteps, eligibleBars) => {
      const s = applyHandMovements(defaults, level),
        c = resolveSettings(s);
      expect(c.movement).toMatchObject({
        kind: "rested-reposition",
        probability,
        maxDistanceSteps,
        eligibleBars,
      });
      expect(
        resolveSettings({ ...s, shiftFrequency: 0.15, maxShift: 1 }).movement,
      ).toMatchObject({ probability: 0.15, maxDistanceSteps: 1 });
      expect(resolveSettings({ ...s, shiftFrequency: 0 }).coverage.kind).toBe(
        "disabled",
      );
    },
  );
  it.each([
    ["off", 0, 1],
    ["easy", 0.3, 2],
    ["medium", 0.6, 3],
    ["hard", 0.85, 4],
  ] as const)(
    "resolves %s spacing probability and approved pattern set",
    (fingerSpacing, probability, count) => {
      const c = resolveSettings({ ...defaults, fingerSpacing });
      expect(c.fingering.variablePositionProbability).toBe(probability);
      expect(c.fingering.patterns).toHaveLength(count);
    },
  );
  it.each([
    ["easy", 0.12, 0, false, 0.22, 6, 7],
    ["medium", 0.28, 0.4, false, 0.45, 11, 9],
    ["hard", 0.45, 0.65, true, 0.7, 14, 9],
  ] as const)(
    "resolves %s chromatic and chord policies",
    (level, probability, passing, dominant, chordProbability, shapes, span) => {
      const c = resolveSettings({
        ...defaults,
        accidentals: level,
        chords: level,
      });
      expect(c.chromatic).toMatchObject({
        probability,
        passingResolutionProbability: passing,
        preferAppliedDominant: dominant,
      });
      expect(c.chords).toMatchObject({
        probability: chordProbability,
        maxSpanSemitones: span,
      });
      if (c.chords.kind === "voicings")
        expect(c.chords.shapes).toHaveLength(shapes);
    },
  );
});

it("supports explicit quarter/half/whole rhythm budgets and longer prepared relocation without new score capabilities", () => {
  for (const value of [480, 960, 1920] as const) {
    const c = resolveGeneratorConfig({
      rhythm: { durations: [{ value, weight: 1 }], breathBars: [] },
    });
    expect(
      generateConfigured(c, "durations").events.every(
        (e) => e.duration === value,
      ),
    ).toBe(true);
  }
  const c = resolveGeneratorConfig({
    hands: { right: { max: 84 } },
    movement: { ...repositionDefaults, probability: 1, preparationBeats: 2 },
  });
  const p = generateConfigured(c, "longer-preparation");
  expect(p.events.some((e) => e.kind === "rest" && e.duration === 960)).toBe(
    true,
  );
  expect(validateGeneratedPhrase(p)).toEqual([]);
});

it("generates reproducible, independently valid custom modules without consulting UI labels", () => {
  fc.assert(
    fc.property(
      fc.integer(),
      fc.integer({ min: 1, max: 7 }),
      fc.integer({ min: 0, max: 20 }),
      fc.boolean(),
      (seed, interval, repeat, breathing) => {
        const base = resolveSettings(
          applyHandMovements(
            {
              ...defaults,
              hand: "both",
              max: 84,
              leftMin: 33,
              leftMax: 57,
              noteJumps: "large",
              interval: 7,
              fingerSpacing: "hard",
              accidentals: "hard",
              chords: "hard",
            } satisfies Settings,
            "hard",
          ),
        );
        const c = resolveGeneratorConfig(
          {
            melody: {
              maxIntervalSteps: interval,
              repetitionBonus: repeat,
              contours: [{ value: [4, 0, 4, 0], weight: 2 }],
              startRegion: "any-connected",
            },
            chords: { maxVoiceLeadingSteps: interval },
            movement: { preparationBeats: 2, distanceWeights: [1, 2, 3, 4] },
            coverage: {
              regions: 7,
              decay: 0.5,
              minTargetPhrases: 2,
              targetSpreadPhrases: 3,
              contourOffsetSteps: 2,
            },
            rhythm: { breathBars: breathing ? [0, 2] : [] },
            chromatic: {
              preferAnchorResolution: false,
              preferMappedFinger: false,
            },
          },
          base,
        );
        const first = generateConfigured(c, String(seed)),
          next = generateConfigured(c, String(seed), first.final);
        expect(first).toEqual(generateConfigured(c, String(seed)));
        expect(next.initial).toEqual(first.final);
        expect(validateGeneratedPhrase(first)).toEqual([]);
        expect(validateGeneratedPhrase(next)).toEqual([]);
        expect(first).not.toHaveProperty("settings");
        expect(first.final.coverage?.right?.usage).toHaveLength(7);
      },
    ),
    { seed: 20261123, numRuns: 100 },
  );
}, 30000);
