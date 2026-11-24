import type { Hand, Phrase, Settings } from "../score/model";
import {
  legacyCoverageContext,
  resolvePositionParameters,
  resolveSettings,
} from "./config/presets";
import { positionsForConfig } from "./positionMaps";
import { validateWithConfig } from "./phraseValidator";

// Fixtures for replay regression tests that assert the old settings/phrase shape.
export function positionsFor(settings: Settings, hand: Hand) {
  return positionsForConfig(resolvePositionParameters(settings), hand);
}
export function validatePhrase(p: Phrase): string[] {
  try {
    return validateWithConfig(
      p,
      resolveSettings(p.settings),
      legacyCoverageContext(p.settings),
    );
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}
