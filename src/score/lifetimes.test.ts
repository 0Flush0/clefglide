import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { defaults, type LifetimeNote, type MovementPlan } from "./model";
import { lifetimeOccupancy, lifetimeNotes } from "./lifetimes";
import {
  noteLifetimeDataSchema,
  validateLifetimePlan,
} from "./lifetimeValidation";
import {
  resolveGeneratorConfig,
  normalizeGeneratorConfig,
  noteLifetimeDefaults,
  durationEvaluationDefaults,
  wideLeapDefaults,
  repositionDefaults,
  generatorConfigFingerprint,
  type GeneratorOverrides,
} from "../generation/config";
import { generateConfigured } from "../generation";
import { validateGeneratedPhrase } from "../generation/phraseValidator";

const note = (
  id = "held",
  onsetTick = 0,
  releaseTick = 2400,
  midi = 60,
  finger = 1,
): LifetimeNote => ({
  id,
  eventId: id,
  midi,
  hand: "right",
  finger,
  positionId: "position",
  lifetime: {
    voiceId: "upper",
    onsetTick,
    releaseTick,
    durationTicks: releaseTick - onsetTick,
    keyHold: { kind: "required", releaseTick },
  },
});

describe("canonical note lifetimes and occupancy", () => {
  it("represents held notes under moving voices without treating voice labels as ties", () => {
    const a = note(),
      b = note("moving", 480, 960, 64, 3);
    b.lifetime.voiceId = "other-voice";
    expect(validateLifetimePlan({ notes: [a, b] })).toEqual([]);
    expect(lifetimeOccupancy([a, b], 600).physical.map((n) => n.id)).toEqual([
      "held",
      "moving",
    ]);
    expect(lifetimeOccupancy([a, b], 960).fingers).toEqual([
      { hand: "right", finger: 1, noteId: "held" },
    ]);
    expect(lifetimeOccupancy([a], 2400).physical).toEqual([]);
  });
  it("carries a single attack across multiple phrase boundaries with exact final state", () => {
    const held = note("long", 0, 6000);
    expect(
      validateLifetimePlan({
        notes: [held],
        startTick: 0,
        endTick: 1920,
        final: [held],
      }),
    ).toEqual([]);
    expect(
      validateLifetimePlan({
        notes: [],
        initial: [held],
        startTick: 1920,
        endTick: 3840,
        final: [held],
      }),
    ).toEqual([]);
    expect(
      validateLifetimePlan({
        notes: [],
        initial: [held],
        startTick: 3840,
        endTick: 7680,
        final: [],
      }),
    ).toEqual([]);
    expect(
      validateLifetimePlan({
        notes: [],
        initial: [held],
        startTick: 1920,
        endTick: 3840,
        final: [],
      }),
    ).toContain("Final active lifetimes differ from the score.");
    expect(
      validateLifetimePlan({ notes: [held], initial: [held], startTick: 1920 }),
    ).toContain("Duplicate lifetime attack identity.");
  });
  it("rejects finger conflicts, ambiguous same-pitch overlap, and unsupported tie data", () => {
    expect(
      validateLifetimePlan({ notes: [note(), note("other", 480, 960, 64, 1)] }),
    ).toContain("A planned finger is occupied by overlapping notes.");
    expect(
      validateLifetimePlan({ notes: [note(), note("other", 480, 960, 60, 2)] }),
    ).toContain(
      "Overlapping same-pitch lifetimes need unsupported unison/tie attribution.",
    );
    expect(
      noteLifetimeDataSchema.safeParse({ ...note().lifetime, tie: "continue" })
        .success,
    ).toBe(false);
    for (const change of [
      { onsetTick: -1 },
      { releaseTick: 0 },
      { durationTicks: 1.5 },
      { durationTicks: 1 },
      { keyHold: { kind: "required", releaseTick: 3000 } },
    ])
      expect(
        noteLifetimeDataSchema.safeParse({ ...note().lifetime, ...change })
          .success,
      ).toBe(false);
  });
  it("separates physical occupancy from the intended sounding interval and movement preparation", () => {
    const a = note();
    a.lifetime.keyHold = { kind: "required", releaseTick: 480 };
    const m: MovementPlan = {
      id: "move",
      hand: "right",
      technique: "lifted-wide-leap",
      fromPositionId: "position",
      toPositionId: "new",
      cueTick: 480,
      landingTick: 1920,
      landingNoteId: "landing",
      landingMidi: 84,
      landingFinger: 1,
      distance: 14,
    };
    expect(lifetimeOccupancy([a], 600)).toMatchObject({
      physical: [],
      sounding: [a],
    });
    expect(validateLifetimePlan({ notes: [a] }, [m])).toEqual([]);
    a.lifetime.keyHold.releaseTick = 481;
    expect(validateLifetimePlan({ notes: [a] }, [m])).toContain(
      "A required physical hold overlaps hand-movement preparation.",
    );
    a.lifetime.keyHold = { kind: "attack-only" };
    expect(lifetimeOccupancy([a], 100).physical).toEqual([]);
  });
});

describe("lifetime configuration and generator integration", () => {
  it("validates independent evaluation policy and rejects contradictions or unsupported capabilities", () => {
    const base = resolveGeneratorConfig({
      noteLifetimes: noteLifetimeDefaults,
    });
    const invalid = [
      {
        noteLifetimes: {
          kind: "explicit",
          keyHold: "required",
          evaluation: {
            ...durationEvaluationDefaults,
            toleranceMs: -1,
          },
        },
      },
      {
        noteLifetimes: {
          kind: "explicit",
          keyHold: "attack-only",
          evaluation: durationEvaluationDefaults,
        },
      },
      {
        noteLifetimes: {
          kind: "explicit",
          keyHold: "required",
          evaluation: {
            ...durationEvaluationDefaults,
            earlyRelease: "ignore",
            lateRelease: "ignore",
          },
        },
      },
      {
        noteLifetimes: {
          kind: "explicit",
          keyHold: "required",
          evaluation: {
            ...durationEvaluationDefaults,
            waitMode: "score-clock",
          },
        },
      },
      { notation: { ...base.notation, ties: true } },
      { notation: { ...base.notation, voices: "independent" } },
      {
        noteLifetimes: {
          kind: "explicit",
          keyHold: "required",
          evaluation: { kind: "disabled", toleranceMs: 12 },
        },
      },
    ];
    invalid.forEach((change) =>
      expect(() => normalizeGeneratorConfig({ ...base, ...change })).toThrow(),
    );
    expect(
      resolveGeneratorConfig({
        noteLifetimes: {
          ...noteLifetimeDefaults,
          evaluation: durationEvaluationDefaults,
        },
      }).noteLifetimes.kind,
    ).toBe("explicit");
  });
  it("preserves both legacy and v6 fingerprints when lifetimes are disabled", () => {
    for (const wideLeaps of [
      { kind: "disabled" },
      wideLeapDefaults,
    ] satisfies GeneratorOverrides["wideLeaps"][]) {
      const c = resolveGeneratorConfig({ wideLeaps });
      const { noteLifetimes: _life, wideLeaps: wide, ...legacy } = c;
      void _life;
      const old =
        wide.kind === "disabled" ? legacy : { ...legacy, wideLeaps: wide };
      expect(generatorConfigFingerprint(c)).toBe(
        `${wide.kind === "disabled" ? "5.2.0" : "6.0.0"}:parameters:${JSON.stringify(old)}`,
      );
      const enabled = resolveGeneratorConfig(
        { noteLifetimes: noteLifetimeDefaults },
        c,
      );
      expect(generatorConfigFingerprint(enabled)).toMatch(/^7.0.0:parameters:/);
      expect(generatorConfigFingerprint(enabled)).not.toBe(
        generatorConfigFingerprint(c),
      );
    }
    expect(defaults).not.toHaveProperty("noteLifetimes");
  });
  it("independently rejects corrupted or missing generated lifetimes and unsupported carry-in voices", () => {
    const c = resolveGeneratorConfig({ noteLifetimes: noteLifetimeDefaults });
    const p = generateConfigured(c, "lifetime-corruption");
    expect(validateGeneratedPhrase(p)).toEqual([]);
    const missing = structuredClone(p);
    delete missing.events[0].notes![0].lifetime;
    expect(validateGeneratedPhrase(missing)).toContain(
      "Missing or invalid generated note lifetime.",
    );
    const changed = structuredClone(p);
    changed.events[0].notes![0].lifetime!.releaseTick++;
    changed.events[0].notes![0].lifetime!.durationTicks++;
    changed.events[0].notes![0].lifetime!.keyHold = {
      kind: "required",
      releaseTick: changed.events[0].notes![0].lifetime!.releaseTick,
    };
    expect(validateGeneratedPhrase(changed)).toContain(
      "Generated lifetime differs from the resolved score contract.",
    );
    const carry = structuredClone(p.final);
    carry.activeLifetimes = [note("carry", 0, 10000)];
    expect(() => generateConfigured(c, "lifetime-corruption", carry)).toThrow(
      /carry-in/,
    );
    const disabled = resolveGeneratorConfig();
    const legacy = generateConfigured(disabled, "old");
    legacy.events[0].lifetime = note().lifetime;
    expect(validateGeneratedPhrase(legacy)).toContain(
      "Explicit lifetimes require the enabled lifetime capability.",
    );
  });
  it("preserves notes, PRNG sequences and continuity under opt-in metadata projection", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom("C", "G", "F", "D"),
        fc.constantFrom("right", "left", "both"),
        (seed, key, hand) => {
          const legacy = resolveGeneratorConfig({
            notation: { key },
            hands: {
              active: hand,
              right: { min: 60, max: 96 },
              left: { min: 24, max: 59 },
            },
            movement: {
              ...repositionDefaults,
              probability: 1,
              eligibleBars: [1, 2, 3],
              maxDistanceSteps: 4,
            },
          });
          const c = resolveGeneratorConfig(
            { noteLifetimes: noteLifetimeDefaults },
            legacy,
          );
          let plain = generateConfigured(legacy, String(seed)),
            explicit = generateConfigured(c, String(seed));
          const strip = (events: typeof explicit.events) => {
            const copy = structuredClone(events);
            copy.forEach((e) => {
              delete e.lifetime;
              e.notes?.forEach((n) => delete n.lifetime);
            });
            return copy;
          };
          for (let i = 0; i < 3; i++) {
            expect(strip(explicit.events)).toEqual(plain.events);
            expect(explicit.final.rng).toBe(plain.final.rng);
            expect(lifetimeNotes(explicit.events)).not.toHaveLength(0);
            expect(validateGeneratedPhrase(explicit)).toEqual([]);
            expect(explicit.final.activeLifetimes).toEqual([]);
            const prior = explicit.final;
            plain = generateConfigured(legacy, String(seed), plain.final);
            explicit = generateConfigured(c, String(seed), prior);
            expect(explicit.initial).toEqual(prior);
            expect(generateConfigured(c, String(seed), prior)).toEqual(
              explicit,
            );
          }
        },
      ),
      { seed: 702023, numRuns: 25 },
    );
  });
});
