import {
  TPQ,
  noteheads,
  type ScoreEvent,
  type LifetimeNote,
  type NoteLifetime,
} from "./model";
import type { ValidatedGeneratorConfig } from "../generation/config";

/** Projection only: no sampling, note selection, notation changes or PRNG draws. */
export function attachNoteLifetimes(
  events: ScoreEvent[],
  c: ValidatedGeneratorConfig,
) {
  const config = c.noteLifetimes;
  if (config.kind === "disabled") return;
  for (const e of events) {
    if (e.kind === "rest") continue;
    const onsetTick = e.bar * c.notation.beats * TPQ + e.onset;
    const releaseTick = onsetTick + e.duration;
    const lifetime: NoteLifetime = {
      voiceId: `${e.hand}:main`,
      onsetTick,
      releaseTick,
      durationTicks: e.duration,
      keyHold:
        config.keyHold === "required"
          ? { kind: "required", releaseTick }
          : { kind: "attack-only" },
    };
    noteheads(e).forEach((n) => (n.lifetime = structuredClone(lifetime)));
    e.lifetime = structuredClone(lifetime);
  }
}

/** One identity per attack, including all chord heads; never synthesizes ties. */
export function lifetimeNotes(events: ScoreEvent[]): LifetimeNote[] {
  return events.flatMap((e) =>
    noteheads(e)
      .filter((n) => !n.tie || n.tie.index === 0)
      .map((n) => {
        if (!n.lifetime)
          throw new Error(`Missing explicit lifetime for ${n.id}.`);
        return {
          id: n.id,
          eventId: e.id,
          midi: n.midi,
          hand: n.hand,
          finger: n.finger,
          positionId: e.positionId,
          lifetime: structuredClone(n.lifetime),
        };
      }),
  );
}

/** Scoring projection: continuation glyphs are never attacks, even in partial chords. */
export function attackEvents(events: ScoreEvent[]): ScoreEvent[] {
  return events.flatMap((e) => {
    if (!noteheads(e).some((n) => n.tie)) return [e];
    const heads = noteheads(e).filter((n) => !n.tie || n.tie.index === 0);
    if (!heads.length) return [];
    const attack = { ...e, ...heads[0], id: e.id, notes: heads };
    if (!heads[0].tie) delete attack.tie;
    return [attack];
  });
}

/** Intended occupancy, not an observation of which finger the pianist used. */
export function lifetimeOccupancy(notes: LifetimeNote[], tick: number) {
  if (!Number.isSafeInteger(tick) || tick < 0)
    throw new Error("Occupancy requires a nonnegative integer tick.");
  const sounding = notes.filter(
    ({ lifetime: n }) => n.onsetTick <= tick && tick < n.releaseTick,
  );
  const physical = sounding.filter(
    ({ lifetime: n }) =>
      n.keyHold.kind === "required" && tick < n.keyHold.releaseTick,
  );
  return {
    sounding,
    physical,
    fingers: physical.map((n) => ({
      hand: n.hand,
      finger: n.finger,
      noteId: n.id,
    })),
  };
}
