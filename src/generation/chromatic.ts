import { Chord, Note } from "tonal";
import type { HandState } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { diatonicIndex } from "./positionMaps";
import { playableTransition } from "./ergonomics";
import { random } from "./random";
import { choose } from "./sampling";

/** Choose a validated pitch/finger pair and its legal pending resolution together. */
export function planChromatic(
  c: ValidatedGeneratorConfig,
  h: HandState,
  index: number,
  rest: boolean,
  landing: boolean,
  harmony: readonly string[],
  state: { rng: number },
) {
  const fingerFor = (pitch: string) =>
    h.fingerToMidi.indexOf(Note.midi(pitch)!) + 1;
  const canPlay = (pitch: string, finger: number) =>
    playableTransition(h.lastFingering ?? [], [
      { midi: Note.midi(pitch)!, finger },
    ]);
  let pitch = h.pitches[index];
  let finger = fingerFor(pitch);
  const resolving = !!h.resolutionPitch;
  if (!rest) h.resolutionPitch = undefined;
  const frequency =
    c.chromatic.kind === "neighbors" ? c.chromatic.probability : 0;
  if (!rest && !resolving && !landing && random(state) < frequency) {
    // Search validated per-finger choices before choosing an alteration.
    // Prefer another finger over reusing one for an illegal key change.
    const playableOptions = (h.pitchOptions ?? []).flatMap((pitches, f) =>
      pitches.flatMap((p) => {
        if (
          p ===
            h.pitches.find((base) => Note.midi(base) === h.fingerToMidi[f]) ||
          Math.abs(Note.midi(p)! - Note.midi(pitch)!) !== 1 ||
          !canPlay(p, f + 1) ||
          (h.lastPitch &&
            Math.abs(diatonicIndex(p) - diatonicIndex(h.lastPitch)) >
              c.melody.maxIntervalSteps)
        )
          return [];
        const resolutions = h.pitches.filter(
          (base) =>
            Math.abs(Note.midi(base)! - Note.midi(p)!) === 1 &&
            Math.abs(diatonicIndex(base) - diatonicIndex(p)) <=
              c.melody.maxIntervalSteps &&
            playableTransition(
              [{ midi: Note.midi(p)!, finger: f + 1 }],
              [{ midi: Note.midi(base)!, finger: fingerFor(base) }],
            ),
        );
        return resolutions.length
          ? [{ pitch: p, finger: f + 1, resolutions }]
          : [];
      }),
    );
    const options = playableOptions.filter(
      (option) =>
        (c.chromatic.kind === "neighbors" && !c.chromatic.preferMappedFinger) ||
        option.finger === finger ||
        !playableOptions.some(
          (other) => other.pitch === option.pitch && other.finger === finger,
        ),
    );
    // Neighbors resolve on their next attack; harmonic color is an explicit preference.
    const root = harmony[0];
    const applied = Chord.get(`${root}7`).notes;
    const preferred =
      c.chromatic.kind === "neighbors" && c.chromatic.preferAppliedDominant
        ? options.filter((p) => applied.includes(Note.pitchClass(p.pitch)))
        : [];
    if (options.length) {
      const option = choose(preferred.length ? preferred : options, state);
      pitch = option.pitch;
      finger = option.finger;
      h.resolutionPitch =
        c.chromatic.kind === "neighbors" &&
        c.chromatic.preferAnchorResolution &&
        option.resolutions.includes(h.pitches[index])
          ? h.pitches[index]
          : choose(option.resolutions, state);
      const passing = option.resolutions.filter(
        (p) => p !== h.resolutionPitch && harmony.includes(Note.pitchClass(p)),
      );
      if (
        c.chromatic.kind === "neighbors" &&
        c.chromatic.passingResolutionProbability > 0 &&
        passing.length &&
        random(state) < c.chromatic.passingResolutionProbability
      )
        h.resolutionPitch = choose(passing, state);
    }
  }

  return { pitch, finger, resolving };
}
