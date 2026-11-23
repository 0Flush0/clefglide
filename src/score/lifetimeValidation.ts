import { z } from "zod";
import type { LifetimePlan, MovementPlan } from "./model";

const tick = z.number().int().nonnegative();
export const noteLifetimeDataSchema = z
  .object({
    voiceId: z.string().min(1),
    onsetTick: tick,
    releaseTick: tick,
    durationTicks: z.number().int().positive(),
    keyHold: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("required"), releaseTick: tick }).strict(),
      z.object({ kind: z.literal("attack-only") }).strict(),
    ]),
  })
  .strict()
  .superRefine((n, ctx) => {
    if (
      n.releaseTick - n.onsetTick !== n.durationTicks ||
      (n.keyHold.kind === "required" &&
        (n.keyHold.releaseTick <= n.onsetTick ||
          n.keyHold.releaseTick > n.releaseTick))
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent note duration or physical key-hold interval.",
      });
  });
export const lifetimeNoteSchema = z
  .object({
    id: z.string().min(1),
    eventId: z.string().min(1),
    midi: z.number().int().min(0).max(127),
    hand: z.enum(["right", "left"]),
    finger: z.number().int().min(1).max(5),
    positionId: z.string().min(1),
    lifetime: noteLifetimeDataSchema,
  })
  .strict();

/** Independent interval/occupancy validation; never calls generation/projection helpers. */
export function validateLifetimePlan(
  plan: LifetimePlan,
  movements: MovementPlan[] = [],
): string[] {
  const errors: string[] = [];
  const parse = (notes: unknown) => {
    const parsed = z.array(lifetimeNoteSchema).safeParse(notes);
    if (!parsed.success) {
      errors.push("Invalid note lifetime data.");
      return [];
    }
    return parsed.data;
  };
  const notes = parse(plan.notes),
    initial = parse(plan.initial ?? []),
    final = parse(plan.final ?? []);
  const start = plan.startTick ?? 0,
    end = plan.endTick;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    (end !== undefined && (!Number.isSafeInteger(end) || end <= start))
  )
    errors.push("Invalid lifetime plan boundaries.");
  if (
    initial.some(
      (n) => n.lifetime.onsetTick >= start || n.lifetime.releaseTick <= start,
    )
  )
    errors.push("Incoming lifetimes must cross the phrase boundary.");
  if (
    notes.some(
      (n) =>
        n.lifetime.onsetTick < start ||
        (end !== undefined && n.lifetime.onsetTick >= end),
    )
  )
    errors.push("Lifetime attack lies outside its phrase.");
  const all = [...initial, ...notes];
  if (new Set(all.map((n) => n.id)).size !== all.length)
    errors.push("Duplicate lifetime attack identity.");
  const physicalEnd = (n: (typeof all)[number]) =>
    n.lifetime.keyHold.kind === "required"
      ? n.lifetime.keyHold.releaseTick
      : n.lifetime.onsetTick;
  let active: typeof all = [];
  for (const a of [...all].sort(
    (a, b) => a.lifetime.onsetTick - b.lifetime.onsetTick,
  )) {
    const x = a.lifetime;
    active = active.filter((b) => b.lifetime.releaseTick > x.onsetTick);
    for (const b of active) {
      const y = b.lifetime;
      if (
        a.midi === b.midi &&
        Math.max(x.onsetTick, y.onsetTick) <
          Math.min(x.releaseTick, y.releaseTick)
      )
        errors.push(
          "Overlapping same-pitch lifetimes need unsupported unison/tie attribution.",
        );
      const occupied =
        x.onsetTick === y.onsetTick ||
        (x.onsetTick <= y.onsetTick && y.onsetTick < physicalEnd(a)) ||
        (y.onsetTick <= x.onsetTick && x.onsetTick < physicalEnd(b));
      if (occupied && a.hand === b.hand && a.finger === b.finger)
        errors.push("A planned finger is occupied by overlapping notes.");
    }
    active.push(a);
    if (
      movements.some(
        (m) =>
          m.hand === a.hand &&
          x.onsetTick < m.landingTick &&
          physicalEnd(a) > m.cueTick,
      )
    )
      errors.push(
        "A required physical hold overlaps hand-movement preparation.",
      );
  }
  if (end !== undefined) {
    const expected = all.filter((n) => n.lifetime.releaseTick > end);
    const canonical = (ns: typeof all) =>
      JSON.stringify([...ns].sort((a, b) => a.id.localeCompare(b.id)));
    if (canonical(expected) !== canonical(final))
      errors.push("Final active lifetimes differ from the score.");
  } else if (plan.final !== undefined)
    errors.push("Final lifetimes require an end boundary.");
  return [...new Set(errors)];
}
