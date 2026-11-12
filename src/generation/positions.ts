import { Note, Scale } from "tonal";
import type { Hand, HandState, Settings } from "../score/model";
import { chromaticOptions } from "./ergonomics";
export const movementRules = {
  off: { distance: 0, eligible: [] },
  easy: { distance: 2, eligible: [2] },
  medium: { distance: 3, eligible: [1, 3] },
  hard: { distance: 4, eligible: [1, 2, 3] },
} as const;
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
export function diatonicIndex(pitch: string): number {
  const n = Note.get(pitch);
  return n.oct! * 7 + "CDEFGAB".indexOf(n.letter);
}
export function positionsFor(s: Settings, hand: Hand): HandState[] {
  const min = hand === "left" ? s.leftMin : s.min,
    max = hand === "left" ? s.leftMax : s.max;
  // Also called on uncommitted form input, before Apply validates settings.
  if (
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 0 ||
    max > 127 ||
    min > max
  )
    return [];
  const scale = Scale.get(`${s.key} major`).notes,
    pitches: string[] = [];
  for (let midi = min; midi <= max; midi++) {
    const pc = scale.find((pc) => Note.chroma(pc) === midi % 12);
    if (pc) pitches.push(`${pc}${Math.floor(midi / 12) - 1}`);
  }
  const patterns = Object.entries(spacingPatterns).filter(
    ([name]) =>
      name === "natural" ||
      (s.fingerSpacing !== "off" && name === "thumbGap") ||
      ((s.fingerSpacing === "medium" || s.fingerSpacing === "hard") &&
        name === "indexGap") ||
      (s.fingerSpacing === "hard" && name === "twoGaps"),
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
        clef: hand === "right" ? s.rhClef : s.lhClef,
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
        s.accidentals === "off"
          ? pos
          : { ...pos, pitchOptions: chromaticOptions(pos) },
      ),
  );
}
export function separated(a: HandState, b: HandState): boolean {
  const rh = a.hand === "right" ? a : b,
    lh = a.hand === "left" ? a : b;
  return Math.min(...rh.fingerToMidi) > Math.max(...lh.fingerToMidi);
}
/** Form feedback uses the same position candidates as the existing planner. */
export function rangeError(s: Settings): string | undefined {
  const hands: Hand[] = s.hand === "both" ? ["left", "right"] : [s.hand];
  for (const hand of hands) {
    if (!positionsFor(s, hand).length)
      return hand === "left"
        ? "Left hand: choose a range containing five consecutive notes in the selected key."
        : "Right hand: choose a range containing five consecutive notes in the selected key.";
  }
  if (
    s.hand === "both" &&
    !positionsFor(s, "right").some((r) =>
      positionsFor(s, "left").some((l) => separated(r, l)),
    )
  )
    return "No separate hand positions fit. Widen the ranges, lower the left range or raise the right range. Overlapping ranges are allowed.";
}
export function rangeSummary(s: Settings): string {
  const hands: Hand[] = s.hand === "both" ? ["right", "left"] : [s.hand];
  return hands
    .map((hand) => {
      const other =
        s.hand === "both"
          ? positionsFor(s, hand === "right" ? "left" : "right")
          : [];
      const compatible = positionsFor(s, hand).filter(
        (position) =>
          s.hand !== "both" ||
          other.some((candidate) => separated(position, candidate)),
      );
      const count = compatible.length;
      const message =
        count === 0
          ? "Choose a range containing five scale notes."
          : count === 1
            ? "Only one hand position fits this range. Choose a wider range to practice repositioning."
            : `Starting positions can vary (${count} positions fit).`;
      const hasSpacing = compatible.some(
        (p) => spacingSignature(p) !== "0,1,2,3,4",
      );
      const fallback =
        s.fingerSpacing !== "off" && !hasSpacing
          ? " No approved spacing pattern fits; conventional spacing will be used."
          : "";
      return `${s.hand === "both" ? (hand === "right" ? "RH: " : "LH: ") : ""}${message}${fallback}`;
    })
    .join(". ");
}
