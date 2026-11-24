import fc from "fast-check";
import { expect, it } from "vitest";
import { attachNoteLifetimes, lifetimeNotes } from "../score/lifetimes";
import { selectFingeringHints } from "../score/hints";
import { writtenPitch } from "../score/pitch";
import { TPQ, type StreamState } from "../score/model";
import {
  generateConfigured,
  generatorConfigVersion,
  GeneratorSearchExhaustedError,
  noteLifetimeDefaults,
  repositionDefaults,
  resolveGeneratorConfig,
  validateGeneratedPhrase,
  wideLeapDefaults,
} from ".";
import { guidedIndependentDuet, movingTrebleWithHeldBass } from "./examples";

it("streams hand-local leap preparation, coverage and independently tied chords", () => {
  const config = movingTrebleWithHeldBass();
  expect(generatorConfigVersion(config)).toBe("10.0.0");
  fc.assert(
    fc.property(fc.integer(), (seedNumber) => {
      const seed = String(seedNumber);
      let previous: StreamState | undefined;
      let moves = 0,
        carriedChord = false,
        chromatic = false,
        overlapping = false;
      for (let i = 0; i < 36; i++) {
        const phrase = generateConfigured(config, seed, previous);
        expect(phrase.initial).toEqual(previous ?? phrase.initial);
        expect(validateGeneratedPhrase(phrase)).toEqual([]);
        expect(phrase.final.coverage?.right).not.toBe(
          phrase.final.coverage?.left,
        );
        for (const hand of ["right", "left"] as const) {
          const coverage = phrase.final.coverage![hand]!;
          expect(coverage.usage).toHaveLength(5);
          expect(
            coverage.usage.reduce((sum, use) => sum + use, 0),
          ).toBeLessThanOrEqual(1);
          expect(coverage.remaining).toBeLessThan(64);
        }
        const notes = [
          ...(phrase.initial.activeLifetimes ?? []),
          ...lifetimeNotes(phrase.events),
        ];
        carriedChord ||= (phrase.final.activeLifetimes ?? []).length > 1;
        chromatic ||= phrase.events.some((e) =>
          e.notes?.some((n) => n.written?.accidental),
        );
        for (const m of phrase.movements) {
          expect(m.hand).toBe("right");
          expect(m.technique).toBe("lifted-wide-leap");
          expect(m.landingTick - m.cueTick).toBe(2 * TPQ);
          expect(
            notes.some(
              ({ hand, lifetime }) =>
                hand === m.hand &&
                lifetime.onsetTick < m.landingTick &&
                lifetime.releaseTick > m.cueTick,
            ),
          ).toBe(false);
          overlapping ||= notes.some(
            ({ hand, lifetime }) =>
              hand === "left" &&
              lifetime.onsetTick < m.landingTick &&
              lifetime.releaseTick > m.landingTick,
          );
          moves++;
        }
        previous = phrase.final;
      }
      expect(moves).toBeGreaterThan(2);
      expect([carriedChord, chromatic, overlapping]).toEqual([
        true,
        true,
        true,
      ]);
    }),
    { seed: 98422, numRuns: 6 },
  );
});

it("keeps deterministic coverage with existing small shifts and independent registers", () => {
  const config = guidedIndependentDuet();
  const seed = "guided-independent";
  const first = generateConfigured(config, seed);
  const second = generateConfigured(config, seed, first.final);
  expect(generateConfigured(config, seed, first.final)).toEqual(second);
  expect([...first.movements, ...second.movements].length).toBeGreaterThan(0);
  expect(second.final.coverage?.left?.max).toBeLessThan(
    second.final.coverage!.right!.min,
  );
  expect(
    second.events
      .filter((e) => e.kind === "note")
      .every((e) => (e.hand === "left" ? e.midi <= 57 : e.midi >= 64)),
  ).toBe(true);
  const bad = structuredClone(second);
  bad.final.coverage!.left!.usage.fill(0);
  expect(validateGeneratedPhrase(bad)).toContain(
    "Independent coverage state differs from the sounding score.",
  );
});

it("retains a committed hold instead of preparing an overlapping same-hand leap", () => {
  const config = resolveGeneratorConfig(
    {
      notation: { ties: { voices: ["right:main"] } },
      wideLeaps: { eligibleBars: [1] },
      independentVoices: {
        right: {
          voices: [
            { durations: [{ value: 1920, weight: 1 }], chromatic: false },
          ],
        },
      },
    },
    movingTrebleWithHeldBass(),
  );
  const first = generateConfigured(config, "same-hand-hold");
  expect(first.final.activeLifetimes!.some((n) => n.hand === "right")).toBe(
    true,
  );
  const next = generateConfigured(config, first.seed, first.final);
  expect(next.movements).toEqual([]);
  expect(next.events.some((e) => e.hand === "right" && e.tie?.previousId)).toBe(
    true,
  );
  expect(validateGeneratedPhrase(next)).toEqual([]);
});

it("composes small and wide moves by skipping a landing inside reserved silence", () => {
  const config = resolveGeneratorConfig({
    notation: { voices: "independent" },
    hands: { right: { max: 91 } },
    melody: { maxIntervalSteps: 7 },
    movement: {
      ...repositionDefaults,
      probability: 1,
      eligibleBars: [1, 2, 3],
      maxDistanceSteps: 4,
    },
    wideLeaps: {
      ...wideLeapDefaults,
      probability: 1,
      eligibleBars: [2, 3],
      preparationBeats: 5,
    },
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: { right: { voices: [{}] } },
  });
  let previous: StreamState | undefined;
  const techniques = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const phrase = generateConfigured(
      config,
      "staggered-movement-windows",
      previous,
    );
    expect(
      phrase.events
        .filter((e) => e.bar === phrase.initial.bar + 1)
        .every((e) => e.kind === "rest"),
    ).toBe(true);
    expect(validateGeneratedPhrase(phrase)).toEqual([]);
    for (const move of phrase.movements) techniques.add(move.technique);
    previous = phrase.final;
  }
  expect(techniques).toEqual(
    new Set(["lift-and-reposition", "lifted-wide-leap"]),
  );
});

it("does not draw or reserve preparation when wide leap probability is zero", () => {
  const base = resolveGeneratorConfig({
    notation: { voices: "independent" },
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: { right: { voices: [{}, {}] } },
  });
  const disabled = generateConfigured(base, "no-leap-draw");
  const enabled = generateConfigured(
    resolveGeneratorConfig(
      {
        wideLeaps: { ...wideLeapDefaults, probability: 0 },
      },
      base,
    ),
    disabled.seed,
  );
  expect(enabled.version).toBe("10.0.0");
  expect(enabled.events).toEqual(disabled.events);
  expect(enabled.final.rng).toBe(disabled.final.rng);
  expect(enabled.final.independentVoices?.leapPreparations).toBeUndefined();
});

it("distinguishes schema rejection, impossible positions and bounded search exhaustion", () => {
  const base = movingTrebleWithHeldBass();
  expect(() =>
    resolveGeneratorConfig(
      {
        wideLeaps: {
          ...wideLeapDefaults,
          minDistanceSteps: 15,
          maxDistanceSteps: 5,
        },
      },
      base,
    ),
  ).toThrow(/minimum leap distance/i);
  expect(() =>
    generateConfigured(
      resolveGeneratorConfig(
        {
          wideLeaps: {
            ...wideLeapDefaults,
            minDistanceSteps: 20,
            maxDistanceSteps: 25,
            preparationBeats: 4,
          },
        },
        base,
      ),
      "no-target",
    ),
  ).toThrow(/wide leaps are infeasible/i);
  const budget = resolveGeneratorConfig({
    notation: { voices: "independent" },
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: {
      maxAttempts: 1,
      right: { voices: [{ minAttacksPerPhrase: 4, activity: 1e-12 }] },
    },
  });
  expect(() => generateConfigured(budget, "exhausted")).toThrow(
    GeneratorSearchExhaustedError,
  );
});

it("validates a tagged adjacent finger after a hand-local rest under a sounding opposite voice", () => {
  const c = resolveGeneratorConfig({
    hands: { active: "both" },
    notation: { voices: "independent" },
    melody: { maxIntervalSteps: 4 },
    rhythm: { breathBars: [] },
    fingering: { allowRestedAlternates: true },
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: {
      left: { voices: [{ durations: [{ value: 1920, weight: 1 }] }] },
      right: { voices: [{ durations: [{ value: 480, weight: 1 }] }] },
    },
  });
  const phrase = generateConfigured(c, "tagged-alternate");
  const [first, rest, alternate, last] = phrase.events.filter(
    (e) => e.voiceId === "right:main" && e.bar === 0,
  );
  const setNote = (
    event: typeof first,
    midi: number,
    pitch: string,
    finger: number,
  ) => {
    Object.assign(event, {
      midi,
      pitch,
      finger,
      kind: "note",
      action: "PLAY_WITHIN_POSITION",
      notes: [
        {
          id: event.id,
          midi,
          pitch,
          finger,
          hand: "right",
          written: writtenPitch(pitch, "C"),
        },
      ],
    });
  };
  setNote(first, 60, "C4", 1);
  Object.assign(rest, {
    kind: "rest",
    action: "REST",
    midi: 0,
    pitch: "",
    finger: 0,
    notes: [],
  });
  delete rest.lifetime;
  setNote(alternate, 64, "E4", 2);
  alternate.fingering = { technique: "rested-alternate", expectedFinger: 3 };
  setNote(last, 67, "G4", 5);
  const next = phrase.events.find(
    (e) => e.voiceId === "right:main" && e.bar === 1,
  )!;
  next.action =
    next.midi === last.midi ? "REPEAT_NOTE" : "PLAY_WITHIN_POSITION";
  attachNoteLifetimes(phrase.events, c);
  expect(validateGeneratedPhrase(phrase)).toEqual([]);
  expect(
    selectFingeringHints(phrase.events, phrase.positions, [], "smart").find(
      (hint) => hint.noteId === alternate.id,
    ),
  ).toMatchObject({ expectedFinger: 3, plannedFinger: 2, show: true });

  const unexplained = structuredClone(phrase);
  delete unexplained.events.find((e) => e.id === alternate.id)!.fingering;
  expect(validateGeneratedPhrase(unexplained)).toContain(
    "Independent voice violates pitch, finger, spelling or transition rules.",
  );
  setNote(rest, 62, "D4", 2);
  attachNoteLifetimes(phrase.events, c);
  expect(validateGeneratedPhrase(phrase)).toContain(
    "Invalid rested alternate fingering.",
  );
});
