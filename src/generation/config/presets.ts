import { settingsValuesSchema, type Settings } from "../../score/model";
import { jumpLevels, spacingLevels } from "../difficulty";
import {
  generatorDefaults,
  repositionDefaults,
  chromaticDefaults,
  chordDefaults,
  coverageDefaults,
} from "./defaults";
import { resolveGeneratorConfig, GeneratorConfigurationError } from "./resolve";
import type { GeneratorConfig, GeneratorOverrides } from "./schema";

/** Historical 5.2 replay caps, preserved for seed identity. */
export const movementRules = {
  off: { distance: 0, eligible: [] },
  easy: { distance: 2, eligible: [2] },
  medium: { distance: 3, eligible: [1, 3] },
  hard: { distance: 4, eligible: [1, 2, 3] },
} as const;
const spacingPatterns = {
  off: ["natural"],
  easy: ["natural", "thumbGap"],
  medium: ["natural", "thumbGap", "indexGap"],
  hard: ["natural", "thumbGap", "indexGap", "twoGaps"],
} as const;
export const chordShapes = {
  easy: ["13", "14", "15", "24", "25", "35"],
  medium: [
    "13",
    "14",
    "15",
    "24",
    "25",
    "35",
    "135",
    "125",
    "145",
    "124",
    "245",
  ],
  hard: [
    "13",
    "14",
    "15",
    "24",
    "25",
    "35",
    "135",
    "125",
    "145",
    "124",
    "245",
    "1235",
    "1245",
    "1345",
  ],
} as const;
const chromaticPresets = {
  off: { kind: "diatonic" },
  easy: { ...chromaticDefaults },
  medium: {
    ...chromaticDefaults,
    probability: 0.28,
    passingResolutionProbability: 0.4,
  },
  hard: {
    ...chromaticDefaults,
    probability: 0.45,
    passingResolutionProbability: 0.65,
    preferAppliedDominant: true,
  },
} satisfies Record<Settings["accidentals"], GeneratorConfig["chromatic"]>;
export const legacyRhythms = {
  gentle: generatorDefaults.rhythm,
  quarters: {
    durations: [{ value: 480, weight: 1 }],
    breathBars: [],
    breathBeats: 1,
  },
  mixed: {
    durations: ([240, 480, 960, 1920] as const).map((value) => ({
      value,
      weight: 1,
    })),
    breathBars: [2],
    breathBeats: 1,
  },
} satisfies Record<Settings["rhythm"], GeneratorConfig["rhythm"]>;

/** Only position-relevant values: range previews must tolerate unrelated invalid drafts. */
export function resolvePositionParameters(s: Settings) {
  return {
    hands: {
      active: s.hand,
      right: { min: s.min, max: s.max, clef: s.rhClef },
      left: { min: s.leftMin, max: s.leftMax, clef: s.lhClef },
    },
    notation: { ...generatorDefaults.notation, key: s.key, beats: s.beats },
    fingering: {
      ...generatorDefaults.fingering,
      patterns: spacingPatterns[s.fingerSpacing].map((value) => ({
        value,
        weight: 1,
      })),
      variablePositionProbability: spacingLevels[s.fingerSpacing].frequency,
      allowRestedAlternates:
        s.handMovements === "medium" || s.handMovements === "hard",
    },
    chromatic: chromaticPresets[s.accidentals],
  };
}
/** One-way adapter from persisted UI settings to explicit parameters. No PRNG calls. */
export function resolveSettings(
  s: Settings,
  overrides: GeneratorOverrides = {},
) {
  // Validate before mapping inactive branches, so e.g. a negative frequency
  // cannot disappear into a fixed-hand configuration.
  const checked = settingsValuesSchema.safeParse(s);
  if (!checked.success)
    throw new GeneratorConfigurationError(
      checked.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(" "),
    );
  const rule = movementRules[s.handMovements];
  if (s.handMovements === "off" && (s.shiftFrequency !== 0 || s.maxShift !== 0))
    throw new Error(
      "Hand movements Off requires zero shift frequency and distance. Choose Easy or above to enable repositioning.",
    );
  if (s.maxShift > rule.distance)
    throw new Error(
      `This level allows repositioning by at most ${rule.distance} scale steps. Reduce maximum repositioning distance or choose a higher level.`,
    );
  if (s.interval > jumpLevels[s.noteJumps].interval)
    throw new Error(
      "Maximum melodic interval exceeds Note jumps. Reduce it in Advanced settings or choose a higher Note jumps level.",
    );
  const movement: GeneratorConfig["movement"] =
    s.handMovements !== "off" && s.shiftFrequency > 0 && s.maxShift > 0
      ? {
          ...repositionDefaults,
          probability: s.shiftFrequency,
          maxDistanceSteps: s.maxShift,
          eligibleBars: [...rule.eligible],
        }
      : { kind: "fixed" };
  const chords: GeneratorConfig["chords"] =
    s.chords === "off"
      ? { kind: "single-notes" }
      : {
          ...chordDefaults,
          probability: { easy: 0.22, medium: 0.45, hard: 0.7 }[s.chords],
          shapes: chordShapes[s.chords].map((value) => ({ value, weight: 1 })),
          maxSpanSemitones: s.chords === "easy" ? 7 : 9,
          maxVoiceLeadingSteps: s.interval,
          majorExtension: s.chords === "hard" ? "sixth" : "none",
          minorExtension: s.chords === "hard" ? "seventh" : "none",
        };
  return resolveGeneratorConfig(overrides, {
    ...generatorDefaults,
    ...resolvePositionParameters(s),
    melody: {
      ...generatorDefaults.melody,
      maxIntervalSteps: s.interval,
      stepBonus: jumpLevels[s.noteJumps].stepWeight,
    },
    rhythm: legacyRhythms[s.rhythm],
    movement,
    chords,
    coverage:
      movement.kind === "fixed" ? { kind: "disabled" } : coverageDefaults,
  });
}
/** Opaque compatibility identity: retained byte-for-byte in existing 5.2 stream states. */
export function legacyCoverageContext(s: Settings) {
  return JSON.stringify([
    s.hand,
    s.key,
    s.min,
    s.max,
    s.leftMin,
    s.leftMax,
    s.handMovements,
    s.shiftFrequency,
    s.maxShift,
    s.noteJumps,
    s.interval,
    s.fingerSpacing,
    s.accidentals,
    s.chords,
    s.rhythm,
    s.beats,
  ]);
}
