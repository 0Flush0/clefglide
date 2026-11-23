import type { HandState } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";

type IndependentConfig = NonNullable<
  ValidatedGeneratorConfig["independentVoices"]
>;
export type VoiceProfile = NonNullable<
  IndependentConfig["right"]
>["voices"][number];

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
    (profile) => profile.entryProbability > 0,
  );
  const choices = profiles.map((profile) =>
    position.fingerToMidi.flatMap((midi, index) =>
      voiceAllows(profile, midi, index + 1) ? [1 << index] : [],
    ),
  );
  if (choices.some((fingers) => !fingers.length)) return false;
  const canPlayChords =
    c.chords.kind === "voicings" &&
    c.chords.probability > 0 &&
    profiles.some((profile) => profile.chords);
  if (canPlayChords) return true;
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
  return [...assignments].some(
    (used) => used.toString(2).replaceAll("0", "").length >= group.minPolyphony,
  );
}
