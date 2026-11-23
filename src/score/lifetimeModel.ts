import type { Hand } from "./model";

/** Absolute integer ticks. A lifetime identifies one attack, not a tied glyph. */
export interface NoteLifetime {
  voiceId: string;
  onsetTick: number;
  releaseTick: number;
  durationTicks: number;
  keyHold: { kind: "required"; releaseTick: number } | { kind: "attack-only" };
}
export interface LifetimeNote {
  id: string;
  eventId: string;
  midi: number;
  hand: Hand;
  finger: number;
  positionId: string;
  lifetime: NoteLifetime;
}
export interface LifetimePlan {
  notes: LifetimeNote[];
  /** Carry original attack identities; do not invent continuation attacks. */
  initial?: LifetimeNote[];
  startTick?: number;
  endTick?: number;
  final?: LifetimeNote[];
}
