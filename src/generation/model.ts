import type { Phrase } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";

/** Parameter-driven output deliberately has no legacy UI settings/session identity.
 * Do not persist custom configurations through the legacy session record API. */
export interface GeneratedPhrase extends Omit<Phrase, "settings"> {
  config: ValidatedGeneratorConfig;
  configFingerprint: string;
}
