import type { MidiEvent } from "../midi/adapter";
import type { ValidatedGeneratorConfig } from "../generation/config";
import { TPQ, type LifetimeNote, type ScoringSettings } from "../score/model";
import type { ArticulationTiming } from "../score/articulationModel";
import { performedLifetime } from "../score/lifetimes";

export type ReleaseStatus = "pending" | "correct" | "early" | "late";
export interface ReleaseResult {
  expectedMs: number;
  releasedAtMs?: number;
  errorMs?: number;
  status: ReleaseStatus;
}
export interface DurationResult {
  id: string;
  status: ReleaseStatus | "pedal" | "interrupted" | "miss" | "skip";
  attackMs?: number;
  physical?: ReleaseResult;
  sound?: ReleaseResult;
  interruption?: "pause" | "disconnect" | "finish";
}
interface Attempt {
  note: LifetimeNote;
  channel: string;
  key: string;
  attackMs: number;
  velocity: number;
  epoch: number;
  keyReleaseMs?: number;
  soundReleaseMs?: number;
  pedalViolation: boolean;
  interrupted: boolean;
  interruptedAtMs?: number;
  result?: DurationResult;
}
type LifetimeConfig = Extract<
  ValidatedGeneratorConfig["noteLifetimes"],
  { kind: "explicit" }
>;

/** Tracks MIDI key edges and damper state per source/channel, independently of attack cursor. */
export class LifetimeTracker {
  readonly results: DurationResult[] = [];
  readonly attempts = new Map<string, Attempt>();
  private live = new Set<Attempt>();
  private down = new Set<string>();
  private pedals = new Set<string>();
  private owners = new Map<string, Attempt>();
  private epoch = 0;
  latestMs = -Infinity;
  get transportEpoch() {
    return this.epoch;
  }
  readonly evaluate: boolean;
  constructor(
    readonly config: LifetimeConfig,
    readonly settings: ScoringSettings,
  ) {
    this.evaluate =
      config.evaluation.kind === "evaluate" &&
      (settings.mode === "timed" ||
        config.evaluation.waitMode === "performed-duration");
  }
  get activeNotes() {
    return [...this.live].map((a) => ({
      id: a.note.id,
      hand: a.note.hand,
      plannedFinger: a.note.finger,
      midi: a.note.midi,
      physicallyHeld: a.keyReleaseMs === undefined,
      pedalSustained: a.keyReleaseMs !== undefined,
      attackMs: a.attackMs,
    }));
  }
  /** Observation is not credit: wrong attacks and pedal never satisfy a scored note. */
  observe(e: MidiEvent) {
    if (
      !Number.isFinite(e.time) ||
      !Number.isInteger(e.channel) ||
      e.channel < 1 ||
      e.channel > 16 ||
      !Number.isInteger(e.pitch) ||
      e.pitch < 0 ||
      e.pitch > 127 ||
      !Number.isFinite(e.velocity) ||
      e.velocity < 0 ||
      e.velocity > 127
    )
      throw new Error("Invalid MIDI lifetime observation.");
    const now = e.time - this.settings.offset;
    const channel = `${e.source}:${e.channel}`,
      key = `${channel}:${e.pitch}`;
    if (e.type === "sustain") {
      const down = e.velocity >= 64;
      if (down) this.pedals.add(channel);
      else this.pedals.delete(channel);
      for (const a of this.live) {
        if (
          a.channel !== channel ||
          a.soundReleaseMs !== undefined ||
          a.interrupted
        )
          continue;
        if (
          down &&
          this.config.evaluation.kind === "evaluate" &&
          this.config.evaluation.pedalTreatment === "forbid"
        )
          a.pedalViolation = true;
        if (!down && a.keyReleaseMs !== undefined) a.soundReleaseMs = now;
      }
    } else if (e.type === "off" || e.velocity === 0) {
      const a = this.owners.get(key);
      if (a && now < a.attackMs)
        throw new Error("A release cannot precede its observed attack.");
      if (!this.down.delete(key)) {
        this.tick(now);
        return;
      }
      if (a && !a.interrupted) {
        a.keyReleaseMs = now;
        if (!this.pedals.has(channel)) a.soundReleaseMs = now;
      }
      this.owners.delete(key);
    } else {
      if (this.down.has(key)) {
        this.tick(now);
        return;
      }
      // MIDI cannot separate the acoustic tails of successive strikes of one string.
      // A fresh attack ends the preceding released/pedal-held logical voice.
      for (const a of this.live)
        if (
          a.key === key &&
          a.keyReleaseMs !== undefined &&
          a.soundReleaseMs === undefined &&
          !a.interrupted
        )
          a.soundReleaseMs = now;
      this.down.add(key);
    }
    this.tick(now);
  }
  accept(
    note: LifetimeNote,
    e: MidiEvent,
    origin: number,
    timing?: ArticulationTiming,
    articulationOwnsTiming = false,
  ) {
    if (this.attempts.has(note.id)) return;
    const now = e.time - this.settings.offset;
    const channel = `${e.source}:${e.channel}`,
      key = `${channel}:${e.pitch}`;
    const a: Attempt = {
      note: structuredClone(note),
      channel,
      key,
      attackMs: now,
      velocity: e.velocity,
      epoch: this.epoch,
      pedalViolation: this.pedals.has(channel),
      interrupted: false,
    };
    this.attempts.set(note.id, a);
    this.live.add(a);
    this.owners.set(key, a);
    if (this.evaluate && this.config.evaluation.kind === "evaluate") {
      const opts = this.config.evaluation;
      if (articulationOwnsTiming && opts.pedalTreatment !== "forbid") return;
      const performance = performedLifetime(note.lifetime, timing);
      const target = (tick: number) =>
        this.settings.mode === "timed"
          ? origin + (tick * 60000) / (TPQ * this.settings.bpm)
          : now +
            ((tick - note.lifetime.onsetTick) * 60000) /
              (TPQ * this.settings.bpm);
      const physical =
        !articulationOwnsTiming && performance.keyHold.kind === "required"
          ? {
              expectedMs: target(performance.keyHold.releaseTick),
              status: "pending" as const,
            }
          : undefined;
      a.result = {
        id: note.id,
        status: "pending",
        attackMs: now,
        ...(physical ? { physical } : {}),
        ...(opts.pedalTreatment === "sounding"
          ? {
              sound: {
                expectedMs: target(performance.intendedReleaseTick),
                status: "pending",
              },
            }
          : {}),
      };
      this.results.push(a.result);
      this.settle(a, now);
    }
  }
  private settle(a: Attempt, now: number) {
    const r = a.result,
      e = this.config.evaluation;
    if (!r || a.interrupted || e.kind !== "evaluate") return;
    const release = (phase: ReleaseResult, actual?: number) => {
      if (actual !== undefined) {
        phase.releasedAtMs = actual;
        phase.errorMs = actual - phase.expectedMs;
        phase.status =
          phase.errorMs < -e.toleranceMs && e.earlyRelease === "penalize"
            ? "early"
            : phase.errorMs > e.toleranceMs && e.lateRelease === "penalize"
              ? "late"
              : "correct";
      } else if (
        now > phase.expectedMs + e.toleranceMs &&
        e.lateRelease === "penalize"
      )
        phase.status = "late";
      else if (now >= phase.expectedMs && e.lateRelease === "ignore")
        phase.status = "correct";
    };
    if (r.physical) release(r.physical, a.keyReleaseMs);
    if (r.sound) release(r.sound, a.soundReleaseMs);
    const phases = [r.physical, r.sound].filter((x): x is ReleaseResult => !!x);
    r.status =
      a.pedalViolation && e.pedalTreatment === "forbid"
        ? "pedal"
        : phases.some((x) => x.status === "early")
          ? "early"
          : phases.some((x) => x.status === "late")
            ? "late"
            : (phases.length > 0 || a.keyReleaseMs !== undefined) &&
                phases.every((x) => x.status === "correct")
              ? "correct"
              : "pending";
  }
  tick(now: number) {
    if (!Number.isFinite(now)) throw new Error("Invalid lifetime clock.");
    this.latestMs = Math.max(now, this.latestMs);
    for (const a of this.live) {
      this.settle(a, now);
      if (a.soundReleaseMs !== undefined) this.live.delete(a);
    }
  }
  unattempted(id: string, status: "miss" | "skip") {
    if (this.evaluate && !this.results.some((r) => r.id === id))
      this.results.push({ id, status });
  }
  interrupt(reason: "pause" | "disconnect" | "finish") {
    for (const a of this.live) {
      if (a.soundReleaseMs !== undefined || a.interrupted) continue;
      a.interrupted = true;
      a.interruptedAtMs = this.latestMs;
      if (a.result?.status === "pending") {
        a.result.status = "interrupted";
        a.result.interruption = reason;
      }
    }
    this.down.clear();
    this.pedals.clear();
    this.owners.clear();
    this.live.clear();
    this.epoch++;
  }
}

/** Pitch/onset metrics stay in metrics(); unobserved durations have no fabricated accuracy. */
export function durationMetrics(results: DurationResult[]) {
  const count = (status: DurationResult["status"]) =>
    results.filter((r) => r.status === status).length;
  const evaluated = results.filter((r) =>
    ["correct", "early", "late", "pedal"].includes(r.status),
  ).length;
  return {
    evaluated,
    correct: count("correct"),
    early: count("early"),
    late: count("late"),
    pedalViolations: count("pedal"),
    interrupted: count("interrupted"),
    pending: count("pending"),
    missed: count("miss"),
    skipped: count("skip"),
    accuracy: evaluated ? (count("correct") * 100) / evaluated : null,
  };
}
