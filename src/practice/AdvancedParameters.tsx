import { useState } from "react";
import {
  chordDefaults,
  chordShapeSchema,
  chromaticDefaults,
  coverageDefaults,
  noteLifetimeDefaults,
  patternNameSchema,
  repositionDefaults,
  tieDefaults,
  durationEvaluationDefaults,
  wideLeapDefaults,
  voiceProfileSchema,
} from "../generation";
import {
  activeHands,
  configForHand,
  hasTies,
  hasArticulation,
  fingeringPolicies,
} from "../generation/config/handParameters";
import { dynamicRules } from "../generation/examples";
import { articulationSchema } from "../generation/config/articulation";
import { touches, emphases } from "../score/articulationModel";
import { TPQ, type Hand } from "../score/model";
import { useTranslation } from "../shared/i18n";
import {
  Category,
  Chance,
  Choice,
  NumberField,
  Picks,
  SliderField,
  Toggle,
  Weights,
} from "./ParameterFields";
import {
  copyHand,
  defaultModules,
  editFeature,
  editModule,
  editVoiceGroup,
  handNames,
  scopedTies,
  scopedArticulation,
  enableIndependentRhythm,
  type Config,
  type HandModule,
  type Voice,
} from "./advancedConfiguration";

const items = <T extends string | number>(values: readonly T[]) =>
  values.map((value) => [value, String(value)] as const);
const durations = [
  [240, "Eighth note"],
  [480, "Quarter note"],
  [960, "Half note"],
  [1920, "Whole note"],
] as const;
const bars = [
  [0, "Bar 1"],
  [1, "Bar 2"],
  [2, "Bar 3"],
  [3, "Bar 4"],
] as const;
const moves = [
  [1, "Before bar 2"],
  [2, "Before bar 3"],
  [3, "Before bar 4"],
] as const;
const fingers = items([1, 2, 3, 4, 5]);
const chordShapes = chordShapeSchema.options.map(
  (shape) =>
    [shape, `${shape.length} notes (${Array.from(shape).join("–")})`] as const,
);
const techniques = Object.keys(dynamicRules) as (keyof typeof dynamicRules)[];

const simpleIntervals = [
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Octave",
] as const;
const semitoneIntervals = [
  [3, "Minor third"],
  [4, "Major third"],
  [5, "Perfect fourth"],
  [7, "Perfect fifth"],
  [8, "Minor sixth"],
  [9, "Major sixth"],
] as const;
const chordSpans = [
  ...semitoneIntervals.slice(0, 3),
  [6, "Tritone"] as const,
  ...semitoneIntervals.slice(3),
];
const positionNames = {
  natural: "Five consecutive notes",
  thumbGap: "Gap between thumb and index",
  indexGap: "Gap between index and middle",
  twoGaps: "Two gaps below the middle finger",
} as const;
const techniqueNames = {
  "thumb-under": "Thumb under",
  "finger-over": "Finger over",
  "continuous-shift": "Connected shift",
  "adjacent-reach": "Reach to an adjacent key",
  "rested-alternate": "Alternate finger after a rest",
  substitution: "Finger substitution",
} as const;
const touchNames = {
  natural: "Natural touch",
  legato: "Legato",
  "non-legato": "Non-legato",
  staccato: "Staccato",
  staccatissimo: "Staccatissimo",
  tenuto: "Tenuto",
} as const;
const emphasisNames = { accent: "Accent", marcato: "Marcato" } as const;

function intervalOptions(
  min: number,
  max: number,
  tr: ReturnType<typeof useTranslation>,
) {
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => {
    const steps = min + index;
    if (steps <= 7) return [steps, simpleIntervals[steps - 1]] as const;
    const octaves = Math.floor(steps / 7);
    const base = octaves === 1 ? tr("Octave") : tr(`${octaves} octaves`);
    const remainder = steps % 7;
    return [
      steps,
      remainder ? `${base} + ${tr(simpleIntervals[remainder - 1])}` : base,
    ] as const;
  });
}

export function AdvancedParameters({
  config,
  bpm,
  onUse,
}: {
  config: Config;
  bpm: number;
  onUse: (candidate: unknown) => boolean;
}) {
  const tr = useTranslation();
  const [editHand, setEditHand] = useState<Hand>("right");
  const [linked, setLinked] = useState(false);
  const [voiceIndex, setVoiceIndex] = useState(0);
  const [confirm, setConfirm] = useState<"copy" | "shared">();
  const independent = config.independentVoices;
  const { active } = config.hands;
  const hand = active === "both" ? editHand : active;
  const linkEdits = active === "both" && linked;
  const local = configForHand(config, hand);
  const use = (change: Partial<Config>) => onUse({ ...config, ...change });
  const set = <K extends HandModule>(key: K, value: Config[K]) =>
    onUse(
      editModule(config, hand, linkEdits, {
        [key]: value,
      } as Pick<Config, K>),
    );
  const reset = <K extends HandModule>(key: K) =>
    onUse(
      editModule(
        config,
        hand,
        linkEdits,
        { [key]: defaultModules[key] } as Pick<Config, K>,
        true,
      ),
    );
  const {
    melody,
    rhythm,
    movement,
    wideLeaps,
    fingering,
    chromatic,
    chords,
    coverage,
  } = local;
  const { notation, noteLifetimes } = config;
  const articulation = scopedArticulation(local, hand);
  const dynamicFingering = local.dynamicFingering;
  const writeFingering = (policy: Config["dynamicFingering"]) =>
    onUse(editFeature(config, hand, linkEdits, "dynamicFingering", policy));
  const writeTies = (policy: Config["notation"]["ties"]) =>
    onUse(editFeature(config, hand, linkEdits, "ties", policy));
  const ties = scopedTies(local, hand);
  const group = independent?.[hand];
  const currentVoice =
    group?.voices[Math.min(voiceIndex, group.voices.length - 1)];
  const voiceIds = (independent ? [hand] : activeHands(config))
    .flatMap((hand) =>
      (independent?.[hand]?.voices ?? [null]).map(
        (_, i) => `${hand}:${i === 0 ? "main" : i + 1}` as const,
      ),
    )
    .filter(
      (
        id,
      ): id is NonNullable<
        Exclude<Config["notation"]["ties"], false>
      >["voices"][number] => /:(main|[2-5])$/.test(id),
    );
  const voiceChoices = (ids: typeof voiceIds) =>
    ids.map((id) => {
      const [side, lane] = id.split(":");
      const voice =
        lane === "main" ? tr("Main voice") : `${tr("Voice")} ${lane}`;
      return [
        id,
        independent
          ? voice
          : `${tr(side === "left" ? "Left hand" : "Right hand")} · ${voice}`,
      ] as const;
    });
  const soundingVoiceIds = voiceIds.filter((_, index) => {
    const voice = group?.voices[index];
    return !voice || (voice.activity > 0 && voice.entryProbability > 0);
  });
  const hold =
    noteLifetimes.kind === "explicit" && noteLifetimes.keyHold === "required";
  const updateGroup = (patch: Partial<NonNullable<typeof group>>) =>
    onUse(editVoiceGroup(config, hand, linkEdits, patch));
  const updateVoice = (patch: Partial<Voice>) => {
    if (!group || !currentVoice) return;
    onUse(
      editVoiceGroup(
        config,
        hand,
        linkEdits,
        {
          voices: group.voices.map((voice) =>
            voice === currentVoice ? { ...voice, ...patch } : voice,
          ),
        },
        group.voices.indexOf(currentVoice),
      ),
    );
  };
  const chooseTechnique = (enabled: (keyof typeof dynamicRules)[]) => {
    if (!enabled.length) return writeFingering(undefined);
    const existing = dynamicFingering?.techniques ?? [];
    writeFingering({
      tempoBpm: bpm,
      fingerWeights: dynamicFingering?.fingerWeights ?? [1, 1, 1, 1, 1],
      techniques: enabled.map(
        (id) =>
          existing.find((rule) => rule.technique === id) ?? dynamicRules[id],
      ),
      ...(enabled.some((id) => id !== "substitution")
        ? {
            attacks: dynamicFingering?.attacks ?? {
              maxConsecutive: 2,
              maxRepeated: 1,
              distanceCost: 0.2,
            },
          }
        : {}),
    } as Config["dynamicFingering"]);
  };
  const writeArticulation = (value: unknown) =>
    onUse(editFeature(config, hand, linkEdits, "articulation", value));
  const requiresHold =
    independent ||
    hasArticulation(config) ||
    hasTies(config) ||
    fingeringPolicies(config).some((policy) =>
      policy.techniques.some((rule) => rule.technique === "substitution"),
    );
  const smallShiftActive =
    movement.kind === "rested-reposition" && movement.probability > 0;
  const leapActive =
    wideLeaps.kind === "lifted-wide" && wideLeaps.probability > 0;
  const keepSmallShifts = coverage.kind === "guided" && !leapActive;
  const keepWideLeaps = coverage.kind === "guided" && !smallShiftActive;
  const usesRestedAlternate = dynamicFingering?.techniques.some(
    ({ technique }) => technique === "rested-alternate",
  );
  const attackOnly = noteLifetimes.kind === "explicit" && !hold;
  const tiesHaveChords = chords.kind === "voicings";
  const chordSize =
    chords.kind === "voicings"
      ? Math.max(...chords.shapes.map(({ value }) => value.length))
      : 1;
  const articulationEvaluation =
    articulation?.evaluation.kind === "evaluate"
      ? articulation.evaluation
      : undefined;
  const hasDetachedTouch = articulation?.touch.some(
    ({ value, probability }) => value !== "natural" && probability > 0,
  );
  const canEvaluateArticulation = !!(
    hasDetachedTouch ||
    articulation?.slurs ||
    articulation?.emphasis.length
  );
  return (
    <div className="parameter-editor">
      <div className="parameter-categories shared-parameters">
        <Category
          title="Shared music and coordination"
          help="Key and meter apply to the whole score. Independent rhythm gives each hand its own timeline and settings."
        >
          <div className="control-grid">
            <Choice
              label="Key"
              value={notation.key}
              items={(["C", "G", "F", "D"] as const).map((key) => [
                key,
                `${tr(key)} ${tr("major")}`,
              ])}
              onChange={(key) => use({ notation: { ...notation, key } })}
            />
            <Choice
              label="Meter"
              value={notation.beats}
              items={[
                [4, "4/4"],
                [3, "3/4"],
              ]}
              onChange={(beats) => use({ notation: { ...notation, beats } })}
            />
          </div>
          <Toggle
            label="Independent rhythm"
            checked={!!independent}
            onChange={(enabled) => {
              if (enabled) onUse(enableIndependentRhythm(config));
              else setConfirm("shared");
            }}
          />
          {independent ? (
            <>
              {confirm === "shared" && (
                <div className="parameter-confirmation">
                  <p className="settings-help">
                    {tr(
                      "Shared rhythm uses the original common settings. Switching removes the separate hand and voice settings from this draft.",
                    )}
                  </p>
                  <div className="profile-actions">
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          onUse({
                            ...config,
                            notation: { ...notation, voices: "shared-rhythm" },
                            independentVoices: undefined,
                            handParameters: undefined,
                          })
                        ) {
                          setConfirm(undefined);
                          setLinked(false);
                        }
                      }}
                    >
                      {tr("Switch to shared rhythm")}
                    </button>
                    <button type="button" onClick={() => setConfirm(undefined)}>
                      {tr("Cancel")}
                    </button>
                  </div>
                </div>
              )}
              <Chance
                label="Shared overlap chance"
                value={independent.overlapProbability}
                onChange={(overlapProbability) =>
                  use({
                    independentVoices: { ...independent, overlapProbability },
                  })
                }
              />
              <NumberField
                label="Shared overlap limit (beats)"
                value={independent.maxOverlapTicks / TPQ}
                min={0}
                max={1024}
                step="any"
                onChange={(beats) =>
                  use({
                    independentVoices: {
                      ...independent,
                      maxOverlapTicks: Math.round(beats * TPQ),
                    },
                  })
                }
              />
              <p className="settings-help">
                {tr(
                  "A hand inherits these overlap limits until you set its own under Voices and polyphony.",
                )}
              </p>
            </>
          ) : (
            !hold && (
              <p className="settings-help">
                {tr("Independent rhythm also enables required key holds.")}
              </p>
            )
          )}
          <button
            className="parameter-reset"
            type="button"
            onClick={() =>
              use({
                notation: {
                  ...notation,
                  key: defaultModules.notation.key,
                  beats: defaultModules.notation.beats,
                },
                ...(independent && {
                  independentVoices: {
                    ...independent,
                    overlapProbability: 1,
                    maxOverlapTicks: 491520,
                    maxAttempts: 24,
                  },
                }),
              })
            }
          >
            {tr("Reset coordination")}
          </button>
        </Category>
        <Category
          title="Note holds and duration"
          help="Release scoring and key-hold rules apply to the whole score. Ties and finger substitution require physical key holds."
        >
          <Toggle
            label="Required physical key holds"
            checked={hold}
            disabled={!!requiresHold}
            onChange={(enabled) =>
              use({
                noteLifetimes: enabled
                  ? noteLifetimeDefaults
                  : { kind: "disabled" },
              })
            }
          />
          {!!requiresHold && (
            <p className="settings-help">
              {tr(
                "An active technique or independent rhythm requires physical key holds.",
              )}
            </p>
          )}
          {noteLifetimes.kind === "explicit" && (
            <Toggle
              label="Assess performed duration"
              checked={noteLifetimes.evaluation.kind === "evaluate"}
              onChange={(enabled) =>
                use({
                  noteLifetimes: {
                    ...noteLifetimes,
                    evaluation: enabled
                      ? {
                          ...durationEvaluationDefaults,
                          ...(attackOnly && { pedalTreatment: "sounding" }),
                        }
                      : { kind: "disabled" },
                  },
                })
              }
            />
          )}
        </Category>
      </div>
      {active === "both" && independent && (
        <div className="hand-parameters">
          <Choice
            label="Edit hand"
            value={hand}
            items={handNames}
            onChange={(hand) => {
              setEditHand(hand);
              setVoiceIndex(0);
              setConfirm(undefined);
            }}
          />
          <Toggle
            label="Link hand edits"
            checked={linked}
            onChange={setLinked}
          />
          <button
            type="button"
            onClick={() => setConfirm(confirm === "copy" ? undefined : "copy")}
          >
            {tr(
              hand === "left"
                ? "Copy left parameters to right"
                : "Copy right parameters to left",
            )}
          </button>
          <p className="settings-help">
            {tr(
              "The controls below show the selected hand. Linked edits update each compatible setting in both hands.",
            )}
          </p>
          {confirm === "copy" && (
            <div className="parameter-confirmation">
              <p className="settings-help">
                {tr(
                  hand === "left"
                    ? "Replace the right-hand music and voice settings with the left hand’s? The right-hand range and clef stay in place."
                    : "Replace the left-hand music and voice settings with the right hand’s? The left-hand range and clef stay in place.",
                )}
              </p>
              <div className="profile-actions">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      onUse(
                        copyHand(
                          config,
                          hand,
                          hand === "left" ? "right" : "left",
                        ),
                      )
                    )
                      setConfirm(undefined);
                  }}
                >
                  {tr("Confirm copy")}
                </button>
                <button type="button" onClick={() => setConfirm(undefined)}>
                  {tr("Cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {!(active === "both" && independent) && (
        <h3 className="parameter-scope">
          {tr(
            active === "both"
              ? "Music for both hands"
              : active === "left"
                ? "Left-hand music"
                : "Right-hand music",
          )}
        </h3>
      )}
      <div className="hand-categories">
        <Category
          title="Melody"
          help="Limit the distance between melody notes. Preference weights favor steps and repeated notes."
          onReset={() => reset("melody")}
        >
          <Choice
            label="Largest melodic interval"
            value={melody.maxIntervalSteps}
            items={intervalOptions(1, 7, tr)}
            onChange={(maxIntervalSteps) =>
              set("melody", { ...melody, maxIntervalSteps })
            }
          />
          <SliderField
            label="Stepwise motion weight"
            value={melody.stepBonus}
            min={0}
            max={1000}
            curved
            onChange={(stepBonus) => set("melody", { ...melody, stepBonus })}
          />
          <SliderField
            label="Repeated-note weight"
            value={melody.repetitionBonus}
            min={0}
            max={1000}
            curved
            onChange={(repetitionBonus) =>
              set("melody", { ...melody, repetitionBonus })
            }
          />
          <Toggle
            label="End on a chord tone when possible"
            checked={melody.preferHarmonicEnding}
            onChange={(preferHarmonicEnding) =>
              set("melody", { ...melody, preferHarmonicEnding })
            }
          />
        </Category>
        <Category
          title="Rhythm and rests"
          help="Choose the note values that can fill a bar. A voice can use its own rhythm."
          onReset={() => reset("rhythm")}
        >
          <Weights
            label="Note values"
            items={durations}
            values={rhythm.durations}
            onChange={(durations) => set("rhythm", { ...rhythm, durations })}
          />
          <Picks
            label="Breath rests after"
            minimum={0}
            items={bars}
            values={rhythm.breathBars}
            onChange={(breathBars) => set("rhythm", { ...rhythm, breathBars })}
          />
          {!!rhythm.breathBars.length && (
            <Choice
              label="Rest length"
              value={rhythm.breathBeats}
              items={[
                [1, "One beat"],
                [2, "Two beats"],
              ]}
              onChange={(breathBeats) =>
                set("rhythm", { ...rhythm, breathBeats })
              }
            />
          )}
        </Category>
        <Category
          title="Hand movement and register"
          help="A lifted move needs a legal landing and reserved silence. Register exploration favors underused areas within the chosen range."
          onReset={() =>
            onUse(
              editModule(
                config,
                hand,
                linkEdits,
                {
                  coverage: defaultModules.coverage,
                  movement: defaultModules.movement,
                  wideLeaps: defaultModules.wideLeaps,
                },
                true,
              ),
            )
          }
        >
          <Toggle
            label="Small repositioning"
            checked={movement.kind === "rested-reposition"}
            disabled={keepSmallShifts}
            onChange={(enabled) =>
              set("movement", enabled ? repositionDefaults : { kind: "fixed" })
            }
          />
          {movement.kind === "rested-reposition" && (
            <>
              <Chance
                label="Small shift chance"
                min={keepSmallShifts ? 1 : 0}
                value={movement.probability}
                onChange={(probability) =>
                  set("movement", { ...movement, probability })
                }
              />
              <Choice
                label="Largest small shift"
                items={intervalOptions(1, 4, tr)}
                value={movement.maxDistanceSteps}
                onChange={(maxDistanceSteps) =>
                  set("movement", { ...movement, maxDistanceSteps })
                }
              />
              <Picks
                label="Small shift landings"
                items={moves}
                values={movement.eligibleBars}
                onChange={(eligibleBars) =>
                  set("movement", { ...movement, eligibleBars })
                }
              />
              <Choice
                label="Small shift preparation"
                value={movement.preparationBeats}
                items={[
                  [1, "One beat"],
                  [2, "Two beats"],
                ]}
                onChange={(preparationBeats) =>
                  set("movement", { ...movement, preparationBeats })
                }
              />
            </>
          )}
          <Toggle
            label="Wide leaps"
            checked={wideLeaps.kind === "lifted-wide"}
            disabled={keepWideLeaps}
            onChange={(enabled) =>
              set(
                "wideLeaps",
                enabled ? wideLeapDefaults : { kind: "disabled" },
              )
            }
          />
          {wideLeaps.kind === "lifted-wide" && (
            <>
              <Chance
                label="Wide leap chance"
                min={keepWideLeaps ? 1 : 0}
                value={wideLeaps.probability}
                onChange={(probability) =>
                  set("wideLeaps", { ...wideLeaps, probability })
                }
              />
              <Choice
                label="Shortest hand leap"
                items={intervalOptions(5, wideLeaps.maxDistanceSteps, tr)}
                value={wideLeaps.minDistanceSteps}
                onChange={(minDistanceSteps) =>
                  set("wideLeaps", { ...wideLeaps, minDistanceSteps })
                }
              />
              <Choice
                label="Longest hand leap"
                items={intervalOptions(wideLeaps.minDistanceSteps, 51, tr)}
                value={wideLeaps.maxDistanceSteps}
                onChange={(maxDistanceSteps) =>
                  set("wideLeaps", { ...wideLeaps, maxDistanceSteps })
                }
              />
              <Choice
                label="Largest interval into the landing note"
                items={intervalOptions(1, 51, tr)}
                value={wideLeaps.maxLandingIntervalSteps}
                onChange={(maxLandingIntervalSteps) =>
                  set("wideLeaps", { ...wideLeaps, maxLandingIntervalSteps })
                }
              />
              <NumberField
                label="Leap preparation (beats)"
                min={1}
                max={15}
                value={wideLeaps.preparationBeats}
                onChange={(preparationBeats) =>
                  set("wideLeaps", { ...wideLeaps, preparationBeats })
                }
              />
              <Choice
                label="Leap direction"
                value={wideLeaps.targetSelection}
                items={[
                  ["anywhere", "Either direction"],
                  ["higher", "Higher"],
                  ["lower", "Lower"],
                  ["range-edges", "Range edges"],
                ]}
                onChange={(targetSelection) =>
                  set("wideLeaps", { ...wideLeaps, targetSelection })
                }
              />
              <Picks
                label="Wide leap landings"
                items={[[0, "Before bar 1"], ...moves]}
                values={wideLeaps.eligibleBars}
                onChange={(eligibleBars) =>
                  set("wideLeaps", { ...wideLeaps, eligibleBars })
                }
              />
              <Picks
                label="Landing fingers"
                items={fingers}
                values={wideLeaps.landingFingers}
                onChange={(landingFingers) =>
                  set("wideLeaps", { ...wideLeaps, landingFingers })
                }
              />
            </>
          )}
          <Toggle
            label="Explore underused registers"
            checked={coverage.kind === "guided"}
            disabled={!smallShiftActive && !leapActive}
            onChange={(enabled) =>
              set("coverage", enabled ? coverageDefaults : { kind: "disabled" })
            }
          />
          <p className="settings-help">
            {tr(
              "Register exploration needs a positive chance of moving. Turn it off before disabling the last movement.",
            )}
          </p>
        </Category>
        <Category
          title="Finger spacing"
          help="Only modeled maps that fit the hand’s range are eligible. Position probability is sampled at the start."
          onReset={() => reset("fingering")}
        >
          <Weights
            label="Allowed position shapes"
            items={patternNameSchema.options.map((value) => [
              value,
              positionNames[value],
            ])}
            required={["natural"]}
            values={fingering.patterns}
            onChange={(patterns) =>
              set("fingering", {
                ...fingering,
                patterns,
                variablePositionProbability:
                  patterns.length > 1
                    ? fingering.variablePositionProbability
                    : 0,
              })
            }
          />
          {fingering.patterns.length > 1 && (
            <Chance
              label="Variable spacing chance"
              value={fingering.variablePositionProbability}
              onChange={(variablePositionProbability) =>
                set("fingering", { ...fingering, variablePositionProbability })
              }
            />
          )}
          <Toggle
            label="Allow a different finger after a rest"
            checked={fingering.allowRestedAlternates}
            disabled={usesRestedAlternate}
            onChange={(allowRestedAlternates) =>
              set("fingering", { ...fingering, allowRestedAlternates })
            }
          />
        </Category>
        <Category
          title="Fingering techniques"
          help="Only explicitly enabled techniques can occur. Eligibility depends on the tempo, preparation, held notes and fingering rules."
          onReset={() => writeFingering(undefined)}
        >
          <Picks
            label="Allowed techniques"
            items={techniques.map((technique) => [
              technique,
              techniqueNames[technique],
            ])}
            values={
              dynamicFingering?.techniques.map((rule) => rule.technique) ?? []
            }
            minimum={0}
            disabledItems={techniques.filter((technique) => {
              if (technique === "substitution") return !hold;
              if (technique === "rested-alternate")
                return !fingering.allowRestedAlternates;
              return attackOnly;
            })}
            onChange={chooseTechnique}
          />
          {dynamicFingering?.techniques.map((rule) => (
            <Chance
              key={rule.technique}
              min={1}
              label={tr(`${tr(techniqueNames[rule.technique])} chance`)}
              value={rule.probability}
              onChange={(probability) =>
                writeFingering({
                  ...dynamicFingering,
                  techniques: dynamicFingering.techniques.map((item) =>
                    item === rule ? { ...item, probability } : item,
                  ),
                })
              }
            />
          ))}
          <p className="settings-help">
            {tr(
              "Finger substitution needs physical key holds. Enable alternates after a rest under Finger spacing.",
            )}
          </p>
        </Category>
        <Category
          title="Accidentals"
          help="Chromatic notes must fit the available fingers and resolve to a legal adjacent pitch."
          onReset={() => reset("chromatic")}
        >
          <Toggle
            label="Chromatic neighbor and passing notes"
            checked={chromatic.kind === "neighbors"}
            onChange={(enabled) =>
              set(
                "chromatic",
                enabled ? chromaticDefaults : { kind: "diatonic" },
              )
            }
          />
          {chromatic.kind === "neighbors" && (
            <>
              <Chance
                label="Chromatic note chance"
                value={chromatic.probability}
                onChange={(probability) =>
                  set("chromatic", { ...chromatic, probability })
                }
              />
              <Chance
                label="Continue to the next scale note"
                value={chromatic.passingResolutionProbability}
                onChange={(passingResolutionProbability) =>
                  set("chromatic", {
                    ...chromatic,
                    passingResolutionProbability,
                  })
                }
              />
              <Picks
                label="Chromatic fingers"
                items={items([2, 3, 4] as const)}
                values={fingering.chromaticFingers}
                onChange={(chromaticFingers) =>
                  set("fingering", { ...fingering, chromaticFingers })
                }
              />
              <Toggle
                label="Favor returning to the original note"
                checked={chromatic.preferAnchorResolution}
                onChange={(preferAnchorResolution) =>
                  set("chromatic", { ...chromatic, preferAnchorResolution })
                }
              />
              <Toggle
                label="Favor applied dominant tones"
                checked={chromatic.preferAppliedDominant}
                onChange={(preferAppliedDominant) =>
                  set("chromatic", { ...chromatic, preferAppliedDominant })
                }
              />
              <Toggle
                label="Favor mapped fingers"
                checked={chromatic.preferMappedFinger}
                onChange={(preferMappedFinger) =>
                  set("chromatic", { ...chromatic, preferMappedFinger })
                }
              />
            </>
          )}
        </Category>
        <Category
          title="Chords and voicing"
          help="Voicings list the fingers used. Chord size, span, extensions and available pitches limit which shapes can sound."
          onReset={() => reset("chords")}
        >
          <Toggle
            label="Chord voicings"
            checked={chords.kind === "voicings"}
            onChange={(enabled) =>
              set("chords", enabled ? chordDefaults : { kind: "single-notes" })
            }
          />
          {chords.kind === "voicings" && (
            <>
              <Chance
                label="Chord chance"
                value={chords.probability}
                onChange={(probability) =>
                  set("chords", { ...chords, probability })
                }
              />
              <Choice
                label="Largest chord span"
                items={chordSpans.filter(
                  ([span]) =>
                    span >= (chordSize >= 4 ? 8 : chordSize >= 3 ? 7 : 3) &&
                    (!chords.shapes.some(({ value }) => value.length === 2) ||
                      chords.dyadIntervals.some(
                        (interval) => interval <= span,
                      )),
                )}
                value={chords.maxSpanSemitones}
                onChange={(maxSpanSemitones) =>
                  set("chords", { ...chords, maxSpanSemitones })
                }
              />
              <Choice
                label="Largest voice-leading interval"
                items={intervalOptions(1, 7, tr)}
                value={chords.maxVoiceLeadingSteps}
                onChange={(maxVoiceLeadingSteps) =>
                  set("chords", { ...chords, maxVoiceLeadingSteps })
                }
              />
              <Choice
                label="Major chord extension"
                value={chords.majorExtension}
                items={(
                  [
                    ["none", "None"],
                    ["sixth", "Sixth"],
                  ] as const
                ).filter(
                  ([extension]) =>
                    extension !== "none" ||
                    chordSize < 4 ||
                    chords.minorExtension !== "none",
                )}
                onChange={(majorExtension) =>
                  set("chords", { ...chords, majorExtension })
                }
              />
              <Choice
                label="Minor chord extension"
                value={chords.minorExtension}
                items={(
                  [
                    ["none", "None"],
                    ["seventh", "Seventh"],
                  ] as const
                ).filter(
                  ([extension]) =>
                    extension !== "none" ||
                    chordSize < 4 ||
                    chords.majorExtension !== "none",
                )}
                onChange={(minorExtension) =>
                  set("chords", { ...chords, minorExtension })
                }
              />
              <Weights
                label="Chord fingerings"
                items={chordShapes}
                values={chords.shapes}
                unavailable={chordShapeSchema.options.filter((shape) => {
                  if (shape.length === 4)
                    return (
                      chords.maxSpanSemitones < 8 ||
                      (chords.majorExtension === "none" &&
                        chords.minorExtension === "none")
                    );
                  if (shape.length === 3) return chords.maxSpanSemitones < 7;
                  return !chords.dyadIntervals.some(
                    (interval) => interval <= chords.maxSpanSemitones,
                  );
                })}
                onChange={(shapes) => set("chords", { ...chords, shapes })}
              />
              <Picks
                label="Two-note intervals"
                items={semitoneIntervals}
                values={chords.dyadIntervals}
                disabledItems={
                  chords.shapes.some(({ value }) => value.length === 2)
                    ? chords.dyadIntervals.filter(
                        (interval) =>
                          interval <= chords.maxSpanSemitones &&
                          chords.dyadIntervals.filter(
                            (value) => value <= chords.maxSpanSemitones,
                          ).length === 1,
                      )
                    : []
                }
                onChange={(dyadIntervals) =>
                  set("chords", { ...chords, dyadIntervals })
                }
              />
              <p className="settings-help">
                {tr(
                  "Triads need at least a fifth of span. Four-note chords need a sixth of span and a chord extension.",
                )}
              </p>
            </>
          )}
        </Category>
        {independent && (
          <Category
            title="Voices and polyphony"
            help="Each independent voice has its own schedule and can have its own rhythm and eligible fingers."
            onReset={
              group
                ? () =>
                    updateGroup({
                      voices: [voiceProfileSchema.parse({})],
                      minPolyphony: 1,
                      maxPolyphony: 5,
                      withinHandOverlapProbability: undefined,
                      maxWithinHandOverlapTicks: undefined,
                    })
                : undefined
            }
          >
            {!group ? (
              <p className="settings-help">
                {tr(
                  "Enable independent rhythm under Shared music and coordination.",
                )}
              </p>
            ) : (
              <>
                <Choice
                  label="Voice count"
                  items={items([1, 2, 3, 4, 5])}
                  value={group.voices.length}
                  onChange={(count) => {
                    const first = group.voices[0];
                    onUse(
                      editVoiceGroup(config, hand, false, {
                        voices: Array.from(
                          { length: count },
                          (_, i) =>
                            group.voices[i] ?? {
                              ...first,
                              activity: 0.35,
                              chords: false,
                            },
                        ),
                      }),
                    );
                  }}
                />
                {linkEdits && (
                  <p className="settings-help">
                    {tr("Voice count applies to the selected hand.")}
                  </p>
                )}
                <NumberField
                  label="Minimum peak simultaneous keys"
                  min={0}
                  max={group.maxPolyphony}
                  value={group.minPolyphony}
                  onChange={(minPolyphony) => updateGroup({ minPolyphony })}
                />
                <NumberField
                  label="Maximum simultaneous keys"
                  min={Math.max(1, group.minPolyphony)}
                  max={5}
                  value={group.maxPolyphony}
                  onChange={(maxPolyphony) => updateGroup({ maxPolyphony })}
                />
                {group.voices.length > 1 && independent && (
                  <>
                    <Chance
                      label="Within-hand overlap chance"
                      value={
                        group.withinHandOverlapProbability ??
                        independent.overlapProbability
                      }
                      onChange={(withinHandOverlapProbability) =>
                        updateGroup({ withinHandOverlapProbability })
                      }
                    />
                    <NumberField
                      label="Maximum within-hand overlap (beats)"
                      min={0}
                      max={1024}
                      step="any"
                      value={
                        (group.maxWithinHandOverlapTicks ??
                          independent.maxOverlapTicks) / TPQ
                      }
                      onChange={(beats) =>
                        updateGroup({
                          maxWithinHandOverlapTicks: Math.round(beats * TPQ),
                        })
                      }
                    />
                  </>
                )}
                {currentVoice && (
                  <>
                    <Choice
                      label="Edit voice"
                      value={Math.min(voiceIndex, group.voices.length - 1)}
                      items={group.voices.map(
                        (_, i) =>
                          [
                            i,
                            i === 0 ? "Main voice" : `${tr("Voice")} ${i + 1}`,
                          ] as const,
                      )}
                      onChange={setVoiceIndex}
                    />
                    <Chance
                      label="Voice activity"
                      value={currentVoice.activity}
                      onChange={(activity) => updateVoice({ activity })}
                    />
                    <Chance
                      label="Voice entry chance"
                      value={currentVoice.entryProbability}
                      onChange={(entryProbability) =>
                        updateVoice({ entryProbability })
                      }
                    />
                    <Chance
                      label="Voice exit chance"
                      value={currentVoice.exitProbability}
                      onChange={(exitProbability) =>
                        updateVoice({ exitProbability })
                      }
                    />
                    <NumberField
                      label="Offbeat preference"
                      min={0.000001}
                      max={1000}
                      step="any"
                      value={currentVoice.offbeatWeight}
                      onChange={(offbeatWeight) =>
                        updateVoice({ offbeatWeight })
                      }
                    />
                    <NumberField
                      label="Weight for starting with another voice"
                      min={0.000001}
                      max={1000}
                      step="any"
                      value={currentVoice.coincidentAttackWeight}
                      onChange={(coincidentAttackWeight) =>
                        updateVoice({ coincidentAttackWeight })
                      }
                    />
                    <Picks
                      label="Allowed voice fingers"
                      items={fingers}
                      values={currentVoice.fingers}
                      onChange={(fingers) => updateVoice({ fingers })}
                    />
                    <Choice
                      label="Largest interval in this voice"
                      value={currentVoice.maxIntervalSteps ?? 0}
                      items={[
                        [0, "Use melody limit"],
                        ...intervalOptions(1, melody.maxIntervalSteps, tr),
                      ]}
                      onChange={(interval) =>
                        updateVoice({ maxIntervalSteps: interval || undefined })
                      }
                    />
                    <Toggle
                      label="Use a separate voice rhythm"
                      checked={!!currentVoice.durations}
                      onChange={(enabled) =>
                        updateVoice({
                          durations: enabled ? rhythm.durations : undefined,
                        })
                      }
                    />
                    {currentVoice.durations && (
                      <Weights
                        label="Voice note values"
                        items={durations}
                        values={currentVoice.durations}
                        onChange={(durations) => updateVoice({ durations })}
                      />
                    )}
                    {chords.kind === "voicings" && (
                      <Toggle
                        label="Allow chords in this voice"
                        checked={currentVoice.chords}
                        onChange={(chords) => updateVoice({ chords })}
                      />
                    )}
                    {chromatic.kind === "neighbors" && (
                      <Toggle
                        label="Allow accidentals in this voice"
                        checked={currentVoice.chromatic}
                        onChange={(chromatic) => updateVoice({ chromatic })}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </Category>
        )}
        <Category
          title="Ties"
          help="Ties hold a note across written note values without a second attack."
          onReset={ties !== false ? () => writeTies(false) : undefined}
        >
          <Toggle
            label="Write ties"
            checked={ties !== false}
            disabled={!hold}
            onChange={(enabled) =>
              writeTies(
                enabled
                  ? {
                      ...tieDefaults,
                      voices: voiceIds.filter((id) => id.endsWith(":main")),
                    }
                  : false,
              )
            }
          />
          {!hold && (
            <p className="settings-help">
              {tr("Enable required key holds under Note holds and duration.")}
            </p>
          )}
          {ties !== false && (
            <>
              <Chance
                label="Tie chance"
                value={ties.probability}
                onChange={(probability) => writeTies({ ...ties, probability })}
              />
              <Picks
                label="Tied voices"
                items={voiceChoices(voiceIds)}
                values={ties.voices}
                onChange={(voices) => writeTies({ ...ties, voices })}
              />
              <NumberField
                label="Maximum tie duration (beats)"
                min={1}
                max={1024}
                step="any"
                value={ties.maxDurationTicks / TPQ}
                onChange={(beats) =>
                  writeTies({
                    ...ties,
                    maxDurationTicks: Math.round(beats * TPQ),
                  })
                }
              />
              {tiesHaveChords && (
                <Choice
                  label="Tied chord tones"
                  value={ties.chordTones}
                  items={[
                    ["none", "Single notes only"],
                    ["all", "All tones"],
                    ["outer", "Outer tones"],
                    ["any", "Any tone"],
                  ]}
                  onChange={(chordTones) => writeTies({ ...ties, chordTones })}
                />
              )}
            </>
          )}
        </Category>
        <Category
          title="Articulation"
          help="Markings apply to selected voices. Timed release and relative MIDI velocity can be assessed when their markings are present."
          onReset={() => writeArticulation(undefined)}
        >
          <Toggle
            label="Articulation markings"
            checked={!!articulation}
            disabled={!hold || !soundingVoiceIds.length}
            onChange={(enabled) =>
              writeArticulation(
                enabled
                  ? {
                      kind: "enabled",
                      voices: soundingVoiceIds,
                      touch: [{ value: "staccato" }],
                      touchProbability: 0.25,
                    }
                  : undefined,
              )
            }
          />
          {!hold && (
            <p className="settings-help">
              {tr("Enable required key holds under Note holds and duration.")}
            </p>
          )}
          {hold && !soundingVoiceIds.length && (
            <p className="settings-help">
              {tr("Enable a sounding voice under Voices and polyphony.")}
            </p>
          )}
          {articulation && (
            <>
              <Picks
                label="Articulated voices"
                items={voiceChoices(soundingVoiceIds)}
                values={articulation.voices}
                onChange={(voices) =>
                  writeArticulation({ ...articulation, voices })
                }
              />
              <Picks
                label="Touch types"
                items={touches.map((value) => [value, touchNames[value]])}
                minimum={
                  !articulation.slurs && !articulation.emphasis.length ? 1 : 0
                }
                disabledItems={
                  articulationEvaluation?.timingWeight &&
                  !articulation.slurs &&
                  articulation.touch.filter(
                    ({ value, probability }) =>
                      value !== "natural" && probability > 0,
                  ).length === 1
                    ? articulation.touch
                        .filter(
                          ({ value, probability }) =>
                            value !== "natural" && probability > 0,
                        )
                        .map(({ value }) => value)
                    : []
                }
                values={articulation.touch.map(({ value }) => value)}
                onChange={(values) =>
                  writeArticulation({
                    ...articulation,
                    touch: values.map(
                      (value) =>
                        articulation.touch.find(
                          (rule) => rule.value === value,
                        ) ?? { value },
                    ),
                  })
                }
              />
              {!!articulation.touch.length && (
                <Chance
                  label="Touch marking chance"
                  min={1}
                  value={articulation.touchProbability}
                  onChange={(touchProbability) =>
                    writeArticulation({ ...articulation, touchProbability })
                  }
                />
              )}
              <Picks
                label="Emphasis types"
                items={emphases.map((value) => [value, emphasisNames[value]])}
                minimum={
                  articulationEvaluation?.velocityWeight ||
                  (!articulation.slurs && !articulation.touch.length)
                    ? 1
                    : 0
                }
                values={articulation.emphasis.map(({ value }) => value)}
                onChange={(values) =>
                  writeArticulation({
                    ...articulation,
                    emphasis: values.map(
                      (value) =>
                        articulation.emphasis.find(
                          (rule) => rule.value === value,
                        ) ?? { value },
                    ),
                  })
                }
              />
              {!!articulation.emphasis.length && (
                <Chance
                  label="Emphasis marking chance"
                  min={1}
                  value={articulation.emphasisProbability}
                  onChange={(emphasisProbability) =>
                    writeArticulation({ ...articulation, emphasisProbability })
                  }
                />
              )}
              <Toggle
                label="Slur groups"
                checked={!!articulation.slurs}
                disabled={
                  !!articulation.slurs &&
                  ((!articulation.touch.length &&
                    !articulation.emphasis.length) ||
                    (!!articulationEvaluation?.timingWeight &&
                      !hasDetachedTouch))
                }
                onChange={(enabled) =>
                  writeArticulation({
                    ...articulation,
                    slurs: enabled ? {} : false,
                  })
                }
              />
              {articulation.slurs && (
                <Chance
                  label="Slur chance"
                  min={1}
                  value={articulation.slurs.probability}
                  onChange={(probability) =>
                    writeArticulation({
                      ...articulation,
                      slurs: { ...articulation.slurs, probability },
                    })
                  }
                />
              )}
              <Toggle
                label="Assess articulation performance"
                checked={articulation.evaluation.kind === "evaluate"}
                disabled={!canEvaluateArticulation}
                onChange={(enabled) => {
                  const parsed = articulationSchema.parse(articulation);
                  const timingWeight =
                    parsed.slurs ||
                    parsed.touch.some(({ value }) => value !== "natural")
                      ? 1
                      : 0;
                  writeArticulation({
                    ...articulation,
                    evaluation: enabled
                      ? {
                          kind: "evaluate",
                          timingWeight,
                          velocityWeight: parsed.emphasis.length ? 1 : 0,
                        }
                      : { kind: "disabled" },
                  });
                }}
              />
            </>
          )}
        </Category>
      </div>
    </div>
  );
}
