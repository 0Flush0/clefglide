import { z } from "zod";
import { TPQ } from "../../score/model";

const probability = z.number().min(0).max(1);
const weight = z.number().min(0.000001).max(1000);
const bonus = z.number().int().min(0).max(1000);
const index = z.number().int().min(0).max(4);
const bar = z.number().int().min(0).max(3);
const steps = z.number().int().min(1).max(7);
const beatRest = z.union([z.literal(1), z.literal(2)]);
export const patternNameSchema = z.enum([
  "natural",
  "thumbGap",
  "indexGap",
  "twoGaps",
]);
export const chordShapeSchema = z.enum([
  "13",
  "14",
  "15",
  "24",
  "25",
  "35",
  "135",
  "125",
  "145",
  "124",
  "245",
  "1235",
  "1245",
  "1345",
]);
const dyadInterval = z.union([
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);
const duration = z.union([
  z.literal(240),
  z.literal(480),
  z.literal(960),
  z.literal(1920),
]);
const four = <T extends z.ZodType>(item: T) =>
  z.tuple([item, item, item, item]);
const distribution = <T extends z.ZodType>(value: T) =>
  z.array(z.object({ value, weight }).strict()).min(1).max(64);
const unique = <T>(items: T[]) =>
  new Set(items.map((item) => JSON.stringify(item))).size === items.length;
const range = z
  .object({
    min: z.number().int().min(21).max(108),
    max: z.number().int().min(21).max(108),
    clef: z.enum(["treble", "bass"]),
  })
  .strict();

export const melodySchema = z
  .object({
    /** All distances are diatonic scale steps, weights are relative selection mass. */
    maxIntervalSteps: steps,
    stepBonus: bonus,
    repetitionBonus: bonus,
    startRegion: z.enum(["largest-connected", "any-connected"]),
    contours: distribution(four(index)),
    motifs: distribution(z.array(index).min(1).max(16)),
    motifOffset: z.number().int().min(-4).max(4),
    contourPeakWeight: z.number().int().positive().max(1000),
    contourDistancePenalty: bonus,
    minimumNoteWeight: z.number().int().positive().max(1000),
    harmonicToneBonus: bonus,
    finalHarmonicToneBonus: bonus,
    preferHarmonicEnding: z.boolean(),
  })
  .strict();
export const rhythmSchema = z
  .object({
    /** Integer ticks at 480 TPQ; shared attacks for both hands, no ties. */
    durations: distribution(duration),
    breathBars: z.array(bar).max(4),
    breathBeats: beatRest,
  })
  .strict();
export const harmonySchema = z
  .object({
    /** Supported diatonic triads in a major key: I, ii, IV, V, vi. */
    progressions: distribution(
      four(
        z.union([
          z.literal(1),
          z.literal(2),
          z.literal(4),
          z.literal(5),
          z.literal(6),
        ]),
      ),
    ),
  })
  .strict();
export const fingeringSchema = z
  .object({
    patterns: distribution(patternNameSchema),
    variablePositionProbability: probability,
    chromaticFingers: z
      .array(z.union([z.literal(2), z.literal(3), z.literal(4)]))
      .min(1)
      .max(3),
    /** Permission for explicitly tagged, independently checked plans; never emitted by the planner. */
    allowRestedAlternates: z.boolean(),
  })
  .strict();
export const movementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed") }).strict(),
  z
    .object({
      kind: z.literal("rested-reposition"),
      probability,
      maxDistanceSteps: z.number().int().min(1).max(4),
      /** Zero-based destination bars inside each four-bar chunk; never bar zero. */
      eligibleBars: z.array(z.number().int().min(1).max(3)).min(1).max(3),
      preparationBeats: beatRest,
      /** Positive relative mass for distances one through four, before coverage acceptance. */
      distanceWeights: four(weight),
    })
    .strict(),
]);
export const chromaticSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("diatonic") }).strict(),
  z
    .object({
      kind: z.literal("neighbors"),
      probability,
      passingResolutionProbability: probability,
      preferAppliedDominant: z.boolean(),
      preferAnchorResolution: z.boolean(),
      preferMappedFinger: z.boolean(),
    })
    .strict(),
]);
/** A lifted relocation is separate from both small shifts and melodic intervals. */
export const wideLeapSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }).strict(),
  z
    .object({
      kind: z.literal("lifted-wide"),
      probability,
      minDistanceSteps: z.number().int().min(5).max(51),
      maxDistanceSteps: z.number().int().min(5).max(51),
      maxLandingIntervalSteps: z.number().int().min(1).max(51),
      targetSelection: z.enum(["anywhere", "higher", "lower", "range-edges"]),
      landingSelection: z.enum(["uniform-positions", "uniform-landings"]),
      distanceWeightExponent: z.number().min(-4).max(4),
      preparationBeats: z.number().int().min(1).max(15),
      minimumPreparationBeats: z.number().min(1).max(15),
      additionalPreparationBeatsPerOctave: z.number().min(0).max(15),
      eligibleBars: z.array(bar).min(1).max(4),
      landingFingers: z.array(z.number().int().min(1).max(5)).min(1).max(5),
    })
    .strict(),
]);
export const chordsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single-notes") }).strict(),
  z
    .object({
      kind: z.literal("voicings"),
      probability,
      shapes: distribution(chordShapeSchema),
      maxSpanSemitones: z.number().int().min(3).max(9),
      dyadIntervals: z.array(dyadInterval).min(1).max(6),
      maxVoiceLeadingSteps: steps,
      majorExtension: z.enum(["none", "sixth"]),
      minorExtension: z.enum(["none", "seventh"]),
    })
    .strict(),
]);
export const coverageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }).strict(),
  z
    .object({
      kind: z.literal("guided"),
      regions: z.number().int().min(2).max(16),
      decay: z.number().min(0).max(0.9999),
      reachedToleranceSemitones: z.number().min(0).max(12),
      usageFloor: z.number().min(0.000001).max(1),
      explorationWeight: weight,
      underuseExponent: z.number().positive().max(10),
      minTargetPhrases: z.number().int().min(1).max(256),
      targetSpreadPhrases: z.number().int().min(1).max(256),
      progressScaleSemitones: z.number().positive().max(24),
      minMoveAcceptance: z.number().min(0.000001).max(1),
      contourProbability: probability,
      contourOffsetSteps: z.number().int().min(0).max(4),
    })
    .strict(),
]);
const schema = z
  .object({
    /** Capability tags reject unsupported models; they are not feature switches. */
    notation: z
      .object({
        key: z.enum(["C", "G", "F", "D"]),
        beats: z.union([z.literal(3), z.literal(4)]),
        phraseBars: z.literal(4),
        voices: z.literal("shared-rhythm"),
        ties: z.literal(false),
      })
      .strict(),
    hands: z
      .object({
        active: z.enum(["right", "left", "both"]),
        right: range,
        left: range,
      })
      .strict(),
    melody: melodySchema,
    rhythm: rhythmSchema,
    harmony: harmonySchema,
    fingering: fingeringSchema,
    movement: movementSchema,
    chromatic: chromaticSchema,
    chords: chordsSchema,
    coverage: coverageSchema,
    wideLeaps: wideLeapSchema.default({ kind: "disabled" }),
  })
  .strict()
  .superRefine((c, ctx) => {
    const error = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    for (const hand of ["right", "left"] as const)
      if (c.hands[hand].min > c.hands[hand].max)
        error(["hands", hand], "Minimum MIDI pitch must not exceed maximum.");
    for (const [path, values] of [
      [["fingering", "patterns"], c.fingering.patterns.map((p) => p.value)],
      [["fingering", "chromaticFingers"], c.fingering.chromaticFingers],
      [["rhythm", "durations"], c.rhythm.durations.map((d) => d.value)],
      [["rhythm", "breathBars"], c.rhythm.breathBars],
    ] as const)
      if (!unique([...values]))
        error(
          [...path],
          "Entries must be unique; use weights to express preference.",
        );
    const patterns = c.fingering.patterns.map((p) => p.value);
    if (!patterns.includes("natural"))
      error(
        ["fingering", "patterns"],
        "Include the natural pattern as the conventional position option.",
      );
    if (patterns.length === 1 && c.fingering.variablePositionProbability > 0)
      error(
        ["fingering", "variablePositionProbability"],
        "A variable position probability requires an approved variable pattern.",
      );
    if (c.chords.kind === "voicings") {
      const chords = c.chords;
      if (!unique(c.chords.shapes.map((s) => s.value)))
        error(
          ["chords", "shapes"],
          "Chord shapes must be unique; use weights.",
        );
      if (!unique(c.chords.dyadIntervals))
        error(["chords", "dyadIntervals"], "Dyad intervals must be unique.");
      if (
        chords.shapes.some((s) => s.value.length === 4) &&
        chords.majorExtension === "none" &&
        chords.minorExtension === "none"
      )
        error(
          ["chords", "shapes"],
          "Four-note shapes require an implemented sixth or seventh harmonic extension.",
        );
      if (
        chords.shapes.some((s) => s.value.length >= 3) &&
        chords.maxSpanSemitones < 7
      )
        error(
          ["chords", "maxSpanSemitones"],
          "Complete triads require at least seven semitones of span.",
        );
      if (
        chords.shapes.some((s) => s.value.length === 4) &&
        chords.maxSpanSemitones < 8
      )
        error(
          ["chords", "maxSpanSemitones"],
          "Four-note harmonic extensions require at least eight semitones of span.",
        );
      const degrees = c.harmony.progressions.flatMap((p) => p.value);
      if (
        chords.shapes.some((s) => s.value.length === 4) &&
        !degrees.some((degree) =>
          degree === 2 || degree === 6
            ? chords.minorExtension !== "none"
            : chords.majorExtension !== "none",
        )
      )
        error(
          ["chords", "shapes"],
          "No selected progression can supply the enabled four-note harmonic extension.",
        );
      if (c.chords.maxVoiceLeadingSteps > c.melody.maxIntervalSteps)
        error(
          ["chords", "maxVoiceLeadingSteps"],
          "Voice leading cannot exceed the melodic interval limit.",
        );
      if (
        chords.shapes.some((s) => s.value.length === 2) &&
        !chords.dyadIntervals.some((i) => i <= chords.maxSpanSemitones)
      )
        error(
          ["chords", "dyadIntervals"],
          "At least one allowed dyad interval must fit the chord span.",
        );
    }
    if (
      c.movement.kind === "rested-reposition" &&
      !unique(c.movement.eligibleBars)
    )
      error(
        ["movement", "eligibleBars"],
        "Movement boundaries must be unique.",
      );
    if (
      c.coverage.kind === "guided" &&
      (c.movement.kind === "fixed" || c.movement.probability === 0)
    )
      error(
        ["coverage"],
        "Coverage guidance requires active rested repositioning; use disabled coverage for fixed hands.",
      );
    const smallest = Math.min(...c.rhythm.durations.map((d) => d.value));
    const wide = c.wideLeaps;
    if (wide.kind === "lifted-wide") {
      if (wide.minDistanceSteps > wide.maxDistanceSteps)
        error(["wideLeaps"], "Minimum leap distance must not exceed maximum.");
      if (!unique(wide.eligibleBars) || !unique(wide.landingFingers))
        error(["wideLeaps"], "Leap bars and landing fingers must be unique.");
      if (
        wide.minimumPreparationBeats +
          (wide.minDistanceSteps / 7) *
            wide.additionalPreparationBeatsPerOctave >
        wide.preparationBeats
      )
        error(
          ["wideLeaps"],
          "Reserved preparation cannot satisfy even the minimum leap distance.",
        );
      const bars = [...wide.eligibleBars].sort((a, b) => a - b);
      if (
        bars.some(
          (b, i) =>
            wide.preparationBeats >=
            ((bars[(i + 1) % bars.length] - b + 4) % 4 || 4) * c.notation.beats,
        )
      )
        error(
          ["wideLeaps", "preparationBeats"],
          "Leave at least one sounded beat between leap preparation windows.",
        );
      if (
        c.movement.kind === "rested-reposition" &&
        c.movement.probability > 0 &&
        wide.probability > 0 &&
        c.movement.eligibleBars.some((b) =>
          bars.some((landing) => {
            const distance = ((landing - b + 4) % 4) * c.notation.beats;
            return distance > 0 && distance <= wide.preparationBeats;
          }),
        )
      )
        error(
          ["wideLeaps"],
          "A small repositioning landing cannot lie inside wide-leap preparation.",
        );
    }
    for (let b = 0; b < c.notation.phraseBars; b++) {
      let rest =
        c.movement.kind === "rested-reposition" &&
        c.movement.probability > 0 &&
        c.movement.eligibleBars.includes(b + 1)
          ? c.movement.preparationBeats
          : c.rhythm.breathBars.includes(b)
            ? c.rhythm.breathBeats
            : 0;
      if (wide.kind === "lifted-wide" && wide.probability > 0) {
        const end = (b + 1) * c.notation.beats;
        for (const landing of wide.eligibleBars) {
          const next =
            (landing <= b ? landing + 4 : landing) * c.notation.beats;
          rest = Math.max(
            rest,
            Math.min(
              c.notation.beats,
              Math.max(0, end - (next - wide.preparationBeats)),
            ),
          );
        }
      }
      if (
        rest > c.notation.beats ||
        ((c.notation.beats - rest) * TPQ) % smallest !== 0
      )
        error(
          ["rhythm", "durations"],
          `Durations must fill the ${c.notation.beats - rest}-beat sounded budget in bar ${b + 1}; include quarter or eighth notes or change rests/meter.`,
        );
    }
  });
export type GeneratorConfig = z.infer<typeof schema>;
export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
export type GeneratorOverrides = DeepPartial<GeneratorConfig>;
export const generatorConfigSchema = schema;
declare const validatedGeneratorConfig: unique symbol;
/** Only normalization can create this brand; raw schema.parse output remains untrusted. */
export type ValidatedGeneratorConfig = DeepReadonly<GeneratorConfig> & {
  readonly [validatedGeneratorConfig]: true;
};
export type GuidedCoverage = DeepReadonly<
  Extract<GeneratorConfig["coverage"], { kind: "guided" }>
>;
