import fc from "fast-check";
import { expect, it } from "vitest";
import { lifetimeNotes } from "../score/lifetimes";
import { isContinuousMovement, noteheads } from "../score/model";
import {
  chordDefaults,
  chromaticDefaults,
  coverageDefaults,
  generateConfigured,
  generatorConfigFingerprint,
  GeneratorContextInfeasibleError,
  GeneratorConfigurationError,
  GeneratorSearchExhaustedError,
  generatorConfigSchema,
  noteLifetimeDefaults,
  repositionDefaults,
  resolveGeneratorConfig,
  tieDefaults,
  validateGeneratedPhrase,
  wideLeapDefaults,
  type GeneratedPhrase,
  type ValidatedGeneratorConfig,
} from ".";
import {
  articulatedStudy,
  dynamicFingeringExample,
  movingTrebleWithHeldBass,
} from "./examples";
import { validateWideSweeps } from "./wideLeapValidation";

const techniques = [
  "thumb-under",
  "finger-over",
  "continuous-shift",
  "adjacent-reach",
  "rested-alternate",
  "substitution",
] as const;
const articulation =
  generatorConfigSchema.parse(articulatedStudy()).articulation!;
const rhythm = {
  durations: ([240, 480, 960] as const).map((value) => ({ value, weight: 1 })),
};

function assertContacts(phrase: GeneratedPhrase) {
  const measure = 480 * phrase.config.notation.beats;
  const boundary = phrase.initial.bar * measure;
  const timing = new Map(
    phrase.events.map((e) => [e.id, e.articulation?.timing]),
  );
  const substitutions = new Map(
    phrase.events
      .flatMap(noteheads)
      .flatMap((n) =>
        n.substitution
          ? [[n.substitution.lifetimeId, n.substitution] as const]
          : [],
      ),
  );
  const keys = [
    ...(phrase.initial.activeLifetimes ?? []),
    ...lifetimeNotes(phrase.events),
  ].flatMap((n) => {
    if (n.lifetime.keyHold.kind !== "required") return [];
    const start = n.lifetime.onsetTick;
    const end = timing.get(n.eventId)
      ? start + timing.get(n.eventId)!.ticks
      : n.lifetime.keyHold.releaseTick;
    const transfer = substitutions.get(n.id);
    return transfer
      ? [
          { ...n, start, end: transfer.endTick },
          { ...n, start: transfer.startTick, end, finger: transfer.toFinger },
        ]
      : [{ ...n, start, end }];
  });
  const black = (midi: number) => "010100101010"[midi % 12] === "1";
  const center = (midi: number) => {
    const whites = Array.from({ length: midi }, (_, key) => key).filter(
      (key) => !black(key),
    );
    return whites.length - (black(midi) ? 0.5 : 0);
  };
  for (const [i, a] of keys.entries())
    for (const b of keys.slice(i + 1)) {
      if (a.id === b.id || Math.min(a.end, b.end) <= Math.max(a.start, b.start))
        continue;
      if (a.midi === b.midi || (a.hand === b.hand && a.finger === b.finger))
        throw new Error(`Conflicting contacts ${a.id} and ${b.id}`);
      if (a.hand !== b.hand && (a.hand === "left") !== a.midi < b.midi)
        throw new Error(`Crossed contacts ${a.id} and ${b.id}`);
      if (a.hand !== b.hand) continue;
      const outerOnBlack = (n: typeof a) =>
        (n.finger === 1 || n.finger === 5) && black(n.midi);
      const innerOnWhite = (n: typeof a) =>
        n.finger > 1 && n.finger < 5 && !black(n.midi);
      const ascending = a.hand === "right" ? a.midi < b.midi : a.midi > b.midi;
      if (
        a.finger < b.finger !== ascending ||
        Math.abs(center(a.midi) - center(b.midi)) >
          1.5 * Math.abs(a.finger - b.finger) + 0.5 ||
        (outerOnBlack(a) && innerOnWhite(b)) ||
        (outerOnBlack(b) && innerOnWhite(a))
      )
        throw new Error(`Unreachable contacts ${a.id} and ${b.id}`);
    }
  for (const move of phrase.movements) {
    if (isContinuousMovement(move)) continue;
    for (const key of keys)
      if (
        key.hand === move.hand &&
        key.start < move.landingTick &&
        key.end > move.cueTick
      )
        throw new Error(`Lift ${move.id} intersects held key ${key.id}`);
  }
  for (const e of phrase.events) {
    const start = e.bar * measure + e.onset;
    if (start < boundary || start + e.duration > (e.bar + 1) * measure)
      throw new Error(`Out-of-bar event ${e.id}`);
    if (e.fingering?.technique !== "adjacent-reach") continue;
    const source = keys.find(
      (key) =>
        key.hand === e.hand &&
        key.lifetime.voiceId === (e.voiceId ?? `${e.hand}:main`) &&
        key.lifetime.releaseTick === start,
    );
    if (start > boundary && source?.end !== start)
      throw new Error(`Adjacent reach ${e.id} lost its prepared contact`);
  }
}

function verifyStream(
  config: ValidatedGeneratorConfig,
  seed: string,
  chunks: number,
  seen: Set<string>,
  stats: {
    phrases: number;
    exhausted: number;
    infeasible: number;
    times: number[];
    rejected: string[];
  },
  allowRejection = false,
) {
  let previous: GeneratedPhrase | undefined;
  for (let chunk = 0; chunk < chunks; chunk++) {
    try {
      const start = performance.now();
      const phrase = generateConfigured(config, seed, previous?.final);
      stats.times.push(performance.now() - start);
      expect(validateGeneratedPhrase(phrase, previous)).toEqual([]);
      if (previous) expect(phrase.initial).toEqual(previous.final);
      assertContacts(phrase);
      stats.phrases++;
      for (const m of phrase.movements) seen.add(m.technique);
      for (const e of phrase.events) {
        if (e.slur) seen.add(e.slur.style);
        if (e.articulation?.touch) seen.add(e.articulation.touch);
        if (e.articulation?.emphasis) seen.add(e.articulation.emphasis);
        const heads = noteheads(e);
        if (heads.length > 1) seen.add("chord");
        for (const n of heads) {
          if (n.fingering) seen.add(n.fingering.technique);
          if (n.substitution) seen.add(n.substitution.technique);
          if (n.tie?.previousId) seen.add("tie");
          if (n.tie?.previousId && e.bar === phrase.initial.bar && !e.onset)
            seen.add("carry");
          if (
            !phrase.positions
              .find((p) => p.id === e.positionId)
              ?.pitches.includes(n.pitch)
          )
            seen.add("accidental");
        }
      }
      previous = phrase;
    } catch (error) {
      const message = `Seed ${JSON.stringify(seed)}, chunk ${chunk}, configuration ${JSON.stringify(config)}`;
      if (allowRejection && error instanceof GeneratorSearchExhaustedError) {
        stats.exhausted++;
        stats.rejected.push(`${message}: ${error.message}`);
        return;
      }
      if (allowRejection && error instanceof GeneratorContextInfeasibleError) {
        stats.infeasible++;
        stats.rejected.push(`${message}: ${error.message}`);
        return;
      }
      throw new Error(message, { cause: error });
    }
  }
}

const stats = () => ({
  phrases: 0,
  exhausted: 0,
  infeasible: 0,
  times: [] as number[],
  rejected: [] as string[],
});
function report(
  label: string,
  result: ReturnType<typeof stats>,
  seen: Set<string>,
) {
  const { times, rejected, ...counts } = result;
  times.sort((a, b) => a - b);
  console.info(label, {
    ...counts,
    ...(rejected.length ? { rejected } : {}),
    medianMs: times[Math.floor(times.length / 2)]?.toFixed(2),
    p95Ms: times[Math.floor(times.length * 0.95)]?.toFixed(2),
    maxMs: times.at(-1)?.toFixed(2),
    features: [...seen].sort().join(", "),
  });
}

it("streams combinations of the existing advanced capabilities for 64 phrases each", () => {
  const comprehensive = dynamicFingeringExample(techniques, {
    hands: { active: "both", left: { min: 35, max: 59 }, right: { max: 96 } },
    melody: { maxIntervalSteps: 4 },
    fingering: {
      variablePositionProbability: 0.35,
      patterns: [
        { value: "natural", weight: 1 },
        { value: "thumbGap", weight: 1 },
        { value: "indexGap", weight: 1 },
      ],
    },
    rhythm: { ...rhythm, breathBars: [1] },
    chromatic: { ...chromaticDefaults, probability: 0.45 },
    chords: { ...chordDefaults, probability: 0.55 },
    movement: { ...repositionDefaults, probability: 0.7, maxDistanceSteps: 3 },
    wideLeaps: { ...wideLeapDefaults, probability: 0.75, eligibleBars: [3] },
    coverage: coverageDefaults,
    articulation: {
      ...articulation,
      voices: ["right:main", "left:main"],
      interactions: {
        ...articulation.interactions,
        sustained: "allow",
        ties: "preserve-hold",
      },
    },
  });
  const duet = resolveGeneratorConfig(
    {
      articulation: {
        ...articulation,
        interactions: {
          ...articulation.interactions,
          sustained: "allow",
          ties: "preserve-hold",
        },
      },
      dynamicFingering:
        generatorConfigSchema.parse(comprehensive).dynamicFingering,
      fingering: { allowRestedAlternates: true },
      independentVoices: {
        right: {
          voices: [
            {
              fingers: [1, 2, 3, 4, 5],
              chords: false,
              durations: [{ value: 480, weight: 1 }],
            },
            { fingers: [1], chromatic: false, chords: false, activity: 0.65 },
          ],
        },
      },
      movement: { ...repositionDefaults, probability: 0.5 },
    },
    movingTrebleWithHeldBass(),
  );
  const independent = resolveGeneratorConfig(
    {
      notation: { voices: "independent", beats: 3, key: "D" },
      independentVoices: {
        right: { voices: [{}, { fingers: [1, 2], activity: 0.6 }] },
        left: { voices: [{}, { fingers: [4, 5], activity: 0.7 }] },
      },
    },
    comprehensive,
  );
  const tiedShared = resolveGeneratorConfig(
    {
      notation: {
        ties: {
          ...tieDefaults,
          probability: 0.65,
          crossPhrase: true,
          chordTones: "all",
          patterns: [...tieDefaults.patterns, { value: "carry", weight: 1 }],
        },
      },
    },
    comprehensive,
  );
  const seen = new Set<string>();
  const result = stats();
  for (const [i, config] of [
    comprehensive,
    duet,
    independent,
    tiedShared,
  ].entries())
    for (let seed = 0; seed < 5; seed++)
      verifyStream(config, `composed-${i}-${seed}`, 64, seen, result);
  report("composed generator streams", result, seen);
  expect(seen).toEqual(
    new Set([
      ...techniques,
      "accidental",
      "accent",
      "carry",
      "chord",
      "legato",
      "lift-and-reposition",
      "lifted-wide-leap",
      "marcato",
      "natural",
      "non-legato",
      "portato",
      "staccatissimo",
      "staccato",
      "tenuto",
      "tie",
    ]),
  );
}, 120_000);

it("checks randomized rhythm, register, overlap, articulation and probability boundaries", () => {
  const result = stats();
  const seen = new Set<string>();
  fc.assert(
    fc.property(
      fc.record({
        seed: fc.integer(),
        key: fc.constantFrom("C", "G", "F", "D"),
        beats: fc.constantFrom(3, 4),
        hand: fc.constantFrom("right", "left"),
        min: fc.integer({ min: 21, max: 92 }),
        width: fc.constantFrom(8, 12, 16),
        lanes: fc.integer({ min: 1, max: 5 }),
        overlap: fc.constantFrom(0, 0.25, 1),
        interval: fc.integer({ min: 1, max: 7 }),
        chance: fc.constantFrom(0, 0.2, 1),
      }),
      ({
        seed,
        key,
        beats,
        hand,
        min,
        width,
        lanes,
        overlap,
        interval,
        chance,
      }) => {
        const config = articulatedStudy({
          notation: { key, beats, voices: "independent" },
          hands: { active: hand, [hand]: { min, max: min + width } },
          independentVoices: {
            [hand]: {
              voices: Array.from({ length: lanes }, (_, i) => ({
                fingers: [i + 1],
                activity: i === 0 ? 1 : chance,
                minSoundedTicks: 0,
              })),
              minPolyphony: 0,
            },
            overlapProbability: overlap,
            maxOverlapTicks: overlap === 0 ? 0 : 960,
          },
          melody: { maxIntervalSteps: interval },
          rhythm,
          chromatic: { ...chromaticDefaults, probability: chance },
          articulation: { voices: [`${hand}:main`] },
        });
        verifyStream(config, `random-${seed}`, 6, seen, result, true);
      },
    ),
    { seed: 178290, numRuns: 120 },
  );
  report("randomized generator streams", result, seen);
  expect(result.rejected).toEqual([]);
  expect(result.phrases).toBe(720);
  expect(result.exhausted).toBe(0);
}, 120_000);

it("distinguishes contradictory settings, impossible register context, and exhausted exploration", () => {
  const independent = resolveGeneratorConfig({
    notation: { voices: "independent" },
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: { right: { voices: [{}] } },
  });
  expect(() =>
    resolveGeneratorConfig(
      {
        independentVoices: {
          maxOverlapTicks: 239,
          right: { voices: [{}, {}], minPolyphony: 2 },
        },
      },
      independent,
    ),
  ).toThrow(GeneratorConfigurationError);
  const impossible = resolveGeneratorConfig(
    {
      hands: { right: { min: 60, max: 64 } },
    },
    independent,
  );
  expect(() => generateConfigured(impossible, "below-five-key-map")).toThrow(
    GeneratorContextInfeasibleError,
  );
  const exhausted = resolveGeneratorConfig(
    {
      independentVoices: {
        maxAttempts: 1,
        right: { voices: [{ activity: 1e-12, minAttacksPerPhrase: 4 }] },
      },
    },
    independent,
  );
  for (let i = 0; i < 8; i++)
    expect(() => generateConfigured(exhausted, `budget-${i}`)).toThrow(
      GeneratorSearchExhaustedError,
    );
  const maxBudget = resolveGeneratorConfig(
    {
      independentVoices: { maxAttempts: 128 },
    },
    exhausted,
  );
  expect(() => generateConfigured(maxBudget, "budget-max")).toThrow(
    /after 128 attempts/,
  );

  const noFreeFinger = resolveGeneratorConfig(
    {
      chords: chordDefaults,
      independentVoices: {
        right: {
          voices: [{ fingers: [1] }, { fingers: [1] }],
          minPolyphony: 2,
        },
      },
    },
    independent,
  );
  expect(() =>
    generateConfigured(noFreeFinger, "one-finger-two-lanes"),
  ).toThrow(GeneratorContextInfeasibleError);
});

it("protects adjacent contacts from release marks and independently rejects a forged release", () => {
  const c = dynamicFingeringExample(["adjacent-reach"], {
    noteLifetimes: noteLifetimeDefaults,
    articulation: {
      kind: "enabled",
      voices: ["right:main"],
      touch: [{ value: "staccato" }],
    },
  });
  const result = stats();
  for (let i = 0; i < 16; i++) {
    const seed = `reach-release-${i}`;
    verifyStream(c, seed, 2, new Set(), result);
    const phrase = generateConfigured(c, seed);
    const index = phrase.events.findIndex(
      (e) => e.fingering?.technique === "adjacent-reach",
    );
    if (index < 1) continue;
    const source = phrase.events[index - 1];
    expect(source.articulation?.touch).toBeUndefined();
    source.articulation = {
      touch: "staccato",
      timing: { kind: "duration", minTicks: 168, ticks: 240, maxTicks: 312 },
    };
    expect(validateGeneratedPhrase(phrase)).toContain(
      "Invalid articulation timing or physical connection target.",
    );
    return;
  }
  throw new Error(`No adjacent-reach candidate at ${JSON.stringify(c)}`);
});

it("rejects forged feature-off and continuation plans", () => {
  const rich = resolveGeneratorConfig({
    chords: { ...chordDefaults, probability: 1 },
    chromatic: { ...chromaticDefaults, probability: 0.7 },
  });
  const disabled = resolveGeneratorConfig(
    {
      chords: { probability: 0 },
      chromatic: { probability: 0 },
    },
    rich,
  );
  for (const [seed, message] of [
    ["forged-0", "Unapproved or unplayable simultaneous chord."],
    ["forged-1", "Chromatic note with accidentals Off."],
  ]) {
    const p = generateConfigured(rich, seed);
    p.config = disabled;
    p.configFingerprint = generatorConfigFingerprint(disabled);
    expect(validateGeneratedPhrase(p), seed).toContain(message);
  }
  const first = generateConfigured(rich, "forged-state");
  const next = generateConfigured(rich, first.seed, first.final);
  next.initial.rng = next.initial.rng === 1 ? 2 : 1;
  expect(validateGeneratedPhrase(next, first)).toContain(
    "Phrase continuation differs from the previous stream state.",
  );
});

it("composes shared wide-only guidance with a stationary opposite hand", () => {
  const c = resolveGeneratorConfig({
    hands: { active: "both", right: { max: 96 }, left: { min: 48, max: 55 } },
    coverage: { ...coverageDefaults, minMoveAcceptance: 1 },
    wideLeaps: {
      ...wideLeapDefaults,
      probability: 1,
      eligibleBars: [2, 3],
    },
    noteLifetimes: noteLifetimeDefaults,
  });
  const result = stats(),
    seen = new Set<string>();
  verifyStream(c, "wide-only-guidance", 12, seen, result);
  expect(seen.has("lifted-wide-leap")).toBe(true);
  const p = generateConfigured(c, "wide-only-guidance");
  expect(p.version).toBe("7.0.1");
  expect(p.movements.every((m) => m.hand === "right")).toBe(true);
  p.final.coverage!.right!.usage.fill(0);
  expect(validateGeneratedPhrase(p)).toContain(
    "Shared coverage state differs from the score.",
  );
});

it("rejects intersecting opposite sweeps whose landings are individually separated", () => {
  const c = resolveGeneratorConfig({
    hands: {
      active: "both",
      right: { min: 72, max: 84 },
      left: { min: 48, max: 79 },
    },
  });
  const p = generateConfigured(c, "staggered-sweep-collision");
  const maps = [
    { id: "rh-source", hand: "right", fingerToMidi: [72, 74, 76, 77, 79] },
    { id: "rh-target", hand: "right", fingerToMidi: [84, 86, 88, 89, 91] },
    { id: "lh-source", hand: "left", fingerToMidi: [55, 53, 52, 50, 48] },
    { id: "lh-target", hand: "left", fingerToMidi: [79, 77, 76, 74, 72] },
  ] as const;
  p.positions = maps.map((map) => ({
    ...p.initial.hands.find((h) => h.hand === map.hand)!,
    ...map,
    fingerToMidi: [...map.fingerToMidi],
  }));
  p.initial.hands = [p.positions[0], p.positions[2]];
  p.movements = [
    {
      id: "earlier",
      technique: "lifted-wide-leap",
      hand: "right",
      fromPositionId: "rh-source",
      toPositionId: "rh-target",
      cueTick: 0,
      landingTick: 960,
      landingNoteId: "right-landing",
      landingMidi: 84,
      landingFinger: 1,
      distance: 7,
    },
    {
      id: "later",
      technique: "lifted-wide-leap",
      hand: "left",
      fromPositionId: "lh-source",
      toPositionId: "lh-target",
      cueTick: 480,
      landingTick: 1440,
      landingNoteId: "left-landing",
      landingMidi: 72,
      landingFinger: 5,
      distance: 14,
    },
  ];
  expect(validateWideSweeps(p, c)).toContain(
    "Wide-leap travel envelopes collide with the other hand.",
  );
  p.movements[1].cueTick = 1200;
  expect(validateWideSweeps(p, c)).toEqual([]);
});

it("checks contact time against tempo before attempting an impossible crossing", () => {
  const c = dynamicFingeringExample(["thumb-under"], {
    rhythm: { durations: [{ value: 240, weight: 1 }] },
    dynamicFingering: { tempoBpm: 60 },
  });
  const p = generateConfigured(c, "crossing-clock");
  expect(validateGeneratedPhrase(p)).toEqual([]);
  const fast = resolveGeneratorConfig(
    { dynamicFingering: { tempoBpm: 180 } },
    c,
  );
  expect(() => generateConfigured(fast, p.seed)).toThrow(
    GeneratorContextInfeasibleError,
  );
});

it("preserves zero overlap when small moves and a silent lane share the scheduler", () => {
  const config = articulatedStudy({
    notation: { voices: "independent" },
    hands: { active: "both", right: { max: 84 }, left: { min: 36, max: 55 } },
    melody: { maxIntervalSteps: 4 },
    movement: { ...repositionDefaults, probability: 1, maxDistanceSteps: 3 },
    independentVoices: {
      overlapProbability: 0,
      right: {
        voices: [
          {},
          { fingers: [5], minMidi: 84, activity: 0, minSoundedTicks: 0 },
        ],
      },
      left: { voices: [{}] },
    },
  });
  const result = stats(),
    seen = new Set<string>();
  verifyStream(config, "small-move-no-overlap", 24, seen, result);
  expect(seen.has("lift-and-reposition")).toBe(true);
  const p = generateConfigured(config, "small-move-no-overlap");
  expect(
    p.events
      .filter((e) => e.voiceId === "right:2")
      .every((e) => e.kind === "rest"),
  ).toBe(true);
});

it("sustains the maximum number of independent lanes at the outer registers", () => {
  const voices = Array.from({ length: 5 }, (_, i) => ({
    fingers: [i + 1],
    minAttacksPerPhrase: 32,
  }));
  const config = articulatedStudy({
    hands: {
      active: "both",
      left: { min: 21, max: 29 },
      right: { min: 100, max: 108 },
    },
    notation: { voices: "independent" },
    rhythm: { durations: [{ value: 240, weight: 1 }], breathBars: [] },
    independentVoices: {
      left: { voices, minPolyphony: 5 },
      right: { voices, minPolyphony: 5 },
      maxOverlapTicks: 240,
      maxAttempts: 128,
    },
  });
  const result = stats(),
    seen = new Set<string>();
  verifyStream(config, "ten-lanes", 16, seen, result);
  report("maximum-lane generator stream", result, seen);
  const p = generateConfigured(config, "ten-lanes");
  expect(
    p.events.slice(0, 10).every((e) => e.onset === 0 && e.kind === "note"),
  ).toBe(true);
  expect(p.events).toHaveLength(320);
});

it("measures independent parameter effects on a paired 96-seed sample", () => {
  const base = resolveGeneratorConfig({
    hands: { right: { min: 60, max: 84 } },
    melody: { maxIntervalSteps: 4 },
    rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
    harmony: { progressions: [{ value: [1, 1, 1, 1], weight: 1 }] },
  });
  const samples = 96;
  const count = (
    config: ValidatedGeneratorConfig,
    measure: (p: GeneratedPhrase) => number,
  ) => {
    let total = 0;
    for (let i = 0; i < samples; i++) {
      const seed = `sensitivity-${i}`;
      try {
        total += measure(generateConfigured(config, seed));
      } catch (error) {
        throw new Error(
          `Seed ${seed}, configuration ${JSON.stringify(config)}`,
          {
            cause: error,
          },
        );
      }
    }
    return total;
  };
  const moves = (p: GeneratedPhrase) => p.movements.length;
  const notes = (p: GeneratedPhrase) =>
    p.events.filter((e) => e.kind === "note");
  const countNotes =
    (f: (e: GeneratedPhrase["events"][number]) => boolean) =>
    (p: GeneratedPhrase) =>
      notes(p).filter(f).length;
  const degree = (pitch: string) =>
    Number(pitch.at(-1)) * 7 + "CDEFGAB".indexOf(pitch[0]);
  const steps = (p: GeneratedPhrase) =>
    notes(p)
      .slice(1)
      .map((e, i) => Math.abs(degree(e.pitch) - degree(p.events[i].pitch)));

  const results = {
    largerJumps: [1, 4].map((maxIntervalSteps) =>
      count(
        resolveGeneratorConfig({ melody: { maxIntervalSteps } }, base),
        (p) => steps(p).filter((step) => step > 1).length,
      ),
    ),
    repeated: [0, 32].map((repetitionBonus) =>
      count(
        resolveGeneratorConfig({ melody: { repetitionBonus } }, base),
        (p) => steps(p).filter((step) => step === 0).length,
      ),
    ),
    eighths: [1, 12].map((weight) =>
      count(
        resolveGeneratorConfig(
          {
            rhythm: {
              durations: [
                { value: 240, weight },
                { value: 480, weight: 4 },
              ],
            },
          },
          base,
        ),
        countNotes((e) => e.duration === 240),
      ),
    ),
    variableMaps: [0, 0.25, 0.85].map((variablePositionProbability) =>
      count(
        resolveGeneratorConfig(
          {
            fingering: {
              variablePositionProbability,
              patterns: [
                { value: "natural", weight: 1 },
                { value: "thumbGap", weight: 1 },
              ],
            },
          },
          base,
        ),
        (p) => Number(p.initial.hands[0].id.endsWith("-thumbGap")),
      ),
    ),
    accidentalAttacks: [0, 0.25, 0.85].map((probability) =>
      count(
        resolveGeneratorConfig(
          { chromatic: { ...chromaticDefaults, probability } },
          base,
        ),
        (p) =>
          notes(p).filter((e) => !p.positions[0].pitches.includes(e.pitch))
            .length,
      ),
    ),
    chordAttacks: [0, 0.25, 0.85].map((probability) =>
      count(
        resolveGeneratorConfig(
          { chords: { ...chordDefaults, probability } },
          base,
        ),
        countNotes((e) => noteheads(e).length > 1),
      ),
    ),
    smallMoves: [0, 0.25, 0.85].map((probability) =>
      count(
        resolveGeneratorConfig(
          {
            movement: {
              ...repositionDefaults,
              maxDistanceSteps: 3,
              probability,
            },
          },
          base,
        ),
        moves,
      ),
    ),
    wideMoves: [0, 0.25, 0.85].map((probability) =>
      count(
        resolveGeneratorConfig(
          { wideLeaps: { ...wideLeapDefaults, probability } },
          base,
        ),
        moves,
      ),
    ),
    ties: [0, 0.25, 0.85].map((probability) =>
      count(
        resolveGeneratorConfig(
          {
            notation: {
              ties: {
                ...tieDefaults,
                probability,
                voices: ["right:main"],
                patterns: [{ value: "subdivide", weight: 1 }],
              },
            },
            noteLifetimes: noteLifetimeDefaults,
          },
          base,
        ),
        countNotes((e) => e.tie?.index === 0),
      ),
    ),
    accents: [0, 0.25, 0.85].map((probability) =>
      count(
        resolveGeneratorConfig(
          {
            noteLifetimes: noteLifetimeDefaults,
            articulation: {
              kind: "enabled",
              voices: ["right:main"],
              emphasis: [
                { value: "accent", probability },
                { value: "marcato" },
              ],
            },
          },
          base,
        ),
        countNotes((e) => e.articulation?.emphasis === "accent"),
      ),
    ),
    overlaps: [0, 0.25, 0.85].map((overlapProbability) =>
      count(
        resolveGeneratorConfig(
          {
            notation: { voices: "independent" },
            noteLifetimes: noteLifetimeDefaults,
            independentVoices: {
              overlapProbability,
              right: {
                voices: [
                  { fingers: [1], minSoundedTicks: 0 },
                  { fingers: [5], minSoundedTicks: 0 },
                ],
              },
            },
          },
          base,
        ),
        (p) => {
          const times = new Map<number, number>();
          for (const e of notes(p)) {
            const tick = e.bar * 1920 + e.onset;
            times.set(tick, (times.get(tick) ?? 0) + 1);
          }
          return [...times.values()].filter((n) => n > 1).length;
        },
      ),
    ),
  };
  console.info("parameter sensitivity counts", results);
  for (const [name, values] of Object.entries(results)) {
    if (values.length === 3 || name === "largerJumps")
      expect(values[0], name).toBe(0);
    for (let i = 1; i < values.length; i++)
      expect(values[i], name).toBeGreaterThan(values[i - 1]);
  }
}, 60_000);
