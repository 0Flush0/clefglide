import { random } from "./random";
import { coverageDefaults, type GuidedCoverage } from "./config";
import type { HandState, LifetimeNote, StreamState } from "../score/model";

/** Ephemeral region-use estimates and one short-lived goal. */
export interface RangeCoverage {
  min: number;
  max: number;
  context: string;
  usage: number[];
  target: number;
  remaining: number;
}

function region(state: RangeCoverage, midi: number): number {
  return Math.max(
    0,
    Math.min(
      state.usage.length - 1,
      Math.floor(
        ((midi - state.min) / (state.max - state.min + 1)) * state.usage.length,
      ),
    ),
  );
}

/** Called once per phrase, independently for each hand. Destinations are the
 * centers of approved positions, before local movement/landing constraints.
 * Unreachable goals expire; they never manufacture a movement opportunity. */
export function planRangeCoverage(
  previous: RangeCoverage | undefined,
  input: {
    min: number;
    max: number;
    context: string;
    position: number;
    destinations: number[];
  },
  rng: { rng: number },
  config: GuidedCoverage = coverageDefaults,
): RangeCoverage {
  const state: RangeCoverage =
    previous?.min === input.min &&
    previous.max === input.max &&
    previous.context === input.context &&
    previous.usage.length === config.regions
      ? { ...previous, usage: [...previous.usage] }
      : {
          min: input.min,
          max: input.max,
          context: input.context,
          usage: Array<number>(config.regions).fill(0),
          target: input.position,
          remaining: 0,
        };
  if (
    state.remaining > 0 &&
    Math.abs(state.target - input.position) > config.reachedToleranceSemitones
  ) {
    state.remaining--;
    return state;
  }
  const peak = Math.max(...state.usage, config.usageFloor);
  // Every region stays eligible. No midpoint preference or prescribed direction.
  const weights = state.usage.map(
    (use) =>
      config.explorationWeight + (1 - use / peak) ** config.underuseExponent,
  );
  let draw = random(rng) * weights.reduce((sum, weight) => sum + weight, 0);
  let selected = config.regions - 1;
  for (let i = 0; i < config.regions; i++) {
    draw -= weights[i];
    if (draw < 0) {
      selected = i;
      break;
    }
  }
  const goal =
    input.min +
    ((selected + 0.5) / config.regions) * (input.max - input.min + 1);
  // Boundary regions may not contain a five-finger position's center. Aim at
  // the nearest approved center so these goals can still be reached naturally.
  state.target = input.destinations.reduce((best, center) =>
    Math.abs(center - goal) < Math.abs(best - goal) ? center : best,
  );
  state.remaining =
    config.minTargetPhrases +
    Math.floor(random(rng) * config.targetSpreadPhrases);
  return state;
}

/** Bounded acceptance weight on already-legal relocations, never on notes.
 * The remaining weight means stay put. Away moves retain the configured floor;
 * towards-target moves can never exceed the existing opportunity frequency. */
export function coverageMoveWeight(
  state: RangeCoverage,
  from: number,
  to: number,
  config: GuidedCoverage = coverageDefaults,
): number {
  const progress = Math.abs(from - state.target) - Math.abs(to - state.target);
  return Math.exp(
    ((Math.max(-1, Math.min(1, progress / config.progressScaleSemitones)) - 1) *
      Math.log(1 / config.minMoveAcceptance)) /
      2,
  );
}

/** Select the contour's register once, at the phrase boundary. The configured
 * offset biases the contour towards the target, clamped to the five-note map.
 * This never changes note-level constraints. */
export function coveragePhraseShape(
  state: RangeCoverage,
  position: number,
  shape: readonly number[],
  rng: { rng: number },
  config: GuidedCoverage = coverageDefaults,
): number[] {
  const offset =
    random(rng) < config.contourProbability
      ? Math.sign(state.target - position) * config.contourOffsetSteps
      : 0;
  return shape.map((index) => Math.max(0, Math.min(4, index + offset)));
}

/** Record actual generated noteheads (including chord tones), excluding rests.
 * Normalize per phrase so dense rhythms/chords do not erase history faster. */
export function recordRangeCoverage(
  state: RangeCoverage,
  pitches: number[],
  config: GuidedCoverage = coverageDefaults,
  weights?: number[],
): void {
  const counts = Array<number>(config.regions).fill(0);
  pitches.forEach((pitch, i) => {
    counts[region(state, pitch)] += weights?.[i] ?? 1;
  });
  const total = weights
    ? weights.reduce((sum, weight) => sum + weight, 0)
    : pitches.length;
  state.usage = state.usage.map(
    (use, i) =>
      use * config.decay +
      (counts[i] / Math.max(1, total)) * (1 - config.decay),
  );
}

export function validCoverageMemory(
  state: StreamState,
  context: string,
  config: GuidedCoverage,
) {
  const memory = state.coverage;
  return (
    !!memory &&
    Object.keys(memory).length === state.hands.length &&
    state.hands.every((hand) => {
      const entry = memory[hand.hand];
      return (
        !!entry &&
        entry.context === context &&
        Number.isInteger(entry.min) &&
        entry.min >= hand.min &&
        Number.isInteger(entry.max) &&
        entry.max <= hand.max &&
        entry.min < entry.max &&
        Number.isFinite(entry.target) &&
        entry.target >= entry.min &&
        entry.target <= entry.max &&
        Number.isInteger(entry.remaining) &&
        entry.remaining >= 0 &&
        entry.remaining <
          config.minTargetPhrases + config.targetSpreadPhrases &&
        Array.isArray(entry.usage) &&
        entry.usage.length === config.regions &&
        entry.usage.every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 1,
        ) &&
        entry.usage.reduce((sum, value) => sum + value, 0) <= 1 + 1e-12
      );
    })
  );
}

/** Reconstruct the outgoing histogram from actual lifetime intersections. */
export function matchesCoverageUsage(
  notes: LifetimeNote[],
  hand: HandState,
  initial: RangeCoverage | undefined,
  final: RangeCoverage,
  start: number,
  end: number,
  config: GuidedCoverage,
) {
  const ticks = final.usage.map(() => 0);
  for (const note of notes) {
    if (note.hand === hand.hand)
      ticks[region(final, note.midi)] += Math.max(
        0,
        Math.min(end, note.lifetime.releaseTick) -
          Math.max(start, note.lifetime.onsetTick),
      );
  }
  const total = Math.max(
    1,
    ticks.reduce((sum, value) => sum + value, 0),
  );
  return final.usage.every(
    (use, index) =>
      Math.abs(
        use -
          ((initial?.usage[index] ?? 0) * config.decay +
            (ticks[index] / total) * (1 - config.decay)),
      ) < 1e-12,
  );
}
