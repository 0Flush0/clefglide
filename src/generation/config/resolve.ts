import { VERSION } from "../../score/model";
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
): string {
  // Disabled configurations retain their pre-capability byte identity.
  const { wideLeaps, noteLifetimes, independentVoices, ...legacy } = config;
  const identity = {
    ...legacy,
    ...(wideLeaps.kind !== "disabled" ? { wideLeaps } : {}),
    ...(noteLifetimes.kind !== "disabled" ? { noteLifetimes } : {}),
    ...(independentVoices ? { independentVoices } : {}),
  };
  return `${generatorConfigVersion(config)}:parameters:${JSON.stringify(identity)}`;
}
export function generatorConfigVersion(config: ValidatedGeneratorConfig) {
  if (config.independentVoices) return "9.0.0";
  if (config.notation.ties !== false) return "8.1.0";
  if (config.noteLifetimes.kind === "explicit") return "7.0.0";
  return config.wideLeaps.kind === "disabled" ? VERSION : "6.0.0";
}
