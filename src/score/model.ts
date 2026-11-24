import { z } from "zod";
import type { RangeCoverage } from "../generation/rangeCoverage";
import type { NoteLifetime, LifetimeNote, TieSegment } from "./lifetimeModel";
import type {
  ArticulationBoundary,
  ArticulationMark,
  SlurMember,
} from "./articulationModel";
export type {
  NoteLifetime,
  LifetimeNote,
  LifetimePlan,
  TieSegment,
} from "./lifetimeModel";
export const VERSION = "5.2.0";
export const TPQ = 480;
export const legacySettingsSchema = z.object({
  hand: z.enum(["right", "left", "both"]).default("right"),
  rhClef: z.enum(["treble", "bass"]).default("treble"),
  lhClef: z.enum(["treble", "bass"]).default("bass"),
  key: z.enum(["C", "G", "F", "D"]).default("C"),
  min: z.number().int().min(36).max(84).default(60),
  max: z.number().int().min(36).max(96).default(67),
  leftMin: z.number().int().min(24).max(72).default(48),
  leftMax: z.number().int().min(24).max(84).default(55),
  bpm: z.number().int().min(10).max(180).default(60),
  beats: z.union([z.literal(3), z.literal(4)]).default(4),
  rhythm: z.enum(["gentle", "quarters", "mixed"]).default("gentle"),
  interval: z.number().int().min(1).max(4).default(2),
  hints: z.enum(["all", "starts", "reveal", "hidden"]).default("starts"),
  mode: z.enum(["wait", "timed", "benchmark"]).default("wait"),
  bars: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(4),
  offset: z.number().min(-500).max(500).default(0),
  tolerance: z.number().min(50).max(400).default(180),
});
export const v2SettingsSchema = legacySettingsSchema.extend({
  difficulty: z
    .enum(["veryEasy", "easy", "medium", "hard"])
    .default("veryEasy"),
  shiftFrequency: z.number().min(0).max(1).default(0),
  maxShift: z.number().int().min(0).max(4).default(0),
  interval: z.number().int().min(1).max(7).default(2),
  hints: z.preprocess(
    (v) => (v === "starts" ? "reveal" : v),
    z.enum(["all", "smart", "reveal", "hidden"]).default("smart"),
  ),
});
export const v3SettingsSchema = v2SettingsSchema
  .omit({ difficulty: true })
  .extend({
    noteJumps: z.enum(["small", "easy", "medium", "large"]),
    handMovements: z.enum(["off", "easy", "medium", "hard"]),
    fingerSpacing: z.enum(["off", "easy", "medium", "hard"]),
  });
export const v4SettingsSchema = v3SettingsSchema.extend({
  accidentals: z.enum(["off", "easy", "medium", "hard"]).default("off"),
  chords: z.enum(["off", "easy", "medium", "hard"]).default("off"),
});
export const settingsValuesSchema = v4SettingsSchema.extend({
  // min/max remain the right-hand bounds for saved-configuration compatibility.
  min: z.number().int().min(21).max(108).default(60),
  max: z.number().int().min(21).max(108).default(67),
  leftMin: z.number().int().min(21).max(108).default(48),
  leftMax: z.number().int().min(21).max(108).default(55),
  rangeVersion: z.literal(2).default(2),
});
/** Normalize older settings for compatibility. Historical rows keep their own schemas. */
export const settingsSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object") return input;
  const s = input as Record<string, unknown>;
  const old = s.difficulty as string | undefined;
  const interval = typeof s.interval === "number" ? s.interval : 2;
  return {
    ...s,
    // Old left-only practice used the shared bounds, even when LH bounds existed.
    // Preserve that active preference; right/both settings already have two ranges.
    ...(s.rangeVersion === undefined && s.hand === "left"
      ? { leftMin: s.min ?? 60, leftMax: s.max ?? 67 }
      : {}),
    noteJumps:
      s.noteJumps ??
      (old === "hard" || interval > 4
        ? "large"
        : old === "medium" || interval > 2
          ? "medium"
          : "easy"),
    handMovements: s.handMovements ?? (old && old !== "veryEasy" ? old : "off"),
    fingerSpacing: s.fingerSpacing ?? "off",
  };
}, settingsValuesSchema);
export type Settings = z.infer<typeof settingsSchema>;
export type ScoringSettings = Pick<
  Settings,
  "mode" | "beats" | "bpm" | "offset" | "tolerance"
>;
export type NotationSettings = Pick<
  Settings,
  "beats" | "key" | "bars" | "hints"
>;
export const defaults = settingsSchema.parse({});
export type Hand = "right" | "left";
export type HintMemory = Partial<
  Record<
    Hand,
    {
      positionId: string;
      /** Scale-degree coordinate minus finger index, oriented from thumb to fifth. */
      anchors: Record<number, number>;
      established: Record<string, Record<number, number>>;
    }
  >
>;
export interface HandState {
  id: string;
  hand: Hand;
  clef: "treble" | "bass";
  pitches: string[];
  fingerToMidi: number[];
  lastIndex: number;
  min: number;
  max: number;
  lastPitch?: string;
  lastNoteEnd?: number;
  /** Explicit playable pitch choices per finger; immutable for this position. */
  pitchOptions?: string[][];
  resolutionPitch?: string;
  lastVoicing?: number[];
  /** Actual previous attack, including every chord finger, across chunk boundaries. */
  lastFingering?: { midi: number; finger: number }[];
}
export interface WrittenPitch {
  letter: string;
  octave: number;
  accidental: "" | "#" | "b";
  key: Settings["key"];
}
export interface Notehead {
  id: string;
  midi: number;
  pitch: string;
  written?: WrittenPitch;
  finger: number;
  hand: Hand;
  lifetime?: NoteLifetime;
  tie?: TieSegment;
  fingering?: AttackFingering;
  substitution?: FingerSubstitution;
}
export interface AttackFingering {
  technique: "rested-alternate" | "adjacent-reach";
  expectedFinger: number;
}
/** A transfer during an existing physical hold, owned by the displayed segment. */
export interface FingerSubstitution {
  technique: "substitution";
  lifetimeId: string;
  fromFinger: number;
  toFinger: number;
  startTick: number;
  endTick: number;
}
export interface ScoreEvent {
  id: string;
  articulation?: ArticulationMark;
  slur?: SlurMember;
  /** Explicit on independent timelines, including rests. */
  voiceId?: string;
  kind: "note" | "rest";
  bar: number;
  onset: number;
  duration: number;
  hand: Hand;
  positionId: string;
  midi: number;
  pitch: string;
  finger: number;
  /** Primary lifetime mirrors notes[0]; absent on legacy scores and rests. */
  lifetime?: NoteLifetime;
  tie?: TieSegment;
  /** Absent only on legacy single-note events. Primary fields mirror notes[0]. */
  notes?: Notehead[];
  action: "PLAY_WITHIN_POSITION" | "REPEAT_NOTE" | "REST";
  fingering?: AttackFingering;
}
export function noteheads(event: ScoreEvent): Notehead[] {
  return event.kind === "rest" ? [] : (event.notes ?? [event]);
}
export interface StreamState {
  rng: number;
  bar: number;
  hands: HandState[];
  hints?: HintMemory;
  coverage?: Partial<Record<Hand, RangeCoverage>>;
  activeLifetimes?: LifetimeNote[];
  dynamicFingering?: FingeringBoundary;
  articulation?: ArticulationBoundary;
  independentVoices?: {
    context: string;
    voices: Record<string, VoiceState>;
    leapPreparations?: Partial<Record<Hand, VoiceLeapPreparation>>;
  };
  pendingTies?: {
    configFingerprint: string;
    head: Notehead;
    positionId: string;
    nextSegmentId: string;
    duration: number;
  }[];
  /** Reserved, fully silent tail for a possible next-chunk wide landing. */
  wideLeapPreparation?: {
    configFingerprint: string;
    cueTick: number;
    landingTick: number;
  };
}
export interface FingeringSpan {
  eventId: string;
  voiceId: string;
  positionId: string;
  hand: Hand;
  pitch: string;
  midi: number;
  finger: number;
  start: number;
  end: number;
  tied: boolean;
  alternate: boolean;
}
export type ContinuousTechnique =
  "thumb-under" | "finger-over" | "continuous-shift";
export type DynamicAttack = AttackFingering["technique"] | ContinuousTechnique;
export interface FingeringRun {
  technique: DynamicAttack;
  consecutive: number;
  repeated: number;
}
export interface FingeringBoundary {
  context: string;
  spans: FingeringSpan[];
  lastMovementTick: Partial<Record<Hand, number>>;
  runs: Partial<Record<Hand, FingeringRun>>;
}
export interface VoiceLeapPreparation {
  cueTick: number;
  landingTick: number;
  /** Nearest opposite-hand envelope edge over the elapsed preparation. */
  oppositeEdge?: number;
}
export interface VoiceState {
  active: boolean;
  lastPitch?: string;
  lastPositionId?: string;
  lastFingering?: { midi: number; finger: number }[];
  resolutionPitch?: string;
}
export interface ScorePhrase {
  seed: string;
  version: string;
  events: ScoreEvent[];
  initial: StreamState;
  final: StreamState;
  harmonies: string[];
  positions: HandState[];
  movements: MovementPlan[];
}
export interface Phrase extends ScorePhrase {
  settings: Settings;
}
interface MovementLanding {
  id: string;
  hand: Hand;
  fromPositionId: string;
  toPositionId: string;
  cueTick: number;
  landingTick: number;
  landingNoteId: string;
  landingMidi: number;
  landingFinger: number;
  distance: number;
}
export type ContinuousMovementPlan = MovementLanding & {
  technique: ContinuousTechnique;
  transferStartTick: number;
  source: { eventId: string; midi: number; finger: number };
};
export type MovementPlan =
  | (MovementLanding & {
      technique: "lift-and-reposition" | "lifted-wide-leap";
    })
  | ContinuousMovementPlan;
export function isContinuousMovement(
  movement: MovementPlan,
): movement is ContinuousMovementPlan {
  return (
    movement.technique === "thumb-under" ||
    movement.technique === "finger-over" ||
    movement.technique === "continuous-shift"
  );
}
export function fingerprint(
  s: Settings,
  assistanceUsed = automaticAssistance(s),
) {
  return (
    VERSION +
    ":" +
    JSON.stringify(settingsSchema.parse(s)) +
    `|assistance:${assistanceUsed ? "assisted" : "unassisted"}`
  );
}
export function automaticAssistance(s: Pick<Settings, "mode" | "hints">) {
  return s.mode !== "benchmark" && (s.hints === "all" || s.hints === "smart");
}
