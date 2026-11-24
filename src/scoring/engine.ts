import type { MidiEvent } from "../midi/adapter";
import {
  activeHands,
  hasArticulation,
  hasTies,
  configForHand,
} from "../generation/config/handParameters";
import {
  TPQ,
  noteheads,
  type ScoreEvent,
  type ScoringSettings,
} from "../score/model";
import {
  generatorConfigFingerprint,
  type ValidatedGeneratorConfig,
} from "../generation/config";
import { lifetimeNotes, attackEvents } from "../score/lifetimes";
import { validateTieSegments } from "../score/ties";
import { validateLifetimePlan } from "../score/lifetimeValidation";
import { LifetimeTracker } from "./lifetimes";
import {
  evaluateArticulation,
  isArticulationTimingEvaluated,
  validateScoredArticulation,
} from "./articulation";
export { articulationMetrics } from "./articulation";
export type { ArticulationResult } from "./articulation";
export { durationMetrics } from "./lifetimes";
export type { DurationResult, ReleaseResult } from "./lifetimes";
export const DEFAULT_CHORD_ONSET_MS = 120;
export interface Result {
  id: string;
  pitch: number;
  hand: string;
  kind: "correct" | "wrong" | "extra" | "miss" | "skip";
  first: boolean;
  errorMs?: number;
  latency?: number;
  eventId?: string;
  eventSize?: number;
  simultaneous?: boolean;
}
export class Scorer {
  private notationEvents?: ScoreEvent[];
  readonly lifetimes?: LifetimeTracker;
  private lifetimePaused = false;
  private lifetimeNoteCount = 0;
  private lifetimeScoringContext?: string;
  index = 0;
  held = new Set<number>();
  sounding = new Set<number>();
  sustained = new Set<number>();
  pedal = false;
  matched = new Set<string>();
  failed = new Set<string>();
  results: Result[] = [];
  running = false;
  origin = 0;
  pauseAt = 0;
  elapsed = 0;
  activated = 0;
  activeStart = 0;
  captureAt: number | null = null;
  captureTimes = new Map<string, number>();
  recentCapture?: {
    until: number;
    tones: {
      id: string;
      eventId: string;
      eventSize: number;
      midi: number;
      hand: string;
    }[];
  };
  completed = new Set<string>();
  constructor(
    public notes: ScoreEvent[],
    public settings: ScoringSettings,
    public chordOnsetMs = DEFAULT_CHORD_ONSET_MS,
    public readonly config?: ValidatedGeneratorConfig,
  ) {
    if (
      config?.independentVoices ||
      hasArticulation(config) ||
      hasTies(config)
    ) {
      if (
        !hasTies(config) &&
        notes.some((e) => e.tie || noteheads(e).some((n) => n.tie))
      )
        throw new Error("Tie scoring requires the enabled tie configuration.");
      this.validateTies(notes);
      this.notationEvents = [...notes];
      this.notes = attackEvents(notes);
      if (config?.independentVoices || config?.articulation)
        this.notes = this.notes.filter((e) => e.kind === "note");
      notes = this.notes;
    } else if (notes.some((e) => e.tie || noteheads(e).some((n) => n.tie))) {
      throw new Error("Tie scoring requires the enabled tie configuration.");
    }
    this.validateArticulationNotes(notes);
    if (config?.noteLifetimes.kind === "explicit") {
      if (
        !Number.isFinite(settings.bpm) ||
        settings.bpm <= 0 ||
        !Number.isFinite(settings.offset)
      )
        throw new Error(
          "Lifetime scoring requires a positive finite tempo and finite input offset.",
        );
      if (config.notation.beats !== settings.beats)
        throw new Error("Lifetime scoring and score meter must agree.");
      this.validateLifetimeNotes(notes);
      this.lifetimeNoteCount = notes.length;
      this.lifetimes = new LifetimeTracker(config.noteLifetimes, settings);
      this.lifetimeScoringContext = JSON.stringify(this.scoringContext());
    }
  }
  private validateTies(events: ScoreEvent[]) {
    if (
      this.config?.articulation &&
      events.some(
        (e) =>
          (e.articulation || e.slur) &&
          (e.kind === "rest" ||
            noteheads(e).some((n) => (n.tie?.index ?? 0) > 0)),
      )
    )
      throw new Error("Articulation must annotate complete scored attacks.");
    const config = this.config;
    const policy = config
      ? (event: ScoreEvent) => configForHand(config, event.hand).notation.ties
      : undefined;
    const errors = validateTieSegments(
      events,
      this.settings.beats,
      [],
      0,
      undefined,
      policy,
    );
    if (errors.length) throw new Error(errors.join(" "));
  }
  private validateArticulationNotes(events: ScoreEvent[]) {
    const config = this.config;
    if (config?.handParameters) {
      for (const hand of activeHands(config))
        validateScoredArticulation(
          events.filter((event) => event.hand === hand),
          configForHand(config, hand).articulation,
        );
    } else validateScoredArticulation(events, config?.articulation);
  }
  private validateLifetimeNotes(notes: ScoreEvent[]) {
    const records = lifetimeNotes(notes);
    const errors = validateLifetimePlan({ notes: records });
    let previous = -1;
    for (const e of notes) {
      if (e.kind !== "note")
        throw new Error(
          "Pass sounded events to the scorer; rests belong to the score timeline.",
        );
      const tick = e.bar * this.settings.beats * TPQ + e.onset;
      if (
        !Number.isSafeInteger(e.bar) ||
        e.bar < 0 ||
        !Number.isSafeInteger(e.onset) ||
        e.onset < 0 ||
        e.onset >= this.settings.beats * TPQ ||
        !Number.isSafeInteger(e.duration) ||
        e.duration <= 0 ||
        tick < previous ||
        !Number.isSafeInteger(tick) ||
        tick < 0 ||
        noteheads(e).some((n) => n.lifetime?.onsetTick !== tick)
      )
        errors.push("Scored lifetime attacks must match sorted score onsets.");
      if (
        this.config?.independentVoices &&
        (!e.voiceId ||
          noteheads(e).some((n) => n.lifetime?.voiceId !== e.voiceId))
      )
        errors.push(
          "Scored attacks must retain their independent voice identity.",
        );
      previous = tick;
    }
    const c = this.config?.noteLifetimes;
    if (
      c?.kind === "explicit" &&
      c.evaluation.kind === "evaluate" &&
      c.evaluation.pedalTreatment !== "sounding" &&
      records.some((n) => n.lifetime.keyHold.kind !== "required")
    )
      errors.push(
        "Physical duration evaluation requires explicit physical release targets.",
      );
    if (errors.length) throw new Error(errors.join(" "));
  }
  private syncLifetimeNotes() {
    if (
      this.lifetimes &&
      this.lifetimeScoringContext !== JSON.stringify(this.scoringContext())
    )
      throw new Error(
        "Start a new scorer to change the lifetime scoring clock or policy.",
      );
    if (this.lifetimes && this.lifetimeNoteCount !== this.notes.length) {
      if (this.notationEvents)
        throw new Error(
          "Use appendNotes to append tied notation without duplicating attacks.",
        );
      if (this.notes.length < this.lifetimeNoteCount)
        throw new Error(
          "Do not remove scored lifetime events from an active scorer.",
        );
      this.validateAppendBoundary(
        this.notes.slice(this.lifetimeNoteCount),
        this.notes.slice(0, this.lifetimeNoteCount),
      );
      this.validateLifetimeNotes(this.notes);
      this.lifetimeNoteCount = this.notes.length;
    }
  }
  private scoringContext() {
    return {
      mode: this.settings.mode,
      bpm: this.settings.bpm,
      beats: this.settings.beats,
      offsetMs: this.settings.offset,
      onsetToleranceMs: this.settings.tolerance,
      chordOnsetMs: this.chordOnsetMs,
    };
  }
  private validateAppendBoundary(
    incoming: ScoreEvent[],
    retained = this.notes,
  ) {
    const previous = retained.at(-1),
      next = incoming[0];
    if (
      previous &&
      next &&
      next.bar * this.settings.beats * TPQ + next.onset <=
        previous.bar * this.settings.beats * TPQ + previous.onset
    )
      throw new Error(
        "Append complete future onset groups; an existing onset group cannot be extended retroactively.",
      );
  }
  /** Streaming preserves active releases even after the attack cursor reaches a phrase end. */
  appendNotes(notes: ScoreEvent[]) {
    this.syncLifetimeNotes();
    let notation: ScoreEvent[] | undefined;
    if (this.notationEvents) {
      if (
        !hasTies(this.config) &&
        notes.some((e) => e.tie || noteheads(e).some((n) => n.tie))
      )
        throw new Error("Tie scoring requires the enabled tie configuration.");
      notation = [...this.notationEvents, ...notes];
      this.validateAppendBoundary(notes, this.notationEvents);
      this.validateTies(notation);
      notes = attackEvents(notes);
      if (this.config?.independentVoices || this.config?.articulation)
        notes = notes.filter((e) => e.kind === "note");
    }
    if (this.lifetimes) {
      this.validateAppendBoundary(notes);
      this.validateLifetimeNotes([...this.notes, ...notes]);
    }
    this.validateArticulationNotes([...this.notes, ...notes]);
    this.notes.push(...notes);
    if (notation) this.notationEvents = notation;
    this.lifetimeNoteCount = this.notes.length;
  }
  get durationResults() {
    return this.lifetimes?.results ?? [];
  }
  get articulationResults() {
    const config = this.config;
    const tracker = this.lifetimes;
    if (!config || !hasArticulation(config) || !tracker) return [];
    this.syncLifetimeNotes();
    return (config.handParameters ? activeHands(config) : [undefined]).flatMap(
      (hand) => {
        const policy = hand
          ? configForHand(config, hand).articulation
          : config.articulation;
        if (!policy) return [];
        return evaluateArticulation(
          hand ? this.notes.filter((event) => event.hand === hand) : this.notes,
          tracker,
          policy,
          this.settings,
          this.chordOnsetMs,
          new Set(
            this.results
              .filter((r) => r.kind === "miss" || r.kind === "skip")
              .map((r) => r.id),
          ),
          !this.running && this.lifetimePaused,
        );
      },
    );
  }
  /** Runtime scoring context; future history must additionally retain assistance state. */
  get scoringFingerprint() {
    if (!this.lifetimes || !this.config) return undefined;
    this.syncLifetimeNotes();
    return `${generatorConfigFingerprint(this.config)}:scoring:${this.lifetimeScoringContext}`;
  }
  disconnect(now: number) {
    this.pause(now, "disconnect");
  }
  finish(now: number) {
    this.pause(now, "finish");
  }
  get target() {
    return this.notes[this.index];
  }
  get group() {
    const n = this.target;
    if (!n) return [];
    let end = this.index + 1;
    while (this.notes[end]?.bar === n.bar && this.notes[end]?.onset === n.onset)
      end++;
    return this.notes.slice(this.index, end);
  }
  get required() {
    return this.group.flatMap((event) =>
      noteheads(event).map((n) => ({
        ...event,
        ...n,
        eventId: event.id,
        eventSize: noteheads(event).length,
      })),
    );
  }
  get missingPitches() {
    return this.required
      .filter((n) => !this.matched.has(n.id))
      .map((n) => n.midi);
  }
  start(now: number) {
    this.syncLifetimeNotes();
    if (this.lifetimes && this.running) return;
    if (this.pauseAt || (this.lifetimes && this.lifetimePaused)) {
      const delta = now - this.pauseAt;
      this.origin += delta;
      this.activated += delta;
      this.pauseAt = 0;
    } else {
      this.origin =
        now +
        (this.settings.mode === "timed"
          ? (this.settings.beats * 60000) / this.settings.bpm
          : 0);
      this.activated = this.origin;
    }
    this.activeStart = Math.max(now, this.origin);
    this.running = true;
    this.lifetimePaused = false;
  }
  pause(now: number, reason: "pause" | "disconnect" | "finish" = "pause") {
    if (!this.running) return;
    if (hasArticulation(this.config))
      this.lifetimes?.tick(now - this.settings.offset);
    this.lifetimes?.interrupt(reason);
    this.lifetimePaused = true;
    this.elapsed += Math.max(0, now - this.activeStart);
    this.running = false;
    this.pauseAt = now;
    this.held.clear();
    this.sounding.clear();
    this.sustained.clear();
    this.pedal = false;
    this.matched.clear();
    this.captureAt = null;
    this.captureTimes.clear();
    this.recentCapture = undefined;
  }
  expected(n: ScoreEvent) {
    return (
      this.origin +
      (((n.bar * this.settings.beats * TPQ + n.onset) / TPQ) * 60000) /
        this.settings.bpm
    );
  }
  advance(now: number) {
    this.index += this.group.length;
    this.matched.clear();
    this.captureAt = null;
    this.captureTimes.clear();
    this.activated = now;
  }
  /** Dense independent onsets divide the matching window at the midpoint. */
  private nextOnsetBoundary() {
    const current = this.target;
    const next = this.notes[this.index + this.group.length];
    return current && next
      ? (this.expected(current) + this.expected(next)) / 2
      : Infinity;
  }
  tick(now: number, calibratedInput = false) {
    this.syncLifetimeNotes();
    if (this.running)
      this.lifetimes?.tick(now - (calibratedInput ? 0 : this.settings.offset));
    if (!this.running || this.settings.mode !== "timed") return;
    const independent = this.config?.independentVoices;
    if (independent && !calibratedInput) now -= this.settings.offset;
    while (
      this.target &&
      (now >
        this.expected(this.target) + Math.max(450, this.settings.tolerance) ||
        (independent && now >= this.nextOnsetBoundary()))
    ) {
      for (const n of this.required)
        if (!this.completed.has(n.id)) {
          this.recordUnattemptedDuration(n, "miss");
          this.results.push({
            id: n.id,
            pitch: n.midi,
            hand: n.hand,
            kind: "miss",
            first: false,
            eventId: n.eventId,
            eventSize: n.eventSize,
            simultaneous: false,
          });
        }
      this.advance(now);
    }
  }
  input(e: MidiEvent) {
    this.syncLifetimeNotes();
    this.lifetimes?.observe(e);
    if (e.type === "sustain") {
      this.pedal = e.velocity >= 64;
      if (!this.pedal) {
        this.sustained.forEach((p) => {
          if (!this.held.has(p)) this.sounding.delete(p);
        });
        this.sustained.clear();
      }
      return;
    }
    if (e.type === "off" || e.velocity === 0) {
      this.held.delete(e.pitch);
      if (this.pedal) this.sustained.add(e.pitch);
      else this.sounding.delete(e.pitch);
      return;
    }
    if (this.held.has(e.pitch)) return;
    this.held.add(e.pitch);
    this.sounding.add(e.pitch);
    const now = e.time - this.settings.offset;
    const independentTimed =
      this.config?.independentVoices && this.settings.mode === "timed";
    if (!this.running || (independentTimed ? now : e.time) < this.origin)
      return;
    this.tick(now, true);
    const group = this.required;
    // A surplus attack can arrive just AFTER the last required chord tone.
    // Keep its original capture window so it cannot improve the next target or
    // leave the just-completed chord falsely marked as an exact simultaneous set.
    if (
      this.recentCapture &&
      now <= this.recentCapture.until &&
      !group.some((n) => n.midi === e.pitch)
    ) {
      const previous = this.recentCapture.tones;
      const nearest = [...previous].sort(
        (a, b) => Math.abs(a.midi - e.pitch) - Math.abs(b.midi - e.pitch),
      )[0];
      this.results.forEach((r) => {
        if (previous.some((n) => n.id === r.id)) r.simultaneous = false;
      });
      this.results.push({
        id: nearest.id,
        pitch: e.pitch,
        hand: nearest.hand,
        kind: "extra",
        first: false,
        eventId: nearest.eventId,
        eventSize: nearest.eventSize,
        simultaneous: false,
      });
      return;
    }
    if (!group.length) return;
    if (
      this.captureAt !== null &&
      now - this.captureAt > this.chordOnsetMs &&
      this.matched.size < group.length
    ) {
      group.forEach((n) => this.failed.add(n.id));
      this.results.forEach((r) => {
        if (group.some((n) => n.id === r.id)) {
          r.first = false;
          r.simultaneous = false;
        }
      });
      for (const [id, time] of this.captureTimes) {
        if (now - time > this.chordOnsetMs) {
          this.matched.delete(id);
          this.captureTimes.delete(id);
        }
      }
      this.captureAt = this.captureTimes.size
        ? Math.min(...this.captureTimes.values())
        : null;
    }
    const n = group.find((x) => x.midi === e.pitch);
    const timing = n ? now - this.expected(n) : 0;
    const previous = this.notes[this.index - 1];
    if (
      !n ||
      (this.settings.mode === "timed" &&
        (Math.abs(timing) > 450 ||
          (independentTimed &&
            previous &&
            now < (this.expected(previous) + this.expected(n)) / 2)))
    ) {
      const t = this.target!;
      group.forEach((n) => this.failed.add(n.id));
      this.results.push({
        id: t.id,
        pitch: e.pitch,
        hand: t.hand,
        kind: this.captureAt === null ? "wrong" : "extra",
        first: false,
        eventId: t.id,
        eventSize: noteheads(t).length,
        simultaneous: false,
      });
      return;
    }
    this.captureAt ??= now;
    this.captureTimes.set(n.id, now);
    this.matched.add(n.id);
    // A target is recorded once even when a chord capture window expires.
    if (!this.completed.has(n.id)) {
      if (this.lifetimes) {
        if (!n.lifetime)
          throw new Error(
            "Missing explicit lifetime on a scored attack; use appendNotes for streaming.",
          );
        this.lifetimes.accept(
          {
            id: n.id,
            eventId: n.eventId,
            midi: n.midi,
            hand: n.hand,
            finger: n.finger,
            positionId: n.positionId,
            lifetime: n.lifetime,
          },
          e,
          this.origin,
          n.articulation?.timing,
          !!n.articulation?.timing &&
            isArticulationTimingEvaluated(
              this.config && configForHand(this.config, n.hand).articulation,
              this.settings.mode,
            ),
        );
      }
      this.completed.add(n.id);
      this.results.push({
        id: n.id,
        pitch: n.midi,
        hand: n.hand,
        kind: "correct",
        first: !this.failed.has(n.id),
        eventId: n.eventId,
        eventSize: n.eventSize,
        simultaneous: false,
        ...(this.settings.mode === "timed"
          ? { errorMs: timing }
          : { latency: now - this.activated }),
      });
    }
    if (this.matched.size === group.length) {
      for (const result of this.results) {
        if (result.kind === "correct" && group.some((n) => n.id === result.id))
          result.simultaneous = !group.some((n) => this.failed.has(n.id));
      }
      this.recentCapture =
        group.length > 1
          ? {
              until: Math.min(
                this.captureAt! + this.chordOnsetMs,
                independentTimed ? this.nextOnsetBoundary() : Infinity,
              ),
              tones: group,
            }
          : undefined;
      this.advance(now);
    }
  }
  skip(now: number) {
    for (const n of this.required)
      if (!this.completed.has(n.id)) {
        this.recordUnattemptedDuration(n, "skip");
        this.results.push({
          id: n.id,
          pitch: n.midi,
          hand: n.hand,
          kind: "skip",
          first: false,
          eventId: n.eventId,
          eventSize: n.eventSize,
          simultaneous: false,
        });
      }
    this.advance(now);
  }
  private recordUnattemptedDuration(
    n: Pick<ScoreEvent, "id" | "hand" | "articulation">,
    status: "miss" | "skip",
  ) {
    const policy = this.lifetimes?.config.evaluation;
    if (
      !n.articulation?.timing ||
      !isArticulationTimingEvaluated(
        this.config && configForHand(this.config, n.hand).articulation,
        this.settings.mode,
      ) ||
      (policy?.kind === "evaluate" && policy.pedalTreatment === "forbid")
    )
      this.lifetimes?.unattempted(n.id, status);
  }
  activeMs(now: number) {
    return Math.max(
      0,
      this.elapsed + (this.running ? Math.max(0, now - this.activeStart) : 0),
    );
  }
}
export function metrics(results: Result[], ms: number, tolerance: number) {
  const correct = results.filter((r) => r.kind === "correct"),
    wrong = results.filter(
      (r) => r.kind === "wrong" || r.kind === "extra",
    ).length,
    eligible = new Set(results.map((r) => r.id)).size;
  const chordEvents = new Map<string, Result[]>();
  results
    .filter((r) => r.eventId && (r.eventSize ?? 1) > 1)
    .forEach((r) =>
      chordEvents.set(r.eventId!, [...(chordEvents.get(r.eventId!) ?? []), r]),
    );
  const chordCorrect = [...chordEvents.values()].filter(
    (rs) =>
      rs.filter((r) => r.kind === "correct" && r.simultaneous && r.first)
        .length === rs[0].eventSize,
  ).length;
  return {
    chordEvents: chordEvents.size,
    chordCorrect,
    chordAccuracy: chordEvents.size
      ? (100 * chordCorrect) / chordEvents.size
      : 0,
    correct: correct.length,
    extra: results.filter((r) => r.kind === "extra").length,
    wrong,
    missed: results.filter((r) => r.kind === "miss").length,
    skipped: results.filter((r) => r.kind === "skip").length,
    accuracy: eligible
      ? (100 * correct.filter((r) => r.first).length) / eligible
      : 0,
    npm: ms > 0 ? correct.length / (ms / 60000) : 0,
    timing: correct.length
      ? (100 *
          correct.filter(
            (r) => r.errorMs !== undefined && Math.abs(r.errorMs) <= tolerance,
          ).length) /
        correct.length
      : 0,
  };
}
