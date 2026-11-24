import { expect, it } from "vitest";
import { Note } from "tonal";
import { defaults, noteheads, type Hand, type Settings } from "../score/model";
import { writtenPitch } from "../score/pitch";
import { inferFingeringHints } from "../score/hints";
import { generate } from "./planner";
import { playableTransition } from "./ergonomics";
import { validatePhrase } from "./legacyFixtures";

// Complete four-bar fixtures retain exact ticks and use real independently checked maps.
function phrase(
  hand: Hand,
  line: [string, number][],
  key: Settings["key"] = "C",
) {
  const s: Settings = {
    ...defaults,
    hand,
    key,
    rhythm: "quarters",
    accidentals: "hard",
    min: key === "D" ? 62 : 60,
    max: key === "D" ? 69 : 67,
    leftMin: key === "D" ? 62 : 60,
    leftMax: key === "D" ? 69 : 67,
  };
  const p = generate(s, "transition-fixture");
  let previous: number | undefined;
  for (const e of p.events) {
    const [pitch, finger] =
      line[Math.min(e.bar * 4 + e.onset / 480, line.length - 1)];
    const midi = Note.midi(pitch)!;
    Object.assign(e, {
      pitch,
      midi,
      finger,
      action: previous === midi ? "REPEAT_NOTE" : "PLAY_WITHIN_POSITION",
    });
    e.notes = [
      {
        id: e.id,
        pitch,
        midi,
        finger,
        hand,
        written: writtenPitch(pitch, key),
      },
    ];
    previous = midi;
  }
  const last = p.events.at(-1)!;
  Object.assign(p.final.hands[0], {
    lastPitch: last.pitch,
    lastIndex: hand === "right" ? last.finger - 1 : 5 - last.finger,
    lastVoicing: [last.midi],
    lastFingering: [{ midi: last.midi, finger: last.finger }],
    resolutionPitch: undefined,
  });
  return p;
}
it.each(["right", "left"] as const)(
  "allows repeated keys and both directions off a black key for %s",
  (hand) => {
    const finger = hand === "right" ? 2 : 3;
    const upper = hand === "right" ? "D4" : "E4";
    for (const pitch of hand === "right" ? ["Db4", "C#4"] : ["Eb4", "D#4"])
      expect(
        validatePhrase(
          phrase(hand, [
            [pitch, finger],
            [upper, finger],
          ]),
        ),
      ).toEqual([]);
    for (const pitch of hand === "right" ? ["D#4", "Eb4"] : ["F#4", "Gb4"])
      expect(
        validatePhrase(
          phrase(hand, [
            [pitch, 2],
            [hand === "right" ? "D4" : "F4", 2],
          ]),
        ),
      ).toEqual([]);
    const repeated = hand === "right" ? ["Db4", "C#4"] : ["Eb4", "D#4"];
    expect(
      validatePhrase(
        phrase(hand, [
          [repeated[0], finger],
          [repeated[1], finger],
          [upper, finger],
        ]),
      ),
    ).toEqual([]);
    const repeatFinger = hand === "right" ? 2 : 4;
    expect(
      validatePhrase(
        phrase(hand, [
          ["D4", repeatFinger],
          ["D4", repeatFinger],
        ]),
      ),
    ).toEqual([]);
    expect(
      playableTransition([{ midi: 61, finger }], [{ midi: 61, finger }]),
    ).toBe(true);
  },
);
it.each(["right", "left"] as const)(
  "rejects reverse slides, other key changes and white enharmonic accidentals for %s",
  (hand) => {
    const finger = hand === "right" ? 2 : 4;
    for (const [from, to] of [
      ["D4", "Db4"],
      ["D4", "C#4"],
      ["D4", "D#4"],
      ["Eb4", "Db4"],
      ["D4", "E4"],
    ]) {
      const p = phrase(hand, [
        [from, finger],
        [to, finger],
        ["D4", finger],
      ]);
      expect(validatePhrase(p)).toContain(
        "Invalid same-finger key transition.",
      );
    }
    // E# is a physical white key, so E#/3 -> F#/3 is not a black-to-white slide.
    const p = phrase(
      hand,
      [
        ["E#4", 3],
        ["F#4", 3],
      ],
      "D",
    );
    expect(validatePhrase(p)).toContain("Invalid same-finger key transition.");
  },
);
it.each(["right", "left"] as const)(
  "reassigns chromatic options within a valid map and explains the finger in Smart hints for %s",
  (hand) => {
    const finger = hand === "right" ? 2 : 4;
    const alternate = 3;
    const p = phrase(hand, [
      ["D4", finger],
      ["D#4", alternate],
      ["E4", alternate],
    ]);
    expect(validatePhrase(p)).toEqual([]);
    const hints = inferFingeringHints(p.events, p.positions, [], "smart").hints;
    expect(hints[1]).toMatchObject({
      plannedFinger: alternate,
      nonObvious: true,
      show: true,
    });
  },
);
it("checks actual previous chord fingers across chunks and independently rejects corruption", () => {
  for (let seed = 0; seed < 35; seed++) {
    const s: Settings = {
      ...defaults,
      hand: "both",
      accidentals: "hard",
      chords: "hard",
      fingerSpacing: "hard",
      noteJumps: "large",
      interval: 7,
      max: 81,
      leftMin: 36,
      leftMax: 57,
    };
    const first = generate(s, `transition-${seed}`),
      next = generate(s, `transition-${seed}`, first.final);
    expect(first).toEqual(generate(s, `transition-${seed}`));
    for (const p of [first, next]) {
      expect(validatePhrase(p)).toEqual([]);
      for (const h of p.initial.hands) {
        let previous = h.lastFingering ?? [];
        for (const e of p.events.filter(
          (e) => e.hand === h.hand && e.kind === "note",
        )) {
          expect(playableTransition(previous, noteheads(e))).toBe(true);
          previous = noteheads(e);
        }
      }
    }
    const broken = structuredClone(next);
    const e = broken.events.find((e) => e.kind === "note")!;
    broken.initial.hands.find((h) => h.hand === e.hand)!.lastFingering = [
      { midi: e.midi - 12, finger: e.finger },
    ];
    expect(validatePhrase(broken)).toContain(
      "Invalid same-finger key transition.",
    );
  }
});
