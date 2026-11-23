import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { generateConfigured } from "./engine";
import { validateGeneratedPhrase } from "./phraseValidator";
import {
  resolveGeneratorConfig,
  tieDefaults,
  noteLifetimeDefaults,
  chordDefaults,
  repositionDefaults,
  wideLeapDefaults,
  generatorConfigFingerprint,
  type GeneratorOverrides,
} from "./config";
import { lifetimeNotes } from "../score/lifetimes";
import { noteheads, TPQ } from "../score/model";

const config = (overrides: GeneratorOverrides = {}) =>
  resolveGeneratorConfig(
    overrides,
    resolveGeneratorConfig({
      notation: { ties: { ...tieDefaults, probability: 1 } },
      noteLifetimes: noteLifetimeDefaults,
    }),
  );

describe("opt-in musical ties", () => {
  it("rejects unsupported and infeasible combinations without changing disabled identities", () => {
    for (const overrides of [
      { noteLifetimes: { kind: "disabled" } },
      { notation: { ties: { ...tieDefaults, segmentCounts: [1] } } },
      { notation: { ties: { ...tieDefaults, withinMeasure: false } } },
      { notation: { ties: { ...tieDefaults, crossPhrase: true } } },
      { notation: { ties: { ...tieDefaults, subdivisions: [1920] } } },
      { notation: { ties: { ...tieDefaults, voices: ["left:main"] } } },
      { notation: { ties: { ...tieDefaults, chordTones: "any" } } },
      {
        rhythm: { breathBars: [3] },
        notation: {
          ties: {
            ...tieDefaults,
            crossPhrase: true,
            patterns: [{ value: "carry", weight: 1 }],
          },
        },
      },
      {
        chromatic: {
          kind: "neighbors",
          probability: 0.2,
          passingResolutionProbability: 0,
          preferAppliedDominant: false,
          preferAnchorResolution: true,
          preferMappedFinger: true,
        },
        notation: {
          ties: {
            ...tieDefaults,
            crossPhrase: true,
            patterns: [{ value: "carry", weight: 1 }],
          },
        },
      },
    ] satisfies GeneratorOverrides[])
      expect(() => config(overrides)).toThrow();
    expect(generatorConfigFingerprint(config())).toMatch(/^8.0.0:/);
    const disabled = resolveGeneratorConfig();
    expect(disabled.notation.ties).toBe(false);
    expect(generatorConfigFingerprint(disabled)).toMatch(/^5.2.0:/);
  });

  it("subdivides deterministic long notes with explicit links and one attack lifetime", () => {
    const c = config({
      rhythm: { durations: [{ value: 960, weight: 1 }], breathBars: [] },
      notation: {
        ties: {
          ...tieDefaults,
          probability: 1,
          patterns: [{ value: "subdivide", weight: 1 }],
        },
      },
    });
    const p = generateConfigured(c, "subdivide");
    expect(validateGeneratedPhrase(p)).toEqual([]);
    expect(p.events).toHaveLength(16);
    expect(lifetimeNotes(p.events)).toHaveLength(8);
    for (const n of p.events.flatMap(noteheads)) {
      expect(n.tie?.count).toBe(2);
      expect(n.lifetime?.durationTicks).toBe(960);
    }
    expect(generateConfigured(c, "subdivide")).toEqual(p);
  });

  it("connects partially tied chords and crosses barlines without manufacturing attacks", () => {
    const c = config({
      melody: { maxIntervalSteps: 4 },
      chords: { ...chordDefaults, probability: 1 },
      harmony: { progressions: [{ value: [1, 1, 1, 1], weight: 1 }] },
      rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
      notation: {
        ties: {
          ...tieDefaults,
          probability: 1,
          chordTones: "any",
          patterns: [{ value: "connect", weight: 1 }],
        },
      },
    });
    const phrases = Array.from({ length: 50 }, (_, i) =>
      generateConfigured(c, `chord-${i}`),
    );
    const partial = phrases
      .flatMap((p) => p.events)
      .find(
        (e) =>
          noteheads(e).some((n) => n.tie?.index === 1) &&
          noteheads(e).some((n) => !n.tie),
      );
    expect(partial).toBeDefined();
    const crossing = phrases
      .flatMap((p) => p.events)
      .find(
        (e) => e.onset === 0 && noteheads(e).some((n) => n.tie?.index === 1),
      );
    expect(crossing).toBeDefined();
    phrases.forEach((p) => expect(validateGeneratedPhrase(p)).toEqual([]));
  });

  it("supports four-segment subdivisions, three-segment connections and cross-measure-only policy", () => {
    const four = config({
      rhythm: { durations: [{ value: 960, weight: 1 }], breathBars: [] },
      notation: {
        ties: {
          ...tieDefaults,
          probability: 1,
          segmentCounts: [4],
          subdivisions: [240],
          patterns: [{ value: "subdivide", weight: 1 }],
        },
      },
    });
    const p = generateConfigured(four, "four-segments");
    expect(p.events.every((e) => e.tie?.count === 4)).toBe(true);
    expect(validateGeneratedPhrase(p)).toEqual([]);
    for (const withinMeasure of [true, false]) {
      const c = config({
        melody: { repetitionBonus: 1000 },
        rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
        notation: {
          ties: {
            ...tieDefaults,
            probability: 1,
            withinMeasure,
            segmentCounts: withinMeasure ? [3] : [2],
            patterns: [{ value: "connect", weight: 1 }],
          },
        },
      });
      const q = generateConfigured(c, "connections");
      expect(q.events.some((e) => e.tie)).toBe(true);
      expect(validateGeneratedPhrase(q)).toEqual([]);
      if (!withinMeasure)
        for (const e of q.events.filter((e) => e.tie?.index === 1))
          expect(e.onset).toBe(0);
    }
    const acrossThree = config({
      melody: { repetitionBonus: 1000 },
      rhythm: { durations: [{ value: 1920, weight: 1 }], breathBars: [] },
      notation: {
        ties: {
          ...tieDefaults,
          probability: 1,
          withinMeasure: false,
          segmentCounts: [3],
          maxDurationTicks: 5760,
          patterns: [{ value: "connect", weight: 1 }],
        },
      },
    });
    const connected = generateConfigured(acrossThree, "three-bars");
    expect(connected.events.some((e) => e.tie?.count === 3)).toBe(true);
    expect(validateGeneratedPhrase(connected)).toEqual([]);
  });

  it("commits and consumes cross-phrase release targets without mutating previous output", () => {
    const c = config({
      rhythm: {
        durations: [
          { value: 480, weight: 1 },
          { value: 960, weight: 1 },
        ],
        breathBars: [],
      },
      hands: { active: "both" },
      notation: {
        ties: {
          ...tieDefaults,
          probability: 1,
          crossPhrase: true,
          patterns: [{ value: "carry", weight: 1 }],
        },
      },
    });
    let p = generateConfigured(c, "carry");
    for (let i = 0; i < 4; i++) {
      expect(p.final.activeLifetimes).toHaveLength(2);
      const snapshot = structuredClone(p);
      const next = generateConfigured(c, "carry", p.final);
      expect(p).toEqual(snapshot);
      expect(next.initial).toEqual(p.final);
      expect(validateGeneratedPhrase(next)).toEqual([]);
      expect(generateConfigured(c, "carry", p.final)).toEqual(next);
      for (const pending of p.final.pendingTies!) {
        const e = next.events.find((e) => e.id === pending.nextSegmentId)!;
        expect(e.notes![0].tie?.index).toBe(1);
        expect(e.notes![0].lifetime).toEqual(pending.head.lifetime);
        expect(lifetimeNotes([e])).toEqual([]);
      }
      p = next;
    }
    const bad = structuredClone(p.final);
    bad.pendingTies![0].duration++;
    expect(() => generateConfigured(c, "carry", bad)).toThrow(/tie state/);
    expect(() => generateConfigured(config(), "carry", p.final)).toThrow();
    const alteredPitch = structuredClone(p);
    alteredPitch.initial.pendingTies![0].head.pitch = "G8";
    expect(validateGeneratedPhrase(alteredPitch)).toContain(
      "Invalid tie continuation boundary state.",
    );
  });

  it("independently rejects broken connectivity, ownership, duration, policy and carry state", () => {
    const c = config({
      rhythm: { breathBars: [] },
      notation: {
        ties: {
          ...tieDefaults,
          probability: 1,
          patterns: [{ value: "subdivide", weight: 1 }],
        },
      },
    });
    const p = generateConfigured(c, "malformed");
    const index = p.events.findIndex((e) => e.tie?.index === 1);
    expect(index).toBeGreaterThan(-1);
    for (const corrupt of [
      (q: typeof p) => {
        q.events[index].notes![0].tie!.lifetimeId = "missing";
      },
      (q: typeof p) => {
        q.events[index].notes![0].tie!.previousId = "missing";
      },
      (q: typeof p) => {
        q.events[index].notes![0].tie!.index = 0;
      },
      (q: typeof p) => {
        q.events[index].notes![0].lifetime!.releaseTick++;
      },
      (q: typeof p) => {
        q.events[index].notes![0].lifetime!.voiceId = "left:main";
      },
      (q: typeof p) => {
        q.events[index].notes![0].midi++;
      },
      (q: typeof p) => {
        q.events[index].notes![0].finger = 5;
      },
      (q: typeof p) => {
        q.events[index].notes![0].tie!.count = 4;
      },
      (q: typeof p) => {
        delete q.events[index].notes![0].tie;
      },
    ]) {
      const q = structuredClone(p);
      corrupt(q);
      expect(validateGeneratedPhrase(q).length).toBeGreaterThan(0);
    }
  });

  it("preserves exact measures, occupancy, movement preparation and deterministic streams across configurations", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom("C", "G", "F", "D"),
        fc.constantFrom("right", "left", "both"),
        fc.boolean(),
        fc.constantFrom(3 as const, 4 as const),
        (seed, key, active, moving, beats) => {
          const c = config({
            notation: {
              key,
              beats,
              ties: {
                ...tieDefaults,
                probability: 0.8,
                segmentCounts: [2, 3, 4],
                chordTones: "any",
              },
            },
            hands: {
              active,
              right: { min: 60, max: 96 },
              left: { min: 24, max: 59 },
            },
            chords: { ...chordDefaults, probability: 0.8 },
            movement: moving
              ? {
                  ...repositionDefaults,
                  probability: 1,
                  eligibleBars: [1, 2, 3],
                }
              : { kind: "fixed" },
            wideLeaps: moving
              ? { ...wideLeapDefaults, probability: 1 }
              : { kind: "disabled" },
            rhythm: {
              durations: [240, 480, 960, 1920].map((value) => ({
                value: value as 240 | 480 | 960 | 1920,
                weight: 1,
              })),
            },
          });
          let p = generateConfigured(c, String(seed));
          for (let phrase = 0; phrase < 3; phrase++) {
            expect(validateGeneratedPhrase(p)).toEqual([]);
            expect(
              generateConfigured(
                c,
                String(seed),
                phrase ? p.initial : undefined,
              ),
            ).toEqual(p);
            for (const h of p.initial.hands)
              for (let bar = p.initial.bar; bar < p.final.bar; bar++)
                expect(
                  p.events
                    .filter((e) => e.bar === bar && e.hand === h.hand)
                    .reduce((sum, e) => sum + e.duration, 0),
                ).toBe(c.notation.beats * TPQ);
            p = generateConfigured(c, String(seed), p.final);
          }
        },
      ),
      { seed: 802023, numRuns: 60 },
    );
  });
});
