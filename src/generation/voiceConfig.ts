import { TPQ, type HandState } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";

type IndependentConfig = NonNullable<
  ValidatedGeneratorConfig["independentVoices"]
>;
export type VoiceProfile = NonNullable<
  IndependentConfig["right"]
>["voices"][number];

export function smallLandingsNeedOverlapCheck(c: ValidatedGeneratorConfig) {
  const policy = c.independentVoices;
  return (
    !!policy &&
    c.movement.kind === "rested-reposition" &&
    c.movement.probability > 0 &&
    (policy.overlapProbability < 1 ||
      policy.maxOverlapTicks < c.notation.beats * TPQ)
  );
}

export function voiceSpecs(c: ValidatedGeneratorConfig) {
  return (["right", "left"] as const).flatMap((hand) =>
    (c.independentVoices?.[hand]?.voices ?? []).map((profile, index) => ({
      hand,
      id: `${hand}:${index === 0 ? "main" : index + 1}`,
      profile,
      durations: profile.durations ?? c.rhythm.durations,
    })),
  );
}

export function voiceEventId(
  seed: string,
  bar: number,
  onset: number,
  voiceId: string,
) {
  return `${seed}-${bar}-${onset}-${voiceId.endsWith(":main") ? voiceId.split(":")[0] : voiceId}`;
}

export function voiceUnit(c: ValidatedGeneratorConfig, id: string) {
  const durations =
    voiceSpecs(c).find((v) => v.id === id)?.durations ?? c.rhythm.durations;
  return Math.min(...durations.map((d) => d.value));
}

export function voiceAllows(
  profile: VoiceProfile,
  midi: number,
  finger: number,
) {
  return (
    midi >= (profile.minMidi ?? 21) &&
    midi <= (profile.maxMidi ?? 108) &&
    profile.fingers.includes(finger)
  );
}

export function positionFitsVoices(
  c: ValidatedGeneratorConfig,
  position: HandState,
) {
  const group = c.independentVoices?.[position.hand];
  if (!group) return true;
  const profiles = group.voices.filter(
    (profile) => profile.entryProbability > 0 && profile.activity > 0,
  );
  const chords = c.chords;
  const choices = profiles.map((profile) => {
    const fingers = position.fingerToMidi.flatMap((midi, index) =>
      voiceAllows(profile, midi, index + 1) ? [1 << index] : [],
    );
    const mask = fingers.reduce((result, finger) => result | finger, 0);
    if (
      group.minPolyphony <= 1 ||
      !profile.chords ||
      chords.kind !== "voicings" ||
      chords.probability === 0
    )
      return fingers;
    const masks = chords.shapes.map(({ value }) =>
      [...value].reduce(
        (result, finger) => result | (1 << (Number(finger) - 1)),
        0,
      ),
    );
    return [...fingers, ...masks.filter((shape) => (shape & mask) === shape)];
  });
  if (choices.some((fingers) => !fingers.length)) return false;
  if (group.minPolyphony <= 1) return true;
  const enough = (mask: number) =>
    mask.toString(2).replaceAll("0", "").length >= group.minPolyphony;
  if (
    c.independentVoices!.overlapProbability === 0 ||
    c.independentVoices!.maxOverlapTicks < TPQ / 2
  )
    return choices.some((fingers) => fingers.some(enough));
  // A lane can supply at most one attack at a time. Use finger masks as an
  // upper bound before sampling harmony, black-key depth and exact overlap.
  let assignments = new Set([0]);
  for (const fingers of choices)
    assignments = new Set([
      ...assignments,
      ...[...assignments].flatMap((used) =>
        fingers
          .filter((finger) => !(used & finger))
          .map((finger) => used | finger),
      ),
    ]);
  return [...assignments].some(enough);
}
