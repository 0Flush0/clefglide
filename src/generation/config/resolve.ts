import { VERSION } from "../../score/model";
import { smallLandingsNeedOverlapCheck } from "../voiceConfig";
import { generatorDefaults } from "./defaults";
import {
  generatorConfigSchema,
  type GeneratorConfig,
  type GeneratorOverrides,
  type ValidatedGeneratorConfig,
} from "./schema";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export class GeneratorConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid generator configuration: ${message}`);
    this.name = "GeneratorConfigurationError";
  }
}
export function normalizeGeneratorConfig(
  input: unknown,
): ValidatedGeneratorConfig {
  const parsed = generatorConfigSchema.safeParse(input);
  if (!parsed.success)
    throw new GeneratorConfigurationError(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
        .join(" "),
    );
  // The only brand assertion: structural validation and deep freezing happen here.
  return freeze(parsed.data) as unknown as ValidatedGeneratorConfig;
}
function merge(base: unknown, override: unknown): unknown {
  if (override === undefined) return structuredClone(base);
  if (
    !base ||
    !override ||
    typeof base !== "object" ||
    typeof override !== "object" ||
    Array.isArray(base) ||
    Array.isArray(override)
  )
    return structuredClone(override);
  const b = base as Record<string, unknown>,
    o = override as Record<string, unknown>;
  // Union branches replace atomically; obsolete branch fields must not survive.
  if (o.kind !== undefined && b.kind !== o.kind) return structuredClone(o);
  const result = structuredClone(b);
  for (const [key, value] of Object.entries(o))
    result[key] = merge(b[key], value);
  return result;
}
/** Defaults < supplied base/preset < explicit overrides. Arrays replace, never concatenate. */
export function resolveGeneratorConfig(
  overrides: GeneratorOverrides = {},
  base: GeneratorConfig | ValidatedGeneratorConfig = generatorDefaults,
): ValidatedGeneratorConfig {
  return normalizeGeneratorConfig(merge(base, overrides));
}
/** For parameter-driven callers only. Legacy session fingerprints are deliberately untouched. */
export function generatorConfigFingerprint(
  config: ValidatedGeneratorConfig,
  version = generatorConfigVersion(config),
): string {
  // Disabled configurations retain their pre-capability byte identity.
  const {
    wideLeaps,
    noteLifetimes,
    independentVoices,
    dynamicFingering,
    articulation,
    ...legacy
  } = config;
  const identity = {
    ...legacy,
    ...(wideLeaps.kind !== "disabled" ? { wideLeaps } : {}),
    ...(noteLifetimes.kind !== "disabled" ? { noteLifetimes } : {}),
    ...(independentVoices ? { independentVoices } : {}),
    ...(dynamicFingering ? { dynamicFingering } : {}),
    ...(articulation ? { articulation } : {}),
  };
  return `${version}:parameters:${JSON.stringify(identity)}`;
}
export function generatorConfigVersion(config: ValidatedGeneratorConfig) {
  if (config.articulation) return "12.0.1";
  const wide = config.wideLeaps;
  const independent = config.independentVoices;
  const wideEnabled = wide.kind === "lifted-wide" && wide.probability > 0;
  const revised =
    (!independent &&
      wideEnabled &&
      (config.coverage.kind === "guided" ||
        (config.notation.ties !== false &&
          config.movement.kind === "rested-reposition" &&
          config.movement.probability > 0))) ||
    (independent &&
      ((!wideEnabled && smallLandingsNeedOverlapCheck(config)) ||
        [independent.right, independent.left].some(
          (group) =>
            group &&
            ((group.minPolyphony > 1 &&
              config.chords.kind === "voicings" &&
              config.chords.probability > 0) ||
              group.voices.some(
                (profile) =>
                  profile.entryProbability > 0 && profile.activity === 0,
              )),
        ) ||
        (config.fingering.variablePositionProbability === 0 &&
          config.fingering.patterns.length > 1)));
  let version = VERSION;
  if (config.dynamicFingering) version = "11.0.0";
  else if (independent)
    version =
      wide.kind !== "disabled" ||
      config.coverage.kind === "guided" ||
      config.fingering.allowRestedAlternates
        ? "10.0.0"
        : "9.0.0";
  else if (config.notation.ties !== false) version = "8.1.0";
  else if (config.noteLifetimes.kind === "explicit") version = "7.0.0";
  else if (wide.kind !== "disabled") version = "6.0.0";
  return revised ? `${version.slice(0, -1)}1` : version;
}
