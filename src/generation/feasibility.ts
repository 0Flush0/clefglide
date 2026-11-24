import { activeHands, configForHand } from "./config/handParameters";
import { Chord, Note, Scale } from "tonal";
import { TPQ, type HandState, type ScoreEvent } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import {
  positionsForConfig,
  separated,
  spacingSignature,
  diatonicIndex,
} from "./positionMaps";
import { chordCandidatesForConfig } from "./voicings";
import { wideLandingOptions } from "./wideLeaps";
import { positionFitsVoices, voiceAllows, voiceSpecs } from "./voiceConfig";
import {
  dynamicFeasibility,
  GeneratorContextInfeasibleError,
} from "./dynamicFeasibility";

// Resolved configurations are deeply frozen. Continuations and slur previews
// can reuse the static map-space proof without caching mutable planner state.
const generationVerdicts = new WeakMap<ValidatedGeneratorConfig, string>();
export function assertGeneratorFeasibility(c: ValidatedGeneratorConfig) {
  let error = generationVerdicts.get(c);
  if (error === undefined) {
    error = inspectGeneratorFeasibility(c).errors.join(" ");
    generationVerdicts.set(c, error);
  }
  if (error) throw new GeneratorContextInfeasibleError(error);
}

/** Context-dependent feasibility is separate from structural configuration validity.
 * Chord/movement probabilities are opportunities, not promises that every shape fits. */
export function inspectGeneratorFeasibility(c: ValidatedGeneratorConfig) {
  const hands = activeHands(c);
  const lists = hands.map((hand) =>
    positionsForConfig(c, hand).filter((pos) => positionFitsVoices(c, pos)),
  );
  const compatible = lists.map((positions, i) =>
    hands.length === 1
      ? positions
      : positions.filter((p) =>
          lists[1 - i].some((other) => separated(p, other)),
        ),
  );
  const errors: string[] = [],
    warnings: string[] = [];
  const wideUnavailable: string[] = [];
  const voices = voiceSpecs(c);
  const ties = c.notation.ties;
  if (
    !c.handParameters &&
    ties !== false &&
    ties.probability > 0 &&
    ties.chordTones !== "none" &&
    !compatible.some((positions, i) =>
      c.independentVoices
        ? voices.some(
            (v) =>
              v.hand === hands[i] &&
              v.profile.chords &&
              ties.voices.some((id) => id === v.id) &&
              hasChord(
                configForHand(c, v.hand),
                positions,
                (heads) =>
                  heads.length <= c.independentVoices![v.hand]!.maxPolyphony &&
                  heads.every((n) => voiceAllows(v.profile, n.midi, n.finger)),
              ),
          )
        : ties.voices.includes(`${hands[i]}:main`) && hasChord(c, positions),
    )
  )
    errors.push(
      "The selected tie chord tones require a feasible, enabled harmonic voicing in an eligible voice.",
    );
  const configuration = c;
  for (let i = 0; i < hands.length; i++) {
    const c = configForHand(configuration, hands[i]);
    if (!lists[i].length)
      errors.push(
        c.independentVoices
          ? `${hands[i]} hand: no position fits the voice registers, permitted fingers and minimum polyphony.`
          : `${hands[i]} hand: the range needs five consecutive notes in ${c.notation.key} major; widen it or change the key.`,
      );
    else if (
      c.fingering.variablePositionProbability > 0 &&
      compatible[i].length > 0 &&
      compatible[i].every((p) => spacingSignature(p) === "0,1,2,3,4")
    )
      warnings.push(
        `${hands[i]} hand: no approved variable position fits; the conventional position option will be used.`,
      );
    const localTies = c.notation.ties;
    if (
      configuration.handParameters &&
      localTies &&
      localTies.probability > 0 &&
      localTies.chordTones !== "none" &&
      localTies.voices.some((id) => id.startsWith(`${hands[i]}:`)) &&
      !voices.some(
        (v) =>
          v.hand === hands[i] &&
          v.profile.chords &&
          localTies.voices.some((id) => id === v.id) &&
          hasChord(
            c,
            compatible[i],
            (heads) =>
              heads.length <= c.independentVoices![v.hand]!.maxPolyphony &&
              heads.every((n) => voiceAllows(v.profile, n.midi, n.finger)),
          ),
      )
    )
      errors.push(
        `${hands[i]} hand: tied chord tones require a feasible voicing in an eligible voice.`,
      );
    const movement = c.movement;
    const wide = c.wideLeaps;
    const main = voices.find(
      (voice) => voice.hand === hands[i] && voice.id.endsWith(":main"),
    )?.profile;
    if (
      wide.kind === "lifted-wide" &&
      wide.probability > 0 &&
      compatible[i].length > 0 &&
      !compatible[i].some((from) => {
        const previousPitches =
          main?.chromatic && from.pitchOptions
            ? from.pitchOptions.flat()
            : from.pitches;
        return wideLandingOptions(c, from, compatible[i]).some(
          ({ to, index }) =>
            (!main ||
              (main.entryProbability > 0 &&
                main.activity > 0 &&
                voiceAllows(
                  main,
                  Note.midi(to.pitches[index])!,
                  to.fingerToMidi.indexOf(Note.midi(to.pitches[index])!) + 1,
                ))) &&
            previousPitches.some(
              (last) =>
                Math.abs(
                  diatonicIndex(to.pitches[index]) - diatonicIndex(last),
                ) <= wide.maxLandingIntervalSteps,
            ) &&
            (hands.length === 1 ||
              lists[1 - i].some(
                (other) => separated(from, other) && separated(to, other),
              )),
        );
      })
    )
      wideUnavailable.push(
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
  (wideUnavailable.length < hands.length && !c.handParameters
    ? warnings
    : errors
  ).push(...wideUnavailable);
  if (
    hands.length === 2 &&
    !lists[0].some((r) => lists[1].some((l) => separated(r, l)))
  )
    errors.push(
      "Both hands need separate positions; widen the ranges or lower the left range.",
    );
  if (c.handParameters) {
    for (const hand of hands)
      errors.push(
        ...dynamicFeasibility(configForHand(c, hand), compatible, hand).map(
          (message) => `${hand} hand: ${message}`,
        ),
      );
  } else errors.push(...dynamicFeasibility(c, compatible));
  return { errors, warnings };
}

function hasChord(
  c: ValidatedGeneratorConfig,
  positions: HandState[],
  accepts: (
    heads: ReturnType<typeof chordCandidatesForConfig>[number],
  ) => boolean = () => true,
) {
  if (c.chords.kind !== "voicings" || c.chords.probability === 0) return false;
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
        return chordCandidatesForConfig(event, pos, c, harmony).some(accepts);
      });
    }),
  );
}
