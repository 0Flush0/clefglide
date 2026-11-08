import { describe, it, expect } from "vitest";
import { defaults, type ScoreEvent } from "../score/model";
import { Scorer, metrics } from "./engine";
import type { MidiEvent } from "../midi/adapter";
const note = (id: string, midi = 60, onset = 0): ScoreEvent => ({
  id,
  midi,
  onset,
  kind: "note",
  bar: 0,
  duration: 480,
  hand: "right",
  positionId: "p",
  pitch: "C4",
  finger: 1,
  action: "REPEAT_NOTE",
});
const event = (
  pitch = 60,
  time = 100,
  type: "on" | "off" = "on",
): MidiEvent => ({
  pitch,
  time,
  type,
  source: "simulator",
  velocity: 100,
  channel: 1,
});
describe("pure scoring state machine", () => {
  it("never marks an already credited chord tone missed after a capture reset or pause", () => {
    const e = new Scorer([note("r", 60), { ...note("l", 48), hand: "left" }], {
      ...defaults,
      mode: "timed",
    });
    e.start(0);
    e.input(event(60, 4000));
    e.pause(4050);
    e.start(4100);
    e.tick(4600);
    expect(e.results.filter((r) => r.id === "r").map((r) => r.kind)).toEqual([
      "correct",
    ]);
    expect(e.results.filter((r) => r.id === "l").map((r) => r.kind)).toEqual([
      "miss",
    ]);
  });
  it("requires release between repeated notes and ignores duplicate ons", () => {
    const e = new Scorer([note("a"), note("b", 60, 480)], defaults);
    e.start(1);
    e.input(event());
    e.input(event());
    expect(e.index).toBe(1);
    e.input(event(60, 101, "off"));
    e.input(event(60, 110));
    expect(e.index).toBe(2);
    expect(metrics(e.results, 1000, 180).correct).toBe(2);
  });
  it("records first attempts and no wait-mode timing accuracy", () => {
    const e = new Scorer([note("a")], defaults);
    e.start(1);
    e.input(event(61));
    e.input(event(60, 5000));
    expect(e.results.at(-1)?.first).toBe(false);
    expect(e.results.at(-1)?.errorMs).toBeUndefined();
    expect(metrics(e.results, 5000, 180).accuracy).toBe(0);
  });
  it("same trace has a different meaning in timed mode, with misses and recovery", () => {
    const notes = [note("a"), note("b", 62, 480)];
    const wait = new Scorer(notes, defaults),
      timed = new Scorer(notes, { ...defaults, mode: "timed" });
    wait.start(0);
    timed.start(0);
    wait.input(event(60, 4500));
    timed.input(event(60, 4500));
    expect(wait.results[0].kind).toBe("correct");
    expect(timed.results[0].kind).toBe("miss");
    timed.input(event(62, 5100));
    expect(timed.results.at(-1)).toMatchObject({
      kind: "correct",
      errorMs: 100,
    });
  });
  it("classifies early and late matched onsets separately from pitch", () => {
    const e = new Scorer([note("a"), note("b", 62, 480)], {
      ...defaults,
      mode: "timed",
    });
    e.start(0);
    e.input(event(60, 4250));
    e.input(event(62, 4800));
    expect(e.results.map((r) => r.errorMs)).toEqual([250, -200]);
    expect(metrics(e.results, 1000, 180).timing).toBe(0);
  });
  it("matches unordered simultaneous pitches without counting held keys twice", () => {
    const e = new Scorer(
      [
        note("r", 60),
        { ...note("l", 48), hand: "left" },
        note("next", 62, 480),
      ],
      defaults,
    );
    e.start(1);
    e.input(event(48, 100));
    e.input(event(48, 101));
    expect(e.index).toBe(0);
    e.input(event(60, 150));
    expect(e.index).toBe(2);
    expect(e.results.filter((r) => r.kind === "correct")).toHaveLength(2);
  });
  it("pause excludes idle time and shifts timed expectations", () => {
    const e = new Scorer([note("a")], { ...defaults, mode: "timed" });
    e.start(0);
    e.pause(4500);
    e.start(9500);
    expect(e.expected(e.notes[0])).toBe(9000);
    e.pause(10000);
    expect(e.activeMs(20000)).toBe(1000);
  });
  it("applies calibrated input offset", () => {
    const e = new Scorer([note("a")], {
      ...defaults,
      mode: "timed",
      offset: 100,
    });
    e.start(0);
    e.input(event(60, 4100));
    expect(e.results[0].errorMs).toBe(0);
  });
  it("skip is explicit and does not inflate accuracy", () => {
    const e = new Scorer([note("a")], defaults);
    e.start(0);
    e.skip(100);
    expect(metrics(e.results, 1000, 180)).toMatchObject({
      correct: 0,
      skipped: 1,
      accuracy: 0,
    });
  });
});
