import { Note } from "tonal";
import type { Hand, HandState } from "../score/model";
import { alterPitch } from "../score/pitch";

export const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
// Horizontal key centers in white-key widths, including black-key offsets.
export function keyCenter(midi: number) {
  return (
    Math.floor(midi / 12) * 7 +
    [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6][midi % 12]
  );
}
/** Conservative software envelope, not a claim of measured human comfort. */
export function comfortableMap(mapped: number[], hand: Hand): boolean {
  const direction = hand === "right" ? 1 : -1;
  return (
    mapped.length === 5 &&
    Math.max(...mapped) - Math.min(...mapped) <= 10 &&
    mapped.every(
      (m, i) =>
        i === 0 ||
        ((m - mapped[i - 1]) * direction > 0 &&
          Math.abs(m - mapped[i - 1]) <= (i <= 2 ? 4 : 2) &&
          Math.abs(keyCenter(m) - keyCenter(mapped[i - 1])) <=
            (i <= 2 ? 2.5 : 1.5)),
    )
  );
}
export function chromaticOptions(pos: HandState): string[][] {
  return pos.fingerToMidi.map((midi, i) => {
    const base = pos.pitches.find((p) => Note.midi(p) === midi)!;
    if (i === 0 || i === 4) return [base];
    return [
      base,
      ...([-1, 1] as const).flatMap((delta) => {
        const pitch = alterPitch(base, delta);
        if (!pitch) return [];
        const m = Note.midi(pitch)!;
        const mapped = [...pos.fingerToMidi];
        mapped[i] = m;
        return m >= pos.min && m <= pos.max && comfortableMap(mapped, pos.hand)
          ? [pitch]
          : [];
      }),
    ];
  });
}
