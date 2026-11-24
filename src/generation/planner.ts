import type { Settings, StreamState, Phrase } from "../score/model";
import { resolveSettings, legacyCoverageContext } from "./config/presets";
import { generateWithContext } from "./engine";
import type { ValidatedGeneratorConfig } from "./config";

export function generateLegacyReplay(
  settings: Settings,
  config: ValidatedGeneratorConfig,
  seed: string,
  previous?: StreamState,
) {
  return generateWithContext(
    config,
    seed,
    previous,
    legacyCoverageContext(settings),
  );
}

/** Compatibility boundary only. Core algorithms receive no UI/difficulty labels. */
export function generate(
  settings: Settings,
  seed: string,
  previous?: StreamState,
): Phrase {
  const config = resolveSettings(settings);
  const {
    config: _config,
    configFingerprint: _fingerprint,
    ...phrase
  } = generateLegacyReplay(settings, config, seed, previous);
  void _config;
  void _fingerprint;
  // Preserve legacy field order as well as values for existing exercise consumers.
  return {
    seed: phrase.seed,
    version: phrase.version,
    settings,
    events: phrase.events,
    initial: phrase.initial,
    final: phrase.final,
    positions: phrase.positions,
    movements: phrase.movements,
    harmonies: phrase.harmonies,
  };
}
