import { Note } from "tonal";
import {
  TPQ,
  type HandState,
  type MovementPlan,
  type Phrase,
  type ScoreEvent,
} from "../score/model";
import {
  generatorConfigFingerprint,
  type ValidatedGeneratorConfig,
} from "./config";

type Plan = Omit<Phrase, "settings">;
const degree = (pitch: string) => {
  const n = Note.get(pitch);
  return (n.oct ?? -100) * 7 + "CDEFGAB".indexOf(n.letter);
};

/** Independent reconstruction of contiguous silence, including certified chunk tail. */
export function hasMovementPreparation(
  p: Plan,
  c: ValidatedGeneratorConfig,
  m: Pick<MovementPlan, "hand" | "cueTick" | "landingTick">,
) {
  const start = p.initial.bar * c.notation.beats * TPQ;
  let cursor = m.cueTick;
  if (cursor < start) {
    const reserved = p.initial.wideLeapPreparation;
    if (
      !reserved ||
      reserved.configFingerprint !== generatorConfigFingerprint(c) ||
      reserved.cueTick !== cursor ||
      reserved.landingTick !== m.landingTick ||
      m.landingTick < start
    )
      return false;
    cursor = start;
  }
  for (const e of p.events
    .filter((e) => e.hand === m.hand)
    .sort((a, b) => a.bar - b.bar || a.onset - b.onset)) {
    const tick = e.bar * c.notation.beats * TPQ + e.onset;
    if (tick < cursor || tick >= m.landingTick) continue;
    if (tick !== cursor || e.kind !== "rest") return false;
    cursor += e.duration;
  }
  return cursor === m.landingTick;
}

export function validateWideLanding(
  p: Plan,
  c: ValidatedGeneratorConfig,
  m: MovementPlan,
  from: HandState,
  e: ScoreEvent,
  lastPitch?: string,
  lastEnd?: number,
) {
  const w = c.wideLeaps;
  if (w.kind !== "lifted-wide" || w.probability === 0) return false;
  const to = p.positions.find(
    (pos) => pos.hand === m.hand && pos.id === m.toPositionId,
  );
  if (!to) return false;
  const distance = degree(to.pitches[0]) - degree(from.pitches[0]);
  const abs = Math.abs(distance);
  return (
    Number.isInteger(m.distance) &&
    m.distance === distance &&
    abs >= w.minDistanceSteps &&
    abs <= w.maxDistanceSteps &&
    w.eligibleBars.includes(e.bar - p.initial.bar) &&
    e.onset === 0 &&
    e.kind === "note" &&
    (e.notes?.length ?? 1) === 1 &&
    !e.fingering &&
    w.landingFingers.includes(e.finger) &&
    to.fingerToMidi[e.finger - 1] === e.midi &&
    to.pitches.includes(e.pitch) &&
    !from.pitches.includes(e.pitch) &&
    (w.targetSelection !== "higher" || distance > 0) &&
    (w.targetSelection !== "lower" || distance < 0) &&
    lastPitch !== undefined &&
    Math.abs(degree(e.pitch) - degree(lastPitch)) <=
      w.maxLandingIntervalSteps &&
    m.cueTick === m.landingTick - w.preparationBeats * TPQ &&
    w.preparationBeats >=
      w.minimumPreparationBeats +
        (abs / 7) * w.additionalPreparationBeatsPerOctave &&
    lastEnd !== undefined &&
    lastEnd <= m.cueTick &&
    hasMovementPreparation(p, c, m)
  );
}

/** Check the whole swept envelope against the other hand throughout preparation. */
export function validateWideSweeps(
  p: Plan,
  c: ValidatedGeneratorConfig,
): string[] {
  const errors: string[] = [];
  if (c.hands.active !== "both") return errors;
  const extent = (h: HandState) => [
    Math.min(...h.fingerToMidi),
    Math.max(...h.fingerToMidi),
  ];
  for (const m of p.movements.filter(
    (m) => m.technique === "lifted-wide-leap",
  )) {
    const from = p.positions.find(
      (h) => h.hand === m.hand && h.id === m.fromPositionId,
    );
    const to = p.positions.find(
      (h) => h.hand === m.hand && h.id === m.toPositionId,
    );
    if (!from || !to) continue;
    const low = Math.min(extent(from)[0], extent(to)[0]),
      high = Math.max(extent(from)[1], extent(to)[1]);
    let other = p.initial.hands.find((h) => h.hand !== m.hand);
    const check = (h?: HandState) => {
      if (
        !h ||
        (m.hand === "right" ? low <= extent(h)[1] : high >= extent(h)[0])
      )
        errors.push("Wide-leap travel envelopes collide with the other hand.");
    };
    for (const o of [...p.movements]
      .filter((o) => o.hand !== m.hand)
      .sort((a, b) => a.landingTick - b.landingTick)) {
      if (o.landingTick < m.cueTick) {
        other = p.positions.find(
          (h) => h.hand === o.hand && h.id === o.toPositionId,
        );
      }
    }
    check(other);
    for (const o of p.movements.filter(
      (o) =>
        o.hand !== m.hand &&
        o.landingTick >= m.cueTick &&
        o.cueTick <= m.landingTick,
    )) {
      check(
        p.positions.find((h) => h.hand === o.hand && h.id === o.fromPositionId),
      );
      check(
        p.positions.find((h) => h.hand === o.hand && h.id === o.toPositionId),
      );
    }
  }
  return errors;
}

export function validateLeapReservation(p: Plan, c: ValidatedGeneratorConfig) {
  const w = c.wideLeaps;
  const initial = p.initial.wideLeapPreparation;
  if (initial) {
    const start = p.initial.bar * c.notation.beats * TPQ;
    const expectedLanding =
      w.kind === "lifted-wide"
        ? start + Math.min(...w.eligibleBars) * c.notation.beats * TPQ
        : start;
    if (
      w.kind !== "lifted-wide" ||
      w.probability === 0 ||
      p.initial.bar === 0 ||
      initial.configFingerprint !== generatorConfigFingerprint(c) ||
      initial.landingTick !== expectedLanding ||
      initial.cueTick !== expectedLanding - w.preparationBeats * TPQ ||
      initial.cueTick >= start ||
      p.initial.hands.some(
        (h) => h.lastNoteEnd === undefined || h.lastNoteEnd > initial.cueTick,
      )
    )
      return ["Invalid incoming wide-leap preparation state."];
  }
  const end = p.final.bar * c.notation.beats * TPQ;
  const landing =
    w.kind === "lifted-wide"
      ? end + Math.min(...w.eligibleBars) * c.notation.beats * TPQ
      : end;
  const enabled =
    w.kind === "lifted-wide" &&
    w.probability > 0 &&
    landing - w.preparationBeats * TPQ < end;
  const final = p.final.wideLeapPreparation;
  if (!enabled) return final ? ["Unexpected wide-leap preparation state."] : [];
  const cue = landing - w.preparationBeats * TPQ;
  if (
    !final ||
    final.cueTick !== cue ||
    final.landingTick !== landing ||
    final.configFingerprint !== generatorConfigFingerprint(c)
  )
    return ["Missing or invalid wide-leap preparation state."];
  for (const h of p.final.hands) {
    if (
      h.lastNoteEnd === undefined ||
      h.lastNoteEnd > cue ||
      !hasMovementPreparation(p, c, {
        hand: h.hand,
        cueTick: cue,
        landingTick: end,
      })
    )
      return ["Wide-leap boundary preparation is not silent."];
  }
  return [];
}
