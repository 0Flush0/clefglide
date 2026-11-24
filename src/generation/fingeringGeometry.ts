import { TPQ, type Hand, type HandState } from "../score/model";
import { comfortableMap, isBlack, keyCenter } from "./ergonomics";
import type { ValidatedGeneratorConfig } from "./config";
import { diatonicIndex, spacingSignature } from "./positionMaps";

export type DynamicPolicy = NonNullable<
  ValidatedGeneratorConfig["dynamicFingering"]
>;
export type TechniqueRule = DynamicPolicy["techniques"][number];
export type TravelRule = Extract<TechniqueRule, { maxPositionSteps: number }>;
export type AlternateRule = Extract<
  TechniqueRule,
  { technique: "adjacent-reach" | "rested-alternate" }
>;
export type SubstitutionRule = Extract<
  TechniqueRule,
  { technique: "substitution" }
>;
type Contact = { midi: number; finger: number };

export const preparationTicks = (ms: number, bpm: number) =>
  Math.ceil((ms * bpm * TPQ) / 60_000);
const orientation = (hand: Hand) => (hand === "right" ? 1 : -1);
const direction = (travel: number) => (travel > 0 ? "up" : "down");
export const eligiblePair = (rule: TechniqueRule, from: number, to: number) =>
  rule.fingerPairs.some(([a, b]) => a === from && b === to);

/** Fixed contact templates. Milliseconds are conservative modeling floors. */
export function permitsContinuousContact(
  rule: TravelRule,
  from: HandState,
  to: HandState,
  source: Contact & { pitch: string },
  landing: Contact & { pitch: string },
) {
  const travel = landing.midi - source.midi;
  const position =
    diatonicIndex(to.pitches[0]) - diatonicIndex(from.pitches[0]);
  const horizontal = Math.abs(keyCenter(landing.midi) - keyCenter(source.midi));
  if (
    !travel ||
    Math.sign(travel) !== Math.sign(position) ||
    !rule.directions.includes(direction(travel)) ||
    Math.abs(travel) > rule.maxSemitones ||
    Math.abs(position) > rule.maxPositionSteps ||
    !eligiblePair(rule, source.finger, landing.finger) ||
    !from.pitches.includes(source.pitch) ||
    !to.pitches.includes(landing.pitch) ||
    from.fingerToMidi[source.finger - 1] !== source.midi ||
    to.fingerToMidi[landing.finger - 1] !== landing.midi ||
    spacingSignature(from) !== spacingSignature(to) ||
    !comfortableMap(from.fingerToMidi, from.hand) ||
    !comfortableMap(to.fingerToMidi, to.hand)
  )
    return false;
  if (
    [source, landing].some(
      ({ midi, finger }) =>
        isBlack(midi) && (!rule.allowBlackKeys || finger === 1 || finger === 5),
    )
  )
    return false;
  const steps = Math.abs(
    diatonicIndex(source.pitch) - diatonicIndex(landing.pitch),
  );
  const oriented = travel * orientation(from.hand);
  if (rule.technique === "continuous-shift")
    return (
      Math.abs(position) === 1 &&
      steps <= 2 &&
      horizontal <= 2 &&
      (landing.finger - source.finger) * oriented > 0
    );
  // Only the inverse scale crossings. The long finger clears the white-key
  // thumb along the front of the keybed while the other digits are unoccupied.
  return (
    steps === 1 &&
    Math.abs(travel) <= 2 &&
    horizontal <= 1 &&
    Math.abs(position) ===
      (source.finger === 1 ? landing.finger : source.finger) &&
    (rule.technique === "thumb-under" ? oriented > 0 : oriented < 0)
  );
}

export function continuousPreparation(rule: TravelRule, bpm: number) {
  return (
    preparationTicks(Math.max(rule.minimumPreparationMs, 80), bpm) +
    continuousTransfer(rule, bpm)
  );
}

export function continuousTransfer(rule: TravelRule, bpm: number) {
  return preparationTicks(
    Math.max(
      rule.minimumTransitionMs,
      rule.technique === "continuous-shift" ? 90 : 120,
    ),
    bpm,
  );
}

export function permitsAlternateContact(
  rule: AlternateRule,
  position: HandState,
  midi: number,
  expected: number,
  finger: number,
) {
  const home = position.fingerToMidi[finger - 1];
  const travel = midi - home;
  // Free digits float. The alternate finger never reaches to/from a black key.
  return (
    position.fingerToMidi[expected - 1] === midi &&
    eligiblePair(rule, expected, finger) &&
    !!travel &&
    rule.directions.includes(direction(travel)) &&
    Math.abs(travel) <= rule.maxSemitones &&
    !isBlack(home) &&
    !isBlack(midi) &&
    Math.abs(keyCenter(home) - keyCenter(midi)) === 1
  );
}

/** A stationary second tone must clear both contacts during the handoff. */
export function supportsContact(hand: Hand, moving: Contact, anchor: Contact) {
  const keys = keyCenter(moving.midi) - keyCenter(anchor.midi);
  const fingers = moving.finger - anchor.finger;
  const incompatibleDepth =
    [moving, anchor].some(
      (n) => isBlack(n.midi) && (n.finger === 1 || n.finger === 5),
    ) &&
    [moving, anchor].some(
      (n) => !isBlack(n.midi) && n.finger > 1 && n.finger < 5,
    );
  return (
    !incompatibleDepth &&
    keys * fingers * orientation(hand) > 0 &&
    Math.abs(keys) <= Math.abs(fingers) * 1.5 + 0.5
  );
}

export function permitsSubstitutionContact(
  rule: SubstitutionRule,
  position: HandState,
  from: Contact,
  toFinger: number,
  anchor?: Contact,
) {
  const home = position.fingerToMidi[toFinger - 1];
  return (
    eligiblePair(rule, from.finger, toFinger) &&
    position.fingerToMidi[from.finger - 1] === from.midi &&
    !isBlack(from.midi) &&
    !isBlack(home) &&
    Math.abs(keyCenter(home) - keyCenter(from.midi)) === 1 &&
    (!anchor ||
      (rule.heldNotes === "stable-dyad" &&
        !isBlack(anchor.midi) &&
        position.fingerToMidi[anchor.finger - 1] === anchor.midi &&
        supportsContact(position.hand, from, anchor) &&
        supportsContact(
          position.hand,
          { midi: from.midi, finger: toFinger },
          anchor,
        )))
  );
}
