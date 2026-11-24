import { z } from "zod";
import { TPQ } from "../../score/model";
import { dynamicFingeringSchema } from "./dynamic";
import { articulationSchema } from "./articulation";

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
const voiceId = z.templateLiteral([
  z.enum(["right", "left"]),
  ":",
  z.enum(["main", "2", "3", "4", "5"]),
]);
const four = <T extends z.ZodType>(item: T) =>
  z.tuple([item, item, item, item]);
const distribution = <T extends z.ZodType>(value: T) =>
  z.array(z.object({ value, weight }).strict()).min(1).max(64);
const unique = (items: readonly unknown[]) =>
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
    /** Integer ticks at 480 TPQ; shared base rhythm before optional tie notation. */
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
export const durationEvaluationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }).strict(),
  z
    .object({
      kind: z.literal("evaluate"),
      toleranceMs: z.number().min(0).max(60000),
      earlyRelease: z.enum(["penalize", "ignore"]),
      lateRelease: z.enum(["penalize", "ignore"]),
      pedalTreatment: z.enum(["physical", "sounding", "forbid"]),
      waitMode: z.enum(["disabled", "performed-duration"]),
    })
    .strict(),
]);
export const noteLifetimeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disabled") }).strict(),
  z
    .object({
      kind: z.literal("explicit"),
      keyHold: z.enum(["required", "attack-only"]),
      evaluation: durationEvaluationSchema,
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
export const tiesSchema = z.union([
  z.literal(false),
  z
    .object({
      kind: z.literal("enabled"),
      probability,
      segmentCounts: z.array(z.number().int().min(2).max(256)).min(1).max(255),
      subdivisions: z.array(duration).min(1).max(4),
      withinMeasure: z.boolean(),
      crossMeasure: z.boolean(),
      crossPhrase: z.boolean(),
      maxDurationTicks: z.number().int().min(480).max(491520),
      voices: z.array(voiceId).min(1).max(10),
      chordTones: z.enum(["none", "all", "outer", "any"]),
      patterns: distribution(z.enum(["subdivide", "connect", "carry"])),
    })
    .strict(),
]);
export const voiceProfileSchema = z
  .object({
    durations: distribution(duration).optional(),
    activity: probability.default(1),
    entryProbability: probability.default(1),
    exitProbability: probability.default(0),
    minAttacksPerPhrase: z.number().int().min(0).max(32).default(0),
    minSoundedTicks: z.number().int().min(0).max(7680).default(240),
    offbeatWeight: weight.default(1),
    coincidentAttackWeight: weight.default(1),
    minMidi: z.number().int().min(21).max(108).optional(),
    maxMidi: z.number().int().min(21).max(108).optional(),
    fingers: z
      .array(z.number().int().min(1).max(5))
      .min(1)
      .max(5)
      .default([1, 2, 3, 4, 5]),
    maxIntervalSteps: steps.optional(),
    chords: z.boolean().default(true),
    chromatic: z.boolean().default(true),
  })
  .strict();
const voiceHand = z
  .object({
    voices: z.array(voiceProfileSchema).min(1).max(5),
    minPolyphony: z.number().int().min(0).max(5).default(1),
    maxPolyphony: z.number().int().min(1).max(5).default(5),
    withinHandOverlapProbability: probability.optional(),
    maxWithinHandOverlapTicks: z.number().int().min(0).max(491520).optional(),
  })
  .strict();
export const independentVoiceSchema = z
  .object({
    right: voiceHand.optional(),
    left: voiceHand.optional(),
    overlapProbability: probability.default(1),
    maxOverlapTicks: z.number().int().min(0).max(491520).default(491520),
    maxAttempts: z.number().int().min(1).max(128).default(24),
  })
  .strict();
function canConnectTies(
  ties: Exclude<z.infer<typeof tiesSchema>, false>,
  vocabulary: number[],
  budgets: number[],
  measure: number,
) {
  const lengths = vocabulary.filter((d) =>
    ties.subdivisions.some((s) => s === d),
  );
  const memo = new Map<string, boolean>();
  const fits = (
    tick: number,
    remaining: number,
    budget: number,
    previousBar?: number,
  ): boolean => {
    if (remaining === 0) return true;
    const bar = Math.floor(tick / measure),
      onset = tick % measure;
    if (
      bar >= budgets.length ||
      (previousBar !== undefined &&
        (previousBar === bar ? !ties.withinMeasure : !ties.crossMeasure))
    )
      return false;
    const key = `${tick}:${remaining}:${budget}:${previousBar}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const result = lengths.some(
      (d) =>
        d <= budget &&
        onset + d <= budgets[bar] &&
        fits(tick + d, remaining - 1, budget - d, bar),
    );
    memo.set(key, result);
    return result;
  };
  const grid = Math.min(...vocabulary);
  return Array.from(
    { length: (budgets.length * measure) / grid },
    (_, i) => i * grid,
  ).some((start) =>
    ties.segmentCounts.some((count) =>
      fits(start, count, ties.maxDurationTicks),
    ),
  );
}
const handModules = {
  melody: melodySchema,
  rhythm: rhythmSchema,
  fingering: fingeringSchema,
  movement: movementSchema,
  chromatic: chromaticSchema,
  chords: chordsSchema,
  coverage: coverageSchema,
  wideLeaps: wideLeapSchema,
  dynamicFingering: z.union([dynamicFingeringSchema, z.literal(false)]),
  ties: tiesSchema,
  articulation: z.union([articulationSchema, z.literal(false)]),
};
export const handModuleSchema = z.strictObject(handModules).partial();
const configShape = z
  .object({
    /** Capability tags reject unsupported models; they are not feature switches. */
    notation: z
      .object({
        key: z.enum(["C", "G", "F", "D"]),
        beats: z.union([z.literal(3), z.literal(4)]),
        phraseBars: z.literal(4),
        voices: z.enum(["shared-rhythm", "independent"]),
        ties: tiesSchema,
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
    dynamicFingering: dynamicFingeringSchema.optional(),
    movement: movementSchema,
    chromatic: chromaticSchema,
    chords: chordsSchema,
    coverage: coverageSchema,
    wideLeaps: wideLeapSchema.default({ kind: "disabled" }),
    noteLifetimes: noteLifetimeSchema.default({ kind: "disabled" }),
    articulation: z
      .union([articulationSchema, z.literal(false).transform(() => undefined)])
      .optional(),
    independentVoices: z
      .union([
        independentVoiceSchema,
        z.literal(false).transform(() => undefined),
      ])
      .optional(),
    handParameters: z
      .strictObject({
        right: handModuleSchema.optional(),
        left: handModuleSchema.optional(),
      })
      .optional(),
  })
  .strict();
const schema = configShape.superRefine((c, ctx) => {
  if (!c.handParameters) {
    refineConfiguration(c, ctx);
    return;
  }
  if (!c.independentVoices || c.notation.voices !== "independent") {
    ctx.addIssue({
      code: "custom",
      path: ["handParameters"],
      message:
        "Unsupported combination: hand-specific parameters require independent rhythm.",
    });
    return;
  }
  const active =
    c.hands.active === "both" ? (["right", "left"] as const) : [c.hands.active];
  const tempos = new Set(
    [
      c.dynamicFingering,
      c.handParameters.left?.dynamicFingering,
      c.handParameters.right?.dynamicFingering,
    ].flatMap((policy) => (policy ? [policy.tempoBpm] : [])),
  );
  if (tempos.size > 1)
    ctx.addIssue({
      code: "custom",
      path: ["dynamicFingering", "tempoBpm"],
      message: "Use the same planning tempo for both hands.",
    });
  for (const hand of active) {
    if (!c.independentVoices[hand]) {
      ctx.addIssue({
        code: "custom",
        path: ["independentVoices", hand],
        message: "Specify voices for each active hand.",
      });
      continue;
    }
    const forHand = <T extends string>(voices: T[]) =>
      voices.filter((id) => id.startsWith(`${hand}:`));
    const local = c.handParameters[hand];
    const ties = local?.ties ?? c.notation.ties;
    const tieVoices = ties === false ? [] : forHand(ties.voices);
    const a =
      local?.articulation === false
        ? undefined
        : (local?.articulation ?? c.articulation);
    const marks = a ? forHand(a.voices) : [];
    const slurs = a?.slurs ? forHand(a.slurs.voices ?? a.voices) : [];
    if (
      local?.ties &&
      local.ties.voices.some((id) => !id.startsWith(`${hand}:`))
    )
      ctx.addIssue({
        code: "custom",
        path: ["handParameters", hand, "ties", "voices"],
        message: "Select voices belonging to this hand.",
      });
    if (
      local?.articulation &&
      [
        ...local.articulation.voices,
        ...(local.articulation.slurs
          ? (local.articulation.slurs.voices ?? [])
          : []),
      ].some((id) => !id.startsWith(`${hand}:`))
    )
      ctx.addIssue({
        code: "custom",
        path: ["handParameters", hand, "articulation", "voices"],
        message: "Select voices belonging to this hand.",
      });
    refineConfiguration(
      {
        ...c,
        ...local,
        dynamicFingering:
          local?.dynamicFingering === false
            ? undefined
            : (local?.dynamicFingering ?? c.dynamicFingering),
        hands: { ...c.hands, active: hand },
        independentVoices: {
          ...c.independentVoices,
          right: undefined,
          left: undefined,
          [hand]: c.independentVoices[hand],
        },
        notation: {
          ...c.notation,
          ties:
            ties !== false && tieVoices.length > 0
              ? { ...ties, voices: tieVoices }
              : false,
        },
        articulation:
          a && (marks.length || slurs?.length)
            ? {
                ...a,
                voices: marks,
                slurs:
                  a.slurs && slurs?.length
                    ? { ...a.slurs, voices: slurs }
                    : false,
              }
            : undefined,
      },
      (path, message) =>
        ctx.addIssue({ code: "custom", path: [hand, ...path], message }),
      local?.dynamicFingering ? [hand] : active,
    );
  }
});

function refineConfiguration(
  c: z.infer<typeof configShape>,
  context:
    z.RefinementCtx | ((path: (string | number)[], message: string) => void),
  crossingHands?: readonly string[],
) {
  const error = (path: (string | number)[], message: string) =>
    typeof context === "function"
      ? context(path, message)
      : context.addIssue({ code: "custom", path, message });
  const lifetime = c.noteLifetimes;
  const ties = c.notation.ties;
  const independent = c.independentVoices;
  const dynamic = c.dynamicFingering;
  const articulation = c.articulation;
  if (articulation) {
    if (lifetime.kind !== "explicit" || lifetime.keyHold !== "required")
      error(
        ["articulation"],
        "Articulation requires explicit, required key-hold lifetimes.",
      );
    const hands =
      c.hands.active === "both"
        ? (["right", "left"] as const)
        : [c.hands.active];
    const active = hands.flatMap((hand) =>
      independent
        ? (independent[hand]?.voices ?? []).flatMap((v, i) =>
            v.activity > 0 && v.entryProbability > 0
              ? [`${hand}:${i ? i + 1 : "main"}`]
              : [],
          )
        : [`${hand}:main`],
    );
    const slurs = articulation.slurs;
    if (
      [...articulation.voices, ...(slurs ? (slurs.voices ?? []) : [])].some(
        (v) => !active.includes(v),
      )
    )
      error(
        ["articulation", "voices"],
        "Select active, reachable voice IDs from the configured hands and voice model.",
      );
  }
  if (dynamic) {
    const hands =
      c.hands.active === "both" ? ["right", "left"] : [c.hands.active];
    for (const [index, rule] of dynamic.techniques.entries()) {
      const path = ["dynamicFingering", "techniques", index];
      if (
        rule.technique === "substitution" &&
        (lifetime.kind !== "explicit" || lifetime.keyHold !== "required")
      )
        error(path, "Substitutions require explicit physical key holds.");
      if (
        rule.technique !== "substitution" &&
        rule.technique !== "rested-alternate" &&
        lifetime.kind === "explicit" &&
        lifetime.keyHold === "attack-only"
      )
        error(path, "Continuous attacks require a preceding modeled key hold.");
      if (
        rule.technique === "rested-alternate" &&
        !c.fingering.allowRestedAlternates
      )
        error(
          path,
          "Enable fingering.allowRestedAlternates to generate rested alternates.",
        );
      if (
        (rule.technique === "thumb-under" ||
          rule.technique === "finger-over") &&
        !(crossingHands ?? hands).some((hand) =>
          rule.directions.includes(
            (hand === "right") === (rule.technique === "thumb-under")
              ? "up"
              : "down",
          ),
        )
      )
        error(path, "No active hand can cross in an enabled direction.");
    }
  }
  if ((c.notation.voices === "independent") !== !!independent)
    error(
      ["independentVoices"],
      "Select independent notation voices and provide their configuration together.",
    );
  if (independent) {
    const hands =
      c.hands.active === "both"
        ? (["right", "left"] as const)
        : [c.hands.active];
    if (lifetime.kind !== "explicit" || lifetime.keyHold !== "required")
      error(
        ["noteLifetimes"],
        "Independent voices require explicit physical key holds.",
      );
    for (const hand of ["right", "left"] as const) {
      const group = independent[hand];
      if (hands.includes(hand) !== !!group)
        error(
          ["independentVoices", hand],
          "Specify voices for each active hand only.",
        );
      if (!group) continue;
      if (group.minPolyphony > group.maxPolyphony)
        error(
          ["independentVoices", hand],
          "Minimum peak polyphony exceeds the simultaneous key limit.",
        );
      const sounding = group.voices.filter(
        (v) => v.activity > 0 && v.entryProbability > 0,
      );
      const chord = c.chords;
      const maxHeads = sounding.map((v) =>
        v.chords && chord.kind === "voicings" && chord.probability > 0
          ? Math.max(
              1,
              ...chord.shapes
                .filter((shape) =>
                  [...shape.value].every((finger) =>
                    v.fingers.includes(Number(finger)),
                  ),
                )
                .map((shape) => shape.value.length),
            )
          : 1,
      );
      const overlap =
        (group.maxWithinHandOverlapTicks ?? independent.maxOverlapTicks) >=
          TPQ / 2 &&
        (group.withinHandOverlapProbability ?? independent.overlapProbability) >
          0;
      if (
        group.minPolyphony > 1 &&
        group.minPolyphony >
          (overlap
            ? maxHeads.reduce((sum, count) => sum + count, 0)
            : Math.max(0, ...maxHeads))
      )
        error(
          ["independentVoices", hand],
          "This peak polyphony needs more available keys from overlapping voices or enabled chords.",
        );
      if (
        group.minPolyphony > 0 &&
        !group.voices.some((v) => v.activity > 0 && v.entryProbability > 0)
      )
        error(
          ["independentVoices", hand],
          "At least one voice must be able to enter and sound.",
        );
      for (const profile of group.voices) {
        if (
          (profile.minMidi ?? c.hands[hand].min) >
            (profile.maxMidi ?? c.hands[hand].max) ||
          (profile.minMidi ?? 21) > c.hands[hand].max ||
          (profile.maxMidi ?? 108) < c.hands[hand].min
        )
          error(
            ["independentVoices", hand],
            "A voice needs a register intersecting its hand range.",
          );
        if (
          !unique(profile.fingers) ||
          (profile.durations && !unique(profile.durations.map((d) => d.value)))
        )
          error(
            ["independentVoices", hand],
            "Voice durations and fingers must be unique.",
          );
        if (
          profile.maxIntervalSteps &&
          profile.maxIntervalSteps > c.melody.maxIntervalSteps
        )
          error(
            ["independentVoices", hand],
            "A voice interval limit cannot exceed the melody limit.",
          );
        if (
          (profile.minAttacksPerPhrase || profile.minSoundedTicks) &&
          profile.activity === 0 &&
          profile.entryProbability > 0
        )
          error(
            ["independentVoices", hand],
            "A silent voice cannot require attacks.",
          );
      }
    }
  }
  if (ties !== false) {
    const patterns = ties.patterns.map((p) => p.value);
    if (lifetime.kind !== "explicit" || lifetime.keyHold !== "required")
      error(
        ["notation", "ties"],
        "Ties require explicit lifetimes with required key holds.",
      );
    for (const values of [
      ties.segmentCounts,
      ties.subdivisions,
      ties.voices,
      patterns,
    ])
      if (!unique(values))
        error(
          ["notation", "ties"],
          "Tie selections must be unique; use pattern weights.",
        );
    if (!independent && ties.voices.some((v) => !v.endsWith(":main")))
      error(
        ["notation", "ties", "voices"],
        "Shared rhythm only supports main voices.",
      );
    if (
      independent &&
      ties.voices.some((v) => {
        const hand = v.startsWith("right:") ? "right" : "left";
        return (
          !v.endsWith(":main") &&
          Number(v.split(":")[1]) > (independent[hand]?.voices.length ?? 0)
        );
      })
    )
      error(
        ["notation", "ties", "voices"],
        "Secondary tie voices must be declared in the independent profiles.",
      );
    if (
      !ties.voices.some((v) => {
        const hand = v.startsWith("right:") ? "right" : "left";
        return (
          (c.hands.active === "both" || c.hands.active === hand) &&
          (!independent ||
            (independent[hand]?.voices.length ?? 0) >=
              (v.endsWith(":main") ? 1 : Number(v.split(":")[1])))
        );
      })
    )
      error(["notation", "ties", "voices"], "No eligible active voice.");
    if (
      !independent &&
      patterns.includes("subdivide") &&
      (!ties.withinMeasure ||
        !c.rhythm.durations.some((d) =>
          ties.segmentCounts.some((count) =>
            ties.subdivisions.some(
              (s) => s * count === d.value && d.value <= ties.maxDurationTicks,
            ),
          ),
        ))
    )
      error(
        ["notation", "ties", "patterns"],
        "Subdivision requires a feasible equal-segment rhythm and within-measure ties.",
      );
    if (
      !independent &&
      patterns.includes("connect") &&
      ((!ties.withinMeasure && !ties.crossMeasure) ||
        !ties.segmentCounts.some((count) =>
          ties.subdivisions.some(
            (s) =>
              c.rhythm.durations.some((d) => d.value === s) &&
              s * count <= ties.maxDurationTicks,
          ),
        ))
    )
      error(
        ["notation", "ties", "patterns"],
        "Connection requires eligible rhythm segments, duration budget and a measure boundary policy.",
      );
    if (
      ties.crossPhrase !== patterns.includes("carry") ||
      (!independent &&
        ties.crossPhrase &&
        (!ties.crossMeasure ||
          !ties.subdivisions.some(
            (s) => s === Math.min(...c.rhythm.durations.map((d) => d.value)),
          ) ||
          ties.maxDurationTicks <
            2 * Math.min(...c.rhythm.durations.map((d) => d.value))))
    )
      error(
        ["notation", "ties"],
        "Cross-phrase ties require the carry pattern, cross-measure permission and the shortest rhythm subdivision within the duration budget.",
      );
    if (ties.chordTones !== "none" && c.chords.kind === "single-notes")
      error(
        ["notation", "ties", "chordTones"],
        "Chord-tone selection requires enabled chord voicings.",
      );
    if (
      !independent &&
      ties.crossPhrase &&
      c.wideLeaps.kind === "lifted-wide" &&
      c.wideLeaps.probability > 0 &&
      c.wideLeaps.eligibleBars.includes(0)
    )
      error(
        ["notation", "ties"],
        "Phrase carry conflicts with reserved wide-leap preparation at bar zero.",
      );
  }
  if (lifetime.kind === "explicit" && lifetime.evaluation.kind === "evaluate") {
    const e = lifetime.evaluation;
    if (e.earlyRelease === "ignore" && e.lateRelease === "ignore")
      error(
        ["noteLifetimes", "evaluation"],
        "Duration evaluation must evaluate at least one release boundary.",
      );
    if (lifetime.keyHold === "attack-only" && e.pedalTreatment !== "sounding")
      error(
        ["noteLifetimes", "evaluation"],
        "Attack-only key requirements need sounding-duration evaluation or disabled evaluation.",
      );
  }
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
      error(["chords", "shapes"], "Chord shapes must be unique; use weights.");
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
    error(["movement", "eligibleBars"], "Movement boundaries must be unique.");
  if (
    c.coverage.kind === "guided" &&
    (c.movement.kind === "fixed" || c.movement.probability === 0) &&
    !(c.wideLeaps.kind === "lifted-wide" && c.wideLeaps.probability > 0)
  )
    error(
      ["coverage"],
      "Coverage guidance requires active rested repositioning or wide leaps.",
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
        (wide.minDistanceSteps / 7) * wide.additionalPreparationBeatsPerOctave >
      wide.preparationBeats
    )
      error(
        ["wideLeaps"],
        "Reserved preparation cannot satisfy even the minimum leap distance.",
      );
    const bars = [...wide.eligibleBars].sort((a, b) => a - b);
    if (
      wide.preparationBeats >= c.notation.phraseBars * c.notation.beats ||
      (!independent &&
        bars.some(
          (b, i) =>
            wide.preparationBeats >=
            ((bars[(i + 1) % bars.length] - b + 4) % 4 || 4) * c.notation.beats,
        ))
    )
      error(
        ["wideLeaps", "preparationBeats"],
        "Leave at least one sounded beat between leap preparation windows.",
      );
    if (
      !independent &&
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
  const soundedBudgets: number[] = [];
  for (let b = 0; b < c.notation.phraseBars; b++) {
    let rest =
      c.movement.kind === "rested-reposition" &&
      c.movement.probability > 0 &&
      c.movement.eligibleBars.includes(b + 1)
        ? c.movement.preparationBeats
        : c.rhythm.breathBars.includes(b)
          ? c.rhythm.breathBeats
          : 0;
    if (!independent && wide.kind === "lifted-wide" && wide.probability > 0) {
      const end = (b + 1) * c.notation.beats;
      for (const landing of wide.eligibleBars) {
        const next = (landing <= b ? landing + 4 : landing) * c.notation.beats;
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
      (!independent && ((c.notation.beats - rest) * TPQ) % smallest !== 0)
    )
      error(
        ["rhythm", "durations"],
        `Durations must fill the ${c.notation.beats - rest}-beat sounded budget in bar ${b + 1}; include quarter or eighth notes or change rests/meter.`,
      );
    soundedBudgets.push((c.notation.beats - rest) * TPQ);
  }
  if (articulation?.slurs) {
    const slurs = articulation.slurs;
    if (slurs.crossPhrase && soundedBudgets.at(-1) !== c.notation.beats * TPQ)
      error(
        ["articulation", "slurs", "crossPhrase"],
        "A slur cannot cross the required rest at the end of each phrase.",
      );
    // A safe upper bound: activity, repetition and movement can lower the
    // realized number. Tie-enabled scores may split chord attacks further.
    const capacity = Math.max(
      ...(slurs.voices ?? articulation.voices).map((id) => {
        const [hand, lane] = id.split(":") as ["left" | "right", string];
        const profile =
          independent?.[hand]?.voices[lane === "main" ? 0 : Number(lane) - 1];
        const grid = Math.min(
          ...(profile?.durations ?? c.rhythm.durations).map((d) => d.value),
          ...(ties === false ? [] : ties.subdivisions),
        );
        const slots = soundedBudgets.map((budget) =>
          Math.max(0, Math.floor(budget / grid)),
        );
        return slurs.crossMeasure
          ? slots.reduce((sum, n) => sum + n, 0) * (slurs.crossPhrase ? 2 : 1)
          : Math.max(...slots);
      }),
    );
    if (slurs.lengths.some(({ value }) => value > capacity))
      error(
        ["articulation", "slurs", "lengths"],
        "Each selected slur length must fit at least one eligible voice's grouping and rhythm budget.",
      );
  }
  if (independent) {
    for (const hand of ["right", "left"] as const)
      for (const [index, profile] of (
        independent[hand]?.voices ?? []
      ).entries()) {
        const lengths = (profile.durations ?? c.rhythm.durations).map(
          (d) => d.value,
        );
        const unit = Math.min(...lengths);
        const id = `${hand}:${index === 0 ? "main" : index + 1}`;
        const slots = soundedBudgets.reduce(
          (sum, n) => sum + Math.floor(n / unit),
          0,
        );
        const canSplitAttacks =
          ties !== false &&
          ties.probability > 0 &&
          ties.voices.some((voice) => voice === id) &&
          ties.patterns.some((pattern) => pattern.value === "subdivide") &&
          (ties.chordTones === "any" || ties.chordTones === "outer") &&
          profile.chords &&
          c.chords.kind === "voicings" &&
          c.chords.probability > 0;
        const attackUnit = canSplitAttacks
          ? Math.min(unit, ...ties.subdivisions)
          : unit;
        const attackSlots = soundedBudgets.reduce(
          (sum, n) => sum + Math.floor(n / attackUnit),
          0,
        );
        if (
          profile.minAttacksPerPhrase > attackSlots ||
          profile.minSoundedTicks > slots * unit
        )
          error(
            ["independentVoices", hand],
            "The minimum voice activity cannot fit its rhythm and sounded budget.",
          );
        if (ties === false || !ties.voices.some((voice) => voice === id))
          continue;
        if (
          ties.crossPhrase &&
          (!ties.crossMeasure ||
            !ties.subdivisions.some((d) => d === unit) ||
            soundedBudgets[3] !== c.notation.beats * TPQ ||
            ties.segmentCounts.some((count) => {
              const measure = c.notation.beats * TPQ,
                continuation = (count - 1) * unit;
              const hasPartialReattacks =
                (ties.chordTones === "any" || ties.chordTones === "outer") &&
                profile.chords &&
                c.chords.kind === "voicings" &&
                c.chords.probability > 0 &&
                (independent[hand]?.maxPolyphony ?? 0) > 1;
              const freeAttackSlots = soundedBudgets.reduce(
                (sum, budget, bar) => {
                  const held = Math.max(0, continuation - bar * measure);
                  return (
                    sum + Math.floor(Math.max(0, budget - held) / attackUnit)
                  );
                },
                0,
              );
              return (
                unit > measure ||
                count * unit > ties.maxDurationTicks ||
                (!hasPartialReattacks &&
                  freeAttackSlots < profile.minAttacksPerPhrase) ||
                (count > 2 && unit < measure && !ties.withinMeasure) ||
                Array.from(
                  { length: Math.ceil(continuation / measure) },
                  (_, bar) =>
                    Math.min(measure, continuation - bar * measure) >
                    soundedBudgets[bar % c.notation.phraseBars],
                ).some(Boolean)
              );
            }))
        )
          error(
            ["notation", "ties"],
            `Carry counts cannot fit the rhythm, rests, minimum attacks or duration policy for ${id}.`,
          );
        if (
          ties.patterns.some((p) => p.value === "subdivide") &&
          (!ties.withinMeasure ||
            !lengths.some(
              (d) =>
                d <= ties.maxDurationTicks &&
                soundedBudgets.some((b) => b >= d) &&
                ties.segmentCounts.some((count) =>
                  ties.subdivisions.some((s) => s * count === d),
                ),
            ))
        )
          error(["notation", "ties"], `No feasible subdivision for ${id}.`);
        if (
          ties.patterns.some((p) => p.value === "connect") &&
          ((!ties.withinMeasure && !ties.crossMeasure) ||
            !canConnectTies(
              ties,
              lengths,
              soundedBudgets,
              c.notation.beats * TPQ,
            ))
        )
          error(["notation", "ties"], `No feasible connection for ${id}.`);
      }
  }
  if (ties !== false && !independent) {
    if (ties.crossPhrase) {
      const unit = Math.min(...c.rhythm.durations.map((d) => d.value));
      const measure = c.notation.beats * TPQ;
      for (const count of ties.segmentCounts) {
        const continuation = (count - 1) * unit;
        const fits = Array.from(
          { length: Math.ceil(continuation / measure) },
          (_, bar) =>
            Math.min(measure, continuation - bar * measure) <=
            soundedBudgets[bar % 4],
        ).every(Boolean);
        if (
          count * unit > ties.maxDurationTicks ||
          !fits ||
          (continuation > unit && unit < measure && !ties.withinMeasure)
        )
          error(
            ["notation", "ties", "segmentCounts"],
            "Every carry count must fit the duration budget, sounded timeline and within-measure policy.",
          );
      }
    }
    if (
      ties.patterns.some((p) => p.value === "subdivide") &&
      !c.rhythm.durations.some(
        (d) =>
          soundedBudgets.some((b) => b >= d.value) &&
          ties.segmentCounts.some((count) =>
            ties.subdivisions.some(
              (s) => s * count === d.value && d.value <= ties.maxDurationTicks,
            ),
          ),
      )
    )
      error(
        ["notation", "ties"],
        "No sounded budget can realize the selected subdivision pattern.",
      );
    if (ties.crossPhrase && soundedBudgets[3] !== c.notation.beats * TPQ)
      error(
        ["notation", "ties"],
        "Cross-phrase carry requires a sounded phrase ending; remove the final preparation/breath rest.",
      );
    if (
      ties.crossPhrase &&
      soundedBudgets[0] < Math.min(...c.rhythm.durations.map((d) => d.value))
    )
      error(
        ["notation", "ties"],
        "Cross-phrase carry requires a sounded phrase opening.",
      );
    if (
      ties.patterns.some((p) => p.value === "connect") &&
      !canConnectTies(
        ties,
        c.rhythm.durations.map((d) => d.value),
        soundedBudgets,
        c.notation.beats * TPQ,
      )
    )
      error(
        ["notation", "ties"],
        "No sounded timeline can realize the selected connection pattern.",
      );
  }
}
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
export type GeneratorOverrides = DeepPartial<z.input<typeof schema>>;
export const generatorConfigSchema = schema;
declare const validatedGeneratorConfig: unique symbol;
/** Only normalization can create this brand; raw schema.parse output remains untrusted. */
export type ValidatedGeneratorConfig = DeepReadonly<GeneratorConfig> & {
  readonly [validatedGeneratorConfig]: true;
};
export type GuidedCoverage = DeepReadonly<
  Extract<GeneratorConfig["coverage"], { kind: "guided" }>
>;
