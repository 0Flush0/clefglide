import {
  chordDefaults,
  chromaticDefaults,
  coverageDefaults,
  durationEvaluationDefaults,
  noteLifetimeDefaults,
  resolveGeneratorConfig,
  tieDefaults,
  wideLeapDefaults,
  type GeneratorConfig,
  type GeneratorOverrides,
} from "./config";

/** A mobile treble part over a bass part that can carry a full chord across a phrase. */
export function movingTrebleWithHeldBass() {
  return resolveGeneratorConfig({
    hands: { active: "both", right: { max: 88 } },
    notation: {
      voices: "independent",
      ties: {
        ...tieDefaults,
        voices: ["left:main"],
        patterns: [{ value: "carry", weight: 1 }],
        crossPhrase: true,
        probability: 1,
        chordTones: "all",
      },
    },
    rhythm: { breathBars: [] },
    harmony: { progressions: [{ value: [1, 1, 1, 1], weight: 1 }] },
    melody: { maxIntervalSteps: 4 },
    chromatic: { ...chromaticDefaults, probability: 0.65 },
    chords: { ...chordDefaults, probability: 1, maxVoiceLeadingSteps: 4 },
    wideLeaps: { ...wideLeapDefaults, probability: 1, eligibleBars: [0, 2] },
    coverage: { ...coverageDefaults, minMoveAcceptance: 0.5 },
    noteLifetimes: {
      ...noteLifetimeDefaults,
      evaluation: durationEvaluationDefaults,
    },
    independentVoices: {
      right: {
        voices: [
          {
            fingers: [2, 3, 4, 5],
            minMidi: 62,
            chords: false,
            durations: [{ value: 480, weight: 1 }],
          },
          { fingers: [1], chromatic: false, chords: false, activity: 0.7 },
        ],
      },
      left: {
        voices: [
          {
            chromatic: false,
            durations: [{ value: 1920, weight: 1 }],
          },
        ],
      },
    },
  });
}

/** Local relocation, independent registers and optional guided exploration in 3/4. */
export function guidedIndependentDuet() {
  return resolveGeneratorConfig({
    notation: { voices: "independent", key: "G", beats: 3 },
    hands: { active: "both", left: { min: 40, max: 59 }, right: { max: 81 } },
    melody: { maxIntervalSteps: 4 },
    movement: {
      kind: "rested-reposition",
      probability: 0.8,
      maxDistanceSteps: 3,
      eligibleBars: [2],
      preparationBeats: 1,
      distanceWeights: [4, 3, 2, 1],
    },
    coverage: coverageDefaults,
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: {
      right: {
        voices: [{ minMidi: 64, durations: [{ value: 240, weight: 1 }] }],
      },
      left: {
        voices: [{ maxMidi: 57, durations: [{ value: 960, weight: 1 }] }],
      },
    },
  });
}

type DynamicPolicy = NonNullable<GeneratorConfig["dynamicFingering"]>;
type Technique = DynamicPolicy["techniques"][number]["technique"];
const travel = {
  probability: 0.7,
  weight: 1,
  directions: ["up", "down"] as ["up", "down"],
  maxSemitones: 2,
  minimumPreparationMs: 140,
};
const moving = {
  ...travel,
  minimumTransitionMs: 120,
  allowBlackKeys: true,
  allowTiedSource: true,
};
export const dynamicRules = {
  "thumb-under": {
    technique: "thumb-under",
    ...moving,
    fingerPairs: [
      [2, 1],
      [3, 1],
    ],
    maxPositionSteps: 3,
  },
  "finger-over": {
    technique: "finger-over",
    ...moving,
    fingerPairs: [
      [1, 2],
      [1, 3],
    ],
    maxPositionSteps: 3,
  },
  "continuous-shift": {
    technique: "continuous-shift",
    ...moving,
    maxSemitones: 3,
    fingerPairs: [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
    ],
    maxPositionSteps: 1,
  },
  "adjacent-reach": {
    technique: "adjacent-reach",
    ...travel,
    fingerPairs: [
      [2, 3],
      [3, 2],
      [3, 4],
      [4, 3],
    ],
  },
  "rested-alternate": {
    technique: "rested-alternate",
    ...travel,
    fingerPairs: [
      [2, 3],
      [3, 2],
      [3, 4],
      [4, 3],
    ],
    minimumRestTicks: 480,
  },
  substitution: {
    technique: "substitution",
    probability: 1,
    fingerPairs: [
      [2, 3],
      [3, 2],
      [3, 4],
      [4, 3],
    ],
    minimumPreparationMs: 160,
    transferMs: 100,
    minimumRecoveryMs: 80,
    allowTies: true,
    heldNotes: "stable-dyad",
  },
} satisfies Record<Technique, DynamicPolicy["techniques"][number]>;

/** Choose one or more techniques, then optionally override the exercise context. */
export function dynamicFingeringExample(
  techniques: readonly Technique[],
  overrides: GeneratorOverrides = {},
) {
  const rests =
    techniques.includes("rested-alternate") ||
    techniques.includes("substitution");
  const base = resolveGeneratorConfig({
    hands: { right: { min: 60, max: 84 }, left: { min: 36, max: 59 } },
    rhythm: {
      breathBars: rests ? [1, 2] : [],
      durations: [{ value: 480, weight: 1 }],
    },
    fingering: {
      allowRestedAlternates: techniques.includes("rested-alternate"),
    },
    ...(techniques.includes("substitution")
      ? { noteLifetimes: noteLifetimeDefaults }
      : {}),
    dynamicFingering: {
      tempoBpm: 72,
      techniques: techniques.map((technique) => dynamicRules[technique]),
      fingerWeights: [1, 1, 1, 1, 1],
      ...(techniques.some((technique) => technique !== "substitution")
        ? { attacks: { maxConsecutive: 2, maxRepeated: 1, distanceCost: 0.2 } }
        : {}),
    },
  });
  return resolveGeneratorConfig(overrides, base);
}

/** Quarter-note lines with touch, phrase-level portato and relative accents. */
export function articulatedStudy(overrides: GeneratorOverrides = {}) {
  const base = resolveGeneratorConfig({
    rhythm: { durations: [{ value: 480, weight: 1 }], breathBars: [] },
    noteLifetimes: noteLifetimeDefaults,
    articulation: {
      kind: "enabled",
      voices: ["right:main"],
      touch: [
        { value: "natural", weight: 2 },
        { value: "non-legato" },
        { value: "staccato" },
        { value: "staccatissimo" },
        { value: "tenuto" },
      ],
      touchProbability: 0.5,
      emphasis: [{ value: "accent", weight: 2 }, { value: "marcato" }],
      emphasisProbability: 0.25,
      persistence: 0.2,
      slurs: {
        probability: 0.55,
        lengths: [{ value: 3 }, { value: 5 }],
        styles: [{ value: "legato", weight: 3 }, { value: "portato" }],
        crossPhrase: true,
      },
      evaluation: {
        kind: "evaluate",
        timingWeight: 1,
        velocityWeight: 0.4,
        waitMode: "velocity-only",
      },
    },
  });
  return resolveGeneratorConfig(overrides, base);
}

/** Legato treble against a separately timed bass voice with carried ties. */
export function articulatedDuet() {
  return resolveGeneratorConfig(
    {
      articulation: {
        kind: "enabled",
        voices: ["right:main"],
        touch: [{ value: "legato" }],
        touchProbability: 0.5,
        slurs: { crossPhrase: true, lengths: [{ value: 3 }, { value: 5 }] },
        interactions: { sustained: "allow", ties: "preserve-hold" },
      },
    },
    movingTrebleWithHeldBass(),
  );
}
