import { describe, expect, it } from "vitest";
import { Scorer, durationMetrics, metrics } from "./engine";
import { defaults, noteheads, type ScoreEvent } from "../score/model";
import {
  generateConfigured,
  resolveGeneratorConfig,
  tieDefaults,
  noteLifetimeDefaults,
  durationEvaluationDefaults,
  chordDefaults,
} from "../generation";
import type { MidiEvent } from "../midi/adapter";
import { lifetimeNotes } from "../score/lifetimes";

const event = (
  pitch: number,
  time: number,
  type: MidiEvent["type"] = "on",
  velocity = type === "on" ? 100 : 0,
): MidiEvent => ({
  pitch,
  time,
  type,
  velocity,
  channel: 1,
  source: "simulator",
});
const config = (
  pedalTreatment: "physical" | "sounding" | "forbid" = "physical",
  waitMode: "disabled" | "performed-duration" = "performed-duration",
) =>
  resolveGeneratorConfig({
    notation: {
      ties: {
        ...tieDefaults,
        probability: 1,
        patterns: [{ value: "subdivide", weight: 1 }],
      },
    },
    rhythm: { durations: [{ value: 960, weight: 1 }], breathBars: [] },
    noteLifetimes: {
      ...noteLifetimeDefaults,
      evaluation: {
        ...durationEvaluationDefaults,
        toleranceMs: 50,
        pedalTreatment,
        waitMode,
      },
    },
  });
const pair = (c = config()): ScoreEvent[] =>
  generateConfigured(c, "scored-tie").events.slice(0, 2);

describe("tie lifetime scoring with normalized simulated MIDI", () => {
  const chain = (
    count: number,
    treatment: "physical" | "sounding" | "forbid" = "physical",
  ) => {
    const c = resolveGeneratorConfig(
      {
        rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
        notation: {
          ties: {
            ...tieDefaults,
            probability: 1,
            crossPhrase: true,
            segmentCounts: [count],
            maxDurationTicks: count * 480,
            patterns: [{ value: "carry", weight: 1 }],
          },
        },
      },
      config(treatment),
    );
    let p = generateConfigured(c, `score-chain-${count}`);
    const source = p.events.at(-1)!;
    const chunks = [[source]];
    while (chunks.flat().length < count) {
      p = generateConfigured(c, `score-chain-${count}`, p.final);
      chunks.push(p.events.filter((e) => e.tie?.lifetimeId === source.id));
    }
    return { c, source, chunks };
  };

  it.each([2, 18, 34])(
    "scores a streamed %i-segment chain once through its final release",
    (count) => {
      const { c, source, chunks } = chain(count);
      const s = new Scorer(chunks[0], defaults, 120, c);
      s.start(0);
      s.input(event(source.midi, 0));
      chunks.slice(1).forEach((chunk) => s.appendNotes(chunk));
      s.tick(count * 1000 - 100);
      expect(s.notes).toHaveLength(1);
      expect(s.results).toHaveLength(1);
      expect(s.durationResults[0].status).toBe("pending");
      s.input(event(source.midi, count * 1000, "off"));
      expect(s.durationResults).toHaveLength(1);
      expect(s.durationResults[0].status).toBe("correct");
    },
  );

  it("retains early release and pedal evidence across multiple phrase appends and retriggers", () => {
    for (const treatment of ["physical", "sounding", "forbid"] as const) {
      const { c, source, chunks } = chain(34, treatment);
      const s = new Scorer(chunks[0], defaults, 120, c);
      s.start(0);
      s.input(event(source.midi, 0));
      s.input(event(64, 100, "sustain", 127));
      s.appendNotes(chunks[1]);
      s.input(event(source.midi, 17000, "off"));
      s.input(event(source.midi, 17010));
      chunks.slice(2).forEach((chunk) => s.appendNotes(chunk));
      s.input(event(source.midi, 34000, "off"));
      s.input(event(64, 34000, "sustain", 0));
      expect(s.results).toHaveLength(1);
      expect(s.durationResults).toHaveLength(1);
      expect(s.durationResults[0].status).toBe(
        treatment === "forbid" ? "pedal" : "early",
      );
      expect(s.durationResults[0].physical?.releasedAtMs).toBe(17000);
    }
  });

  it("evaluates one timed onset and the committed multi-phrase release with calibrated offset", () => {
    const { c, source, chunks } = chain(34);
    const s = new Scorer(
      chunks[0],
      { ...defaults, mode: "timed", offset: 20 },
      120,
      c,
    );
    s.start(0);
    const onset = s.expected(source) + 20;
    s.input(event(source.midi, onset));
    chunks.slice(1).forEach((chunk) => s.appendNotes(chunk));
    s.input(event(source.midi, onset + 34000, "off"));
    expect(s.results).toHaveLength(1);
    expect(s.results[0].errorMs).toBe(0);
    expect(s.durationResults).toHaveLength(1);
    expect(s.durationResults[0]).toMatchObject({
      status: "correct",
      physical: { errorMs: 0 },
    });
  });

  it("keeps a paused multi-phrase hold interrupted after resume and later continuation appends", () => {
    const { c, source, chunks } = chain(34);
    const s = new Scorer(chunks[0], defaults, 120, c);
    s.start(0);
    s.input(event(source.midi, 0));
    s.appendNotes(chunks[1]);
    s.pause(17000);
    s.start(22000);
    chunks.slice(2).forEach((chunk) => s.appendNotes(chunk));
    s.input(event(source.midi, 39000, "off"));
    expect(s.results).toHaveLength(1);
    expect(s.durationResults).toHaveLength(1);
    expect(s.durationResults[0].status).toBe("interrupted");
    expect(durationMetrics(s.durationResults).evaluated).toBe(0);
  });

  it("attributes a repeated pitch after a multi-phrase release to a new lifetime", () => {
    const { c, source, chunks } = chain(34);
    const last = chunks.at(-1)!.at(-1)!;
    const repeat = structuredClone(last);
    repeat.id += ":repeat";
    repeat.onset += repeat.duration;
    const head = repeat.notes![0];
    head.id = repeat.id;
    delete head.tie;
    delete repeat.tie;
    const onsetTick = last.lifetime!.releaseTick;
    head.lifetime = {
      ...head.lifetime!,
      onsetTick,
      releaseTick: onsetTick + 480,
      durationTicks: 480,
      keyHold: { kind: "required", releaseTick: onsetTick + 480 },
    };
    repeat.lifetime = structuredClone(head.lifetime);
    const s = new Scorer(chunks.flat(), defaults, 120, c);
    s.appendNotes([repeat]);
    s.start(0);
    s.input(event(source.midi, 0));
    s.input(event(source.midi, 34000, "off"));
    s.input(event(source.midi, 34000));
    s.input(event(source.midi, 35000, "off"));
    expect(s.results).toHaveLength(2);
    expect(s.durationResults.map((r) => r.status)).toEqual([
      "correct",
      "correct",
    ]);
    expect(new Set(s.durationResults.map((r) => r.id)).size).toBe(2);
  });

  it("scores independent releases and reattacks in a partially tied boundary chord", () => {
    const c = resolveGeneratorConfig(
      {
        melody: { maxIntervalSteps: 7 },
        chords: { ...chordDefaults, probability: 1, maxVoiceLeadingSteps: 7 },
        harmony: { progressions: [{ value: [1, 1, 1, 1], weight: 1 }] },
        rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
        notation: {
          ties: {
            ...tieDefaults,
            probability: 1,
            crossPhrase: true,
            chordTones: "any",
            patterns: [{ value: "carry", weight: 1 }],
          },
        },
      },
      config(),
    );
    const pairs = Array.from({ length: 20 }, (_, i) => {
      const a = generateConfigured(c, `partial-boundary-${i}`);
      const b = generateConfigured(c, a.seed, a.final);
      return [a.events.at(-1)!, b.events[0]];
    });
    const notes = pairs.find(
      ([a, b]) =>
        noteheads(a).length > 1 &&
        noteheads(b).some(
          (n) => !n.tie && !noteheads(a).some((h) => h.midi === n.midi),
        ),
    )!;
    expect(notes).toBeDefined();
    const s = new Scorer([notes[0]], defaults, 120, c);
    s.start(0);
    for (const n of noteheads(notes[0])) s.input(event(n.midi, 0));
    s.appendNotes([notes[1]]);
    for (const n of noteheads(notes[0]).filter((n) => !n.tie))
      s.input(event(n.midi, 1000, "off"));
    for (const n of noteheads(notes[1]).filter((n) => !n.tie))
      s.input(event(n.midi, 1000));
    for (const n of noteheads(notes[1])) s.input(event(n.midi, 2000, "off"));
    const expected = lifetimeNotes(notes).length;
    expect(s.results).toHaveLength(expected);
    expect(s.durationResults).toHaveLength(expected);
    expect(s.durationResults.every((r) => r.status === "correct")).toBe(true);
  });

  it("rejects malformed continuation ticks and physical hold metadata before projecting attacks", () => {
    const c = config(),
      notes = pair(c);
    const invalidTicks = structuredClone(notes);
    invalidTicks[1].onset += 0.5;
    invalidTicks[1].duration -= 0.5;
    expect(() => new Scorer(invalidTicks, defaults, 120, c)).toThrow(
      /ticks|discontinuous/,
    );
    const noHold = structuredClone(notes);
    for (const e of noHold) {
      e.lifetime!.keyHold = { kind: "attack-only" };
      e.notes![0].lifetime!.keyHold = { kind: "attack-only" };
    }
    expect(() => new Scorer(noHold, defaults, 120, c)).toThrow(/policy/);
  });

  it("scores one attack, holds through the internal boundary and evaluates only the final release", () => {
    const c = config(),
      notes = pair(c),
      pitch = notes[0].midi;
    const s = new Scorer(notes, defaults, 120, c);
    s.start(0);
    s.input(event(pitch, 0));
    s.tick(1000);
    expect(s.target).toBeUndefined();
    expect(s.results).toHaveLength(1);
    expect(s.durationResults[0].status).toBe("pending");
    s.input(event(pitch, 2000, "off"));
    expect(s.durationResults).toHaveLength(1);
    expect(s.durationResults[0].status).toBe("correct");
    expect(metrics(s.results, 2000, 180).correct).toBe(1);
    expect(durationMetrics(s.durationResults).correct).toBe(1);
  });

  it("does not repair an early release by retriggering at the tie boundary", () => {
    const c = config(),
      notes = pair(c),
      pitch = notes[0].midi;
    const s = new Scorer(notes, defaults, 120, c);
    s.start(0);
    s.input(event(pitch, 0));
    s.input(event(pitch, 1000, "off"));
    s.input(event(pitch, 1010));
    s.input(event(pitch, 2000, "off"));
    expect(s.results).toHaveLength(1);
    expect(s.durationResults).toHaveLength(1);
    expect(s.durationResults[0].status).toBe("early");
    expect(s.durationResults[0].physical?.releasedAtMs).toBe(1000);
  });

  it("applies timed offset/tolerance to the final tied release and detects late holds", () => {
    const c = config(),
      notes = pair(c),
      pitch = notes[0].midi;
    const s = new Scorer(
      notes,
      { ...defaults, mode: "timed", offset: 20 },
      120,
      c,
    );
    s.start(0);
    s.input(event(pitch, 4020));
    s.tick(6100);
    expect(s.durationResults[0].status).toBe("late");
    s.input(event(pitch, 6140, "off"));
    expect(s.durationResults[0].physical?.errorMs).toBe(120);
    expect(s.results[0].errorMs).toBe(0);
  });

  it("keeps wait mode pitch-only unless performed duration is explicitly selected", () => {
    const c = config("physical", "disabled"),
      notes = pair(c);
    const s = new Scorer(notes, defaults, 120, c);
    s.start(0);
    s.input(event(notes[0].midi, 10000));
    s.input(event(notes[0].midi, 10001, "off"));
    expect(s.results).toHaveLength(1);
    expect(s.durationResults).toEqual([]);
  });

  it("keeps physical and pedal-held sound releases separate and honors forbidden pedal", () => {
    for (const treatment of ["physical", "sounding", "forbid"] as const) {
      const c = config(treatment),
        notes = pair(c),
        pitch = notes[0].midi;
      const s = new Scorer(notes, defaults, 120, c);
      s.start(0);
      s.input(event(pitch, 0));
      s.input(event(64, 100, "sustain", 127));
      s.input(event(pitch, 1000, "off"));
      s.input(event(64, 2000, "sustain", 0));
      expect(s.durationResults[0].status).toBe(
        treatment === "forbid" ? "pedal" : "early",
      );
      expect(s.durationResults[0].physical?.status).toBe("early");
      if (treatment === "sounding")
        expect(s.durationResults[0].sound?.status).toBe("correct");
    }
  });

  it("scores attacks and independent releases in a partially tied chord without double-counting its held tone", () => {
    const c = resolveGeneratorConfig(
      {
        chords: { ...chordDefaults, probability: 1 },
        harmony: { progressions: [{ value: [1, 1, 1, 1], weight: 1 }] },
        notation: {
          ties: {
            ...tieDefaults,
            probability: 1,
            chordTones: "any",
            patterns: [{ value: "subdivide", weight: 1 }],
          },
        },
      },
      config(),
    );
    const phrase = generateConfigured(c, "partial-score");
    const first = phrase.events.findIndex(
      (e) => noteheads(e).length > 1 && e.tie?.index !== 1,
    );
    const notes = phrase.events.slice(first, first + 2);
    expect(notes[0].notes!.length).toBeGreaterThan(1);
    const s = new Scorer(notes, defaults, 120, c);
    s.start(0);
    for (const n of noteheads(notes[0])) s.input(event(n.midi, 0));
    for (const n of noteheads(notes[0]).filter((n) => !n.tie))
      s.input(event(n.midi, 1000, "off"));
    for (const n of noteheads(notes[1]).filter((n) => !n.tie))
      s.input(event(n.midi, 1000));
    for (const n of noteheads(notes[1])) s.input(event(n.midi, 2000, "off"));
    const expected = lifetimeNotes(notes).length;
    expect(s.results.filter((r) => r.kind === "correct")).toHaveLength(
      expected,
    );
    expect(s.durationResults).toHaveLength(expected);
    expect(s.durationResults.every((r) => r.status === "correct")).toBe(true);
  });

  it("validates notation during streaming, retaining committed cross-phrase lifetime identities", () => {
    const c = resolveGeneratorConfig(
      {
        rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
        notation: {
          ties: {
            ...tieDefaults,
            probability: 1,
            crossPhrase: true,
            patterns: [{ value: "carry", weight: 1 }],
          },
        },
      },
      config(),
    );
    const a = generateConfigured(c, "stream"),
      b = generateConfigured(c, "stream", a.final);
    const s = new Scorer(a.events, defaults, 120, c);
    const count = s.notes.length;
    s.appendNotes(b.events);
    expect(s.notes.length).toBe(count + lifetimeNotes(b.events).length);
    expect(
      s.notes.some((e) => noteheads(e).some((n) => n.tie?.index === 1)),
    ).toBe(false);
    const bad = structuredClone(b.events);
    bad[0].notes![0].tie!.previousId = "orphan";
    expect(() => new Scorer([...a.events, ...bad], defaults, 120, c)).toThrow(
      /tie/i,
    );
    expect(() => new Scorer(b.events, defaults, 120, c)).toThrow(
      /owner|incoming/,
    );
  });
});
