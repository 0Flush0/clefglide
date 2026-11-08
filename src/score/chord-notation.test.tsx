import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createCanvas } from "@napi-rs/canvas";
import { Notation } from "./Notation";
import { defaults, noteheads, type ScoreEvent } from "./model";
import { writtenPitch } from "./pitch";
import { positionsFor } from "../generation/positions";
import { inferFingeringHints } from "./hints";
import { generate } from "../generation/planner";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => createCanvas(10, 10).getContext("2d"),
  });
}
const event = (
  id: string,
  pitches: string[],
  onset: number,
  bar = 0,
): ScoreEvent => {
  const midis: Record<string, number> = {
    C4: 60,
    E4: 64,
    G4: 67,
    "F#4": 66,
    F4: 65,
    Eb4: 63,
  };
  const fingers: Record<string, number> = {
    C4: 1,
    E4: 3,
    G4: 5,
    "F#4": 4,
    F4: 4,
    Eb4: 3,
  };
  return {
    id,
    kind: "note",
    bar,
    onset,
    duration: 480,
    hand: "right",
    positionId: "right-C4",
    midi: midis[pitches[0]],
    pitch: pitches[0],
    finger: fingers[pitches[0]],
    action: "PLAY_WITHIN_POSITION",
    notes: pitches.map((pitch, i) => ({
      id: i ? `${id}:${i}` : id,
      pitch,
      midi: midis[pitch],
      finger: fingers[pitch],
      hand: "right",
      written: writtenPitch(pitch, "C"),
    })),
  };
};
it("renders multiple noteheads and one finger modifier beside EACH correct notehead, then minimizes Smart", () => {
  setup();
  const notes = [
    event("triad", ["C4", "E4", "G4"], 0),
    event("repeat", ["C4", "E4", "G4"], 480),
    event("sharp", ["F#4"], 960),
    event("natural", ["F4"], 1440),
  ];
  notes.push({
    ...notes[0],
    id: "rest-bar",
    kind: "rest",
    bar: 1,
    onset: 0,
    duration: 1920,
    notes: [],
    action: "REST",
  });
  const settings = {
    ...defaults,
    accidentals: "hard" as const,
    hints: "all" as const,
    bars: 2 as const,
  };
  const hands = positionsFor(settings, "right").slice(0, 1);
  const props = { events: notes, hands, settings, startBar: 0, reveal: false };
  const ui = render(<Notation {...props} />);
  const numbers = () =>
    [...ui.container.querySelectorAll("svg text")].filter((n) =>
      /^[1-5]$/.test(n.textContent ?? ""),
    );
  expect(numbers()).toHaveLength(8);
  for (const id of ["triad", "repeat"]) {
    const group = ui.container.querySelector(`[id="vf-${id}"]`)!;
    expect(group.querySelectorAll(".vf-notehead")).toHaveLength(3);
    expect(
      [...group.querySelectorAll("text")].map((n) => n.textContent),
    ).toEqual(expect.arrayContaining(["1", "3", "5"]));
  }
  ui.rerender(
    <Notation {...props} settings={{ ...settings, hints: "smart" }} />,
  );
  expect(numbers().map((n) => n.textContent)).toEqual(["1"]);
  ui.rerender(
    <Notation {...props} settings={{ ...settings, hints: "hidden" }} />,
  );
  expect(numbers()).toHaveLength(0);
  ui.rerender(
    <Notation {...props} settings={{ ...settings, hints: "hidden" }} reveal />,
  );
  expect(numbers()).toHaveLength(8);
});
it("engraves sharp/flat/natural cancellation, suppresses repeats and resets at barlines", () => {
  setup();
  const events = [
    event("sharp", ["F#4"], 0),
    event("sharp-repeat", ["F#4"], 480),
    event("cancel", ["F4"], 960),
    event("flat", ["Eb4"], 1440),
    event("flat-new-bar", ["Eb4"], 0, 1),
    event("flat-repeat", ["Eb4"], 480, 1),
    event("cancel-flat", ["E4"], 960, 1),
    event("ordinary", ["E4"], 1440, 1),
  ];
  const hands = positionsFor(defaults, "right");
  const ui = render(
    <Notation
      events={events}
      hands={hands}
      settings={{ ...defaults, bars: 2 }}
      startBar={0}
      reveal={false}
    />,
  );
  const signs = events.map(
    (e) =>
      [
        ...ui.container
          .querySelector(`[id="vf-${e.id}"]`)!
          .querySelectorAll("text"),
      ]
        .map((n) => n.textContent ?? "")
        .join("")
        .match(/[\uE260-\uE262]/g) ?? [],
  );
  expect(signs).toEqual([
    ["\uE262"],
    [],
    ["\uE261"],
    ["\uE260"],
    ["\uE260"],
    [],
    ["\uE261"],
    [],
  ]);
});
it("keeps Smart spacing exceptions and chord notehead inference across chunks", () => {
  const s = {
    ...defaults,
    chords: "hard" as const,
    accidentals: "hard" as const,
    fingerSpacing: "hard" as const,
    max: 79,
    noteJumps: "large" as const,
    interval: 7,
  };
  const p = generate(s, "chord-hints"),
    next = generate(s, p.seed, p.final);
  const first = inferFingeringHints(
    p.events,
    p.positions,
    p.movements,
    "smart",
    false,
    p.initial.hints,
  );
  const second = inferFingeringHints(
    next.events,
    next.positions,
    next.movements,
    "smart",
    false,
    next.initial.hints,
  );
  const all = inferFingeringHints(
    [...p.events, ...next.events],
    [...p.positions, ...next.positions],
    [...p.movements, ...next.movements],
  );
  const projection = (h: typeof first.hints) =>
    h.map(({ noteId, show, reasons }) => ({ noteId, show, reasons }));
  expect(projection([...first.hints, ...second.hints])).toEqual(
    projection(all.hints),
  );
  expect(all.hints).toHaveLength(
    [...p.events, ...next.events].flatMap(noteheads).length,
  );
});
