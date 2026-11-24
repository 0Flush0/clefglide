import { Note } from "tonal";
import {
  TPQ,
  type HandState,
  type Hand,
  type MovementPlan,
  type Phrase,
  type ScoreEvent,
  type StreamState,
} from "../score/model";
import {
  generatorConfigFingerprint,
  type ValidatedGeneratorConfig,
} from "./config";
import { oppositeSweepEdge } from "./movementEnvelope";
import { voiceSpecs } from "./voiceConfig";

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
  if (c.independentVoices) {
    const reserved = p.initial.independentVoices?.leapPreparations?.[m.hand];
    if (
      m.cueTick < start &&
      (!reserved ||
        reserved.cueTick !== m.cueTick ||
        reserved.landingTick !== m.landingTick)
    )
      return false;
    return voiceRests(
      p,
      c,
      m.hand,
      Math.max(start, m.cueTick),
      m.landingTick,
      m.cueTick >= start,
    );
  }
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

export function voiceRests(
  p: Plan,
  c: ValidatedGeneratorConfig,
  hand: Hand,
  from: number,
  to: number,
  exactCue: boolean,
) {
  const tick = (e: ScoreEvent) => e.bar * c.notation.beats * TPQ + e.onset;
  return voiceSpecs(c)
    .filter((v) => v.hand === hand)
    .every(({ id }) => {
      let cursor = from;
      for (const e of p.events.filter((e) => e.voiceId === id)) {
        const onset = tick(e);
        if (onset >= to || onset + e.duration <= from) continue;
        if (
          e.kind !== "rest" ||
          Math.max(from, onset) !== cursor ||
          (exactCue && id.endsWith(":main") && onset < from)
        )
          return false;
        cursor = Math.min(to, onset + e.duration);
      }
      return cursor === to;
    });
}

export function validVoiceLeapBoundary(
  state: StreamState,
  c: ValidatedGeneratorConfig,
) {
  const wide = c.wideLeaps;
  const measure = c.notation.beats * TPQ;
  const boundary = state.bar * measure;
  return Object.entries(state.independentVoices?.leapPreparations ?? {}).every(
    ([hand, window]) =>
      !(
        !window ||
        !state.hands.some((h) => h.hand === hand) ||
        wide.kind !== "lifted-wide" ||
        wide.probability === 0 ||
        boundary === 0 ||
        window.cueTick < 0 ||
        window.cueTick >= boundary ||
        window.landingTick < boundary ||
        window.cueTick !== window.landingTick - wide.preparationBeats * TPQ ||
        !wide.eligibleBars.some(
          (bar) => window.landingTick === boundary + bar * measure,
        ) ||
        (state.hands.length === 2
          ? !Number.isInteger(window.oppositeEdge) ||
            window.oppositeEdge! < 21 ||
            window.oppositeEdge! > 108
          : window.oppositeEdge !== undefined) ||
        (state.activeLifetimes ?? []).some(
          (n) =>
            n.hand === hand &&
            n.lifetime.onsetTick < window.landingTick &&
            n.lifetime.keyHold.kind === "required" &&
            n.lifetime.keyHold.releaseTick > window.cueTick,
        )
      ),
  );
}

export function validateVoiceLeapReservations(
  p: Plan,
  c: ValidatedGeneratorConfig,
) {
  const measure = c.notation.beats * TPQ;
  const start = p.initial.bar * measure;
  const end = p.final.bar * measure;
  const errors: string[] = [];
  for (const [state, outgoing] of [
    [p.initial, false],
    [p.final, true],
  ] as const) {
    if (!validVoiceLeapBoundary(state, c)) {
      errors.push("Invalid independent wide-leap boundary preparation.");
      continue;
    }
    for (const [hand, window] of Object.entries(
      state.independentVoices?.leapPreparations ?? {},
    )) {
      const h = hand as Hand;
      if (
        outgoing
          ? !voiceRests(p, c, h, window.cueTick, end, true) ||
            window.oppositeEdge !==
              oppositeSweepEdge(
                h,
                p.initial.hands,
                p.positions,
                p.movements,
                window.cueTick,
                end,
              )
          : !voiceRests(
              p,
              c,
              h,
              start,
              Math.min(window.landingTick, end),
              false,
            )
      )
        errors.push(
          "Independent wide-leap preparation differs from the score.",
        );
    }
  }
  return errors;
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
    (c.independentVoices || (lastEnd !== undefined && lastEnd <= m.cueTick)) &&
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
  const position = (hand: Hand, id: string) =>
    p.positions.find((h) => h.hand === hand && h.id === id);
  for (const move of p.movements) {
    if (move.technique !== "lifted-wide-leap") continue;
    const from = position(move.hand, move.fromPositionId);
    const to = position(move.hand, move.toPositionId);
    const other = p.initial.hands.find((h) => h.hand !== move.hand);
    if (!from || !to || !other) continue;
    const own = [...from.fingerToMidi, ...to.fingerToMidi];
    const overlaps = (midis: number[]) =>
      move.hand === "right"
        ? Math.min(...own) <= Math.max(...midis)
        : Math.max(...own) >= Math.min(...midis);
    const opposing = p.movements.filter((m) => m.hand === other.hand);
    const prior = opposing
      .filter((m) => m.landingTick < move.cueTick)
      .sort((a, b) => a.landingTick - b.landingTick)
      .at(-1);
    const active = prior ? position(other.hand, prior.toPositionId) : other;
    const swept = opposing
      .filter(
        (m) => m.landingTick >= move.cueTick && m.cueTick <= move.landingTick,
      )
      .flatMap((m) => [m.fromPositionId, m.toPositionId])
      .map((id) => position(other.hand, id));
    const carried = p.initial.independentVoices?.leapPreparations?.[move.hand];
    if (
      [active, ...swept].some((h) => !h || overlaps(h.fingerToMidi)) ||
      (carried?.landingTick === move.landingTick &&
        carried.oppositeEdge !== undefined &&
        overlaps([carried.oppositeEdge]))
    )
      errors.push("Wide-leap travel envelopes collide with the other hand.");
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
