import { Note } from "tonal";
import {
  TPQ,
  type HandState,
  type Hand,
  type MovementPlan,
  type StreamState,
  type VoiceLeapPreparation,
} from "../score/model";
import {
  generatorConfigFingerprint,
  type ValidatedGeneratorConfig,
} from "./config";
import type { MovementDiagnostic } from "./model";
import {
  diatonicIndex,
  positionCenter,
  separated,
  spacingSignature,
} from "./positionMaps";
import { coverageMoveWeight } from "./rangeCoverage";
import { clearsOppositeEdge, oppositeSweepEdge } from "./movementEnvelope";
import { chooseWeighted } from "./sampling";
import { random } from "./random";

/** Cyclic preparation windows also reserve the tail before next chunk's bar zero. */
export function wideRestBeats(c: ValidatedGeneratorConfig, bar: number) {
  const w = c.wideLeaps;
  if (w.kind === "disabled" || w.probability === 0) return 0;
  const beats = c.notation.beats;
  return Math.max(
    0,
    ...w.eligibleBars.map((landing) => {
      const next = (landing <= bar ? landing + 4 : landing) * beats;
      return Math.min(
        beats,
        Math.max(0, (bar + 1) * beats - (next - w.preparationBeats)),
      );
    }),
  );
}

export function nextLeapPreparation(
  c: ValidatedGeneratorConfig,
  nextBar: number,
) {
  const w = c.wideLeaps;
  if (w.kind === "disabled" || w.probability === 0) return undefined;
  const end = nextBar * c.notation.beats * TPQ;
  const landingTick =
    end + Math.min(...w.eligibleBars) * c.notation.beats * TPQ;
  const cueTick = landingTick - w.preparationBeats * TPQ;
  return cueTick < end
    ? { configFingerprint: generatorConfigFingerprint(c), cueTick, landingTick }
    : undefined;
}

/** All possible landings, before context-specific preparation and collision checks. */
export function wideLandingOptions(
  c: ValidatedGeneratorConfig,
  from: HandState,
  destinations: HandState[],
) {
  const w = c.wideLeaps;
  if (w.kind === "disabled") return [];
  return destinations.flatMap((to) => {
    const distance =
      diatonicIndex(to.pitches[0]) - diatonicIndex(from.pitches[0]);
    const absolute = Math.abs(distance);
    if (
      spacingSignature(to) !== spacingSignature(from) ||
      absolute < w.minDistanceSteps ||
      absolute > w.maxDistanceSteps ||
      w.minimumPreparationBeats +
        (absolute / 7) * w.additionalPreparationBeatsPerOctave >
        w.preparationBeats ||
      (w.targetSelection === "higher" && distance < 0) ||
      (w.targetSelection === "lower" && distance > 0)
    )
      return [];
    return to.pitches.flatMap((pitch, index) => {
      const finger = to.fingerToMidi.indexOf(Note.midi(pitch)!) + 1;
      return !from.pitches.includes(pitch) &&
        w.landingFingers.includes(finger) &&
        (!from.lastPitch ||
          Math.abs(diatonicIndex(pitch) - diatonicIndex(from.lastPitch)) <=
            w.maxLandingIntervalSteps)
        ? [{ to, index, distance }]
        : [];
    });
  });
}

/** Sweeps stay on each hand's own side of every other occupied/swept position. */
export function movementSeparated(
  to: HandState,
  state: StreamState,
  positions: HandState[],
  movements: MovementPlan[],
  tick: number,
) {
  const others = state.hands.filter((h) => h.hand !== to.hand);
  for (const m of movements.filter(
    (m) => m.hand !== to.hand && m.landingTick === tick,
  )) {
    const from = positions.find(
      (p) => p.hand === m.hand && p.id === m.fromPositionId,
    );
    if (from) others.push(from);
  }
  return others.every((other) => separated(to, other));
}

export type AcceptsLanding = (
  from: HandState,
  to: HandState,
  pitch: string,
  technique: MovementPlan["technique"],
  cue: number,
) => boolean;

export type VoiceLeapWindow = (
  hand: Hand,
  landing: number,
) => VoiceLeapPreparation | undefined;

export function planWideLeaps(
  c: ValidatedGeneratorConfig,
  seed: string,
  state: StreamState,
  available: Map<Hand, HandState[]>,
  b: number,
  positions: HandState[],
  movements: MovementPlan[],
  diagnostics: MovementDiagnostic[],
  acceptsLanding: AcceptsLanding,
  voiceWindow?: VoiceLeapWindow,
) {
  const w = c.wideLeaps;
  const landings = new Map<Hand, number>();
  if (
    w.kind === "disabled" ||
    w.probability === 0 ||
    !w.eligibleBars.includes(b)
  )
    return landings;
  const tick = (state.bar + b) * c.notation.beats * TPQ;
  const cue = tick - w.preparationBeats * TPQ;
  for (let hi = 0; hi < state.hands.length; hi++) {
    const from = state.hands[hi];
    const window = voiceWindow?.(from.hand, tick);
    if (voiceWindow ? !window : random(state) >= w.probability) continue;
    const prepared = voiceWindow
      ? window?.cueTick === cue
      : cue >= state.bar * c.notation.beats * TPQ ||
        (state.wideLeapPreparation?.landingTick === tick &&
          state.wideLeapPreparation.cueTick === cue &&
          state.wideLeapPreparation.configFingerprint ===
            generatorConfigFingerprint(c));
    if (
      !prepared ||
      from.lastPitch === undefined ||
      from.lastNoteEnd === undefined ||
      from.lastNoteEnd > cue
    ) {
      diagnostics.push({
        hand: from.hand,
        landingTick: tick,
        reason: "no-preparation",
      });
      continue;
    }
    const edge = oppositeSweepEdge(
      from.hand,
      positions.slice(0, state.hands.length),
      positions,
      movements,
      cue,
      tick,
    );
    let options = wideLandingOptions(c, from, available.get(from.hand)!).filter(
      ({ to, index }) =>
        movementSeparated(to, state, positions, movements, tick) &&
        clearsOppositeEdge(from, edge) &&
        clearsOppositeEdge(to, edge) &&
        clearsOppositeEdge(from, window?.oppositeEdge) &&
        clearsOppositeEdge(to, window?.oppositeEdge) &&
        acceptsLanding(from, to, to.pitches[index], "lifted-wide-leap", cue),
    );
    if (!options.length) {
      diagnostics.push({
        hand: from.hand,
        landingTick: tick,
        reason: "no-legal-target",
      });
      continue;
    }
    if (w.targetSelection === "range-edges") {
      const degrees = options.map((o) => diatonicIndex(o.to.pitches[0]));
      const low = Math.min(...degrees),
        high = Math.max(...degrees);
      options = options.filter((o) =>
        [low, high].includes(diatonicIndex(o.to.pitches[0])),
      );
    }
    const counts = new Map<string, number>();
    options.forEach((o) => counts.set(o.to.id, (counts.get(o.to.id) ?? 0) + 1));
    const { to, index, distance } = chooseWeighted(
      options.map((o) => ({
        value: o,
        weight:
          Math.abs(o.distance) ** w.distanceWeightExponent /
          (w.landingSelection === "uniform-positions"
            ? counts.get(o.to.id)!
            : 1),
      })),
      state,
    );
    if (
      c.coverage.kind === "guided" &&
      random(state) >=
        coverageMoveWeight(
          state.coverage![from.hand]!,
          positionCenter(from),
          positionCenter(to),
          c.coverage,
        )
    )
      continue;
    const midi = Note.midi(to.pitches[index])!;
    movements.push({
      id: `${seed}-wide-${state.bar + b}-${from.hand}`,
      hand: from.hand,
      technique: "lifted-wide-leap",
      fromPositionId: from.id,
      toPositionId: to.id,
      cueTick: cue,
      landingTick: tick,
      landingNoteId: `${seed}-${state.bar + b}-0-${from.hand}`,
      landingMidi: midi,
      landingFinger: to.fingerToMidi.indexOf(midi) + 1,
      distance,
    });
    state.hands[hi] = {
      ...to,
      lastIndex: index,
      lastPitch: from.lastPitch,
      lastNoteEnd: from.lastNoteEnd,
    };
    positions.push(structuredClone(to));
    landings.set(from.hand, index);
  }
  return landings;
}
