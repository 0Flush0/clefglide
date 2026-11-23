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
  // The preceding phrase committed both the release target and the exact next head ID.
  for (const pending of initial.pendingTies ?? []) {
    const e = events.find((e) => e.id === pending.nextSegmentId)!;
    const n = e.notes![0];
    n.lifetime = structuredClone(pending.head.lifetime);
    n.tie = { ...pending.head.tie!, index: 1, previousId: pending.head.id };
    delete n.tie.nextId;
    mirror(e);
  }
  state.pendingTies = [];
  for (const hand of state.hands) {
    const voice = `${hand.hand}:main` as "right:main" | "left:main";
    if (!t.voices.includes(voice)) continue;
    const timeline = events.filter((e) => e.hand === hand.hand);
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
          const duration = Math.min(...c.rhythm.durations.map((d) => d.value));
          if (
            heads.length !== 1 ||
            tick(e) + e.duration !== end ||
            !t.subdivisions.some((s) => s === e.duration) ||
            e.duration + duration > t.maxDurationTicks
          )
            continue;
          candidates.push({
            weight: pattern.weight,
            value: () => {
              const n = heads[0],
                nextSegmentId = `${seed}-${state.bar}-0-${hand.hand}`;
              const l = n.lifetime!;
              l.releaseTick += duration;
              l.durationTicks += duration;
              l.keyHold = { kind: "required", releaseTick: l.releaseTick };
              n.tie = {
                lifetimeId: n.id,
                attackEventId: e.id,
                index: 0,
                count: 2,
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
    if (
      !c.notation.ties.crossPhrase ||
      p.configFingerprint !== generatorConfigFingerprint(c) ||
      !h ||
      p.positionId !== h.id ||
      h.lastPitch !== n.pitch ||
      h.lastFingering?.length !== 1 ||
      h.fingerToMidi[n.finger - 1] !== n.midi ||
      n.tie?.pattern !== "carry" ||
      n.tie.index !== 0 ||
      n.tie.count !== 2 ||
      n.tie.lifetimeId !== n.id ||
      n.tie.attackEventId !== n.id ||
      n.tie.nextId !== p.nextSegmentId ||
      p.nextSegmentId !== `${seed}-${state.bar}-0-${n.hand}` ||
      p.duration !== Math.min(...c.rhythm.durations.map((d) => d.value)) ||
      !l ||
      l.onsetTick >= start ||
      l.releaseTick !== start + p.duration ||
      l.durationTicks !== l.releaseTick - l.onsetTick ||
      l.durationTicks > c.notation.ties.maxDurationTicks ||
      l.keyHold.kind !== "required" ||
      l.keyHold.releaseTick !== l.releaseTick
    )
      throw new Error("Invalid or incompatible cross-phrase tie state.");
    expected.push({
      id: n.id,
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
    new Set(pending.map((p) => p.head.hand)).size !== pending.length ||
    canonical(expected) !== canonical(state.activeLifetimes ?? [])
  )
    throw new Error("Cross-phrase ties and active lifetimes disagree.");
}
