import { Note, Scale } from "tonal";
import type { Hand, HandState } from "../score/model";
import { chromaticOptions } from "./ergonomics";
import type { ValidatedGeneratorConfig } from "./config";
/** Offsets in finger order, away from the thumb. No ring/little-finger gaps. */
export const spacingPatterns = {
  natural: [0, 1, 2, 3, 4],
  thumbGap: [0, 2, 3, 4, 5],
  indexGap: [0, 1, 3, 4, 5],
  twoGaps: [0, 2, 4, 5, 6],
} as const;
export function spacingSignature(pos: HandState): string {
  const degrees = pos.pitches.map(diatonicIndex);
  const ordered = pos.hand === "right" ? degrees : [...degrees].reverse();
  return ordered.map((d) => Math.abs(d - ordered[0])).join(",");
}
export function positionCenter(h: HandState): number {
  return (Math.min(...h.fingerToMidi) + Math.max(...h.fingerToMidi)) / 2;
}
export function diatonicIndex(pitch: string): number {
  const n = Note.get(pitch);
  return n.oct! * 7 + "CDEFGAB".indexOf(n.letter);
}
type PositionParameters = Pick<
  ValidatedGeneratorConfig,
  "hands" | "notation" | "fingering" | "chromatic"
>;
export function positionsForConfig(
  c: PositionParameters,
  hand: Hand,
): HandState[] {
  const { min, max, clef } = c.hands[hand];
  // Also called on uncommitted form input, before Apply validates settings.
  if (
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 0 ||
    max > 127 ||
    min > max
  )
    return [];
  const scale = Scale.get(`${c.notation.key} major`).notes,
    pitches: string[] = [];
  for (let midi = min; midi <= max; midi++) {
    const pc = scale.find((pc) => Note.chroma(pc) === midi % 12);
    if (pc) pitches.push(`${pc}${Math.floor(midi / 12) - 1}`);
  }
  const patterns = c.fingering.patterns.map(
    ({ value }) => [value, spacingPatterns[value]] as const,
  );
  return patterns.flatMap(([name, offsets]) =>
    Array.from({ length: Math.max(0, pitches.length - offsets[4]) }, (_, i) => {
      const ascending =
        hand === "left"
          ? [...offsets].reverse().map((n) => offsets[4] - n)
          : offsets;
      const five = ascending.map((offset) => pitches[i + offset]),
        numbers = five.map((p) => Note.midi(p)!);
      return {
        id: `${hand}-${five[0]}${name === "natural" ? "" : `-${name}`}`,
        hand,
        clef,
        pitches: five,
        fingerToMidi: hand === "right" ? numbers : [...numbers].reverse(),
        lastIndex: 0,
        min,
        max,
      };
    })
      .filter((pos) => {
        const mapped = pos.fingerToMidi;
        return (
          Math.max(...mapped) - Math.min(...mapped) <= 10 &&
          mapped.every(
            (n, i) =>
              i === 0 || Math.abs(n - mapped[i - 1]) <= (i <= 2 ? 4 : 2),
          )
        );
      })
      .map((pos) =>
        c.chromatic.kind === "diatonic"
          ? pos
          : {
              ...pos,
              pitchOptions: chromaticOptions(pos, c.fingering.chromaticFingers),
            },
      ),
  );
}
export function separated(a: HandState, b: HandState): boolean {
  const rh = a.hand === "right" ? a : b,
    lh = a.hand === "left" ? a : b;
  return Math.min(...rh.fingerToMidi) > Math.max(...lh.fingerToMidi);
}
