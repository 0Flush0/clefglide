import type { Hand, HandState, Settings } from "../score/model";
import { resolvePositionParameters } from "./config/presets";
import {
  positionsForConfig,
  separated,
  spacingSignature,
} from "./positionMaps";
export { movementRules } from "./config/presets";
export {
  spacingPatterns,
  spacingSignature,
  positionCenter,
  diatonicIndex,
  positionsForConfig,
  separated,
} from "./positionMaps";

/** Legacy range-preview/position API. Core algorithms import positionMaps instead. */
export function positionsFor(s: Settings, hand: Hand): HandState[] {
  return positionsForConfig(resolvePositionParameters(s), hand);
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
