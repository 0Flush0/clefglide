import {
  chordDefaults,
  chromaticDefaults,
  coverageDefaults,
  durationEvaluationDefaults,
  noteLifetimeDefaults,
  resolveGeneratorConfig,
  tieDefaults,
  wideLeapDefaults,
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
