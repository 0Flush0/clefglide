import { Chord, Note } from "tonal";
import {
  noteheads,
  type HandState,
  type Notehead,
  type ScoreEvent,
} from "../score/model";
import { writtenPitch } from "../score/pitch";
import { comfortableMap, isBlack, keyCenter } from "./ergonomics";
import { diatonicIndex } from "./positionMaps";
import type { ValidatedGeneratorConfig } from "./config";
export function chordCandidatesForConfig(
  event: ScoreEvent,
  pos: HandState,
  c: ValidatedGeneratorConfig,
  harmony: string[],
  previous?: number[],
  continuing: readonly Notehead[] = [],
): Notehead[][] {
  const chord = c.chords;
  if (chord.kind === "single-notes") return [];
  const tones = noteheads(event),
    primary = tones[0];
  const triad = Chord.detect(harmony)[0];
  const harmonicSets = [harmony];
  if (triad) {
    const root = Chord.get(triad).tonic!;
    const extension = triad.includes("m")
      ? chord.minorExtension
      : chord.majorExtension;
    if (extension !== "none")
      harmonicSets.push(
        Chord.get(`${root}${extension === "seventh" ? "m7" : "6"}`).notes,
      );
  }
  return chord.shapes.flatMap(({ value: shape }) => {
    const fingers = [...shape].map(Number);
    if (!fingers.includes(primary.finger)) return [];
    const heads = fingers
      .map((finger) => {
        const pitch =
          finger === primary.finger
            ? primary.pitch
            : pos.pitches.find(
                (p) => Note.midi(p) === pos.fingerToMidi[finger - 1],
              )!;
        return {
          id: "",
          pitch,
          midi: Note.midi(pitch)!,
          finger,
          hand: event.hand,
          written: writtenPitch(pitch, c.notation.key),
        };
      })
      .sort((a, b) => a.midi - b.midi);
    const span = heads.at(-1)!.midi - heads[0].midi;
    if (span > chord.maxSpanSemitones) return [];
    const pcs = heads.map((n) => Note.pitchClass(n.pitch));
    const attackPcs = continuing.length
      ? heads
          .filter(
            (n) =>
              !continuing.some(
                (held) =>
                  held.midi === n.midi &&
                  held.pitch === n.pitch &&
                  held.finger === n.finger,
              ),
          )
          .map((n) => Note.pitchClass(n.pitch))
      : pcs;
    if (heads.length === 2) {
      if (
        !chord.dyadIntervals.includes(span as 3 | 4 | 5 | 7 | 8 | 9) ||
        !attackPcs.every((pc) => harmony.includes(pc))
      )
        return [];
    } else if (
      !harmonicSets.some(
        (set) =>
          set.length === heads.length &&
          (continuing.length
            ? attackPcs.every((pc) => set.includes(pc))
            : set.every((pc) => pcs.includes(pc))),
      )
    )
      return [];
    const mapped = [...pos.fingerToMidi];
    heads.forEach((n) => (mapped[n.finger - 1] = n.midi));
    if (!comfortableMap(mapped, event.hand)) return [];
    // Short outer fingers on black keys against white inner fingers are excluded.
    if (
      heads.some(
        (n) =>
          (n.finger === 1 || n.finger === 5) &&
          isBlack(n.midi) &&
          heads.some((o) => o.finger > 1 && o.finger < 5 && !isBlack(o.midi)),
      )
    )
      return [];
    if (
      heads.some(
        (n, i) =>
          i > 0 &&
          Math.abs(keyCenter(n.midi) - keyCenter(heads[i - 1].midi)) >
            Math.abs(n.finger - heads[i - 1].finger) * 1.5 + 0.5,
      )
    )
      return [];
    if (
      previous &&
      previous.length > 1 &&
      heads.some(
        (n) =>
          Math.min(
            ...previous.map((m) =>
              Math.abs(
                diatonicIndex(Note.fromMidi(m)) - diatonicIndex(n.pitch),
              ),
            ),
          ) > chord.maxVoiceLeadingSteps,
      )
    )
      return [];
    if (
      previous &&
      previous.length > 1 &&
      previous.some(
        (m) =>
          Math.min(
            ...heads.map((n) =>
              Math.abs(
                diatonicIndex(Note.fromMidi(m)) - diatonicIndex(n.pitch),
              ),
            ),
          ) > chord.maxVoiceLeadingSteps,
      )
    )
      return [];
    // Preserve the event's melodic anchor and legacy ID, regardless of engraving order.
    return [
      [primary, ...heads.filter((n) => n.finger !== primary.finger)].map(
        (n, i) => ({ ...n, id: i === 0 ? event.id : `${event.id}:${i}` }),
      ),
    ];
  });
}
