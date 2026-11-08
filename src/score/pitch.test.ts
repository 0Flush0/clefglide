import { expect, it } from "vitest";
import { Note } from "tonal";
import { AccidentalState, writtenPitch, alterPitch } from "./pitch";
it("preserves enharmonic meaning independently of MIDI, including C4=60", () => {
  expect(Note.midi("C4")).toBe(60);
  expect(Note.midi("D#4")).toBe(Note.midi("Eb4"));
  expect(writtenPitch("D#4", "C")).toEqual({
    letter: "D",
    accidental: "#",
    octave: 4,
    key: "C",
  });
  expect(writtenPitch("Eb4", "F")).toEqual({
    letter: "E",
    accidental: "b",
    octave: 4,
    key: "F",
  });
  expect(alterPitch("F#4", -1)).toBe("F4");
  expect(alterPitch("Bb4", 1)).toBe("B4");
});
it("tracks sharps, flats, cancellation, octaves, key signatures, barlines and tied continuations", () => {
  const c = new AccidentalState("C");
  expect(
    ["F#4", "F#4", "F4", "F4", "Eb4", "Eb4", "E4"].map((p) => c.attack(p)),
  ).toEqual(["#", undefined, "n", undefined, "b", undefined, "n"]);
  expect(c.attack("F#5")).toBe("#");
  c.barline();
  expect(c.attack("F#5", true)).toBeUndefined();
  expect(c.attack("F#5")).toBe("#");
  const g = new AccidentalState("G");
  expect(["F#4", "F4", "F4", "F#4"].map((p) => g.attack(p))).toEqual([
    undefined,
    "n",
    undefined,
    "#",
  ]);
  g.barline();
  expect(g.attack("F#4")).toBeUndefined();
  const f = new AccidentalState("F");
  expect(["Bb4", "B4", "Bb4"].map((p) => f.attack(p))).toEqual([
    undefined,
    "n",
    "b",
  ]);
});
