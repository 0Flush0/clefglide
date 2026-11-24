import { describe, expect, it } from "vitest";
import type { MidiEvent } from "../midi/adapter";
import {
  chordDefaults,
  durationEvaluationDefaults,
  generateConfigured,
  noteLifetimeDefaults,
  resolveGeneratorConfig,
} from "../generation";
import { articulatedStudy } from "../generation/examples";
import { defaults, noteheads, type ScoreEvent } from "../score/model";
import { articulationMetrics, metrics, Scorer } from "./engine";

const midi = (
  pitch: number,
  time: number,
  type: MidiEvent["type"] = "on",
  velocity = type === "on" ? 80 : 0,
): MidiEvent => ({
  pitch,
  time,
  type,
  velocity,
  channel: 1,
  source: "simulator",
});
const precise = { beatFraction: 0, minMs: 0, maxMs: 0 };
const staccato = resolveGeneratorConfig({
  noteLifetimes: {
    ...noteLifetimeDefaults,
    evaluation: durationEvaluationDefaults,
  },
  rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
  articulation: {
    kind: "enabled",
    voices: ["right:main"],
    touch: [{ value: "staccato" }],
    evaluation: { kind: "evaluate", tolerance: precise },
  },
});

describe("articulation evaluation using simulated MIDI", () => {
  it("uses physical staccato release while the pedal continues sound and grades it once", () => {
    const e = generateConfigured(staccato, "release").events[0];
    const s = new Scorer(
      [e],
      { ...defaults, mode: "timed", offset: 15 },
      120,
      staccato,
    );
    s.start(0);
    s.input(midi(64, 3999, "sustain", 127));
    const onset = s.expected(e) + 45;
    s.input(midi(e.midi, onset));
    s.input(midi(e.midi, onset + 500, "off"));
    expect(s.lifetimes?.activeNotes[0].pedalSustained).toBe(true);
    expect(s.articulationResults).toEqual([
      expect.objectContaining({
        status: "correct",
        observed: 500,
        min: 350,
        max: 650,
      }),
    ]);
    expect(s.durationResults).toEqual([]);
    expect(s.results[0].errorMs).toBe(30);
    expect(metrics(s.results, s.elapsed, defaults.tolerance).correct).toBe(1);
    s.input(midi(64, onset + 1500, "sustain"));
    expect(s.lifetimes?.attempts.get(e.id)?.soundReleaseMs).toBe(onset + 1485);
    expect(articulationMetrics(s.articulationResults).accuracy).toBe(100);
  });

  it("projects intended durations into duration scoring when articulation timing evaluation is disabled", () => {
    const c = resolveGeneratorConfig(
      { articulation: { evaluation: { kind: "disabled" } } },
      staccato,
    );
    const e = generateConfigured(c, "duration-owner").events[0];
    const s = new Scorer([e], { ...defaults, mode: "timed" }, 120, c);
    s.start(0);
    s.input(midi(e.midi, s.expected(e)));
    s.input(midi(e.midi, s.expected(e) + 500, "off"));
    expect(s.durationResults[0]).toMatchObject({
      status: "correct",
      physical: { errorMs: 0 },
    });
    expect(articulationMetrics(s.articulationResults).accuracy).toBe(null);
  });

  it("scales timing tolerance by tempo and applies its configured floor and ceiling", () => {
    const c = resolveGeneratorConfig(
      {
        articulation: {
          evaluation: {
            tolerance: { beatFraction: 0.05, minMs: 20, maxMs: 40 },
          },
        },
      },
      staccato,
    );
    const e = generateConfigured(c, "scaled-tolerance").events[0];
    for (const [bpm, tolerance] of [
      [60, 40],
      [100, 30],
      [180, 20],
    ]) {
      const s = new Scorer([e], { ...defaults, mode: "timed", bpm }, 120, c);
      s.start(0);
      s.input(midi(e.midi, s.expected(e)));
      s.input(midi(e.midi, s.expected(e) + (0.5 * 60000) / bpm, "off"));
      expect(s.articulationResults[0].max).toBeCloseTo(
        (0.65 * 60000) / bpm + tolerance,
      );
      expect(s.articulationResults[0].status).toBe("correct");
    }
  });

  it("keeps the existing pedal prohibition without a duplicate release result", () => {
    const c = resolveGeneratorConfig(
      {
        noteLifetimes: {
          kind: "explicit",
          evaluation: { kind: "evaluate", pedalTreatment: "forbid" },
        },
      },
      staccato,
    );
    const e = generateConfigured(c, "pedal-ownership").events[0];
    const s = new Scorer([e], { ...defaults, mode: "timed" }, 120, c);
    s.start(0);
    const t = s.expected(e);
    s.input(midi(e.midi, t));
    s.input(midi(64, t + 100, "sustain", 127));
    s.input(midi(e.midi, t + 500, "off"));
    expect(s.articulationResults[0].status).toBe("correct");
    expect(s.durationResults[0]).toMatchObject({ status: "pedal" });
    expect(s.durationResults[0].physical).toBeUndefined();
  });

  it.each(["overlap", "separation"] as const)(
    "evaluates %s relative to the next accepted attack",
    (kind) => {
      const c = resolveGeneratorConfig(
        {
          articulation: {
            touch: [{ value: kind === "overlap" ? "legato" : "non-legato" }],
          },
        },
        staccato,
      );
      const events = generateConfigured(c, "relational").events;
      const i = events.findIndex((e) => e.articulation?.timing?.kind === kind);
      const pair = events.slice(i, i + 2);
      expect(pair).toHaveLength(2);
      const [source, next] = pair;
      const s = new Scorer(
        events.slice(i),
        { ...defaults, mode: "timed", bpm: 120 },
        120,
        c,
      );
      s.start(0);
      const a = s.expected(source) + 20;
      const b = s.expected(next) + 40;
      const target = source.articulation!.timing!;
      if (target.kind === "duration") throw new Error("Expected a connection.");
      const release = midi(
        source.midi,
        b + (target.offsetTicks * 500) / 480,
        "off",
      );
      s.input(midi(source.midi, a));
      if (kind === "separation") s.input(release);
      s.input(midi(next.midi, b));
      if (kind === "overlap") s.input(release);
      expect(s.articulationResults[0]).toMatchObject({
        status: "correct",
        observed: (target.offsetTicks * 500) / 480,
      });
    },
  );

  it("retains a pending slur across append, and censors connections interrupted by pause", () => {
    const c = articulatedStudy({
      articulation: {
        touch: [],
        emphasis: [],
        slurs: {
          probability: 1,
          crossPhrase: true,
          lengths: [{ value: 3 }],
          styles: [{ value: "legato" }],
        },
        evaluation: {
          kind: "evaluate",
          velocityWeight: 0,
          waitMode: "disabled",
          tolerance: precise,
        },
      },
    });
    const p = generateConfigured(c, "scoring-cross");
    const q = generateConfigured(c, p.seed, p.final);
    const source = p.events.at(-1)!;
    const next = q.events[0];
    expect(source.articulation?.timing).toMatchObject({
      kind: "connected",
      nextEventId: next.id,
    });
    for (const pause of [false, true]) {
      const s = new Scorer([source], { ...defaults, mode: "timed" }, 120, c);
      s.start(0);
      s.input(midi(source.midi, s.expected(source)));
      s.input(midi(source.midi, s.expected(next) - 10, "off"));
      expect(s.articulationResults[0].status).toBe("pending");
      s.appendNotes(q.events);
      if (pause) {
        s.pause(s.expected(next));
        s.start(s.expected(next) + 500);
      }
      s.input(midi(next.midi, s.expected(next)));
      expect(s.articulationResults[0]).toMatchObject({
        status: pause ? "unobserved" : "correct",
        ...(pause ? {} : { observed: -10 }),
      });
    }
  });

  it("assesses relative chord velocity in wait mode without imposing rhythmic accuracy", () => {
    const c = resolveGeneratorConfig({
      chords: { ...chordDefaults, probability: 1 },
      noteLifetimes: noteLifetimeDefaults,
      articulation: {
        kind: "enabled",
        voices: ["right:main"],
        emphasis: [{ value: "accent" }],
        touch: [{ value: "tenuto" }],
        evaluation: {
          kind: "evaluate",
          timingWeight: 1,
          velocityWeight: 2,
          waitMode: "velocity-only",
        },
      },
    });
    const generated = generateConfigured(c, "chord-velocity").events.filter(
      (e) => noteheads(e).length === 2,
    );
    expect(generated.length).toBeGreaterThanOrEqual(2);
    const [base, contrast] = generated;
    const unmarked: ScoreEvent = { ...base, articulation: undefined };
    const s = new Scorer([unmarked, contrast], defaults, 120, c);
    s.start(0);
    noteheads(unmarked).forEach((n, i) =>
      s.input(midi(n.midi, i * 10, "on", 60 + i * 10)),
    );
    noteheads(unmarked).forEach((n, i) =>
      s.input(midi(n.midi, 50 + i * 10, "off")),
    );
    noteheads(contrast).forEach((n, i) =>
      s.input(midi(n.midi, 12000 + i * 10, "on", 75 + i * 10)),
    );
    expect(s.articulationResults).toEqual([
      expect.objectContaining({
        dimension: "velocity",
        status: "correct",
        observed: 80 / 65,
        weight: 2,
      }),
    ]);
    expect(s.results.every((r) => r.errorMs === undefined)).toBe(true);
    const incomplete = new Scorer([unmarked, contrast], defaults, 120, c);
    incomplete.start(0);
    incomplete.skip(0);
    noteheads(contrast).forEach((n, i) =>
      incomplete.input(midi(n.midi, 500 + i * 10)),
    );
    expect(incomplete.articulationResults[0].status).toBe("unobserved");
    expect(
      articulationMetrics(incomplete.articulationResults).accuracy,
    ).toBeNull();
  });
});
