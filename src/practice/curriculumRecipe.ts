import {
  chordDefaults,
  chromaticDefaults,
  coverageDefaults,
  durationEvaluationDefaults,
  noteLifetimeDefaults,
  repositionDefaults,
  tieDefaults,
  wideLeapDefaults,
  voiceProfileSchema,
  type GeneratorConfig,
} from "../generation/config";
import { articulationSchema } from "../generation/config/articulation";
import { dynamicRules } from "../generation/examples";
import { TPQ, type Hand } from "../score/model";

export type HandScope = Hand | "both";
type Config = GeneratorConfig;
type Duration = Config["rhythm"]["durations"][number]["value"];
type Shape = Extract<
  Config["chords"],
  { kind: "voicings" }
>["shapes"][number]["value"];
type Tie = Exclude<Config["notation"]["ties"], false>;
type Voice = ReturnType<typeof voiceProfileSchema.parse>;
type Group = NonNullable<NonNullable<Config["independentVoices"]>["left"]>;
export type Technique = keyof typeof dynamicRules;
export type Feature =
  | "third"
  | "fourth"
  | "eighth"
  | "half"
  | "whole"
  | "rest"
  | "shift"
  | "wide"
  | "chromatic"
  | "dyad"
  | "triad"
  | "extension"
  | "tie"
  | "partial"
  | "carry"
  | "longCarry"
  | "async"
  | "voices"
  | "polyphony"
  | "touch"
  | "emphasis"
  | "slur"
  | "portato"
  | "crossSlur"
  | Technique;
export type Edit = (config: Config) => void;
export type Study = readonly [
  id: string,
  title: string,
  description: string,
  bpm: number,
  edits: Edit,
  evidence?: Feature | readonly Feature[],
];
export type Stage = {
  id: string;
  title: string;
  objective: string;
  studies: readonly Study[];
};

export const change =
  (...edits: Edit[]): Edit =>
  (c) =>
    edits.forEach((edit) => edit(c));
const enabled = (c: Config): Hand[] =>
  c.hands.active === "both" ? ["right", "left"] : [c.hands.active];
const handList = (c: Config, hand?: Hand) => (hand ? [hand] : enabled(c));
const weighted = <T>(...items: T[]) =>
  items.map((value) => ({ value, weight: 1 }));
const main = (hand: Hand) => `${hand}:main` as const;

/** In shared rhythm these fields are common. Independent rhythm keeps their values per hand. */
type Module =
  | "melody"
  | "rhythm"
  | "movement"
  | "wideLeaps"
  | "coverage"
  | "chords"
  | "chromatic"
  | "fingering";
function module<K extends Module>(
  c: Config,
  key: K,
  update: (value: Config[K]) => Config[K],
  hand?: Hand,
) {
  if (!c.handParameters) {
    c[key] = update(c[key]);
    return;
  }
  for (const target of handList(c, hand)) {
    const local: Partial<Pick<Config, Module>> = (c.handParameters[target] ??=
      {});
    local[key] = update(local[key] ?? c[key]);
  }
}

export const band =
  (low: number, high: number, hand?: Hand): Edit =>
  (c) => {
    for (const target of handList(c, hand))
      Object.assign(c.hands[target], { min: low, max: high });
  };
export const key =
  (value: Config["notation"]["key"]): Edit =>
  (c) => {
    c.notation.key = value;
  };
export const meter =
  (beats: 3 | 4): Edit =>
  (c) => {
    c.notation.beats = beats;
  };
export const intervals =
  (cap: number, stepBonus = 4, repetitionBonus = 0, hand?: Hand): Edit =>
  (c) =>
    module(
      c,
      "melody",
      (m) => ({ ...m, maxIntervalSteps: cap, stepBonus, repetitionBonus }),
      hand,
    );
export const contour =
  (contours: Config["melody"]["contours"], hand?: Hand): Edit =>
  (c) =>
    module(c, "melody", (m) => ({ ...m, contours }), hand);
export const rhythms = (
  quarter: number,
  half = 0,
  eighth = 0,
  whole = 0,
): Config["rhythm"]["durations"] => {
  const values = [480, 960, 240, 1920] as const;
  return [quarter, half, eighth, whole].flatMap((weight, i) =>
    weight ? [{ value: values[i], weight }] : [],
  );
};
export const rhythm =
  (durations: Config["rhythm"]["durations"], hand?: Hand): Edit =>
  (c) =>
    module(c, "rhythm", (r) => ({ ...r, durations }), hand);
export const breaths =
  (breathBars: number[], breathBeats: 1 | 2 = 1, hand?: Hand): Edit =>
  (c) =>
    module(c, "rhythm", (r) => ({ ...r, breathBars, breathBeats }), hand);
export const harmony =
  (
    ...progressions: Config["harmony"]["progressions"][number]["value"][]
  ): Edit =>
  (c) => {
    c.harmony.progressions = weighted(...progressions);
  };
export const shifts =
  (
    probability: number,
    maxDistanceSteps = 1,
    eligibleBars = [2],
    hand?: Hand,
  ): Edit =>
  (c) =>
    module(
      c,
      "movement",
      () =>
        probability
          ? {
              ...repositionDefaults,
              probability,
              maxDistanceSteps,
              eligibleBars,
            }
          : { kind: "fixed" },
      hand,
    );
export const leaps =
  (
    probability: number,
    distance: [number, number],
    eligibleBars: number[],
    hand?: Hand,
  ): Edit =>
  (c) =>
    module(
      c,
      "wideLeaps",
      () =>
        probability
          ? {
              ...wideLeapDefaults,
              probability,
              minDistanceSteps: distance[0],
              maxDistanceSteps: distance[1],
              eligibleBars,
              distanceWeightExponent: -0.4,
            }
          : { kind: "disabled" },
      hand,
    );
export const explore =
  (regions: number, hand?: Hand): Edit =>
  (c) =>
    module(
      c,
      "coverage",
      () =>
        regions
          ? {
              ...coverageDefaults,
              regions,
              minTargetPhrases: 2,
              targetSpreadPhrases: 3,
              minMoveAcceptance: 0.55,
              contourProbability: 0.65,
            }
          : { kind: "disabled" },
      hand,
    );
export const spacing =
  (
    probability: number,
    patterns: ("thumbGap" | "indexGap" | "twoGaps")[],
    hand?: Hand,
  ): Edit =>
  (c) =>
    module(
      c,
      "fingering",
      (f) => ({
        ...f,
        variablePositionProbability: probability,
        patterns: weighted("natural", ...patterns),
      }),
      hand,
    );
export const accidentals =
  (probability: number, passing = 0, dominant = false, hand?: Hand): Edit =>
  (c) =>
    module(
      c,
      "chromatic",
      () =>
        probability
          ? {
              ...chromaticDefaults,
              probability,
              passingResolutionProbability: passing,
              preferAppliedDominant: dominant,
            }
          : { kind: "diatonic" },
      hand,
    );
export const thirds: Shape[] = ["13", "35"];
export const openDyads: Shape[] = ["13", "14", "15", "24", "25", "35"];
export const triads: Shape[] = ["135", "125", "145", "124", "245"];
export const extensions: Shape[] = ["1235", "1245", "1345"];
export const chords =
  (
    probability: number,
    shapes: Shape[],
    span = 7,
    leading = 3,
    hand?: Hand,
  ): Edit =>
  (c) =>
    module(
      c,
      "chords",
      () =>
        probability
          ? {
              ...chordDefaults,
              probability,
              shapes: shapes.map((value) => ({
                value,
                weight: value.length === 4 ? 4 : 1,
              })),
              maxSpanSemitones: span,
              maxVoiceLeadingSteps: leading,
              majorExtension: shapes.some((s) => s.length === 4)
                ? "sixth"
                : "none",
              minorExtension: shapes.some((s) => s.length === 4)
                ? "seventh"
                : "none",
            }
          : { kind: "single-notes" },
      hand,
    );

export const holds =
  (grade = false): Edit =>
  (c) => {
    c.noteLifetimes = grade
      ? { ...noteLifetimeDefaults, evaluation: durationEvaluationDefaults }
      : noteLifetimeDefaults;
  };
export const independent: Edit = (c) => {
  if (c.independentVoices) return;
  holds()(c);
  c.notation.voices = "independent";
  c.handParameters = {};
  c.independentVoices = {
    overlapProbability: 1,
    maxOverlapTicks: 491520,
    maxAttempts: 48,
  };
  for (const hand of enabled(c))
    c.independentVoices[hand] = {
      voices: [voiceProfileSchema.parse({})],
      minPolyphony: 1,
      maxPolyphony: 5,
    };
};
export const lane =
  (hand: Hand, index: number, values: Partial<Voice>): Edit =>
  (c) => {
    const group = c.independentVoices![hand]!;
    group.voices[index] = voiceProfileSchema.parse({
      ...group.voices[index],
      ...values,
    });
  };
export const voices =
  (
    hand: Hand,
    profiles: Partial<Voice>[],
    caps: Partial<Omit<Group, "voices">> = {},
  ): Edit =>
  (c) => {
    c.independentVoices![hand] = {
      minPolyphony: 1,
      maxPolyphony: 5,
      ...caps,
      voices: profiles.map((p) => voiceProfileSchema.parse(p)),
    };
  };
export const between =
  (probability: number, beats: number): Edit =>
  (c) =>
    Object.assign(c.independentVoices!, {
      overlapProbability: probability,
      maxOverlapTicks: beats * TPQ,
    });

export const ties =
  (
    probability: number,
    patterns: Tie["patterns"][number]["value"][],
    options: Partial<Tie> = {},
    hand?: Hand,
  ): Edit =>
  (c) => {
    const policy = (hands: Hand[]): Tie | false =>
      probability
        ? {
            ...tieDefaults,
            probability,
            crossPhrase: patterns.includes("carry"),
            patterns: weighted(...patterns),
            voices: hands.map(main),
            ...options,
          }
        : false;
    if (!c.handParameters) c.notation.ties = policy(enabled(c));
    else
      for (const target of handList(c, hand))
        (c.handParameters[target] ??= {}).ties = policy([target]);
  };
export const technique =
  (rules: Technique[], hand?: Hand): Edit =>
  (c) => {
    const policy: Config["dynamicFingering"] = rules.length
      ? {
          tempoBpm: 60, // The lesson's default BPM is assigned after composing the recipe.
          fingerWeights: [1, 1, 1, 1, 1],
          techniques: rules.map((rule) => ({
            ...dynamicRules[rule],
            probability: rule === "substitution" ? 0.75 : 0.66,
          })),
          ...(rules.some((rule) => rule !== "substitution") && {
            attacks: { maxConsecutive: 3, maxRepeated: 2, distanceCost: 0.22 },
          }),
        }
      : undefined;
    module(
      c,
      "fingering",
      (f) => ({
        ...f,
        allowRestedAlternates: rules.includes("rested-alternate"),
      }),
      hand,
    );
    if (!c.handParameters) c.dynamicFingering = policy;
    else
      for (const target of handList(c, hand))
        (c.handParameters[target] ??= {}).dynamicFingering = policy ?? false;
  };
type Articulation = NonNullable<Config["articulation"]>;
type Touch = Articulation["touch"][number]["value"];
type Emphasis = Articulation["emphasis"][number]["value"];
export const expression =
  (
    touch: Touch[],
    emphasis: Emphasis[] = [],
    slurs: false | "legato" | "portato" | "mixed" | "across" = false,
    hand?: Hand,
    grade = false,
    probability = 0.55,
    secondary = false,
  ): Edit =>
  (c) => {
    const policy = (hands: Hand[]) => {
      if (!touch.length && !emphasis.length && !slurs) return undefined;
      return articulationSchema.parse({
        kind: "enabled",
        voices: hands.flatMap((target) =>
          secondary ? [main(target), `${target}:2`] : [main(target)],
        ),
        touch: weighted(...touch),
        emphasis: weighted(...emphasis),
        touchProbability: probability,
        emphasisProbability: Math.min(probability, 0.45),
        slurs: slurs && {
          probability,
          lengths: weighted(2, 3, 4),
          styles: weighted(
            ...(slurs === "mixed"
              ? ["legato", "portato"]
              : [slurs === "across" ? "legato" : slurs]),
          ),
          crossMeasure: true,
          crossPhrase: slurs === "across",
        },
        interactions: { ties: "preserve-hold" },
        ...(grade && {
          evaluation: {
            kind: "evaluate",
            timingWeight: touch.some((t) => t !== "natural") || slurs ? 1 : 0,
            velocityWeight: emphasis.length ? 0.5 : 0,
          },
        }),
      });
    };
    if (!c.handParameters) c.articulation = policy(enabled(c));
    else
      for (const target of handList(c, hand))
        (c.handParameters[target] ??= {}).articulation =
          policy([target]) ?? false;
  };

export const pulse = (value: Duration) => weighted(value);
