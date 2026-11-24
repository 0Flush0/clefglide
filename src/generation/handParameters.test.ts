import { expect, test } from "vitest";
import {
  chordDefaults,
  chromaticDefaults,
  coverageDefaults,
  generateConfigured,
  normalizeGeneratorConfig,
  noteLifetimeDefaults,
  repositionDefaults,
  resolveGeneratorConfig,
  tieDefaults,
  validateGeneratedPhrase,
  wideLeapDefaults,
} from ".";
import { dynamicRules } from "./examples";
import { generatorDefaults } from "./config";
import { diatonicIndex } from "./positionMaps";
import { defaults, noteheads } from "../score/model";
import { Scorer } from "../scoring/engine";

test("one hand's rhythm and melody changes preserve the disjoint partner's seeded line", () => {
  const base = resolveGeneratorConfig({
    hands: { active: "both", left: { min: 36, max: 48 } },
    notation: { voices: "independent" },
    independentVoices: { right: { voices: [{}] }, left: { voices: [{}] } },
    noteLifetimes: noteLifetimeDefaults,
    handParameters: {},
  });
  const changed = normalizeGeneratorConfig({
    ...base,
    handParameters: {
      left: {
        melody: { ...base.melody, maxIntervalSteps: 1 },
        rhythm: {
          ...base.rhythm,
          durations: [{ value: 960, weight: 1 }],
          breathBars: [],
        },
      },
    },
  });
  type Phrase = ReturnType<typeof generateConfigured>;
  let previous: Phrase | undefined, baseline: Phrase | undefined;
  for (let chunk = 0; chunk < 12; chunk++) {
    const phrase = generateConfigured(
      changed,
      "disjoint-bands",
      previous?.final,
    );
    baseline = generateConfigured(base, "disjoint-bands", baseline?.final);
    expect(validateGeneratedPhrase(phrase, previous)).toEqual([]);
    expect(phrase.events.filter((e) => e.hand === "right")).toEqual(
      baseline.events.filter((e) => e.hand === "right"),
    );
    const line = phrase.events.filter(
      (e) => e.hand === "left" && e.kind === "note",
    );
    expect(line).toHaveLength(8);
    expect(line.every((e) => e.duration === 960)).toBe(true);
    expect(
      line.every(
        (e, i) =>
          !i ||
          Math.abs(diatonicIndex(e.pitch) - diatonicIndex(line[i - 1].pitch)) <=
            1,
      ),
    ).toBe(true);
    previous = phrase;
  }
});

test("scoped ties, chords, chromatic notes, fingering, movement and touch interoperate", () => {
  const config = resolveGeneratorConfig({
    hands: {
      active: "both",
      right: { min: 60, max: 88 },
      left: { min: 36, max: 50 },
    },
    notation: { voices: "independent" },
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: {
      left: { voices: [{ durations: [{ value: 960, weight: 1 }] }] },
      right: {
        voices: [
          {},
          {
            activity: 0.45,
            chords: false,
            chromatic: false,
            fingers: [1, 2, 3],
          },
        ],
      },
    },
    handParameters: {
      left: {
        rhythm: { ...generatorDefaults.rhythm, breathBars: [] },
        chords: { ...chordDefaults, probability: 0.65 },
        ties: {
          ...tieDefaults,
          voices: ["left:main"],
          probability: 0.6,
          chordTones: "all",
          patterns: [{ value: "subdivide", weight: 1 }],
        },
        articulation: {
          kind: "enabled",
          voices: ["left:main"],
          emphasis: [{ value: "accent" }],
        },
      },
      right: {
        movement: {
          ...repositionDefaults,
          eligibleBars: [1],
          probability: 0.65,
        },
        wideLeaps: {
          ...wideLeapDefaults,
          probability: 0.55,
          eligibleBars: [3],
        },
        coverage: coverageDefaults,
        chromatic: { ...chromaticDefaults, probability: 0.4 },
        dynamicFingering: {
          tempoBpm: 60,
          fingerWeights: [1, 1, 1, 1, 1],
          attacks: { maxConsecutive: 2, maxRepeated: 1, distanceCost: 0.2 },
          techniques: [dynamicRules["adjacent-reach"]],
        },
        articulation: {
          kind: "enabled",
          voices: ["right:main"],
          touch: [{ value: "staccato" }],
          touchProbability: 0.4,
          evaluation: { kind: "evaluate" },
        },
      },
    },
  });
  const used = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const seed = `scoped-mixed-${i}`;
    let previous: ReturnType<typeof generateConfigured> | undefined;
    let scorer: Scorer | undefined;
    for (let chunk = 0; chunk < 8; chunk++) {
      const phrase = generateConfigured(config, seed, previous?.final);
      expect(
        validateGeneratedPhrase(phrase, previous),
        `${seed}, chunk ${chunk}`,
      ).toEqual([]);
      const notes = phrase.events.filter((e) => e.kind === "note");
      if (scorer) scorer.appendNotes(notes);
      else
        scorer = new Scorer(
          notes,
          { ...defaults, mode: "timed", bpm: 60 },
          120,
          config,
        );
      for (const move of phrase.movements) {
        expect(move.hand).toBe("right");
        used.add(move.technique);
      }
      for (const event of notes) {
        if (event.voiceId === "right:2") used.add("secondary voice");
        if (event.fingering) {
          expect(event.hand).toBe("right");
          used.add(event.fingering.technique);
        }
        if (event.articulation?.touch) {
          expect(event.hand).toBe("right");
          used.add(event.articulation.touch);
        }
        if (event.articulation?.emphasis) {
          expect(event.hand).toBe("left");
          used.add(event.articulation.emphasis);
        }
        if (event.notes!.length > 1) {
          expect(event.hand).toBe("left");
          used.add("chord");
        }
        if (noteheads(event).some((n) => n.tie)) {
          expect(event.hand).toBe("left");
          used.add("tie");
        }
        if (noteheads(event).some((n) => n.written?.accidental)) {
          expect(event.hand).toBe("right");
          used.add("accidental");
        }
      }
      previous = phrase;
    }
  }
  expect([...used].sort()).toEqual([
    "accent",
    "accidental",
    "adjacent-reach",
    "chord",
    "lift-and-reposition",
    "lifted-wide-leap",
    "secondary voice",
    "staccato",
    "tie",
  ]);
});
