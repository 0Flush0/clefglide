import { TPQ } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { chooseWeighted } from "./sampling";

/** Preparatory rests take precedence over discretionary breathing rests. */
export function barRhythm(
  c: ValidatedGeneratorConfig,
  bar: number,
  state: { rng: number },
) {
  const restBeats =
    c.movement.kind === "rested-reposition" &&
    c.movement.probability > 0 &&
    c.movement.eligibleBars.includes(bar + 1)
      ? c.movement.preparationBeats
      : c.rhythm.breathBars.includes(bar)
        ? c.rhythm.breathBeats
        : 0;
  const durations: number[] = [];
  let remaining = (c.notation.beats - restBeats) * TPQ;
  while (remaining) {
    const legal = c.rhythm.durations.filter(
      (option) => option.value <= remaining,
    );
    const d = chooseWeighted(legal, state);
    durations.push(d);
    remaining -= d;
  }
  if (restBeats) durations.push(restBeats * TPQ);
  return { durations, breath: restBeats > 0 };
}
