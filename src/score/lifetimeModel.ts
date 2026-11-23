import type { Hand } from "./model";

/** Links engraved heads to one original MIDI attack. IDs are never pitch-derived. */
export interface TieSegment {
  lifetimeId: string;
  attackEventId: string;
  index: number;
  count: number;
  pattern: "subdivide" | "connect" | "carry";
  previousId?: string;
  nextId?: string;
}

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
