import { z } from "zod";
import {
  emphases,
  slurPlacements,
  slurStyles,
  touches,
} from "../../score/articulationModel";

const probability = z.number().min(0).max(1);
const weight = z.number().positive().max(1000);
const positiveTicks = z.number().int().min(1).max(239);
const rules = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .strictObject({
      value: z.enum(values),
      probability: probability.default(1),
      weight: weight.default(1),
    })
    .array()
    .max(values.length);
const voiceIds = z
  .string()
  .regex(/^(right|left):(main|[2-5])$/)
  .array()
  .min(1)
  .max(10);
const ratios = z.strictObject({
  min: z
    .number()
    .min(1 / 240)
    .max(1),
  target: z
    .number()
    .min(1 / 240)
    .max(1),
  max: z
    .number()
    .min(1 / 240)
    .max(1),
});
const velocityRatios = z.strictObject({
  min: z.number().gt(1).max(4),
  max: z.number().gt(1).max(4),
});
export const articulationSchema = z
  .strictObject({
    kind: z.literal("enabled"),
    voices: voiceIds,
    touch: rules(touches).default([]),
    emphasis: rules(emphases).default([]),
    touchProbability: probability.default(1),
    emphasisProbability: probability.default(1),
    persistence: probability.default(0),
    slurs: z
      .union([
        z.literal(false),
        z.strictObject({
          voices: voiceIds.optional(),
          probability: probability.gt(0).default(0.35),
          lengths: z
            .strictObject({
              value: z.number().int().min(2).max(16),
              weight: weight.default(1),
            })
            .array()
            .min(1)
            .max(15)
            .default([
              { value: 2, weight: 1 },
              { value: 3, weight: 1 },
            ]),
          styles: rules(slurStyles)
            .min(1)
            .default([{ value: "legato", probability: 1, weight: 1 }]),
          placement: z.enum(slurPlacements).default("auto"),
          crossMeasure: z.boolean().default(true),
          crossPhrase: z.boolean().default(false),
        }),
      ])
      .default(false),
    interactions: z
      .strictObject({
        chords: z.enum(["allow", "exclude"]).default("allow"),
        ties: z.enum(["exclude", "preserve-hold"]).default("exclude"),
        sustained: z.enum(["allow", "exclude"]).default("allow"),
        continuous: z.enum(["exclude", "connected"]).default("connected"),
        legatoFallback: z.enum(["omit", "connected"]).default("connected"),
      })
      .prefault({}),
    timing: z
      .strictObject({
        staccatissimo: ratios.default({ min: 0.15, target: 0.25, max: 0.35 }),
        staccato: ratios.default({ min: 0.35, target: 0.5, max: 0.65 }),
        portato: ratios.default({ min: 0.55, target: 0.7, max: 0.85 }),
        tenuto: ratios.default({ min: 0.9, target: 1, max: 1 }),
        overlapTicks: positiveTicks.default(24),
        separationTicks: positiveTicks.default(48),
        connectedGapTicks: z.number().int().min(0).max(239).default(24),
      })
      .prefault({}),
    evaluation: z
      .discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("disabled") }),
        z.strictObject({
          kind: z.literal("evaluate"),
          timingWeight: z.number().min(0).max(1000).default(1),
          velocityWeight: z.number().min(0).max(1000).default(0),
          waitMode: z.enum(["disabled", "velocity-only"]).default("disabled"),
          tolerance: z
            .strictObject({
              beatFraction: z.number().min(0).max(0.5).default(0.035),
              minMs: z.number().min(0).max(250).default(8),
              maxMs: z.number().min(0).max(250).default(40),
            })
            .prefault({}),
          velocity: z
            .strictObject({
              precedingAttacks: z.number().int().min(1).max(64).default(8),
              accent: velocityRatios.default({ min: 1.08, max: 1.45 }),
              marcato: velocityRatios.default({ min: 1.15, max: 1.8 }),
            })
            .prefault({}),
        }),
      ])
      .default({ kind: "disabled" }),
  })
  .superRefine((a, ctx) => {
    const error = (path: string[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const touch = a.touch.filter((p) => p.probability > 0);
    const emphasis = a.emphasis.filter((p) => p.probability > 0);
    for (const [key, group] of [
      ["voices", a.voices],
      ["touch", a.touch.map((r) => r.value)],
      ["emphasis", a.emphasis.map((r) => r.value)],
      ...(a.slurs
        ? ([
            ["slurs.voices", a.slurs.voices ?? []],
            ["slurs.styles", a.slurs.styles.map((r) => r.value)],
            ["slurs.lengths", a.slurs.lengths.map((r) => r.value)],
          ] as const)
        : []),
    ] as const)
      if (new Set<unknown>(group).size !== group.length)
        error(key.split("."), "Entries must be unique.");
    if (!a.slurs && !touch.length && !emphasis.length)
      error([], "Enable at least one touch, emphasis or slur.");
    if (a.touch.length && (!touch.length || !a.touchProbability))
      error(
        ["touch"],
        "Selected touches need a positive occurrence probability.",
      );
    if (a.emphasis.length && (!emphasis.length || !a.emphasisProbability))
      error(
        ["emphasis"],
        "Selected emphases need a positive occurrence probability.",
      );
    if (a.slurs && !a.slurs.styles.some((r) => r.probability > 0))
      error(
        ["slurs", "styles"],
        "At least one slur style needs positive probability.",
      );
    if (a.slurs && a.slurs.crossPhrase && !a.slurs.crossMeasure)
      error(
        ["slurs", "crossPhrase"],
        "Cross-phrase slurs require cross-measure slurs.",
      );
    const durations = [
      "staccatissimo",
      "staccato",
      "portato",
      "tenuto",
    ] as const;
    for (const type of durations) {
      const { min, target, max } = a.timing[type];
      if (min > target || target > max || (type !== "tenuto" && max >= 1))
        error(
          ["timing", type],
          "Require min ≤ target ≤ max and a detached maximum below 1.",
        );
    }
    if (
      durations.some(
        (type, i) =>
          i > 0 && a.timing[type].target <= a.timing[durations[i - 1]].target,
      )
    )
      error(
        ["timing"],
        "Target ratios must increase from staccatissimo to staccato to portato to tenuto.",
      );
    const e = a.evaluation;
    if (e.kind !== "evaluate") return;
    if (e.tolerance.minMs > e.tolerance.maxMs)
      error(
        ["evaluation", "tolerance"],
        "Minimum tolerance cannot exceed the maximum.",
      );
    if (
      (!e.timingWeight && !e.velocityWeight) ||
      (e.timingWeight &&
        !a.slurs &&
        !touch.some((r) => r.value !== "natural")) ||
      (e.velocityWeight && !emphasis.length) ||
      (e.waitMode === "velocity-only" && !e.velocityWeight)
    )
      error(
        ["evaluation"],
        "Evaluation weights and wait mode require their corresponding enabled capabilities.",
      );
    if (emphases.some((m) => e.velocity[m].min > e.velocity[m].max))
      error(
        ["evaluation", "velocity"],
        "Velocity ratio minima cannot exceed maxima.",
      );
  });
