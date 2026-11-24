import { z } from "zod";
import { curriculum, guidedRecipe, type GuidedLevel } from "./curriculum";
import {
  generatorConfigFingerprint,
  generatorConfigSchema,
  normalizeGeneratorConfig,
  type GeneratorConfig,
  type ValidatedGeneratorConfig,
} from "../generation/config";
import { planningTempo } from "../generation/config/handParameters";
import { settingsValuesSchema } from "../score/model";

export const practiceOptionsSchema = settingsValuesSchema
  .pick({ bpm: true, mode: true, bars: true, offset: true, tolerance: true })
  .extend({ hints: z.enum(["all", "smart", "hidden"]).default("smart") });
export type PracticeOptions = z.infer<typeof practiceOptionsSchema>;
export const practiceProfileSchema = z.enum(["guided", "custom"]);
export type PracticeProfile = z.infer<typeof practiceProfileSchema>;
export const levelIdentitySchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
});
export type PracticeSetup = {
  profile: PracticeProfile;
  config: ValidatedGeneratorConfig;
  options: PracticeOptions;
  level?: { id: string; version: number };
};
export const defaultExerciseSeed = "first-light";

export function guidedPractice(
  hand: GeneratorConfig["hands"]["active"],
): PracticeSetup {
  return atGuidedLevel(curriculum[hand][0], practiceOptionsSchema.parse({}));
}

export const defaultPractice = guidedPractice("right");

export function atGuidedLevel(
  level: GuidedLevel,
  options: PracticeOptions,
): PracticeSetup {
  return {
    profile: "guided",
    config: guidedRecipe(level),
    options: { ...options, bpm: level.bpm },
    level: { id: level.id, version: level.version },
  };
}

export const savedSetupSchema = z
  .object({
    profile: practiceProfileSchema,
    config: generatorConfigSchema.transform(normalizeGeneratorConfig),
    options: practiceOptionsSchema,
    level: levelIdentitySchema.optional(),
  })
  .refine(
    ({ config, options }) =>
      (planningTempo(config) ?? options.bpm) === options.bpm,
    "The playback tempo must match the tempo used to plan dynamic fingering.",
  );

export function playbackSettings({ config, options }: PracticeSetup) {
  const { active, right, left } = config.hands;
  const { key, beats } = config.notation;
  return {
    ...options,
    hints: options.mode === "benchmark" ? ("hidden" as const) : options.hints,
    beats,
    key,
    hand: active,
    min: right.min,
    max: right.max,
    leftMin: left.min,
    leftMax: left.max,
  };
}

export function practiceFingerprint(
  config: ValidatedGeneratorConfig,
  options: PracticeOptions,
  assistanceUsed: boolean,
  version?: string,
) {
  const playback = practiceOptionsSchema.parse(options);
  if (playback.mode === "benchmark") playback.hints = "hidden";
  return `${generatorConfigFingerprint(config, version)}|practice:${JSON.stringify(playback)}|assistance:${assistanceUsed ? "assisted" : "unassisted"}`;
}
