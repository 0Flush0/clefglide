import type { Hand, HandState } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import {
  positionsForConfig,
  separated,
  spacingSignature,
  spacingPatterns,
} from "./positionMaps";
import { random } from "./random";
import { chooseWeighted } from "./sampling";

export function initialHands(
  c: ValidatedGeneratorConfig,
  state: { rng: number },
  accepts: (position: HandState) => boolean = () => true,
): HandState[] {
  const hands: Hand[] =
    c.hands.active === "both" ? ["right", "left"] : [c.hands.active];
  const lists = hands.map((hand) =>
    positionsForConfig(c, hand).filter(accepts),
  );
  if (lists.some((xs) => !xs.length))
    throw new Error(
      "This range needs five consecutive notes in the chosen major key. Widen the range or change the key.",
    );
  const prefer = (xs: HandState[]) => {
    const spaced = random(state) < c.fingering.variablePositionProbability;
    const selected = xs.filter(
      (p) => (spacingSignature(p) !== "0,1,2,3,4") === spaced,
    );
    return selected.length ? selected : xs;
  };
  const weight = (p: HandState) =>
    c.fingering.patterns.find(
      (pattern) =>
        spacingPatterns[pattern.value].join(",") === spacingSignature(p),
    )!.weight;
  if (hands.length === 1)
    return [
      structuredClone(
        chooseWeighted(
          prefer(lists[0]).map((p) => ({ value: p, weight: weight(p) })),
          state,
        ),
      ),
    ];
  const pairs = lists[0].flatMap((r) =>
    lists[1].filter((l) => separated(r, l)).map((l) => [r, l]),
  );
  if (!pairs.length)
    throw new Error(
      "Both hands need non-overlapping five-note positions. Lower the LH range or raise the RH range.",
    );
  let compatible = pairs;
  for (let i = 0; i < hands.length; i++) {
    const allowed = new Set(prefer(compatible.map((pair) => pair[i])));
    compatible = compatible.filter((pair) => allowed.has(pair[i]));
  }
  return structuredClone(
    chooseWeighted(
      compatible.map((pair) => ({
        value: pair,
        weight: weight(pair[0]) * weight(pair[1]),
      })),
      state,
    ),
  );
}
