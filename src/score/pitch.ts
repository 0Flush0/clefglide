import { Note, Scale } from "tonal";
import type { Settings, WrittenPitch } from "./model";

export function writtenPitch(
  pitch: string,
  key: Settings["key"],
): WrittenPitch {
  const n = Note.get(pitch);
  if (n.empty || n.oct === undefined || !["", "#", "b"].includes(n.acc))
    throw new Error(`Unsupported written pitch: ${pitch}`);
  return {
    letter: n.letter,
    octave: n.oct,
    accidental: n.acc as WrittenPitch["accidental"],
    key,
  };
}

/** Preserve the written letter: E4 -> Eb4, F#4 -> F4 (a written natural). */
export function alterPitch(
  pitch: string,
  semitones: -1 | 1,
): string | undefined {
  const n = Note.get(pitch),
    alt = n.alt + semitones;
  if (n.oct === undefined || Math.abs(alt) > 1) return;
  return `${n.letter}${alt === 1 ? "#" : alt === -1 ? "b" : ""}${n.oct}`;
}

/** Explicit measure-state projection, also useful for testing engraving rules.
 * State is per written letter AND octave. A tied continuation suppresses a sign
 * but does not establish accidental state for subsequent untied attacks. */
export class AccidentalState {
  private active = new Map<string, string>();
  private signature: Map<string, string>;
  constructor(key: Settings["key"]) {
    this.signature = new Map(
      Scale.get(`${key} major`).notes.map((p) => {
        const n = Note.get(p);
        return [n.letter, n.acc];
      }),
    );
  }
  barline() {
    this.active.clear();
  }
  attack(pitch: string, tied = false): "#" | "b" | "n" | undefined {
    if (tied) return;
    const n = Note.get(pitch),
      id = `${n.letter}${n.oct}`;
    const previous = this.active.get(id) ?? this.signature.get(n.letter) ?? "";
    this.active.set(id, n.acc);
    return previous === n.acc
      ? undefined
      : n.acc === ""
        ? "n"
        : (n.acc as "#" | "b");
  }
}
