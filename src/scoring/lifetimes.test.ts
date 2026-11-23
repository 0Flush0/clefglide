import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Note } from "tonal";
import { Scorer, durationMetrics, metrics } from "./engine";
import {
  defaults,
  type ScoreEvent,
  type NoteLifetime,
  type Settings,
} from "../score/model";
import type { MidiEvent } from "../midi/adapter";
import {
  resolveGeneratorConfig,
  noteLifetimeDefaults,
  durationEvaluationDefaults,
  type GeneratorOverrides,
} from "../generation/config";

function note(
  id = "a",
  midi = 60,
  onsetTick = 0,
  releaseTick = 480,
  finger = 1,
  keyHold: NoteLifetime["keyHold"] = { kind: "required", releaseTick },
): ScoreEvent {
  const lifetime = {
    voiceId: `voice-${finger}`,
    onsetTick,
    releaseTick,
    durationTicks: releaseTick - onsetTick,
    keyHold,
  };
  const pitch = Note.fromMidi(midi);
  return {
    id,
    kind: "note",
    midi,
    pitch,
    finger,
    hand: "right",
    bar: Math.floor(onsetTick / 1920),
    onset: onsetTick % 1920,
    duration: releaseTick - onsetTick,
    positionId: "position",
    action: "PLAY_WITHIN_POSITION",
    lifetime,
    notes: [
      {
        id,
        midi,
        pitch,
        finger,
        hand: "right",
        lifetime: structuredClone(lifetime),
      },
    ],
  };
}
const input = (
  pitch: number,
  time: number,
  type: MidiEvent["type"] = "on",
  velocity = type === "on" ? 100 : 0,
  channel = 1,
): MidiEvent => ({ pitch, time, type, velocity, channel, source: "simulator" });
function config(overrides: GeneratorOverrides = {}) {
  return resolveGeneratorConfig(
    overrides,
    resolveGeneratorConfig({
      noteLifetimes: {
        ...noteLifetimeDefaults,
        evaluation: {
          ...durationEvaluationDefaults,
          waitMode: "performed-duration",
        },
      },
    }),
  );
}
function scorer(
  notes = [note()],
  overrides: GeneratorOverrides = {},
  settings: Settings = defaults,
) {
  return new Scorer(notes, settings, 120, config(overrides));
}

describe("optional release and duration scoring", () => {
  it.each([
    [980, "correct"],
    [1220, "correct"],
    [979, "early"],
    [1221, "late"],
  ] as const)(
    "classifies release at %i ms as %s with inclusive tolerance",
    (time, status) => {
      const e = scorer();
      e.start(0);
      e.input(input(60, 100));
      e.input(input(60, time, "off"));
      expect(e.durationResults).toHaveLength(1);
      expect(e.durationResults[0]).toMatchObject({
        status,
        physical: {
          expectedMs: 1100,
          releasedAtMs: time,
          errorMs: time - 1100,
        },
      });
      expect(metrics(e.results, 2000, 180).accuracy).toBe(100);
      expect(durationMetrics(e.durationResults).accuracy).toBe(
        status === "correct" ? 100 : 0,
      );
    },
  );
  it("keeps pitch, onset and duration accuracy separate in timed practice", () => {
    const e = scorer([note()], {}, { ...defaults, mode: "timed" });
    e.start(0);
    e.input(input(60, 4250));
    e.input(input(60, 5000, "off"));
    expect(metrics(e.results, 2000, 180)).toMatchObject({
      accuracy: 100,
      timing: 0,
    });
    expect(durationMetrics(e.durationResults)).toMatchObject({
      evaluated: 1,
      accuracy: 100,
    });
    expect(e.durationResults[0].physical?.expectedMs).toBe(5000);
  });
  it("defaults to no duration evaluation in wait or benchmark mode and offers explicit performed duration", () => {
    for (const mode of ["wait", "benchmark"] as const) {
      const e = scorer(
        [note()],
        {
          noteLifetimes: {
            evaluation: { ...durationEvaluationDefaults, waitMode: "disabled" },
          },
        },
        { ...defaults, mode },
      );
      e.start(0);
      e.input(input(60, 10000));
      e.input(input(60, 10001, "off"));
      e.tick(50000);
      expect(e.durationResults).toEqual([]);
      expect(durationMetrics(e.durationResults).accuracy).toBeNull();
      expect(metrics(e.results, 2000, 180).correct).toBe(1);
    }
    const e = scorer();
    e.start(0);
    e.input(input(60, 10000));
    e.input(input(60, 11000, "off"));
    expect(e.durationResults[0].status).toBe("correct");
  });
  it("supports distinct early/late rules without fabricating note-off observations", () => {
    const early = scorer([note()], {
      noteLifetimes: { evaluation: { earlyRelease: "ignore" } },
    });
    early.start(0);
    early.input(input(60, 100));
    early.input(input(60, 101, "off"));
    expect(early.durationResults[0].status).toBe("correct");
    const late = scorer([note()], {
      noteLifetimes: { evaluation: { lateRelease: "ignore" } },
    });
    late.start(0);
    late.input(input(60, 100));
    late.tick(1100);
    expect(late.durationResults[0].status).toBe("correct");
    expect(late.durationResults[0].physical?.releasedAtMs).toBeUndefined();
    expect(late.lifetimes?.activeNotes[0].physicallyHeld).toBe(true);
    const strict = scorer();
    strict.start(0);
    strict.input(input(60, 100));
    strict.tick(1221);
    expect(strict.durationResults[0]).toMatchObject({
      status: "late",
      physical: { status: "late" },
    });
    strict.input(input(60, 2000, "off"));
    expect(strict.durationResults).toHaveLength(1);
    expect(strict.durationResults[0].physical?.errorMs).toBe(900);
  });
  it("supports separate physical and sounding release targets for an authored lifetime", () => {
    const e = scorer(
      [note("a", 60, 0, 960, 1, { kind: "required", releaseTick: 480 })],
      { noteLifetimes: { evaluation: { pedalTreatment: "sounding" } } },
    );
    e.start(0);
    e.input(input(64, 50, "sustain", 127));
    e.input(input(60, 100));
    e.input(input(60, 1100, "off"));
    e.input(input(64, 2100, "sustain", 0));
    expect(e.durationResults[0]).toMatchObject({
      status: "correct",
      physical: { expectedMs: 1100, releasedAtMs: 1100 },
      sound: { expectedMs: 2100, releasedAtMs: 2100 },
    });
  });
  it("follows overlapping held notes independently of the attack cursor", () => {
    const e = scorer([
      note("held", 60, 0, 960, 1),
      note("moving", 64, 480, 960, 3),
    ]);
    e.start(0);
    e.input(input(60, 100));
    e.input(input(64, 1100));
    expect(e.index).toBe(2);
    expect(e.lifetimes?.activeNotes.map((n) => n.id)).toEqual([
      "held",
      "moving",
    ]);
    e.input(input(64, 2100, "off"));
    e.input(input(60, 2100, "off"));
    expect(e.lifetimes?.activeNotes).toEqual([]);
    expect(durationMetrics(e.durationResults)).toMatchObject({
      correct: 2,
      accuracy: 100,
    });
  });
  it("evaluates each chord head independently, including partial chord credit and capture retries", () => {
    const a = note("chord", 60, 0, 480, 1),
      b = note("head", 64, 0, 480, 3);
    a.notes!.push(b.notes![0]);
    const e = scorer([a]);
    e.start(0);
    e.input(input(60, 100));
    e.input(input(64, 150));
    e.input(input(60, 500, "off"));
    e.input(input(64, 1150, "off"));
    expect(e.durationResults.map((r) => r.status)).toEqual([
      "early",
      "correct",
    ]);
    expect(metrics(e.results, 2000, 180)).toMatchObject({
      chordAccuracy: 100,
      accuracy: 100,
    });
    expect(durationMetrics(e.durationResults).accuracy).toBe(50);
    const partial = scorer([a]);
    partial.start(0);
    partial.input(input(60, 100));
    partial.skip(200);
    partial.input(input(60, 1100, "off"));
    expect(partial.durationResults.map((r) => r.status)).toEqual([
      "correct",
      "skip",
    ]);
  });
  it("requires fresh repeated attacks and never improves an old duration by retrying its chord tone", () => {
    const e = scorer([note("a"), note("b", 60, 480, 960)]);
    e.start(0);
    e.input(input(60, 100));
    e.input(input(60, 101));
    expect(e.index).toBe(1);
    expect(e.durationResults).toHaveLength(1);
    e.input(input(60, 1100, "off"));
    e.input(input(60, 1100));
    e.input(input(60, 2100, "off"));
    expect(e.durationResults.map((r) => r.status)).toEqual([
      "correct",
      "correct",
    ]);
    const a = note("chord"),
      b = note("head", 64, 0, 480, 3);
    a.notes!.push(b.notes![0]);
    const retry = scorer([a]);
    retry.start(0);
    retry.input(input(60, 100));
    retry.input(input(60, 200, "off"));
    retry.input(input(60, 300));
    retry.input(input(64, 320));
    retry.input(input(60, 1300, "off"));
    expect(retry.durationResults.filter((r) => r.id === "chord")).toHaveLength(
      1,
    );
    expect(retry.durationResults[0].status).toBe("early");
  });
  it("distinguishes physical release from pedal-held sound under all pedal policies", () => {
    const physical = scorer();
    physical.start(0);
    physical.input(input(64, 50, "sustain", 127));
    physical.input(input(60, 100));
    physical.input(input(60, 400, "off"));
    expect(physical.durationResults[0].status).toBe("early");
    expect(physical.lifetimes?.activeNotes[0]).toMatchObject({
      physicallyHeld: false,
      pedalSustained: true,
    });
    const allowed = scorer(
      [note("a", 60, 0, 480, 1, { kind: "attack-only" })],
      {
        noteLifetimes: {
          keyHold: "attack-only",
          evaluation: { pedalTreatment: "sounding" },
        },
      },
    );
    allowed.start(0);
    allowed.input(input(64, 50, "sustain", 127));
    allowed.input(input(60, 100));
    allowed.input(input(60, 400, "off"));
    expect(allowed.durationResults[0].status).toBe("pending");
    allowed.input(input(64, 1100, "sustain", 0));
    expect(allowed.durationResults[0]).toMatchObject({
      status: "correct",
      sound: { releasedAtMs: 1100 },
    });
    expect(allowed.durationResults[0].physical).toBeUndefined();
    const required = scorer([note()], {
      noteLifetimes: { evaluation: { pedalTreatment: "sounding" } },
    });
    required.start(0);
    required.input(input(64, 50, "sustain", 127));
    required.input(input(60, 100));
    required.input(input(60, 400, "off"));
    required.input(input(64, 1100, "sustain", 0));
    expect(required.durationResults[0]).toMatchObject({
      status: "early",
      sound: { status: "correct" },
      physical: { status: "early" },
    });
    const forbidden = scorer([note()], {
      noteLifetimes: { evaluation: { pedalTreatment: "forbid" } },
    });
    forbidden.start(0);
    forbidden.input(input(60, 100));
    forbidden.input(input(64, 500, "sustain", 127));
    forbidden.input(input(60, 1100, "off"));
    expect(forbidden.durationResults[0].status).toBe("pedal");
  });
  it("associates releases and pedals with their source/channel and ignores stray/duplicate offs", () => {
    const e = scorer([note()], {
      noteLifetimes: { evaluation: { pedalTreatment: "forbid" } },
    });
    e.start(0);
    e.input(input(60, 100));
    e.input(input(60, 500, "off", 0, 2));
    e.input(input(64, 500, "sustain", 127, 2));
    expect(e.durationResults[0].status).toBe("pending");
    e.input({ ...input(60, 600, "off"), source: "hardware" });
    expect(e.durationResults[0].status).toBe("pending");
    e.input(input(60, 1100, "off"));
    e.input(input(60, 1101, "off"));
    expect(e.durationResults[0].status).toBe("correct");
    expect(e.durationResults[0].physical?.releasedAtMs).toBe(1100);
  });
  it("supports repeated pedal-held notes as separate logical attacks", () => {
    const e = scorer(
      [
        note("a", 60, 0, 480, 1, { kind: "attack-only" }),
        note("b", 60, 480, 960, 1, { kind: "attack-only" }),
      ],
      {
        noteLifetimes: {
          keyHold: "attack-only",
          evaluation: { pedalTreatment: "sounding" },
        },
      },
    );
    e.start(0);
    e.input(input(64, 0, "sustain", 127));
    e.input(input(60, 100));
    e.input(input(60, 200, "off"));
    e.input(input(60, 1100));
    e.input(input(60, 1200, "off"));
    e.input(input(64, 2100, "sustain", 0));
    expect(e.durationResults.map((r) => r.status)).toEqual([
      "correct",
      "correct",
    ]);
  });
  it.each(["pause", "disconnect", "finish"] as const)(
    "marks an open duration interrupted on %s without inventing releases",
    (method) => {
      const e = scorer();
      e.start(0);
      e.input(input(60, 100));
      e[method](500);
      expect(e.durationResults[0]).toMatchObject({
        status: "interrupted",
        interruption: method,
      });
      expect(e.durationResults[0].physical?.releasedAtMs).toBeUndefined();
      expect(e.lifetimes?.activeNotes).toEqual([]);
      expect(durationMetrics(e.durationResults)).toMatchObject({
        interrupted: 1,
        evaluated: 0,
        accuracy: null,
      });
    },
  );
  it("resumes the timeline without regrading interrupted holds, including pause at timestamp zero", () => {
    const e = scorer(
      [note("a"), note("b", 64, 480, 960, 3)],
      {},
      { ...defaults, mode: "timed" },
    );
    e.start(0);
    e.input(input(60, 4000));
    e.pause(4500);
    e.start(9500);
    e.input(input(60, 9600, "off"));
    e.input(input(64, 10000));
    e.input(input(64, 11000, "off"));
    expect(e.durationResults.map((r) => r.status)).toEqual([
      "interrupted",
      "correct",
    ]);
    expect(durationMetrics(e.durationResults).accuracy).toBe(100);
    const zero = scorer();
    zero.start(0);
    zero.pause(0);
    zero.start(5000);
    expect(zero.origin).toBe(5000);
  });
  it("keeps releases across streamed phrase boundaries and rejects contradictory appended plans", () => {
    const e = scorer([note("held", 60, 0, 2400, 1)]);
    e.start(0);
    e.input(input(60, 0));
    expect(e.target).toBeUndefined();
    expect(e.durationResults[0].status).toBe("pending");
    expect(() => e.appendNotes([note("bad", 64, 1920, 2400, 1)])).toThrow(
      /occupied/,
    );
    e.appendNotes([note("next-phrase", 64, 1920, 2400, 3)]);
    e.input(input(64, 4000));
    e.input(input(60, 5000, "off"));
    e.input(input(64, 5000, "off"));
    expect(durationMetrics(e.durationResults)).toMatchObject({
      correct: 2,
      accuracy: 100,
    });
  });
  it("accounts for misses and skips separately from observed duration accuracy", () => {
    const e = scorer([note()], {}, { ...defaults, mode: "timed" });
    e.start(0);
    e.tick(4501);
    expect(e.durationResults).toEqual([{ id: "a", status: "miss" }]);
    expect(durationMetrics(e.durationResults)).toMatchObject({
      missed: 1,
      accuracy: null,
    });
    const skip = scorer();
    skip.start(0);
    skip.skip(100);
    expect(skip.durationResults).toEqual([{ id: "a", status: "skip" }]);
  });
  it("applies input offset to note-off and sustain and waits for compensated release deadlines", () => {
    const e = scorer([note()], {}, { ...defaults, mode: "timed", offset: 100 });
    e.start(0);
    e.input(input(60, 4100));
    e.tick(5150);
    expect(e.durationResults[0].status).toBe("pending");
    e.input(input(60, 5100, "off"));
    expect(e.durationResults[0]).toMatchObject({
      status: "correct",
      physical: { errorMs: 0 },
    });
  });
  it("preserves existing note-on scoring when duration evaluation is disabled", () => {
    for (const mode of ["wait", "timed"] as const) {
      const settings = { ...defaults, mode };
      const old = new Scorer([note("a"), note("b", 60, 480, 960)], settings);
      const disabled = scorer(
        [note("a"), note("b", 60, 480, 960)],
        { noteLifetimes: { evaluation: { kind: "disabled" } } },
        settings,
      );
      const shift = mode === "timed" ? 4000 : 0;
      for (const e of [old, disabled]) {
        e.start(0);
        e.input(input(61, shift + 10));
        e.input(input(60, shift + 100));
        e.input(input(60, shift + 101));
        e.input(input(64, shift + 200, "sustain", 127));
        e.input(input(60, shift + 300, "off"));
        e.input(input(60, shift + 1100));
        e.input(input(60, shift + 1200, "off"));
        e.pause(shift + 1300);
        e.start(shift + 2300);
      }
      expect(disabled.results).toEqual(old.results);
      expect(disabled.index).toBe(old.index);
      expect(disabled.durationResults).toEqual([]);
      expect(metrics(disabled.results, 2000, 180)).toEqual(
        metrics(old.results, 2000, 180),
      );
    }
  });
  it("rejects missing lifetime metadata, ambiguous lifetimes and incompatible scoring policy", () => {
    const missing = note();
    delete missing.notes![0].lifetime;
    expect(() => scorer([missing])).toThrow(/Missing explicit/);
    expect(() => scorer([note("a"), note("b", 64, 240, 720, 1)])).toThrow(
      /occupied/,
    );
    expect(() =>
      scorer([note("a", 60, 0, 480, 1, { kind: "attack-only" })]),
    ).toThrow(/physical release/);
    expect(() => scorer([note()], { notation: { beats: 3 } })).toThrow(/meter/);
    expect(() => scorer([note()], {}, { ...defaults, bpm: 0 })).toThrow(
      /tempo/,
    );
    expect(() => scorer([{ ...note(), bar: -1, onset: 1920 }])).toThrow(
      /onsets/,
    );
    const e = scorer();
    e.start(0);
    e.input(input(60, 100));
    expect(() => e.appendNotes([note("retro", 64, 0, 480, 3)])).toThrow(
      /retroactively/,
    );
    e.notes.push(note("bad-direct", 64, 240, 720, 1));
    expect(() => e.tick(200)).toThrow(/occupied/);
  });
  it("versions release scoring policy and runtime clock context separately from legacy identities", () => {
    const a = scorer(),
      b = scorer([note()], {
        noteLifetimes: { evaluation: { toleranceMs: 121 } },
      }),
      fast = scorer([note()], {}, { ...defaults, bpm: 120 });
    expect(a.scoringFingerprint).toMatch(/^7.0.0:parameters:/);
    expect(a.scoringFingerprint).not.toBe(b.scoringFingerprint);
    expect(a.scoringFingerprint).not.toBe(fast.scoringFingerprint);
    expect(new Scorer([note()], defaults).scoringFingerprint).toBeUndefined();
    a.settings = { ...a.settings, hints: "hidden" };
    expect(a.scoringFingerprint).toMatch(/^7.0.0:parameters:/);
    a.settings = { ...a.settings, bpm: 120 };
    expect(() => a.start(0)).toThrow(/new scorer/);
  });
  it("deterministically scores seeded release traces and never mixes duration with pitch accuracy", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4800 }),
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: 10, max: 180 }),
        (ticks, error, bpm) => {
          const run = () => {
            const e = scorer(
              [note("a", 60, 0, ticks)],
              {},
              { ...defaults, bpm },
            );
            e.start(0);
            const attack = 1000,
              duration = (ticks * 60000) / (480 * bpm);
            if (duration + error <= 0) return;
            e.input(input(60, attack));
            e.input(input(60, attack + duration + error, "off"));
            expect(metrics(e.results, 2000, 180).accuracy).toBe(100);
            expect(e.durationResults[0].status).toBe(
              error < -120 ? "early" : error > 120 ? "late" : "correct",
            );
            return e.durationResults;
          };
          expect(run()).toEqual(run());
        },
      ),
      { seed: 702024, numRuns: 100 },
    );
  });
});
