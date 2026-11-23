import { Chord, Note, Scale } from "tonal";
import {
  TPQ,
  type Hand,
  type HandState,
  type ScoreEvent,
} from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import {
  positionsForConfig,
  separated,
  spacingSignature,
  diatonicIndex,
} from "./positionMaps";
import { chordCandidatesForConfig } from "./voicings";
import { wideLandingOptions } from "./wideLeaps";

/** Context-dependent feasibility is separate from structural configuration validity.
 * Chord/movement probabilities are opportunities, not promises that every shape fits. */
export function inspectGeneratorFeasibility(c: ValidatedGeneratorConfig) {
  const hands: Hand[] =
    c.hands.active === "both" ? ["right", "left"] : [c.hands.active];
  const lists = hands.map((hand) => positionsForConfig(c, hand));
  const compatible = lists.map((positions, i) =>
    hands.length === 1
      ? positions
      : positions.filter((p) =>
          lists[1 - i].some((other) => separated(p, other)),
        ),
  );
  const errors: string[] = [],
    warnings: string[] = [];
  for (let i = 0; i < hands.length; i++) {
    if (!lists[i].length)
      errors.push(
        `${hands[i]} hand: the range needs five consecutive notes in ${c.notation.key} major; widen it or change the key.`,
      );
    else if (
      c.fingering.variablePositionProbability > 0 &&
      compatible[i].length > 0 &&
      compatible[i].every((p) => spacingSignature(p) === "0,1,2,3,4")
    )
      warnings.push(
        `${hands[i]} hand: no approved variable position fits; the conventional position option will be used.`,
      );
    const movement = c.movement;
    const wide = c.wideLeaps;
    if (
      wide.kind === "lifted-wide" &&
      wide.probability > 0 &&
      compatible[i].length > 0 &&
      !compatible[i].some((from) =>
        wideLandingOptions(c, from, compatible[i]).some(
          ({ to, index }) =>
            from.pitches.some(
              (last) =>
                Math.abs(
                  diatonicIndex(to.pitches[index]) - diatonicIndex(last),
                ) <= wide.maxLandingIntervalSteps,
            ) &&
            (hands.length === 1 ||
              lists[1 - i].some(
                (other) => separated(from, other) && separated(to, other),
              )),
        ),
      )
    )
      errors.push(
        `${hands[i]} hand: wide leaps are infeasible for these ranges, spacing, distance, landing, direction and preparation constraints.`,
      );
    if (
      movement.kind === "rested-reposition" &&
      movement.probability > 0 &&
      compatible[i].length > 0 &&
      !compatible[i].some((from) =>
        compatible[i].some((to) => {
          const distance = Math.abs(
            diatonicIndex(to.pitches[0]) - diatonicIndex(from.pitches[0]),
          );
          return (
            distance > 0 &&
            distance <= movement.maxDistanceSteps &&
            spacingSignature(from) === spacingSignature(to) &&
            to.pitches.some(
              (pitch) =>
                !from.pitches.includes(pitch) &&
                from.pitches.some(
                  (last) =>
                    Math.abs(diatonicIndex(pitch) - diatonicIndex(last)) <=
                    c.melody.maxIntervalSteps,
                ),
            ) &&
            (hands.length === 1 ||
              lists[1 - i].some(
                (other) => separated(from, other) && separated(to, other),
              ))
          );
        }),
      )
    )
      warnings.push(
        `${hands[i]} hand: no legal same-shape repositioning fits these ranges and limits; movement opportunities will keep the position.`,
      );
    if (
      c.chords.kind === "voicings" &&
      c.chords.probability > 0 &&
      compatible[i].length > 0 &&
      !hasChord(c, compatible[i])
    )
      warnings.push(
        `${hands[i]} hand: no approved chord voicing fits these positions and harmonic plans; legal single notes will be retained.`,
      );
  }
  if (
    hands.length === 2 &&
    !lists[0].some((r) => lists[1].some((l) => separated(r, l)))
  )
    errors.push(
      "Both hands need separate positions; widen the ranges or lower the left range.",
    );
  return { errors, warnings };
}

function hasChord(c: ValidatedGeneratorConfig, positions: HandState[]) {
  const scale = Scale.get(`${c.notation.key} major`).notes;
  const degrees = [...new Set(c.harmony.progressions.flatMap((p) => p.value))];
  return positions.some((pos) =>
    degrees.some((degree) => {
      const harmony = Chord.get(
        `${scale[degree - 1]}${degree === 2 || degree === 6 ? "m" : ""}`,
      ).notes;
      return pos.pitches.some((pitch) => {
        const midi = Note.midi(pitch)!;
        const event: ScoreEvent = {
          id: "feasibility",
          kind: "note",
          hand: pos.hand,
          bar: 0,
          onset: 0,
          duration: TPQ,
          positionId: pos.id,
          pitch,
          midi,
          finger: pos.fingerToMidi.indexOf(midi) + 1,
          action: "PLAY_WITHIN_POSITION",
        };
        return chordCandidatesForConfig(event, pos, c, harmony).length > 0;
      });
    }),
  );
}
