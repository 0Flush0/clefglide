import { TPQ } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { chooseWeighted } from "./sampling";
import { wideRestBeats } from "./wideLeaps";

export function smallRestBeats(c: ValidatedGeneratorConfig, bar: number) {
  return c.movement.kind === "rested-reposition" &&
    c.movement.probability > 0 &&
    c.movement.eligibleBars.includes(bar + 1)
    ? c.movement.preparationBeats
    : c.rhythm.breathBars.includes(bar)
      ? c.rhythm.breathBeats
      : 0;
}

/** Preparatory rests take precedence over discretionary breathing rests. */
export function barRhythm(
  c: ValidatedGeneratorConfig,
  bar: number,
  state: { rng: number },
) {
  const smallRest = smallRestBeats(c, bar);
  const wideRest = wideRestBeats(c, bar);
  const restBeats = Math.max(smallRest, wideRest);
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
  const noteCount = durations.length;
  // A shorter leap preparation inside a longer breathing/small-shift rest
  // still needs an exact, engravable cue at its declared start.
  const restBudgets =
    wideRest > 0 && wideRest < restBeats
      ? [restBeats - wideRest, wideRest]
      : [restBeats];
  for (const budget of restBudgets) {
    let restTicks = budget * TPQ;
    while (restTicks) {
      const d = [1920, 960, 480].find((d) => d <= restTicks)!;
      durations.push(d);
      restTicks -= d;
    }
  }
  return { durations, breath: restBeats > 0, noteCount };
}
