import { TPQ, noteheads, type Phrase, type LifetimeNote } from "../score/model";
import {
  generatorConfigFingerprint,
  type ValidatedGeneratorConfig,
} from "./config";
import {
  validateLifetimePlan,
  noteLifetimeDataSchema,
} from "../score/lifetimeValidation";
import { validateTieSegments } from "../score/ties";

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
          e.tie !== undefined ||
          noteheads(e).some(
            (n) => n.lifetime !== undefined || n.tie !== undefined,
          ),
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
  // Carry-in ownership is supported only by the explicit tie module.
  if (p.initial.activeLifetimes?.length && c.notation.ties === false)
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
      const tied = c.notation.ties !== false && n.tie !== undefined;
      if (
        (!tied &&
          (l.onsetTick !== onset ||
            l.releaseTick !== onset + e.duration ||
            l.durationTicks !== e.duration)) ||
        l.voiceId !== `${e.hand}:main` ||
        l.keyHold.kind !== config.keyHold ||
        (l.keyHold.kind === "required" &&
          l.keyHold.releaseTick !== l.releaseTick)
      )
        errors.push(
          "Generated lifetime differs from the resolved score contract.",
        );
      if (!n.tie || n.tie.index === 0)
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
  if (c.notation.ties === false) {
    if (
      p.events.some((e) => e.tie || noteheads(e).some((n) => n.tie)) ||
      p.initial.pendingTies !== undefined ||
      p.final.pendingTies !== undefined
    )
      errors.push("Tie metadata requires the enabled tie capability.");
  } else {
    const t = c.notation.ties;
    const start = p.initial.bar * c.notation.beats * TPQ,
      end = p.final.bar * c.notation.beats * TPQ;
    errors.push(
      ...validateTieSegments(
        p.events,
        c.notation.beats,
        p.initial.activeLifetimes,
        start,
        end,
        t,
      ),
    );
    for (const e of p.events) {
      const heads = noteheads(e);
      if (JSON.stringify(e.tie) !== JSON.stringify(heads[0]?.tie))
        errors.push("Primary tie differs from its notehead.");
      for (const n of heads.filter((n) => n.tie)) {
        const s = n.tie!,
          l = n.lifetime!;
        if (
          t.probability === 0 ||
          !t.segmentCounts.includes(s.count) ||
          !t.subdivisions.some((s) => s === e.duration) ||
          !t.voices.includes(l?.voiceId as "right:main" | "left:main") ||
          !t.patterns.some((p) => p.value === s.pattern) ||
          !l ||
          l.durationTicks > t.maxDurationTicks ||
          (s.pattern === "carry" && !t.crossPhrase) ||
          (heads.length > 1 &&
            (t.chordTones === "none" ||
              (t.chordTones === "all" && heads.some((h) => !h.tie)) ||
              (t.chordTones === "outer" &&
                n.midi !== Math.min(...heads.map((h) => h.midi)) &&
                n.midi !== Math.max(...heads.map((h) => h.midi)))))
        )
          errors.push("Tie violates the resolved configuration.");
        if (l) {
          const firstBar = Math.floor(l.onsetTick / (c.notation.beats * TPQ));
          const lastBar = Math.floor(
            (l.releaseTick - 1) / (c.notation.beats * TPQ),
          );
          if (
            (firstBar === lastBar && !t.withinMeasure) ||
            (firstBar !== lastBar && !t.crossMeasure)
          )
            errors.push("Tie violates measure boundary permission.");
          const previous = p.events.find((event) =>
            noteheads(event).some((h) => h.id === s.previousId),
          );
          if (
            previous &&
            (previous.bar === e.bar ? !t.withinMeasure : !t.crossMeasure)
          )
            errors.push("Tie connection violates measure boundary permission.");
          const owner = p.events.find((event) =>
            noteheads(event).some((h) => h.id === s.lifetimeId),
          );
          if (
            s.pattern === "subdivide" &&
            (!owner ||
              owner.bar !== e.bar ||
              owner.duration !== e.duration ||
              l.durationTicks !== s.count * e.duration ||
              !c.rhythm.durations.some((d) => d.value === l.durationTicks))
          )
            errors.push("Invalid subdivision tie pattern.");
          if (
            s.pattern === "connect" &&
            !c.rhythm.durations.some((d) => d.value === e.duration)
          )
            errors.push(
              "Connected segments must belong to the attack rhythm vocabulary.",
            );
          if (
            s.pattern === "carry" &&
            (heads.length !== 1 ||
              s.count !== 2 ||
              (s.index === 0 &&
                (e.bar !== p.final.bar - 1 ||
                  e.onset + e.duration !== c.notation.beats * TPQ)) ||
              (s.index === 1 &&
                (e.bar !== p.initial.bar ||
                  e.onset !== 0 ||
                  e.duration !==
                    Math.min(...c.rhythm.durations.map((d) => d.value)))))
          )
            errors.push("Invalid cross-phrase carry pattern.");
        }
      }
    }
    // Reconstruct pending carry independently, including the exact original attack.
    for (const [state, boundary, incoming] of [
      [p.initial, start, true],
      [p.final, end, false],
    ] as const) {
      const pending = state.pendingTies ?? [];
      const active = state.activeLifetimes ?? [];
      if (
        pending.length !== active.length ||
        new Set(pending.map((p) => p.head.id)).size !== pending.length
      )
        errors.push("Tie boundary state is incomplete.");
      for (const item of pending) {
        const n = item.head,
          l = n.lifetime,
          s = n.tie;
        const owned = active.find((a) => a.id === n.id);
        const source = incoming
          ? p.events.find((e) => e.id === item.nextSegmentId)?.notes?.[0]
          : p.events.flatMap(noteheads).find((h) => h.id === n.id);
        if (
          !t.crossPhrase ||
          item.configFingerprint !== generatorConfigFingerprint(c) ||
          item.nextSegmentId !== `${p.seed}-${state.bar}-0-${n.hand}` ||
          !owned ||
          !source ||
          source.pitch !== n.pitch ||
          source.midi !== n.midi ||
          source.finger !== n.finger ||
          source.hand !== n.hand ||
          !l ||
          !s ||
          s.pattern !== "carry" ||
          s.index !== 0 ||
          s.count !== 2 ||
          s.nextId !== item.nextSegmentId ||
          item.duration !==
            Math.min(...c.rhythm.durations.map((d) => d.value)) ||
          l.releaseTick !== boundary + item.duration ||
          owned.eventId !== s.attackEventId ||
          owned.positionId !== item.positionId ||
          owned.midi !== n.midi ||
          owned.finger !== n.finger ||
          owned.hand !== n.hand ||
          JSON.stringify(owned.lifetime) !== JSON.stringify(l) ||
          JSON.stringify(source.lifetime) !== JSON.stringify(l) ||
          (incoming
            ? source.tie?.previousId !== n.id
            : JSON.stringify(source) !== JSON.stringify(n))
        )
          errors.push("Invalid tie continuation boundary state.");
      }
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
