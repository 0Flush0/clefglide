import {
  resolveGeneratorConfig,
  noteLifetimeDefaults,
  type ValidatedGeneratorConfig,
} from "../generation";
import {
  activeHands,
  configForHand,
} from "../generation/config/handParameters";
import type { Hand } from "../score/model";

export type Config = ValidatedGeneratorConfig;
type Modules = NonNullable<NonNullable<Config["handParameters"]>["right"]>;
type ScopedFeature = "dynamicFingering" | "ties" | "articulation";
export type HandModule = Exclude<keyof Modules, ScopedFeature>;
export type Voice = NonNullable<
  NonNullable<Config["independentVoices"]>["right"]
>["voices"][number];
export const handModules = [
  "melody",
  "rhythm",
  "movement",
  "wideLeaps",
  "fingering",
  "chromatic",
  "chords",
  "coverage",
] as const satisfies readonly HandModule[];

type HandScope = Config["hands"]["active"];
type Assignable = Record<string, unknown>;
const isRecord = (value: unknown): value is Assignable =>
  !!value && typeof value === "object" && !Array.isArray(value);
const rowKey = (value: unknown) =>
  isRecord(value) ? (value.technique ?? value.value) : value;

export const handNames = [
  ["left", "Left hand"],
  ["right", "Right hand"],
] as const;
export const practiceHands = [...handNames, ["both", "Both hands"]] as const;

// Linked edits apply the source edit to the destination's effective settings.
// Keep the partner's other selections and update only the changed rows.
function linkedChanges(
  before: unknown,
  after: unknown,
  target: unknown,
): unknown {
  if (before === after) return target;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (!Array.isArray(target)) return target;
    const previous = new Map(
      before.map((item: unknown) => [rowKey(item), item]),
    );
    const next = new Map(after.map((item: unknown) => [rowKey(item), item]));
    const partnerKeys = new Set(target.map(rowKey));
    return [
      ...target.flatMap((item: unknown) => {
        const key = rowKey(item);
        if (!previous.has(key) || previous.get(key) === next.get(key))
          return [item];
        return next.has(key)
          ? [linkedChanges(previous.get(key), next.get(key), item)]
          : [];
      }),
      ...after.filter(
        (item: unknown) =>
          !previous.has(rowKey(item)) && !partnerKeys.has(rowKey(item)),
      ),
    ];
  }
  if (!isRecord(before) || !isRecord(after) || before.kind !== after.kind)
    return after;
  if (!isRecord(target) || target.kind !== after.kind) return target;
  const result = { ...target };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] === after[key]) continue;
    if (!(key in after)) delete result[key];
    else result[key] = linkedChanges(before[key], after[key], target[key]);
  }
  return result;
}

export function editModule<K extends HandModule>(
  config: Config,
  hand: Hand,
  linked: boolean,
  modules: Pick<Config, K>,
  replace = false,
) {
  if (!config.independentVoices) return { ...config, ...modules };
  const targets: Hand[] = linked ? ["left", "right"] : [hand];
  return {
    ...config,
    handParameters: {
      ...config.handParameters,
      ...Object.fromEntries(
        targets.map((target) => [
          target,
          {
            ...config.handParameters?.[target],
            ...(target === hand || replace
              ? modules
              : Object.fromEntries(
                  (Object.keys(modules) as K[]).map((key) => [
                    key,
                    linkedChanges(
                      configForHand(config, hand)[key],
                      modules[key],
                      configForHand(config, target)[key],
                    ),
                  ]),
                )),
          },
        ]),
      ),
    },
  };
}

export function voiceSettings(config: Config, active = config.hands.active) {
  const provisional = { ...config.hands, active };
  const old = config.independentVoices;
  return {
    ...old,
    ...Object.fromEntries(
      activeHands({ hands: provisional }).map((hand) => [
        hand,
        old?.[hand] ?? { voices: [{}] },
      ]),
    ),
  };
}

export function enableIndependentRhythm(config: Config) {
  return {
    ...config,
    notation: { ...config.notation, voices: "independent" },
    independentVoices: voiceSettings(config),
    handParameters: config.handParameters ?? {},
    noteLifetimes:
      config.noteLifetimes.kind === "explicit"
        ? { ...config.noteLifetimes, keyHold: "required" }
        : noteLifetimeDefaults,
  };
}

export function changePracticeHands(config: Config, active: HandScope) {
  return {
    ...config,
    hands: { ...config.hands, active },
    ...(config.independentVoices && {
      independentVoices: voiceSettings(config, active),
      handParameters: config.handParameters ?? {},
    }),
  };
}

export function editFeature(
  config: Config,
  hand: Hand,
  linked: boolean,
  feature: ScopedFeature,
  value: unknown,
) {
  if (!config.independentVoices)
    return feature === "ties"
      ? { ...config, notation: { ...config.notation, ties: value } }
      : { ...config, [feature]: value || undefined };
  const targets: Hand[] = linked ? ["left", "right"] : [hand];
  const readFeature = (target: Hand) => {
    const local = configForHand(config, target);
    if (feature === "ties") return scopedTies(local, target);
    if (feature === "articulation") return scopedArticulation(local, target);
    return local.dynamicFingering;
  };
  return {
    ...config,
    handParameters: {
      ...config.handParameters,
      ...Object.fromEntries(
        targets.map((target) => [
          target,
          {
            ...config.handParameters?.[target],
            [feature]: updatedFeature(target),
          },
        ]),
      ),
    },
  };

  function updatedFeature(target: Hand) {
    const updated =
      target === hand
        ? value
        : linkedChanges(
            readFeature(hand),
            value,
            remapVoices(readFeature(target), hand),
          );
    return feature === "dynamicFingering"
      ? (updated ?? false)
      : remapVoices(updated, target);
  }
}

type VoiceGroup = NonNullable<NonNullable<Config["independentVoices"]>[Hand]>;

export function editVoiceGroup(
  config: Config,
  hand: Hand,
  linked: boolean,
  patch: Partial<VoiceGroup>,
  voiceIndex?: number,
) {
  const policy = config.independentVoices;
  const group = policy?.[hand];
  if (!policy || !group) return config;
  const other = hand === "left" ? "right" : "left";
  const partner = policy[other];
  const edited = { ...group, ...patch };
  const partnerPatch =
    voiceIndex === undefined
      ? patch
      : {
          voices: partner?.voices.map((voice, index) =>
            index === voiceIndex
              ? (linkedChanges(
                  group.voices[index],
                  edited.voices[index],
                  voice,
                ) as Voice)
              : voice,
          ),
        };
  return {
    ...config,
    independentVoices: {
      ...policy,
      [hand]: edited,
      ...(linked &&
        partner && {
          [other]: { ...partner, ...partnerPatch },
        }),
    },
  };
}

function remapVoices(value: unknown, hand: Hand) {
  if (!value || typeof value !== "object") return value ?? false;
  if (!("voices" in value) || !Array.isArray(value.voices)) return value;
  const remap = (voice: string) => `${hand}:${voice.split(":")[1]}`;
  const slurs = "slurs" in value ? value.slurs : undefined;
  return {
    ...value,
    voices: value.voices.map(remap),
    ...(slurs &&
    typeof slurs === "object" &&
    "voices" in slurs &&
    Array.isArray(slurs.voices)
      ? { slurs: { ...slurs, voices: slurs.voices.map(remap) } }
      : {}),
  };
}

export function copyHand(config: Config, from: Hand, to: Hand) {
  const source = configForHand(config, from);
  const policy = config.independentVoices;
  const voice = policy?.[from];
  return {
    ...config,
    handParameters: {
      ...config.handParameters,
      [to]: {
        ...Object.fromEntries(handModules.map((key) => [key, source[key]])),
        dynamicFingering: source.dynamicFingering ?? false,
        ties: remapVoices(scopedTies(source, from), to),
        articulation: remapVoices(scopedArticulation(source, from), to),
      },
    },
    ...(voice && policy?.[to]
      ? { independentVoices: { ...policy, [to]: voice } }
      : {}),
  };
}

export function scopedTies(config: Config, hand: Hand) {
  const ties = config.notation.ties;
  if (ties === false || !config.independentVoices) return ties;
  const voices = ties.voices.filter((voice) => voice.startsWith(`${hand}:`));
  return voices.length ? { ...ties, voices } : false;
}

export function scopedArticulation(
  config: Config,
  hand: Hand,
): Config["articulation"] {
  const policy = config.articulation;
  if (!policy || !config.independentVoices) return policy;
  const voices = policy.voices.filter((voice) => voice.startsWith(`${hand}:`));
  const slurVoices = policy.slurs
    ? (policy.slurs.voices ?? policy.voices).filter((voice) =>
        voice.startsWith(`${hand}:`),
      )
    : [];
  if (!voices.length && !slurVoices.length) return undefined;
  return {
    ...policy,
    voices: voices.length ? voices : slurVoices,
    slurs:
      policy.slurs && slurVoices.length
        ? { ...policy.slurs, voices: slurVoices }
        : false,
  };
}

export const defaultModules = resolveGeneratorConfig();
