import type { Phrase } from "../score/model";
import { resolveSettings } from "./config/presets";
import { validateWithConfig } from "./phraseValidator";
export { validateGeneratedPhrase } from "./phraseValidator";
/** Legacy phrase boundary: resolve policy, then independently validate the score. */
export function validatePhrase(p: Phrase): string[] {
  try {
    return validateWithConfig(p, resolveSettings(p.settings));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}
