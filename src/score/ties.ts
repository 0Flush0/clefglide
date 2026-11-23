import { z } from "zod";
import { TPQ, noteheads, type LifetimeNote, type ScoreEvent } from "./model";
import type { ValidatedGeneratorConfig } from "../generation/config";
import { Note } from "tonal";

export const tieSegmentSchema = z
  .object({
    lifetimeId: z.string().min(1),
    attackEventId: z.string().min(1),
    index: z.number().int().min(0).max(255),
    count: z.number().int().min(2).max(256),
    pattern: z.enum(["subdivide", "connect", "carry"]),
    previousId: z.string().min(1).optional(),
    nextId: z.string().min(1).optional(),
  })
  .strict();

/** Independent graph and interval reconstruction. No generator selection helpers. */
export function validateTieSegments(
  events: ScoreEvent[],
  beats: number,
  initial: LifetimeNote[] = [],
  startTick = 0,
  endTick = Math.max(
    0,
    ...events.map((e) => e.bar * beats * TPQ + e.onset + e.duration),
  ),
  policy?: Exclude<ValidatedGeneratorConfig["notation"]["ties"], false>,
  // For a clipped notation window, retain the full surrounding score as evidence.
  // Missing glyphs alone are never accepted as proof of an incoming connection.
  windowContext?: ScoreEvent[],
): string[] {
  if (windowContext) {
    const tick = (e: ScoreEvent) => e.bar * beats * TPQ + e.onset;
    const errors = validateTieSegments(
      windowContext,
      beats,
      initial,
      Math.min(startTick, ...windowContext.map(tick)),
      Math.max(endTick, ...windowContext.map((e) => tick(e) + e.duration)),
      policy,
    );
    const expected = windowContext.filter(
      (e) => tick(e) >= startTick && tick(e) < endTick,
    );
    if (JSON.stringify(expected) !== JSON.stringify(events))
      errors.push("Notation window differs from its validated tie context.");
    return [...new Set(errors)];
  }
  const errors: string[] = [];
  let previousTick = -1;
  for (const e of events) {
    const tick = e.bar * beats * TPQ + e.onset;
    if (
      !Number.isSafeInteger(e.bar) ||
      e.bar < 0 ||
      !Number.isSafeInteger(e.onset) ||
      e.onset < 0 ||
      e.onset >= beats * TPQ ||
      !Number.isSafeInteger(e.duration) ||
      e.duration <= 0 ||
      e.onset + e.duration > beats * TPQ ||
      tick < previousTick
    )
      errors.push(
        "Tie notation requires sorted, exact within-measure segment ticks.",
      );
    previousTick = tick;
  }
  const entries = events.flatMap((event) =>
    noteheads(event).map((head) => ({
      event,
      head,
      tick: event.bar * beats * TPQ + event.onset,
    })),
  );
  const byId = new Map(entries.map((e) => [e.head.id, e]));
  if (byId.size !== entries.length)
    errors.push("Duplicate notation segment identity.");
  for (const { event, head, tick } of entries) {
    if (!head.tie) continue;
    const parsed = tieSegmentSchema.safeParse(head.tie);
    if (!parsed.success) {
      errors.push("Invalid typed tie segment.");
      continue;
    }
    const t = parsed.data,
      l = head.lifetime;
    const spelling = Note.get(head.pitch);
    if (
      spelling.midi !== head.midi ||
      (head.written &&
        (head.written.letter !== spelling.letter ||
          head.written.octave !== spelling.oct ||
          head.written.accidental !== spelling.acc))
    )
      errors.push("Tie has inconsistent chromatic spelling.");
    if (
      policy &&
      (!l ||
        policy.probability === 0 ||
        !policy.segmentCounts.includes(t.count) ||
        !policy.subdivisions.some((d) => d === event.duration) ||
        !policy.patterns.some((p) => p.value === t.pattern) ||
        !policy.voices.some((v) => v === l.voiceId) ||
        l.durationTicks > policy.maxDurationTicks ||
        l.keyHold.kind !== "required" ||
        l.keyHold.releaseTick !== l.releaseTick ||
        (t.pattern === "carry" && !policy.crossPhrase))
    )
      errors.push("Tie notation violates the configured lifetime policy.");
    if (
      !l ||
      t.index >= t.count ||
      (t.index === 0) !== !t.previousId ||
      (t.index === t.count - 1) !== !t.nextId ||
      (t.index === 0 &&
        (t.lifetimeId !== head.id ||
          t.attackEventId !== event.id ||
          l.onsetTick !== tick)) ||
      tick < l.onsetTick ||
      tick + event.duration > l.releaseTick ||
      (t.index === t.count - 1 && tick + event.duration !== l.releaseTick)
    ) {
      errors.push("Tie segment does not cover its owned lifetime.");
      continue;
    }
    const owner = byId.get(t.lifetimeId);
    const carried = initial.find((n) => n.id === t.lifetimeId);
    if (
      owner
        ? owner.head.tie?.index !== 0 ||
          owner.event.id !== t.attackEventId ||
          owner.head.midi !== head.midi ||
          owner.head.pitch !== head.pitch ||
          (owner.head.written &&
            head.written &&
            owner.head.written.key !== head.written.key) ||
          owner.head.finger !== head.finger ||
          owner.head.hand !== head.hand ||
          owner.event.positionId !== event.positionId ||
          JSON.stringify(owner.head.lifetime) !== JSON.stringify(l)
        : !carried ||
          carried.eventId !== t.attackEventId ||
          carried.midi !== head.midi ||
          carried.finger !== head.finger ||
          carried.hand !== head.hand ||
          carried.positionId !== event.positionId ||
          JSON.stringify(carried.lifetime) !== JSON.stringify(l)
    )
      errors.push("Tie has no matching original lifetime owner.");
    if (t.previousId) {
      const previous = byId.get(t.previousId);
      if (previous) {
        const p = previous.head.tie;
        if (
          !p ||
          p.nextId !== head.id ||
          p.index + 1 !== t.index ||
          p.count !== t.count ||
          p.pattern !== t.pattern ||
          p.lifetimeId !== t.lifetimeId ||
          previous.tick + previous.event.duration !== tick
        )
          errors.push("Broken or discontinuous tie connection.");
        if (
          policy &&
          (previous.event.bar === event.bar
            ? !policy.withinMeasure
            : !policy.crossMeasure)
        )
          errors.push("Tie connection violates measure boundary permission.");
      } else if (!carried || t.pattern !== "carry" || tick !== startTick)
        errors.push("Missing incoming tie segment or boundary state.");
    }
    if (t.nextId) {
      const next = byId.get(t.nextId);
      if (next) {
        if (
          next.head.tie?.previousId !== head.id ||
          next.head.tie.index !== t.index + 1 ||
          next.head.tie.lifetimeId !== t.lifetimeId ||
          next.tick !== tick + event.duration
        )
          errors.push("Broken or discontinuous tie connection.");
      } else if (
        t.pattern !== "carry" ||
        tick + event.duration !== endTick ||
        l.releaseTick <= endTick
      )
        errors.push("Missing outgoing tie segment or boundary state.");
    }
  }
  return [...new Set(errors)];
}
