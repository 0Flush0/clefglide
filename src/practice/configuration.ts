import { z } from "zod";
import {
  generatorConfigFingerprint,
  generatorConfigSchema,
  normalizeGeneratorConfig,
  resolveGeneratorConfig,
  type GeneratorConfig,
  type ValidatedGeneratorConfig,
} from "../generation/config";
import { settingsValuesSchema } from "../score/model";

export const practiceOptionsSchema = settingsValuesSchema
  .pick({ bpm: true, mode: true, bars: true, offset: true, tolerance: true })
  .extend({ hints: z.enum(["all", "smart", "hidden"]).default("smart") });
export type PracticeOptions = z.infer<typeof practiceOptionsSchema>;
export const practiceProfileSchema = z.enum(["guided", "custom"]);
export type PracticeProfile = z.infer<typeof practiceProfileSchema>;
export type PracticeSetup = {
  profile: PracticeProfile;
  config: ValidatedGeneratorConfig;
  options: PracticeOptions;
};
export const defaultExerciseSeed = "first-light";

export const defaultPractice: PracticeSetup = {
  profile: "guided",
  config: resolveGeneratorConfig(),
  options: practiceOptionsSchema.parse({}),
};

export function guidedPractice(
  hand: GeneratorConfig["hands"]["active"],
): PracticeSetup {
  return {
    ...defaultPractice,
    config: resolveGeneratorConfig({ hands: { active: hand } }),
  };
}

export const savedSetupSchema = z
  .object({
    profile: practiceProfileSchema,
    config: generatorConfigSchema.transform(normalizeGeneratorConfig),
    options: practiceOptionsSchema,
  })
  .refine(
    ({ config, options }) =>
      !config.dynamicFingering ||
      config.dynamicFingering.tempoBpm === options.bpm,
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
