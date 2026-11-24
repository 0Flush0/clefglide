import { Note } from "tonal";
import { activeHands, configForHand } from "./config/handParameters";
import {
  TPQ,
  type Hand,
  type HandState,
  type MovementPlan,
  type StreamState,
} from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import {
  diatonicIndex,
  spacingSignature,
  separated,
  positionCenter,
} from "./positionMaps";
import { coverageMoveWeight } from "./rangeCoverage";
import { random } from "./random";
import {
  movementSeparated,
  planWideLeaps,
  type AcceptsLanding,
  type VoiceLeapWindow,
} from "./wideLeaps";
import { clearsOppositeEdge, oppositeSweepEdge } from "./movementEnvelope";
import type { MovementDiagnostic } from "./model";

/** Plan only explicit, prepared relocations; unavailable opportunities stay put. */
export function planMovements(
  c: ValidatedGeneratorConfig,
  seed: string,
  state: StreamState,
  available: Map<Hand, HandState[]>,
  b: number,
  positions: HandState[],
  movements: MovementPlan[],
  diagnostics: MovementDiagnostic[] = [],
  acceptsLanding: AcceptsLanding = () => true,
  voiceWindow?: VoiceLeapWindow,
) {
  const bar = state.bar + b;
  const landings = planWideLeaps(
    c,
    seed,
    state,
    available,
    b,
    positions,
    movements,
    diagnostics,
    acceptsLanding,
    voiceWindow,
  );
  const wideEnabled = activeHands(c).some((hand) => {
    const wide = configForHand(c, hand).wideLeaps;
    return wide.kind === "lifted-wide" && wide.probability > 0;
  });
  for (let hi = 0; hi < state.hands.length; hi++) {
    const from = state.hands[hi];
    const local = configForHand(c, from.hand);
    const movement = local.movement;
    if (
      movement.kind !== "rested-reposition" ||
      movement.probability === 0 ||
      !movement.eligibleBars.includes(b)
    )
      continue;
    if (landings.has(from.hand)) continue;
    if (random(state) >= movement.probability || !from.lastPitch) continue;
    const tick = bar * c.notation.beats * TPQ;
    const cue =
      tick -
      Math.max(
        movement.preparationBeats,
        !voiceWindow &&
          c.wideLeaps.kind === "lifted-wide" &&
          c.wideLeaps.probability > 0 &&
          c.wideLeaps.eligibleBars.includes(b)
          ? c.wideLeaps.preparationBeats
          : 0,
      ) *
        TPQ;
    const other = state.hands.find((h) => h.hand !== from.hand);
    const edge = wideEnabled
      ? oppositeSweepEdge(
          from.hand,
          positions.slice(0, state.hands.length),
          positions,
          movements,
          cue,
          tick,
        )
      : undefined;
    if (!clearsOppositeEdge(from, edge)) continue;
    // Only move when the old position cannot reach the landing pitch.
    const options = available.get(from.hand)!.flatMap((to) => {
      const distance =
        diatonicIndex(to.pitches[0]) - diatonicIndex(from.pitches[0]);
      if (
        spacingSignature(to) !== spacingSignature(from) ||
        !distance ||
        Math.abs(distance) > movement.maxDistanceSteps ||
        (other && !separated(to, other)) ||
        (wideEnabled &&
          !movementSeparated(to, state, positions, movements, tick)) ||
        !clearsOppositeEdge(to, edge)
      )
        return [];
      return to.pitches.flatMap((pitch, index) => {
        const leap = Math.abs(
          diatonicIndex(pitch) - diatonicIndex(from.lastPitch!),
        );
        return !from.pitches.includes(pitch) &&
          acceptsLanding(from, to, pitch, "lift-and-reposition", cue) &&
          leap <= local.melody.maxIntervalSteps
          ? [{ to, index, distance }]
          : [];
      });
    });
    if (!options.length) continue;
    // Apply configured distance mass only after hard movement/landing checks.
    const weights = options.map(
      (o) =>
        movement.distanceWeights[Math.abs(o.distance) - 1] *
        (local.coverage.kind === "guided"
          ? coverageMoveWeight(
              state.coverage![from.hand]!,
              positionCenter(from),
              positionCenter(o.to),
              local.coverage,
            )
          : 1),
    );
    // Unused weight defers the relocation. This matters when the landing
    // constraints permit only an away-from-target direction at this rest.
    let draw =
      random(state) *
      options.reduce(
        (sum, o) => sum + movement.distanceWeights[Math.abs(o.distance) - 1],
        0,
      );
    const selected = options.findIndex((_, i) => (draw -= weights[i]) < 0);
    if (selected < 0) continue;
    const { to, index, distance } = options[selected];
    const pitch = to.pitches[index],
      midi = Note.midi(pitch)!;
    movements.push({
      id: `${seed}-move-${bar}-${from.hand}`,
      hand: from.hand,
      technique: "lift-and-reposition",
      fromPositionId: from.id,
      toPositionId: to.id,
      cueTick: cue,
      landingTick: tick,
      landingNoteId: `${seed}-${bar}-0-${from.hand}`,
      landingMidi: midi,
      landingFinger: to.fingerToMidi.indexOf(midi) + 1,
      distance,
    });
    state.hands[hi] = {
      ...to,
      lastIndex: index,
      lastPitch: from.lastPitch,
      lastNoteEnd: from.lastNoteEnd,
      resolutionPitch: undefined,
      lastFingering: undefined,
    };
    positions.push(structuredClone(to));
    landings.set(from.hand, index);
  }

  return landings;
}
