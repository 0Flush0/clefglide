import { Note } from "tonal";
import type { HandState } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { diatonicIndex } from "./positionMaps";
import { playableTransition } from "./ergonomics";

function connectedStart(h: HandState, interval: number): number[] {
  const segments: number[][] = [[]];
  h.pitches.forEach((pitch, i) => {
    if (
      i > 0 &&
      diatonicIndex(pitch) - diatonicIndex(h.pitches[i - 1]) > interval
    )
      segments.push([]);
    segments.at(-1)!.push(i);
  });
  const largest = Math.max(...segments.map((segment) => segment.length));
  return segments.filter((segment) => segment.length === largest).flat();
}
export function melodicChoices(
  c: ValidatedGeneratorConfig,
  h: HandState,
  harmony: readonly string[],
  finalAttack: boolean,
) {
  let choices = [0, 1, 2, 3, 4].filter(
    (i) =>
      playableTransition(h.lastFingering ?? [], [
        {
          midi: Note.midi(h.pitches[i])!,
          finger: h.fingerToMidi.indexOf(Note.midi(h.pitches[i])!) + 1,
        },
      ]) &&
      (!h.lastPitch ||
        Math.abs(diatonicIndex(h.pitches[i]) - diatonicIndex(h.lastPitch)) <=
          c.melody.maxIntervalSteps),
  );
  if (!h.lastPitch && c.melody.startRegion === "largest-connected")
    choices = connectedStart(h, c.melody.maxIntervalSteps);
  if (finalAttack && c.melody.preferHarmonicEnding) {
    const stable = choices.filter((i) =>
      harmony.includes(Note.pitchClass(h.pitches[i])),
    );
    if (stable.length) choices = stable;
  }
  return choices;
}
export function melodicWeights(
  c: ValidatedGeneratorConfig,
  h: HandState,
  choices: number[],
  goal: number,
  harmony: readonly string[],
  finalEvent: boolean,
) {
  const m = c.melody;
  return choices.map((i) => ({
    value: i,
    weight:
      Math.max(
        m.minimumNoteWeight,
        m.contourPeakWeight - Math.abs(i - goal) * m.contourDistancePenalty,
      ) +
      (h.lastPitch &&
      Math.abs(diatonicIndex(h.pitches[i]) - diatonicIndex(h.lastPitch)) === 1
        ? m.stepBonus
        : 0) +
      (h.lastPitch === h.pitches[i] ? m.repetitionBonus : 0) +
      (harmony.includes(Note.pitchClass(h.pitches[i]))
        ? m.harmonicToneBonus
        : 0) +
      (finalEvent && harmony.includes(Note.pitchClass(h.pitches[i]))
        ? m.finalHarmonicToneBonus
        : 0),
  }));
}
