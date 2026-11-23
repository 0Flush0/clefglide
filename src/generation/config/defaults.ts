import type { GeneratorConfig } from "./schema";

const weighted = <T>(...values: T[]) =>
  values.map((value) => ({ value, weight: 1 }));
/** Explicit opt-in; never composed into UI presets. */
export const tieDefaults = {
  kind: "enabled",
  probability: 0.25,
  segmentCounts: [2],
  subdivisions: [240, 480, 960, 1920],
  withinMeasure: true,
  crossMeasure: true,
  crossPhrase: false,
  maxDurationTicks: 3840,
  voices: ["right:main", "left:main"],
  chordTones: "none",
  patterns: weighted("subdivide", "connect"),
} satisfies Exclude<GeneratorConfig["notation"]["ties"], false>;
export const durationEvaluationDefaults = {
  kind: "evaluate",
  toleranceMs: 120,
  earlyRelease: "penalize",
  lateRelease: "penalize",
  pedalTreatment: "physical",
  waitMode: "disabled",
} satisfies Extract<
  GeneratorConfig["noteLifetimes"],
  { kind: "explicit" }
>["evaluation"];
export const noteLifetimeDefaults = {
  kind: "explicit",
  keyHold: "required",
  evaluation: { kind: "disabled" },
} satisfies GeneratorConfig["noteLifetimes"];
export const wideLeapDefaults = {
  kind: "lifted-wide",
  probability: 0.25,
  minDistanceSteps: 5,
  maxDistanceSteps: 14,
  maxLandingIntervalSteps: 18,
  targetSelection: "anywhere",
  landingSelection: "uniform-positions",
  distanceWeightExponent: -1,
  preparationBeats: 2,
  minimumPreparationBeats: 1,
  additionalPreparationBeatsPerOctave: 0.5,
  eligibleBars: [2],
  landingFingers: [1, 2, 3, 4, 5],
} satisfies GeneratorConfig["wideLeaps"];
export const repositionDefaults = {
  kind: "rested-reposition",
  probability: 0.25,
  maxDistanceSteps: 1,
  eligibleBars: [2],
  preparationBeats: 1,
  distanceWeights: [4, 3, 2, 1],
} satisfies GeneratorConfig["movement"];
export const chromaticDefaults = {
  kind: "neighbors",
  probability: 0.12,
  passingResolutionProbability: 0,
  preferAppliedDominant: false,
  preferAnchorResolution: true,
  preferMappedFinger: true,
} satisfies GeneratorConfig["chromatic"];
export const chordDefaults = {
  kind: "voicings",
  probability: 0.22,
  shapes: weighted("13", "14", "15", "24", "25", "35") as {
    value: "13" | "14" | "15" | "24" | "25" | "35";
    weight: number;
  }[],
  maxSpanSemitones: 7,
  dyadIntervals: [3, 4, 5, 7, 8, 9],
  maxVoiceLeadingSteps: 2,
  majorExtension: "none",
  minorExtension: "none",
} satisfies GeneratorConfig["chords"];
export const coverageDefaults = {
  kind: "guided",
  regions: 5,
  decay: 0.95,
  reachedToleranceSemitones: 1,
  usageFloor: 0.001,
  explorationWeight: 0.1,
  underuseExponent: 2,
  minTargetPhrases: 32,
  targetSpreadPhrases: 32,
  progressScaleSemitones: 2,
  minMoveAcceptance: 0.1,
  contourProbability: 0.75,
  contourOffsetSteps: 1,
} satisfies GeneratorConfig["coverage"];
/** Canonical independent module defaults, matching the default 5.2 exercise. */
export const generatorDefaults: GeneratorConfig = {
  notation: {
    key: "C",
    beats: 4,
    phraseBars: 4,
    voices: "shared-rhythm",
    ties: false,
  },
  hands: {
    active: "right",
    right: { min: 60, max: 67, clef: "treble" },
    left: { min: 48, max: 55, clef: "bass" },
  },
  melody: {
    maxIntervalSteps: 2,
    stepBonus: 4,
    repetitionBonus: 0,
    startRegion: "largest-connected",
    contours: weighted([0, 2, 4, 0], [2, 4, 2, 0]) as {
      value: [number, number, number, number];
      weight: number;
    }[],
    motifs: weighted([0, 1, 2, 1], [0, 2, 1, 0], [2, 1, 0, 1]),
    motifOffset: -1,
    contourPeakWeight: 6,
    contourDistancePenalty: 2,
    minimumNoteWeight: 1,
    harmonicToneBonus: 2,
    finalHarmonicToneBonus: 5,
    preferHarmonicEnding: true,
  },
  rhythm: {
    durations: [
      { value: 480, weight: 2 },
      { value: 960, weight: 1 },
    ],
    breathBars: [2],
    breathBeats: 1,
  },
  harmony: {
    progressions: weighted(
      [1, 4, 5, 1],
      [1, 2, 5, 1],
      [1, 6, 4, 5],
    ) as GeneratorConfig["harmony"]["progressions"],
  },
  fingering: {
    patterns: [{ value: "natural", weight: 1 }],
    variablePositionProbability: 0,
    chromaticFingers: [2, 3, 4],
    allowRestedAlternates: false,
  },
  movement: { kind: "fixed" },
  chromatic: { kind: "diatonic" },
  chords: { kind: "single-notes" },
  coverage: { kind: "disabled" },
  wideLeaps: { kind: "disabled" },
  noteLifetimes: { kind: "disabled" },
};
