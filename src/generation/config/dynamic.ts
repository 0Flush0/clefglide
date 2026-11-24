import { z } from "zod";
import { TPQ } from "../../score/model";

const finger = z.number().int().min(1).max(5);
const weight = z.number().min(0.001).max(1000);
const milliseconds = z.number().int().min(0).max(2000);
const occurrence = {
  probability: z.number().positive().max(1),
  weight,
};
const fingers = z
  .array(z.tuple([finger, finger]))
  .min(1)
  .max(20);
const directions = z
  .array(z.enum(["up", "down"]))
  .min(1)
  .max(2);
const travel = {
  ...occurrence,
  fingerPairs: fingers,
  directions,
  maxSemitones: z.number().int().min(1).max(3),
  minimumPreparationMs: milliseconds,
};
const crossing = {
  ...travel,
  maxPositionSteps: z.number().int().min(1).max(3),
  minimumTransitionMs: milliseconds,
  allowBlackKeys: z.boolean(),
  allowTiedSource: z.boolean(),
};
export const dynamicFingeringSchema = z
  .object({
    tempoBpm: z.number().int().min(10).max(180),
    techniques: z
      .array(
        z.discriminatedUnion("technique", [
          z
            .object({ technique: z.literal("thumb-under"), ...crossing })
            .strict(),
          z
            .object({ technique: z.literal("finger-over"), ...crossing })
            .strict(),
          z
            .object({ technique: z.literal("continuous-shift"), ...crossing })
            .strict(),
          z
            .object({ technique: z.literal("adjacent-reach"), ...travel })
            .strict(),
          z
            .object({
              technique: z.literal("rested-alternate"),
              ...travel,
              minimumRestTicks: z
                .number()
                .int()
                .min(TPQ)
                .max(2 * TPQ),
            })
            .strict(),
          z
            .object({
              technique: z.literal("substitution"),
              probability: occurrence.probability,
              fingerPairs: fingers,
              minimumPreparationMs: milliseconds,
              transferMs: milliseconds,
              minimumRecoveryMs: milliseconds,
              allowTies: z.boolean(),
              heldNotes: z.enum(["isolated", "stable-dyad"]),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(6),
    fingerWeights: z.tuple([weight, weight, weight, weight, weight]),
    attacks: z
      .object({
        maxConsecutive: z.number().int().min(1).max(32),
        maxRepeated: z.number().int().min(1).max(32),
        distanceCost: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    const unique = (items: readonly unknown[]) =>
      new Set(items.map((item) => JSON.stringify(item))).size === items.length;
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (!unique(policy.techniques.map((rule) => rule.technique)))
      issue(["techniques"], "Provide one rule per technique.");
    if (
      !!policy.attacks !==
      policy.techniques.some((rule) => rule.technique !== "substitution")
    )
      issue(
        ["attacks"],
        "Supply attack selection parameters exactly when an attack technique is enabled.",
      );
    if (
      policy.attacks &&
      policy.attacks.maxRepeated > policy.attacks.maxConsecutive
    )
      issue(
        ["attacks", "maxRepeated"],
        "Repeated attacks cannot exceed the consecutive attack limit.",
      );
    for (const [index, rule] of policy.techniques.entries()) {
      const path = ["techniques", index];
      if (
        !unique(rule.fingerPairs) ||
        !rule.fingerPairs.every(([from, to]) => {
          switch (rule.technique) {
            case "thumb-under":
              return (from === 2 || from === 3) && to === 1;
            case "finger-over":
              return from === 1 && (to === 2 || to === 3);
            case "continuous-shift":
            case "rested-alternate":
              return Math.abs(from - to) === 1;
            default:
              return (
                from >= 2 &&
                from <= 4 &&
                to >= 2 &&
                to <= 4 &&
                Math.abs(from - to) === 1
              );
          }
        })
      )
        issue(
          [...path, "fingerPairs"],
          "Provide unique pairs inside the technique's physical finger limits.",
        );
      if ("directions" in rule && !unique(rule.directions))
        issue([...path, "directions"], "Directions must be unique.");
      if (rule.technique === "substitution") {
        if (rule.transferMs < 80)
          issue(
            [...path, "transferMs"],
            "Allow at least 80 ms for the modeled transfer.",
          );
        if (rule.minimumRecoveryMs < 80)
          issue(
            [...path, "minimumRecoveryMs"],
            "Allow at least 80 ms of release recovery.",
          );
      }
      if (rule.technique === "continuous-shift" && rule.maxPositionSteps !== 1)
        issue(
          [...path, "maxPositionSteps"],
          "Continuous shifts are limited to one diatonic position step.",
        );
      if (
        (rule.technique === "thumb-under" ||
          rule.technique === "finger-over") &&
        (!rule.fingerPairs.some(
          ([from, to]) => Math.max(from, to) <= rule.maxPositionSteps,
        ) ||
          rule.maxSemitones > 2)
      )
        issue(
          path,
          "A crossing needs a permitted finger pair within its position distance and at most two semitones of key travel.",
        );
      if (
        (rule.technique === "adjacent-reach" ||
          rule.technique === "rested-alternate") &&
        rule.maxSemitones > 2
      )
        issue(
          [...path, "maxSemitones"],
          "Alternate finger reach is limited to two semitones.",
        );
    }
  });
