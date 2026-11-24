/** Shared generation API for practice profiles. */
export { generateConfigured } from "./engine";
export { GeneratorSearchExhaustedError } from "./independentVoices";
export { inspectGeneratorFeasibility } from "./feasibility";
export { GeneratorContextInfeasibleError } from "./dynamicFeasibility";
export { validateGeneratedPhrase } from "./phraseValidator";
export type { GeneratedPhrase, MovementDiagnostic } from "./model";
export * from "./config";
