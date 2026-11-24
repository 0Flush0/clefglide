/** Parameter-driven API for future practice-mode composition. */
export { generateConfigured } from "./engine";
export { GeneratorSearchExhaustedError } from "./independentVoices";
export { inspectGeneratorFeasibility } from "./feasibility";
export { GeneratorContextInfeasibleError } from "./dynamicFeasibility";
export { validateGeneratedPhrase } from "./phraseValidator";
export type { GeneratedPhrase, MovementDiagnostic } from "./model";
export * from "./config";
/** Explicit saved-settings compatibility boundary. */
export { generate } from "./planner";
export { resolveSettings } from "./config/presets";
