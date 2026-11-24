import type { ValidatedGeneratorConfig } from "../generation/config";
import type { ArticulationTiming } from "../score/articulationModel";
import {
  TPQ,
  noteheads,
  type ScoreEvent,
  type ScoringSettings,
} from "../score/model";
import type { LifetimeTracker } from "./lifetimes";

type Policy = NonNullable<ValidatedGeneratorConfig["articulation"]>;
type Evaluation = Extract<Policy["evaluation"], { kind: "evaluate" }>;
type Attempt = NonNullable<ReturnType<LifetimeTracker["attempts"]["get"]>>;
type Status = "pending" | "unobserved" | "correct" | "low" | "high";
export interface ArticulationResult {
  id: string;
  eventId: string;
  dimension: "timing" | "velocity";
  status: Status;
  /** Milliseconds from own attack (duration) or next attack (connection), or a velocity ratio. */
  observed?: number;
  min?: number;
  max?: number;
  weight: number;
}

const laneOf = (e: ScoreEvent) => e.voiceId ?? `${e.hand}:main`;

/** Score attacks alone can be trusted to identify MIDI observations. The
 * generator validates the full score, including ergonomic context. */
export function validateScoredArticulation(
  events: ScoreEvent[],
  policy?: Policy,
) {
  if (!policy) {
    if (events.some((e) => e.articulation || e.slur))
      throw new Error(
        "Articulation scoring requires the enabled configuration.",
      );
    return;
  }
  const lanes = new Map<string, ScoreEvent[]>();
  const ids = new Set(events.map((e) => e.id));
  for (const e of events) {
    if (e.kind !== "note") continue;
    const lane = lanes.get(laneOf(e)) ?? [];
    lane.push(e);
    lanes.set(laneOf(e), lane);
  }
  const fail = () => {
    throw new Error("Invalid articulation on scored attacks.");
  };
  for (const e of events) {
    if (!e.articulation && !e.slur) continue;
    if (e.kind !== "note") {
      fail();
      continue;
    }
    const { emphasis, touch, timing } = e.articulation ?? {};
    if (
      (emphasis &&
        !policy.emphasis.some(
          (r) => r.value === emphasis && r.probability > 0,
        )) ||
      (touch &&
        !policy.touch.some((r) => r.value === touch && r.probability > 0)) ||
      ((emphasis || touch) && !policy.voices.includes(laneOf(e)))
    )
      fail();
    if (
      e.slur &&
      (!policy.slurs ||
        !(policy.slurs.voices ?? policy.voices).includes(laneOf(e)))
    )
      fail();
    if (!timing) continue;
    const length = noteheads(e)[0].lifetime!.durationTicks;
    if (
      !Number.isSafeInteger(timing.ticks) ||
      timing.ticks <= 0 ||
      noteheads(e).some(
        (n) =>
          n.lifetime?.durationTicks !== length ||
          ((n.tie || n.substitution) && timing.ticks !== length),
      )
    )
      fail();
    if (timing.kind === "duration") {
      if (
        ![timing.minTicks, timing.maxTicks].every(Number.isSafeInteger) ||
        timing.minTicks <= 0 ||
        timing.minTicks > timing.ticks ||
        timing.maxTicks < timing.ticks ||
        timing.maxTicks > length
      )
        fail();
      continue;
    }
    const lane = lanes.get(laneOf(e))!;
    const next = lane[lane.indexOf(e) + 1];
    const expectedOffset =
      timing.kind === "overlap"
        ? policy.timing.overlapTicks
        : timing.kind === "separation"
          ? -policy.timing.separationTicks
          : timing.kind === "connected"
            ? 0
            : NaN;
    if (
      timing.offsetTicks !== expectedOffset ||
      timing.ticks !== length + expectedOffset ||
      !timing.nextEventId ||
      timing.nextEventId === e.id ||
      (next
        ? next.id !== timing.nextEventId ||
          next.lifetime?.onsetTick !== e.lifetime!.releaseTick
        : ids.has(timing.nextEventId) ||
          !e.slur ||
          e.slur.index + 1 >= e.slur.length)
    )
      fail();
    if (
      timing.kind === "overlap" &&
      next &&
      noteheads(e).some((n) =>
        noteheads(next).some((p) => n.midi === p.midi || n.finger === p.finger),
      )
    )
      fail();
  }
}

function timingBounds(
  timing: ArticulationTiming,
  policy: Policy,
  evaluation: Evaluation,
  bpm: number,
) {
  const beat = 60000 / bpm;
  const ms = (ticks: number) => (ticks * beat) / TPQ;
  const { minMs, maxMs, beatFraction } = evaluation.tolerance;
  const tolerance = Math.max(minMs, Math.min(maxMs, beat * beatFraction));
  if (timing.kind === "duration")
    return {
      min: Math.max(0, ms(timing.minTicks) - tolerance),
      max: ms(timing.maxTicks) + tolerance,
    };
  if (timing.kind === "connected") {
    const gap = ms(policy.timing.connectedGapTicks) + tolerance;
    return { min: -gap, max: gap };
  }
  const center = ms(timing.offsetTicks);
  return timing.kind === "overlap"
    ? { min: Math.max(0, center - tolerance), max: center + tolerance }
    : { min: center - tolerance, max: Math.min(0, center + tolerance) };
}

function classify(observed: number, min: number, max: number): Status {
  return observed < min ? "low" : observed > max ? "high" : "correct";
}

export function isArticulationTimingEvaluated(
  policy: Policy | undefined,
  mode: ScoringSettings["mode"],
) {
  return (
    mode === "timed" &&
    policy?.evaluation.kind === "evaluate" &&
    policy.evaluation.timingWeight > 0
  );
}

/** Reuse the lifetime tracker's accepted attacks, calibrated key edges and
 * transport epochs. A missing or incomparable observation is excluded. */
export function evaluateArticulation(
  events: ScoreEvent[],
  tracker: LifetimeTracker,
  policy: Policy,
  settings: ScoringSettings,
  chordOnsetMs: number,
  unattempted: ReadonlySet<string>,
  paused: boolean,
) {
  const evaluation = policy.evaluation;
  if (
    evaluation.kind !== "evaluate" ||
    (settings.mode !== "timed" && evaluation.waitMode !== "velocity-only")
  )
    return [];
  const timingEnabled = isArticulationTimingEvaluated(policy, settings.mode);
  const results: ArticulationResult[] = [];
  const samples = new Map<string, Attempt[]>();
  const lost = new Set<string>();
  for (const e of events) {
    const heads = noteheads(e);
    if (heads.some((n) => unattempted.has(n.id))) lost.add(e.id);
    const attempts = heads.map((n) => tracker.attempts.get(n.id));
    if (!attempts.length || !attempts.every((n): n is Attempt => !!n)) continue;
    const first = attempts[0];
    if (
      attempts.some(
        (n) => n.epoch !== first.epoch || n.channel !== first.channel,
      ) ||
      Math.max(...attempts.map((n) => n.attackMs)) -
        Math.min(...attempts.map((n) => n.attackMs)) >
        chordOnsetMs
    ) {
      lost.add(e.id);
      continue;
    }
    samples.set(e.id, attempts);
  }
  const baseline = new Map<string, { index: number; velocity: number }>();
  const indices = new Map<string, number>();
  for (const e of events) {
    const lane = laneOf(e);
    const index = (indices.get(lane) ?? 0) + 1;
    indices.set(lane, index);
    const attempts = samples.get(e.id);
    const mark = e.articulation;
    const timing = mark?.timing;
    if (timingEnabled && timing) {
      const next =
        timing.kind === "duration"
          ? undefined
          : samples.get(timing.nextEventId);
      const own = attempts ?? [];
      const weight = evaluation.timingWeight;
      const bounds = timingBounds(timing, policy, evaluation, settings.bpm);
      for (const attempt of own) {
        const result: ArticulationResult = {
          id: attempt.note.id,
          eventId: e.id,
          dimension: "timing",
          status: "pending",
          weight,
        };
        const reference =
          timing.kind === "duration"
            ? attempt.attackMs
            : next?.every(
                  (n) =>
                    n.channel === attempt.channel && n.epoch === attempt.epoch,
                )
              ? Math.min(...next.map((n) => n.attackMs))
              : undefined;
        if (reference === undefined) {
          if (
            next ||
            paused ||
            attempt.epoch !== tracker.transportEpoch ||
            (timing.kind !== "duration" && lost.has(timing.nextEventId))
          )
            result.status = "unobserved";
        } else {
          Object.assign(result, bounds);
          const release = attempt.keyReleaseMs;
          const observedUntil = attempt.interruptedAtMs ?? tracker.latestMs;
          if (release !== undefined) {
            const observed = release - reference;
            result.observed = observed;
            result.status =
              observed === 0 && timing.kind === "overlap"
                ? "low"
                : observed === 0 && timing.kind === "separation"
                  ? "high"
                  : classify(observed, bounds.min, bounds.max);
          } else if (observedUntil > reference + bounds.max)
            result.status = "high";
          else if (attempt.interrupted) result.status = "unobserved";
        }
        results.push(result);
      }
      if (!attempts && lost.has(e.id))
        for (const n of noteheads(e))
          results.push({
            id: n.id,
            eventId: e.id,
            dimension: "timing",
            status: "unobserved",
            weight,
          });
    }
    if (!evaluation.velocityWeight) continue;
    const emphasis = mark?.emphasis;
    const weight = evaluation.velocityWeight;
    if (!attempts) {
      if (emphasis && lost.has(e.id))
        results.push({
          id: e.id,
          eventId: e.id,
          dimension: "velocity",
          status: "unobserved",
          weight,
        });
      continue;
    }
    const { channel, epoch } = attempts[0];
    const key = JSON.stringify([lane, channel, epoch, attempts.length]);
    const velocity =
      attempts.reduce((sum, n) => sum + n.velocity, 0) / attempts.length;
    if (!emphasis) {
      baseline.set(key, { index, velocity });
      continue;
    }
    const before = baseline.get(key);
    const bounds = evaluation.velocity[emphasis];
    if (
      !before ||
      index - before.index > evaluation.velocity.precedingAttacks ||
      before.velocity * bounds.min > 127
    ) {
      results.push({
        id: e.id,
        eventId: e.id,
        dimension: "velocity",
        status: "unobserved",
        weight,
      });
      continue;
    }
    const observed = velocity / before.velocity;
    results.push({
      id: e.id,
      eventId: e.id,
      dimension: "velocity",
      weight,
      observed,
      ...bounds,
      status: classify(observed, bounds.min, bounds.max),
    });
  }
  return results;
}

export function articulationMetrics(results: readonly ArticulationResult[]) {
  const accuracy = (observations: readonly ArticulationResult[]) => {
    const evaluated = observations.filter(
      (r) =>
        r.status === "correct" || r.status === "low" || r.status === "high",
    );
    const total = evaluated.reduce((sum, r) => sum + r.weight, 0);
    const correct = evaluated.filter((r) => r.status === "correct");
    return {
      evaluated: evaluated.length,
      correct: correct.length,
      pending: observations.filter((r) => r.status === "pending").length,
      unobserved: observations.filter((r) => r.status === "unobserved").length,
      accuracy: total
        ? (100 * correct.reduce((sum, r) => sum + r.weight, 0)) / total
        : null,
    };
  };
  return {
    ...accuracy(results),
    timing: accuracy(results.filter((r) => r.dimension === "timing")),
    velocity: accuracy(results.filter((r) => r.dimension === "velocity")),
  };
}
