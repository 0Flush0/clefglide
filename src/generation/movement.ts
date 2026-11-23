import { Note } from "tonal";
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
import { movementSeparated, planWideLeaps } from "./wideLeaps";
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
  acceptsLanding: (
    from: HandState,
    to: HandState,
    pitch: string,
  ) => boolean = () => true,
) {
  const movement = c.movement;
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
  );
  const usePreparation =
    movement.kind === "rested-reposition" && movement.probability > 0;
  if (
    movement.kind === "rested-reposition" &&
    movement.eligibleBars.includes(b) &&
    usePreparation
  ) {
    for (let hi = 0; hi < state.hands.length; hi++) {
      const from = state.hands[hi];
      if (landings.has(from.hand)) continue;
      if (random(state) >= movement.probability || !from.lastPitch) continue;
      const other = state.hands.find((h) => h.hand !== from.hand);
      // Only move when the old position cannot reach the landing pitch.
      const options = available.get(from.hand)!.flatMap((to) => {
        const distance =
          diatonicIndex(to.pitches[0]) - diatonicIndex(from.pitches[0]);
        if (
          spacingSignature(to) !== spacingSignature(from) ||
          !distance ||
          Math.abs(distance) > movement.maxDistanceSteps ||
          (other && !separated(to, other)) ||
          (c.wideLeaps.kind === "lifted-wide" &&
            c.wideLeaps.probability > 0 &&
            !movementSeparated(
              to,
              state,
              positions,
              movements,
              bar * c.notation.beats * TPQ,
            ))
        )
          return [];
        return to.pitches.flatMap((pitch, index) => {
          const leap = Math.abs(
            diatonicIndex(pitch) - diatonicIndex(from.lastPitch!),
          );
          return !from.pitches.includes(pitch) &&
            acceptsLanding(from, to, pitch) &&
            leap <= c.melody.maxIntervalSteps
            ? [{ to, index, distance }]
            : [];
        });
      });
      if (!options.length) continue;
      // Apply configured distance mass only after hard movement/landing checks.
      const weights = options.map(
        (o) =>
          movement.distanceWeights[Math.abs(o.distance) - 1] *
          (c.coverage.kind === "guided"
            ? coverageMoveWeight(
                state.coverage![from.hand]!,
                positionCenter(from),
                positionCenter(o.to),
                c.coverage,
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
      const tick = bar * c.notation.beats * TPQ,
        pitch = to.pitches[index],
        midi = Note.midi(pitch)!;
      movements.push({
        id: `${seed}-move-${bar}-${from.hand}`,
        hand: from.hand,
        technique: "lift-and-reposition",
        fromPositionId: from.id,
        toPositionId: to.id,
        cueTick:
          tick -
          Math.max(
            movement.preparationBeats,
            c.wideLeaps.kind === "lifted-wide" &&
              c.wideLeaps.probability > 0 &&
              c.wideLeaps.eligibleBars.includes(b)
              ? c.wideLeaps.preparationBeats
              : 0,
          ) *
            TPQ,
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
  }

  return landings;
}
