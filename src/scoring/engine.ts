import type { MidiEvent } from "../midi/adapter";
import { TPQ, noteheads, type ScoreEvent, type Settings } from "../score/model";
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
    public settings: Settings,
    public chordOnsetMs = DEFAULT_CHORD_ONSET_MS,
  ) {}
  get target() {
    return this.notes[this.index];
  }
  get group() {
    const n = this.target;
    return n
      ? this.notes
          .slice(this.index)
          .filter((x) => x.bar === n.bar && x.onset === n.onset)
      : [];
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
    if (this.pauseAt) {
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
  }
  pause(now: number) {
    if (!this.running) return;
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
  tick(now: number) {
    if (!this.running || this.settings.mode !== "timed") return;
    while (
      this.target &&
      now > this.expected(this.target) + Math.max(450, this.settings.tolerance)
    ) {
      for (const n of this.required)
        if (!this.completed.has(n.id))
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
      this.advance(now);
    }
  }
  input(e: MidiEvent) {
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
    if (!this.running || e.time < this.origin) return;
    const now = e.time - this.settings.offset;
    this.tick(now);
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
    if (!n || (this.settings.mode === "timed" && Math.abs(timing) > 450)) {
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
          ? { until: this.captureAt! + this.chordOnsetMs, tones: group }
          : undefined;
      this.advance(now);
    }
  }
  skip(now: number) {
    for (const n of this.required)
      if (!this.completed.has(n.id))
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
    this.advance(now);
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
