import { random } from "./random";

export function choose<T>(items: readonly T[], state: { rng: number }): T {
  if (!items.length)
    throw new Error(
      "No playable candidates remain for the resolved parameters.",
    );
  return items[Math.floor(random(state) * items.length)];
}
/** One draw, ordered cumulative mass. Unit/integer weights preserve the legacy
 * expanded-array sampler's ordering and PRNG consumption, including singleton lists. */
export function chooseWeighted<T>(
  items: readonly { value: T; weight: number }[],
  state: { rng: number },
): T {
  if (!items.length)
    throw new Error(
      "No playable weighted candidates remain for the resolved parameters.",
    );
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let draw = random(state) * total;
  for (const item of items) {
    draw -= item.weight;
    if (draw < 0) return item.value;
  }
  return items[items.length - 1].value;
}
