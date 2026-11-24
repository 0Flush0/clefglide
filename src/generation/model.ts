import type { ScorePhrase } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";

/** Canonical practice phrase and its generation identity. */
export interface GeneratedPhrase extends ScorePhrase {
  config: ValidatedGeneratorConfig;
  configFingerprint: string;
  /** Actual skipped leap opportunities; never fabricated practice outcomes. */
  movementDiagnostics?: MovementDiagnostic[];
}
export interface MovementDiagnostic {
  hand: import("../score/model").Hand;
  landingTick: number;
  reason: "no-legal-target" | "no-preparation";
}
