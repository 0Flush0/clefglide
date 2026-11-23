import {
  TPQ,
  noteheads,
  type ScoreEvent,
  type Notehead,
  type StreamState,
  type LifetimeNote,
} from "../score/model";
import { lifetimeNotes } from "../score/lifetimes";
import {
  generatorConfigFingerprint,
  type ValidatedGeneratorConfig,
} from "./config";
import { chooseWeighted } from "./sampling";
import { random } from "./random";
import { Note } from "tonal";
import { tieSegmentSchema } from "../score/ties";
import { noteLifetimeDataSchema } from "../score/lifetimeValidation";
import { diatonicIndex } from "./positionMaps";
import { writtenPitch } from "../score/pitch";
import { voiceEventId, voiceUnit } from "./voiceConfig";

/** Continuation identities are committed before the next phrase exists. */
export function carryHeadId(eventId: string, finger: number, primary: boolean) {
  return primary ? eventId : `${eventId}:hold:${finger}`;
}

/** Only notates already playable heads. Never guesses a fingering or moves a hand. */
export function planTies(
  events: ScoreEvent[],
  c: ValidatedGeneratorConfig,
  initial: StreamState,
  state: StreamState,
  seed: string,
) {
  const t = c.notation.ties;
  if (t === false) return;
  const voiceOf = (e: ScoreEvent) => e.voiceId ?? `${e.hand}:main`;
  const tick = (e: ScoreEvent) => e.bar * c.notation.beats * TPQ + e.onset;
  const end = state.bar * c.notation.beats * TPQ;
  const selected = (heads: Notehead[]) => {
    if (heads.length === 1) return heads;
    if (t.chordTones === "none") return [];
    if (t.chordTones === "all") return heads;
    const sorted = [...heads].sort((a, b) => a.midi - b.midi);
    const eligible =
      t.chordTones === "outer" ? [sorted[0], sorted.at(-1)!] : sorted;
    return [
      chooseWeighted(
        eligible.map((value) => ({ value, weight: 1 })),
        state,
      ),
    ];
  };
  const mirror = (e: ScoreEvent) => {
    e.lifetime = structuredClone(e.notes![0].lifetime);
    if (e.notes![0].tie) e.tie = structuredClone(e.notes![0].tie);
    else delete e.tie;
  };
  const link = (
    chain: { event: ScoreEvent; head: Notehead }[],
    pattern: "subdivide" | "connect",
  ) => {
    const first = chain[0],
      last = chain.at(-1)!;
    const lifetime = structuredClone(first.head.lifetime!);
    lifetime.releaseTick = tick(last.event) + last.event.duration;
    lifetime.durationTicks = lifetime.releaseTick - lifetime.onsetTick;
    lifetime.keyHold = { kind: "required", releaseTick: lifetime.releaseTick };
    chain.forEach(({ event, head }, index) => {
      head.lifetime = structuredClone(lifetime);
      head.tie = {
        lifetimeId: first.head.id,
        attackEventId: first.event.id,
        index,
        count: chain.length,
        pattern,
        ...(index ? { previousId: chain[index - 1].head.id } : {}),
        ...(index < chain.length - 1
          ? { nextId: chain[index + 1].head.id }
          : {}),
      };
      mirror(event);
    });
  };
  state.pendingTies = [];
  // Consume the committed grid without extending or rewriting an owned lifetime.
  for (const pending of initial.pendingTies ?? []) {
    let previous = pending.head;
    const release = previous.lifetime!.releaseTick;
    const voice = previous.lifetime!.voiceId;
    const primary =
      pending.nextSegmentId === voiceEventId(seed, initial.bar, 0, voice);
    for (const e of events.filter(
      (e) => voiceOf(e) === voice && tick(e) < release,
    )) {
      const n = noteheads(e).find((n) => n.finger === previous.finger)!;
      if (!n || n.midi !== previous.midi || n.pitch !== previous.pitch)
        throw new Error("A committed tie lost its occupied tone.");
      n.lifetime = structuredClone(previous.lifetime);
      n.tie = {
        ...previous.tie!,
        index: previous.tie!.index + 1,
        previousId: previous.id,
      };
      if (tick(e) + e.duration < release) {
        const nextTick = tick(e) + e.duration;
        const nextEvent = voiceEventId(
          seed,
          Math.floor(nextTick / (c.notation.beats * TPQ)),
          nextTick % (c.notation.beats * TPQ),
          voice,
        );
        n.tie.nextId = carryHeadId(nextEvent, n.finger, primary);
      } else delete n.tie.nextId;
      mirror(e);
      previous = n;
    }
    if (release > end)
      state.pendingTies.push({
        ...structuredClone(pending),
        head: structuredClone(previous),
        nextSegmentId: previous.tie!.nextId!,
      });
  }
  for (const voice of new Set(events.map(voiceOf))) {
    if (!t.voices.some((id) => id === voice)) continue;
    const timeline = events.filter((e) => voiceOf(e) === voice);
    for (let i = 0; i < timeline.length; i++) {
      const e = timeline[i],
        heads = noteheads(e);
      if (
        !heads.length ||
        heads.some((n) => n.tie) ||
        (heads.length > 1 && t.chordTones === "none")
      )
        continue;
      const candidates: { value: () => void; weight: number }[] = [];
      for (const pattern of t.patterns) {
        if (pattern.value === "subdivide") {
          const counts = t.segmentCounts.filter(
            (count) =>
              t.subdivisions.some((s) => s === e.duration / count) &&
              e.duration <= t.maxDurationTicks,
          );
          if (!counts.length) continue;
          candidates.push({
            weight: pattern.weight,
            value: () => {
              const count = chooseWeighted(
                counts.map((value) => ({ value, weight: 1 })),
                state,
              );
              const chosen = selected(heads);
              const segments = Array.from({ length: count }, (_, index) => {
                const part = structuredClone(e);
                part.onset += (index * e.duration) / count;
                part.duration /= count;
                if (index) {
                  part.id = `${e.id}:tie:${index}`;
                  part.action = "REPEAT_NOTE";
                  part.notes!.forEach((n, k) => {
                    n.id = k ? `${part.id}:${k}` : part.id;
                  });
                }
                part.notes!.forEach((n) => {
                  const onset = tick(part),
                    releaseTick = onset + part.duration;
                  n.lifetime = {
                    voiceId: voice,
                    onsetTick: onset,
                    releaseTick,
                    durationTicks: part.duration,
                    keyHold: { kind: "required", releaseTick },
                  };
                });
                mirror(part);
                return part;
              });
              for (const head of chosen) {
                const k = heads.indexOf(head);
                link(
                  segments.map((event) => ({ event, head: event.notes![k] })),
                  "subdivide",
                );
              }
              events.splice(events.indexOf(e), 1, ...segments);
            },
          });
        } else if (pattern.value === "connect") {
          const options = t.segmentCounts.flatMap((count) => {
            const run = timeline.slice(i, i + count);
            if (
              run.length !== count ||
              run.some(
                (x, j) =>
                  x.kind !== "note" ||
                  x.positionId !== e.positionId ||
                  !t.subdivisions.some((s) => s === x.duration) ||
                  noteheads(x).some((n) => n.tie) ||
                  (noteheads(x).length > 1 && t.chordTones === "none") ||
                  (j > 0 &&
                    (tick(x) !== tick(run[j - 1]) + run[j - 1].duration ||
                      (x.bar === run[j - 1].bar
                        ? !t.withinMeasure
                        : !t.crossMeasure))),
              ) ||
              tick(run.at(-1)!) + run.at(-1)!.duration - tick(e) >
                t.maxDurationTicks
            )
              return [];
            const common = heads.filter((n) =>
              run.every((x) => {
                const hs = noteheads(x);
                return (
                  hs.some(
                    (other) =>
                      other.midi === n.midi &&
                      other.pitch === n.pitch &&
                      other.finger === n.finger,
                  ) &&
                  (t.chordTones !== "outer" ||
                    n.midi === Math.min(...hs.map((h) => h.midi)) ||
                    n.midi === Math.max(...hs.map((h) => h.midi)))
                );
              }),
            );
            if (
              !common.length ||
              (t.chordTones === "all" &&
                run.some((x) => noteheads(x).length !== common.length))
            )
              return [];
            return [{ run, common }];
          });
          if (!options.length) continue;
          candidates.push({
            weight: pattern.weight,
            value: () => {
              const { run, common } = chooseWeighted(
                options.map((value) => ({ value, weight: 1 })),
                state,
              );
              const chosen =
                t.chordTones === "all"
                  ? common
                  : [
                      chooseWeighted(
                        common.map((value) => ({ value, weight: 1 })),
                        state,
                      ),
                    ];
              for (const n of chosen)
                link(
                  run.map((event) => ({
                    event,
                    head: noteheads(event).find((h) => h.midi === n.midi)!,
                  })),
                  "connect",
                );
            },
          });
        } else {
          const duration = voiceUnit(c, voice);
          const eligible = heads.filter(
            (n) =>
              Math.abs(diatonicIndex(n.pitch) - diatonicIndex(e.pitch)) <=
                c.melody.maxIntervalSteps &&
              (t.chordTones !== "outer" ||
                n.midi === Math.min(...heads.map((h) => h.midi)) ||
                n.midi === Math.max(...heads.map((h) => h.midi))),
          );
          if (
            !eligible.length ||
            tick(e) + e.duration !== end ||
            !t.subdivisions.some((s) => s === e.duration) ||
            !t.segmentCounts.some(
              (count) =>
                e.duration + (count - 1) * duration <= t.maxDurationTicks,
            )
          )
            continue;
          candidates.push({
            weight: pattern.weight,
            value: () => {
              const count = chooseWeighted(
                t.segmentCounts
                  .filter(
                    (count) =>
                      e.duration + (count - 1) * duration <= t.maxDurationTicks,
                  )
                  .map((value) => ({ value, weight: 1 })),
                state,
              );
              const chosen =
                t.chordTones === "all"
                  ? heads
                  : [
                      chooseWeighted(
                        eligible.map((value) => ({ value, weight: 1 })),
                        state,
                      ),
                    ];
              for (const [index, n] of chosen.entries()) {
                const nextSegmentId = carryHeadId(
                  voiceEventId(seed, state.bar, 0, voice),
                  n.finger,
                  index === 0,
                );
                const l = n.lifetime!;
                l.releaseTick += (count - 1) * duration;
                l.durationTicks += (count - 1) * duration;
                l.keyHold = { kind: "required", releaseTick: l.releaseTick };
                n.tie = {
                  lifetimeId: n.id,
                  attackEventId: e.id,
                  index: 0,
                  count,
                  pattern: "carry",
                  nextId: nextSegmentId,
                };
                mirror(e);
                state.pendingTies!.push({
                  configFingerprint: generatorConfigFingerprint(c),
                  head: structuredClone(n),
                  positionId: e.positionId,
                  nextSegmentId,
                  duration,
                });
              }
            },
          });
        }
      }
      if (candidates.length && random(state) < t.probability)
        chooseWeighted(candidates, state)();
    }
  }
  // A stable shared onset order, including newly split glyphs.
  events.sort(
    (a, b) =>
      tick(a) - tick(b) ||
      state.hands.findIndex((h) => h.hand === a.hand) -
        state.hands.findIndex((h) => h.hand === b.hand),
  );
  state.activeLifetimes = [
    ...(initial.activeLifetimes ?? []),
    ...lifetimeNotes(events),
  ].filter((n) => n.lifetime.releaseTick > end);
}

export function validateTieCarry(
  c: ValidatedGeneratorConfig,
  state: StreamState,
  seed: string,
) {
  const pending = state.pendingTies ?? [];
  if (c.notation.ties === false) {
    if (pending.length)
      throw new Error("Pending ties require the tie capability.");
    return;
  }
  const start = state.bar * c.notation.beats * TPQ;
  const expected: LifetimeNote[] = [];
  for (const p of pending) {
    const h = state.hands.find((h) => h.hand === p.head.hand);
    const n = p.head,
      l = n.lifetime;
    const voice = l?.voiceId ?? `${n.hand}:main`;
    const eventId = voiceEventId(seed, state.bar, 0, voice);
    const lastFingering = c.independentVoices
      ? state.independentVoices?.voices[voice]?.lastFingering
      : h?.lastFingering;
    if (
      !c.notation.ties.crossPhrase ||
      p.configFingerprint !== generatorConfigFingerprint(c) ||
      !h ||
      p.positionId !== h.id ||
      !lastFingering?.some((f) => f.midi === n.midi && f.finger === n.finger) ||
      Note.midi(n.pitch) !== n.midi ||
      (n.written !== undefined &&
        JSON.stringify(n.written) !==
          JSON.stringify(writtenPitch(n.pitch, c.notation.key))) ||
      (h.fingerToMidi[n.finger - 1] !== n.midi &&
        !h.pitchOptions?.[n.finger - 1]?.includes(n.pitch)) ||
      !tieSegmentSchema.safeParse(n.tie).success ||
      !noteLifetimeDataSchema.safeParse(l).success ||
      n.tie?.pattern !== "carry" ||
      n.tie.index >= n.tie.count - 1 ||
      !c.notation.ties.segmentCounts.includes(n.tie.count) ||
      n.tie.nextId !== p.nextSegmentId ||
      ![eventId, `${eventId}:hold:${n.finger}`].includes(p.nextSegmentId) ||
      p.duration !== voiceUnit(c, voice) ||
      !l ||
      l.onsetTick >= start ||
      l.releaseTick !== start + (n.tie.count - n.tie.index - 1) * p.duration ||
      l.durationTicks !== l.releaseTick - l.onsetTick ||
      l.durationTicks > c.notation.ties.maxDurationTicks ||
      l.keyHold.kind !== "required" ||
      l.keyHold.releaseTick !== l.releaseTick
    )
      throw new Error("Invalid or incompatible cross-phrase tie state.");
    expected.push({
      id: n.tie.lifetimeId,
      eventId: n.tie.attackEventId,
      midi: n.midi,
      hand: n.hand,
      finger: n.finger,
      positionId: p.positionId,
      lifetime: structuredClone(l),
    });
  }
  const canonical = (ns: LifetimeNote[]) =>
    JSON.stringify([...ns].sort((a, b) => a.id.localeCompare(b.id)));
  if (
    new Set(pending.map((p) => `${p.head.hand}:${p.head.finger}`)).size !==
      pending.length ||
    canonical(expected) !== canonical(state.activeLifetimes ?? [])
  )
    throw new Error("Cross-phrase ties and active lifetimes disagree.");
}
