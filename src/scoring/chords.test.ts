import { expect, it } from "vitest";
import { defaults, type ScoreEvent } from "../score/model";
import type { MidiEvent } from "../midi/adapter";
import { Scorer, metrics } from "./engine";
const chord = (
  id = "chord",
  midis = [60, 64, 67],
  onset = 0,
  hand: "right" | "left" = "right",
): ScoreEvent => ({
  id,
  midi: midis[0],
  pitch: "C4",
  finger: 1,
  hand,
  positionId: "p",
  kind: "note",
  bar: 0,
  onset,
  duration: 480,
  action: "PLAY_WITHIN_POSITION",
  notes: midis.map((midi, i) => ({
    id: i ? `${id}:${i}` : id,
    midi,
    pitch: "C4",
    finger: i + 1,
    hand,
  })),
});
const input = (
  pitch: number,
  time: number,
  type: MidiEvent["type"] = "on",
  velocity = type === "on" ? 90 : 0,
): MidiEvent => ({
  pitch,
  time,
  type,
  velocity,
  source: "simulator",
  channel: 1,
});
it.each(["wait", "timed"] as const)(
  "accepts unordered small onset differences in %s, retaining note and event accuracy",
  (mode) => {
    const e = new Scorer([chord()], { ...defaults, mode, offset: 25 });
    e.start(0);
    const start = mode === "timed" ? 4025 : 100;
    e.input(input(67, start));
    expect(e.index).toBe(0);
    expect(e.missingPitches).toEqual([60, 64]);
    e.input(input(60, start + 20));
    expect(e.index).toBe(0);
    e.input(input(64, start + 70));
    expect(e.index).toBe(1);
    expect(metrics(e.results, 1000, 180)).toMatchObject({
      correct: 3,
      chordEvents: 1,
      chordCorrect: 1,
      chordAccuracy: 100,
      accuracy: 100,
    });
    expect(e.results.map((r) => r.errorMs)).toEqual(
      mode === "timed" ? [0, 20, 70] : [undefined, undefined, undefined],
    );
  },
);
it("never rewards slow arpeggiation, but permits a fresh complete retry", () => {
  const e = new Scorer([chord()], defaults);
  e.start(0);
  e.input(input(60, 100));
  e.input(input(64, 240));
  e.input(input(67, 380));
  expect(e.index).toBe(0);
  expect(metrics(e.results, 1000, 180).chordCorrect).toBe(0);
  [60, 64, 67].forEach((p) => e.input(input(p, 400, "off")));
  [60, 64, 67].forEach((p, i) => e.input(input(p, 500 + i * 20)));
  expect(e.index).toBe(1);
  expect(metrics(e.results, 1000, 180)).toMatchObject({
    correct: 3,
    chordCorrect: 0,
    accuracy: 0,
  });
  expect(new Set(e.results.map((r) => r.id)).size).toBe(e.results.length);
});
it("configures the onset window internally and accepts its exact boundary", () => {
  const narrow = new Scorer([chord("a", [60, 64])], defaults, 40);
  narrow.start(0);
  narrow.input(input(60, 100));
  narrow.input(input(64, 141));
  expect(narrow.index).toBe(0);
  const boundary = new Scorer([chord("b", [60, 64])], defaults, 40);
  boundary.start(0);
  boundary.input(input(60, 100));
  boundary.input(input(64, 140));
  expect(boundary.index).toBe(1);
});
it("records missing noteheads exactly once and keeps partial pitch credit separate from chord success", () => {
  const e = new Scorer([chord()], { ...defaults, mode: "timed" });
  e.start(0);
  e.input(input(60, 4000));
  e.tick(4501);
  e.tick(4600);
  expect(e.results.map((r) => [r.pitch, r.kind])).toEqual([
    [60, "correct"],
    [64, "miss"],
    [67, "miss"],
  ]);
  expect(metrics(e.results, 1000, 180)).toMatchObject({
    correct: 1,
    missed: 2,
    chordCorrect: 0,
  });
});
it("identifies extra pitches during a chord without advancing prematurely", () => {
  const e = new Scorer([chord()], defaults);
  e.start(0);
  e.input(input(60, 100));
  e.input(input(61, 110));
  e.input(input(64, 120));
  expect(e.index).toBe(0);
  e.input(input(67, 140));
  expect(e.index).toBe(1);
  expect(e.results.find((r) => r.pitch === 61)?.kind).toBe("extra");
  expect(metrics(e.results, 1000, 180)).toMatchObject({
    wrong: 1,
    extra: 1,
    chordCorrect: 0,
  });
});
it("attributes a surplus attack just after chord completion to that chord, even at the end of the score", () => {
  const e = new Scorer([chord()], defaults);
  e.start(0);
  [60, 64, 67].forEach((p, i) => e.input(input(p, 100 + i * 15)));
  expect(e.index).toBe(1);
  expect(metrics(e.results, 1000, 180).chordCorrect).toBe(1);
  e.input(input(70, 150));
  expect(e.results.at(-1)).toMatchObject({
    kind: "extra",
    eventId: "chord",
    pitch: 70,
  });
  expect(metrics(e.results, 1000, 180)).toMatchObject({
    correct: 3,
    chordCorrect: 0,
    extra: 1,
  });
});
it("requires new attacks for repeated chords and doesn't reuse held common tones", () => {
  const e = new Scorer([chord("a"), chord("b", [60, 64, 67], 480)], defaults);
  e.start(0);
  [60, 64, 67].forEach((p, i) => e.input(input(p, 100 + i * 20)));
  [60, 64, 67].forEach((p, i) => e.input(input(p, 200 + i * 20)));
  expect(e.index).toBe(1);
  expect(e.results).toHaveLength(3);
  [60, 64, 67].forEach((p) => e.input(input(p, 250, "off")));
  [60, 64, 67].forEach((p, i) => e.input(input(p, 300 + i * 20)));
  expect(e.index).toBe(2);
  expect(metrics(e.results, 1000, 180).chordCorrect).toBe(2);
});
it("sustain preserves sounding notes but never supplies missing attacks; released keys can repeat with pedal down", () => {
  const e = new Scorer(
    [chord("a", [60, 64]), chord("b", [60, 64], 480)],
    defaults,
  );
  e.start(0);
  e.input(input(64, 10, "sustain", 127));
  e.input(input(60, 100));
  e.input(input(60, 110, "off"));
  expect(e.held.has(60)).toBe(false);
  expect(e.sounding.has(60)).toBe(true);
  e.input(input(64, 140));
  expect(e.index).toBe(1);
  e.input(input(64, 150, "off"));
  expect(e.index).toBe(1);
  e.input(input(60, 200));
  expect(e.index).toBe(1);
  e.input(input(64, 220));
  expect(e.index).toBe(2);
  e.input(input(60, 230, "off"));
  e.input(input(64, 230, "off"));
  e.input(input(64, 240, "sustain", 0));
  expect(e.sounding.size).toBe(0);
  expect(metrics(e.results, 1000, 180).chordCorrect).toBe(2);
});
it("matches both-hand chords once per notehead without treating the other hand as extra", () => {
  const e = new Scorer(
    [chord("r", [60, 64, 67]), chord("l", [48, 55], 0, "left")],
    defaults,
  );
  e.start(0);
  [55, 60, 67, 48, 64].forEach((p, i) => e.input(input(p, 100 + i * 15)));
  expect(e.index).toBe(2);
  expect(e.results).toHaveLength(5);
  expect(metrics(e.results, 1000, 180)).toMatchObject({
    correct: 5,
    wrong: 0,
    chordEvents: 2,
    chordCorrect: 2,
  });
});
it("pause and skip preserve partial credit without duplicating missing or completed noteheads", () => {
  const e = new Scorer([chord()], defaults);
  e.start(1);
  e.input(input(60, 100));
  e.pause(120);
  e.start(300);
  e.skip(310);
  expect(e.results.map((r) => r.kind)).toEqual(["correct", "skip", "skip"]);
  expect(metrics(e.results, 1000, 180).chordCorrect).toBe(0);
});
it("grades pitch independently of all planned finger assignments", () => {
  const a = chord(),
    b = structuredClone(a);
  b.notes!.forEach((n) => (n.finger = 5));
  const left = new Scorer([a], defaults),
    right = new Scorer([b], defaults);
  for (const e of [left, right]) {
    e.start(0);
    [60, 64, 67].forEach((p, i) => e.input(input(p, 100 + i * 20)));
  }
  expect(left.results).toEqual(right.results);
});
