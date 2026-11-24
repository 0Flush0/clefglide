import type { HandState, Notehead, ScoreEvent } from "../score/model";

/** Validate the existing adjacent-finger exception; callers check preparation and holds. */
export function isRestedAlternateAssignment(
  position: HandState,
  note: Pick<Notehead, "midi" | "pitch" | "finger">,
  tag: ScoreEvent["fingering"],
) {
  const expected = position.fingerToMidi.indexOf(note.midi) + 1;
  return (
    tag?.technique === "rested-alternate" &&
    position.pitches.includes(note.pitch) &&
    expected > 0 &&
    tag.expectedFinger === expected &&
    Number.isInteger(note.finger) &&
    Math.abs(note.finger - expected) === 1 &&
    Math.abs(position.fingerToMidi[note.finger - 1] - note.midi) <= 2
  );
}
