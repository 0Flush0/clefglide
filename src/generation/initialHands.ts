import type { Hand, HandState } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { configForHand } from "./config/handParameters";

import {
  positionsForConfig,
  separated,
  spacingSignature,
  spacingPatterns,
} from "./positionMaps";
import { hash, random } from "./random";
import { chooseWeighted } from "./sampling";
import { GeneratorContextInfeasibleError } from "./dynamicFeasibility";

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
    throw new GeneratorContextInfeasibleError(
      "This range needs five consecutive notes in the chosen major key. Widen the range or change the key.",
    );
  const prefer = (xs: HandState[], rng = state) => {
    const local = configForHand(c, xs[0].hand);
    const spaced = random(rng) < local.fingering.variablePositionProbability;
    const selected = xs.filter(
      (p) => (spacingSignature(p) !== "0,1,2,3,4") === spaced,
    );
    return selected.length ? selected : xs;
  };
  const weight = (p: HandState) =>
    configForHand(c, p.hand).fingering.patterns.find(
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
    throw new GeneratorContextInfeasibleError(
      "Both hands need non-overlapping five-note positions. Lower the LH range or raise the RH range.",
    );
  if (
    c.handParameters &&
    lists[0].every((r) => lists[1].every((l) => separated(r, l)))
  ) {
    const seed = state.rng;
    return lists.map((list) => {
      const rng = { rng: hash(`${seed}:position:${list[0].hand}`) };
      return structuredClone(
        chooseWeighted(
          prefer(list, rng).map((p) => ({ value: p, weight: weight(p) })),
          rng,
        ),
      );
    });
  }
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
