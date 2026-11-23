import { expect, it } from "vitest";
import fc from "fast-check";
import {
  generateConfigured,
  resolveGeneratorConfig,
  validateGeneratedPhrase,
  noteLifetimeDefaults,
  tieDefaults,
  chordDefaults,
  chromaticDefaults,
  repositionDefaults,
} from ".";
import { noteheads, defaults, TPQ } from "../score/model";
import { lifetimeNotes } from "../score/lifetimes";
import { Scorer } from "../scoring/engine";
import {
  durationEvaluationDefaults,
  generatorConfigFingerprint,
} from "./config";
import type { GeneratorOverrides } from "./config";

const config = (overrides: GeneratorOverrides = {}) =>
  resolveGeneratorConfig(
    overrides,
    resolveGeneratorConfig({
      notation: { voices: "independent" },
      independentVoices: {
        right: {
          voices: [
            { fingers: [1, 2], durations: [{ value: 960, weight: 1 }] },
            {
              fingers: [3, 4, 5],
              durations: [
                { value: 240, weight: 2 },
                { value: 480, weight: 1 },
              ],
              minAttacksPerPhrase: 2,
            },
          ],
          minPolyphony: 2,
          maxPolyphony: 2,
        },
      },
      noteLifetimes: noteLifetimeDefaults,
      rhythm: { breathBars: [] },
    }),
  );

it("generates staggered same-hand and two-hand attacks with overlapping holds and exact meters", () => {
  fc.assert(
    fc.property(
      fc.integer(),
      fc.constantFrom(3 as const, 4 as const),
      fc.boolean(),
      (seed, beats, both) => {
        const c = config({
          notation: { beats },
          ...(both
            ? {
                hands: { active: "both" },
                independentVoices: {
                  left: {
                    voices: [{ durations: [{ value: 960, weight: 1 }] }],
                  },
                },
              }
            : {}),
        });
        let prev;
        for (let i = 0; i < 3; i++) {
          const p = generateConfigured(c, String(seed), prev);
          if (prev) expect(p.initial).toEqual(prev);
          expect(validateGeneratedPhrase(p)).toEqual([]);
          expect(generateConfigured(c, String(seed), prev)).toEqual(p);
          const notes = lifetimeNotes(p.events);
          for (const voice of Object.keys(p.final.independentVoices!.voices))
            for (let bar = p.initial.bar; bar < p.final.bar; bar++)
              expect(
                p.events
                  .filter((e) => e.voiceId === voice && e.bar === bar)
                  .reduce((sum, e) => sum + e.duration, 0),
              ).toBe(beats * TPQ);
          expect(
            notes.some(
              (a) =>
                a.lifetime.voiceId === "right:main" &&
                notes.some(
                  (b) =>
                    b.lifetime.voiceId === "right:2" &&
                    a.lifetime.onsetTick < b.lifetime.onsetTick &&
                    b.lifetime.onsetTick < a.lifetime.releaseTick,
                ),
            ),
          ).toBe(true);
          if (both)
            expect(
              notes.some(
                (a) =>
                  a.hand === "left" &&
                  notes.some(
                    (b) =>
                      b.hand === "right" &&
                      a.lifetime.onsetTick < b.lifetime.onsetTick &&
                      b.lifetime.onsetTick < a.lifetime.releaseTick,
                  ),
              ),
            ).toBe(true);
          prev = p.final;
        }
      },
    ),
    { seed: 90517, numRuns: 25 },
  );
});

it("maintains polyphony, preserves chord attacks and carries a secondary voice through multiple phrases", () => {
  const c = config({
    melody: { maxIntervalSteps: 7 },
    noteLifetimes: {
      ...noteLifetimeDefaults,
      evaluation: durationEvaluationDefaults,
    },
    independentVoices: {
      right: {
        minPolyphony: 2,
        maxPolyphony: 5,
        voices: [
          { fingers: [1, 3, 5], durations: [{ value: 480, weight: 1 }] },
          { fingers: [2, 4], durations: [{ value: 480, weight: 1 }] },
        ],
      },
    },
    harmony: { progressions: [{ value: [1, 1, 1, 1], weight: 1 }] },
    chords: { ...chordDefaults, maxVoiceLeadingSteps: 7, probability: 1 },
    notation: {
      ties: {
        ...tieDefaults,
        probability: 1,
        crossPhrase: true,
        chordTones: "any",
        voices: ["right:main", "right:2"],
        segmentCounts: [18],
        maxDurationTicks: 8640,
        patterns: [{ value: "carry", weight: 1 }],
      },
    },
  });
  const a = generateConfigured(c, "voice-carry");
  const b = generateConfigured(c, a.seed, a.final);
  const next = generateConfigured(c, a.seed, b.final);
  for (const p of [a, b, next]) expect(validateGeneratedPhrase(p)).toEqual([]);
  const carried = a.final.activeLifetimes!;
  expect(new Set(carried.map((n) => n.lifetime.voiceId))).toEqual(
    new Set(["right:main", "right:2"]),
  );
  expect(b.final.activeLifetimes).toEqual(carried);
  const events = [...a.events, ...b.events, ...next.events];
  for (const n of carried) {
    expect(
      events.flatMap(noteheads).filter((h) => h.tie?.lifetimeId === n.id),
    ).toHaveLength(18);
    expect(
      lifetimeNotes(events).filter((head) => head.id === n.id),
    ).toHaveLength(1);
  }
  expect(
    b.events.some(
      (e) =>
        noteheads(e).some((n) => !n.tie) &&
        noteheads(e).some((n) => n.tie?.index),
    ),
  ).toBe(true);
  const scorer = new Scorer(
    a.events,
    { ...defaults, mode: "timed", bpm: 60 },
    120,
    c,
  );
  scorer.start(0);
  scorer.appendNotes(b.events);
  scorer.appendNotes(next.events);
  const records = lifetimeNotes(events);
  const edges = records
    .flatMap((n) => [
      { pitch: n.midi, tick: n.lifetime.onsetTick, type: "on" as const },
      { pitch: n.midi, tick: n.lifetime.releaseTick, type: "off" as const },
    ])
    .sort(
      (a, b) =>
        a.tick - b.tick || (a.type === b.type ? 0 : a.type === "off" ? -1 : 1),
    );
  for (const { pitch, tick, type } of edges)
    scorer.input({
      pitch,
      time: 4000 + (tick * 1000) / TPQ,
      type,
      source: "simulator",
      channel: 1,
      velocity: type === "on" ? 90 : 0,
    });
  expect(scorer.results.filter((r) => r.kind === "correct")).toHaveLength(
    records.length,
  );
  for (const n of carried)
    expect(scorer.durationResults.filter((r) => r.id === n.id)).toEqual([
      expect.objectContaining({ status: "correct" }),
    ]);
});

it("retains rests, voice entry and exit, and independent chromatic resolution", () => {
  const c = config({
    chromatic: { ...chromaticDefaults, probability: 1 },
    independentVoices: {
      right: {
        minPolyphony: 1,
        voices: [
          { activity: 0.6, minAttacksPerPhrase: 4 },
          { entryProbability: 1, exitProbability: 1, fingers: [5] },
        ],
      },
    },
  });
  const a = generateConfigured(c, "activity"),
    b = generateConfigured(c, a.seed, a.final);
  const next = generateConfigured(c, a.seed, b.final);
  expect(
    [a, b, next].map(
      (p) => p.final.independentVoices?.voices["right:2"].active,
    ),
  ).toEqual([true, false, true]);
  expect(
    b.events
      .filter((e) => e.voiceId === "right:2")
      .every((e) => e.kind === "rest"),
  ).toBe(true);
  expect(
    [a, b, next]
      .flatMap((p) => p.events)
      .flatMap(noteheads)
      .some((n) => n.written?.accidental),
  ).toBe(true);
});

it("lets one entire hand exit for a phrase while the other keeps playing", () => {
  const c = config({
    hands: { active: "both" },
    independentVoices: {
      left: { minPolyphony: 0, voices: [{ exitProbability: 1 }] },
    },
  });
  const a = generateConfigured(c, "one-hand-exit");
  const b = generateConfigured(c, a.seed, a.final);
  expect(a.events.some((e) => e.hand === "left" && e.kind === "note")).toBe(
    true,
  );
  expect(
    b.events.filter((e) => e.hand === "left").every((e) => e.kind === "rest"),
  ).toBe(true);
  expect(b.events.some((e) => e.hand === "right" && e.kind === "note")).toBe(
    true,
  );
});

it("reserves all voices' preparation rests for deliberate repositioning", () => {
  const c = config({
    hands: { right: { max: 90 } },
    melody: { maxIntervalSteps: 7 },
    movement: {
      ...repositionDefaults,
      probability: 1,
      eligibleBars: [1, 2, 3],
    },
    independentVoices: { right: { voices: [{}, { fingers: [3, 4, 5] }] } },
  });
  const p = generateConfigured(c, "voice-move");
  expect(p.movements.length).toBeGreaterThan(0);
  const notes = lifetimeNotes(p.events);
  for (const move of p.movements)
    expect(
      notes.some(
        (n) =>
          n.lifetime.onsetTick < move.landingTick &&
          n.lifetime.releaseTick > move.cueTick,
      ),
    ).toBe(false);
  const bad = structuredClone(p);
  bad.movements[0].cueTick -= 480;
  expect(validateGeneratedPhrase(bad)).toContain(
    "Invalid independent hand relocation, preparation or landing.",
  );
});

it("rejects impossible voice parameters and corrupted schedules, holds and boundary memory", () => {
  expect(() => config({ noteLifetimes: { kind: "disabled" } })).toThrow(
    /physical key holds/,
  );
  expect(() => config({ independentVoices: { maxOverlapTicks: 0 } })).toThrow(
    /overlapping voices/,
  );
  expect(() =>
    generateConfigured(
      config({
        independentVoices: {
          maxAttempts: 2,
          right: { voices: [{ fingers: [1] }, { fingers: [1] }] },
        },
      }),
      "impossible",
    ),
  ).toThrow(/polyphony/);
  const c = config(),
    p = generateConfigured(c, "tamper");
  for (const mutate of [
    (q: typeof p) => {
      q.events[0].voiceId = "left:5";
    },
    (q: typeof p) => {
      q.events[0].duration += 240;
    },
    (q: typeof p) => {
      q.events.find(
        (e) => e.kind === "note",
      )!.notes![0].lifetime!.releaseTick += 240;
    },
    (q: typeof p) => {
      q.events.find((e) => e.kind === "note")!.notes![0].finger = 5;
    },
    (q: typeof p) => {
      q.final.independentVoices!.voices["right:main"].lastPitch = "G8";
    },
  ]) {
    const q = structuredClone(p);
    mutate(q);
    expect(validateGeneratedPhrase(q).length).toBeGreaterThan(0);
  }
  expect(() => generateConfigured(c, "different-seed", p.final)).toThrow(
    /original seed/,
  );
});

it("rejects a carry that occupies every slot reserved for required future attacks", () => {
  expect(() =>
    config({
      independentVoices: {
        right: {
          voices: [
            { durations: [{ value: 1920, weight: 1 }], minAttacksPerPhrase: 1 },
            {},
          ],
        },
      },
      notation: {
        ties: {
          ...tieDefaults,
          crossPhrase: true,
          voices: ["right:main"],
          segmentCounts: [6],
          maxDurationTicks: 11520,
          patterns: [{ value: "carry", weight: 1 }],
        },
      },
    }),
  ).toThrow(/minimum attacks/);
});

it("explicitly opts out when resolving from an independent base", () => {
  const independent = resolveGeneratorConfig({
    notation: { voices: "independent" },
    independentVoices: { right: { voices: [{}] } },
    noteLifetimes: noteLifetimeDefaults,
  });
  expect(generatorConfigFingerprint(independent)).toMatch(/^9\.0\.0:/);
  const shared = resolveGeneratorConfig(
    {
      notation: { voices: "shared-rhythm" },
      independentVoices: false,
      noteLifetimes: { kind: "disabled" },
    },
    independent,
  );
  expect(generatorConfigFingerprint(shared)).toBe(
    generatorConfigFingerprint(resolveGeneratorConfig()),
  );
  expect(generateConfigured(shared, "legacy-identity").events).toEqual(
    generateConfigured(resolveGeneratorConfig(), "legacy-identity").events,
  );
});

it("uses the existing timed scorer for asynchronous releases, simultaneous attacks and pause/resume", () => {
  const c = config({
    noteLifetimes: {
      ...noteLifetimeDefaults,
      evaluation: durationEvaluationDefaults,
    },
  });
  const p = generateConfigured(c, "score-voices");
  const scorer = new Scorer(
    p.events,
    { ...defaults, bpm: 60, mode: "timed" },
    120,
    c,
  );
  const records = lifetimeNotes(p.events);
  const emit = (
    n: (typeof records)[number],
    type: "on" | "off",
    time: number,
  ) =>
    scorer.input({
      pitch: n.midi,
      time,
      type,
      channel: 1,
      source: "simulator",
      velocity: type === "on" ? 90 : 0,
    });
  const edges = records
    .flatMap((n) => [
      { n, tick: n.lifetime.onsetTick, type: "on" as const },
      { n, tick: n.lifetime.releaseTick, type: "off" as const },
    ])
    .sort(
      (a, b) =>
        a.tick - b.tick || (a.type === b.type ? 0 : a.type === "off" ? -1 : 1),
    );
  scorer.start(0);
  let offset = 0;
  for (const edge of edges) {
    if (!offset && edge.tick >= 240) {
      scorer.pause(4250);
      scorer.start(5250);
      offset = 1000;
    }
    emit(edge.n, edge.type, 4000 + (edge.tick * 1000) / TPQ + offset);
  }
  expect(scorer.results).toHaveLength(records.length);
  expect(
    scorer.results.every((r) => r.kind === "correct" && r.errorMs === 0),
  ).toBe(true);
  expect(scorer.durationResults.some((r) => r.status === "interrupted")).toBe(
    true,
  );
  expect(
    scorer.durationResults.every(
      (r) => r.status === "correct" || r.status === "interrupted",
    ),
  ).toBe(true);
});

it("credits a dense later onset when an earlier independent attack is missed", () => {
  const c = config();
  const p = generateConfigured(c, "dense-voices");
  const s = new Scorer(
    p.events,
    { ...defaults, bpm: 180, mode: "timed" },
    120,
    c,
  );
  s.start(0);
  const later = s.notes.find((e) => e.bar === 0 && e.onset > 0)!;
  expect(later).toBeDefined();
  expect(later.onset).toBeLessThanOrEqual(480);
  const expected = s.expected(later);
  s.input({
    pitch: later.midi,
    time: expected,
    type: "on",
    channel: 1,
    source: "simulator",
    velocity: 90,
  });
  expect(s.results.find((r) => r.id === later.id)).toMatchObject({
    kind: "correct",
    errorMs: 0,
  });
  expect(s.results.some((r) => r.kind === "miss")).toBe(true);
  expect(s.results.some((r) => r.kind === "wrong")).toBe(false);
});

it("allows all five mapped fingers to sustain separate voices", () => {
  const c = config({
    independentVoices: {
      right: {
        minPolyphony: 5,
        maxPolyphony: 5,
        voices: [1, 2, 3, 4, 5].map((finger) => ({
          fingers: [finger],
          durations: [{ value: 1920, weight: 1 }],
        })),
      },
    },
  });
  const p = generateConfigured(c, "five-lanes");
  expect(
    p.events.filter((e) => e.bar === 0 && e.onset === 0 && e.kind === "note"),
  ).toHaveLength(5);
  expect(validateGeneratedPhrase(p)).toEqual([]);
});

it.each(["subdivide", "connect"] as const)(
  "applies %s ties only to the eligible voice's rhythm",
  (pattern) => {
    const c = config({
      independentVoices: {
        right: {
          voices: [
            { fingers: [1], durations: [{ value: 960, weight: 1 }] },
            { fingers: [3], durations: [{ value: 480, weight: 1 }] },
          ],
        },
      },
      notation: {
        ties: {
          ...tieDefaults,
          probability: 1,
          voices: ["right:2"],
          patterns: [{ value: pattern, weight: 1 }],
        },
      },
    });
    const p = generateConfigured(c, "voices-local-ties");
    const ties = p.events.filter((e) => e.tie);
    expect(ties.length).toBeGreaterThan(0);
    expect(
      ties.every((e) => e.voiceId === "right:2" && e.tie?.pattern === pattern),
    ).toBe(true);
  },
);

it("bounds staggered intersection length and supports independently scheduled non-overlap", () => {
  for (const maxOverlapTicks of [0, 240]) {
    const c = config({
      independentVoices: {
        maxOverlapTicks,
        right: {
          minPolyphony: maxOverlapTicks === 0 ? 1 : 2,
          voices: [
            { fingers: [1], durations: [{ value: 960, weight: 1 }] },
            { fingers: [3], durations: [{ value: 240, weight: 1 }] },
          ],
        },
      },
    });
    const p = generateConfigured(c, "overlap-limit");
    const notes = lifetimeNotes(p.events);
    const overlaps = notes.flatMap((a) =>
      notes
        .filter((b) => a.lifetime.voiceId !== b.lifetime.voiceId)
        .map(
          (b) =>
            Math.min(a.lifetime.releaseTick, b.lifetime.releaseTick) -
            Math.max(a.lifetime.onsetTick, b.lifetime.onsetTick),
        ),
    );
    expect(Math.max(...overlaps)).toBeLessThanOrEqual(maxOverlapTicks);
    if (maxOverlapTicks) expect(overlaps).toContain(maxOverlapTicks);
  }
});
