import { TPQ, noteheads, type Phrase, type LifetimeNote } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import {
  validateLifetimePlan,
  noteLifetimeDataSchema,
} from "../score/lifetimeValidation";

/** Reconstruct emitted lifetimes independently of the metadata projector. */
export function validateGeneratedLifetimes(
  p: Omit<Phrase, "settings">,
  c: ValidatedGeneratorConfig,
) {
  const errors: string[] = [];
  const config = c.noteLifetimes;
  if (config.kind === "disabled") {
    if (
      p.events.some(
        (e) =>
          e.lifetime !== undefined ||
          noteheads(e).some((n) => n.lifetime !== undefined),
      ) ||
      p.initial.activeLifetimes !== undefined ||
      p.final.activeLifetimes !== undefined
    )
      errors.push(
        "Explicit lifetimes require the enabled lifetime capability.",
      );
    return errors;
  }
  if (
    !Array.isArray(p.initial.activeLifetimes) ||
    !Array.isArray(p.final.activeLifetimes)
  )
    errors.push("Missing lifetime boundary state.");
  // The current shared-rhythm/tie-free generator cannot author a carry-in voice.
  if (p.initial.activeLifetimes?.length)
    errors.push(
      "Shared-rhythm generation cannot consume held carry-in voices.",
    );
  const notes: LifetimeNote[] = [];
  for (const e of p.events) {
    if (e.kind === "rest") {
      if (e.lifetime !== undefined)
        errors.push("A rest cannot carry a note lifetime.");
      continue;
    }
    const heads = noteheads(e);
    if (JSON.stringify(e.lifetime) !== JSON.stringify(heads[0]?.lifetime))
      errors.push("Primary note lifetime differs from its notehead.");
    for (const n of heads) {
      const parsed = noteLifetimeDataSchema.safeParse(n.lifetime);
      if (!parsed.success) {
        errors.push("Missing or invalid generated note lifetime.");
        continue;
      }
      const l = parsed.data;
      const onset = e.bar * c.notation.beats * TPQ + e.onset;
      if (
        l.onsetTick !== onset ||
        l.releaseTick !== onset + e.duration ||
        l.durationTicks !== e.duration ||
        l.voiceId !== `${e.hand}:main` ||
        l.keyHold.kind !== config.keyHold ||
        (l.keyHold.kind === "required" &&
          l.keyHold.releaseTick !== l.releaseTick)
      )
        errors.push(
          "Generated lifetime differs from the resolved score contract.",
        );
      notes.push({
        id: n.id,
        eventId: e.id,
        midi: n.midi,
        hand: n.hand,
        finger: n.finger,
        positionId: e.positionId,
        lifetime: l,
      });
    }
  }
  errors.push(
    ...validateLifetimePlan(
      {
        notes,
        initial: p.initial.activeLifetimes,
        final: p.final.activeLifetimes,
        startTick: p.initial.bar * c.notation.beats * TPQ,
        endTick: p.final.bar * c.notation.beats * TPQ,
      },
      p.movements,
    ),
  );
  return [...new Set(errors)];
}
