import { it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Notation } from "./Notation";
import { defaults } from "./model";
import { generate } from "../generation/planner";
import { createCanvas } from "@napi-rs/canvas";
import { applyHandMovements } from "../practice/presets";
import { movementAnnotation, visibleMovements } from "./hints";
import { restedAlternatePhrase, spacedPhrase } from "./test-fixtures";
it("renders actual VexFlow SVG and removes supported fingering modifiers when hidden", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  // Native canvas supplies real text metrics; SVG drawing remains VexFlow's.
  const context = createCanvas(10, 10).getContext("2d");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => context,
  });
  const p = generate({ ...defaults, hints: "all" }, "engraving");
  const ui = render(
    <Notation
      events={p.events}
      hands={p.initial.hands}
      settings={p.settings}
      startBar={0}
      currentId={p.events[0].id}
      reveal={false}
    />,
  );
  const fingers = () =>
    [...ui.container.querySelectorAll("svg text")].filter((e) =>
      /^[1-5]$/.test(e.textContent ?? ""),
    );
  expect(ui.container.querySelectorAll("svg")).toHaveLength(1);
  expect(ui.container.querySelectorAll(".vf-stavenote").length).toBeGreaterThan(
    8,
  );
  expect(fingers().length).toBeGreaterThan(0);
  expect(ui.container.querySelectorAll(".current-note")).toHaveLength(1);
  ui.rerender(
    <Notation
      events={p.events}
      hands={p.initial.hands}
      settings={{ ...p.settings, hints: "smart" }}
      startBar={0}
      currentId={p.events[0].id}
      reveal={false}
    />,
  );
  expect(fingers()).toHaveLength(1);
  ui.rerender(
    <Notation
      events={p.events}
      hands={p.initial.hands}
      settings={{ ...p.settings, hints: "hidden" }}
      startBar={0}
      currentId={p.events[0].id}
      reveal={false}
    />,
  );
  expect(fingers()).toHaveLength(0);
  const settings = {
    ...applyHandMovements(
      {
        ...defaults,
        noteJumps: "large" as const,
        interval: 7,
        max: 84,
        hints: "all",
      },
      "hard",
    ),
    shiftFrequency: 1,
  };
  const shifted = generate(settings, "engraving-shifts");
  expect(shifted.movements.length).toBeGreaterThan(0);
  const props = {
    events: shifted.events,
    hands: shifted.initial.hands,
    positions: shifted.positions,
    settings,
    startBar: 0,
    currentId: shifted.events[0].id,
    movements: shifted.movements,
  };
  ui.rerender(<Notation {...props} reveal={false} />);
  const annotations = () =>
    [...ui.container.querySelectorAll("svg text")]
      .map((n) => n.textContent)
      .filter((s) => s?.startsWith("Move "));
  expect(annotations()).toEqual(shifted.movements.map(movementAnnotation));
  ui.rerender(
    <Notation
      {...props}
      settings={{ ...settings, hints: "smart" }}
      reveal={false}
    />,
  );
  expect(fingers()).toHaveLength(1 + shifted.movements.length);
  for (const m of shifted.movements) {
    const group = ui.container.querySelector(`[id="vf-${m.landingNoteId}"]`)!;
    expect(
      [...group.querySelectorAll("text")].some(
        (t) => t.textContent === String(m.landingFinger),
      ),
    ).toBe(true);
  }
  ui.rerender(
    <Notation
      {...props}
      settings={{ ...settings, hints: "hidden" }}
      reveal={false}
    />,
  );
  expect(annotations()).toEqual([]);
  expect(fingers()).toHaveLength(0);
  ui.rerender(
    <Notation
      {...props}
      settings={{ ...settings, hints: "hidden" }}
      reveal={true}
    />,
  );
  expect(annotations()).toEqual(shifted.movements.map(movementAnnotation));
  const first = shifted.movements[0];
  const cueBar = Math.floor(first.cueTick / (settings.beats * 480));
  expect(
    visibleMovements(shifted.movements, cueBar, 2, settings.beats),
  ).toContain(first);
  const alternate = restedAlternatePhrase();
  ui.rerender(
    <Notation
      events={alternate.events}
      hands={alternate.initial.hands}
      positions={alternate.positions}
      settings={{ ...alternate.settings, hints: "smart" }}
      startBar={0}
      currentId="e-index"
      reveal={false}
    />,
  );
  expect(fingers().map((n) => n.textContent)).toEqual(["1", "2"]);
  expect(
    ui.container.querySelector('[id="vf-e-index"]')?.textContent,
  ).toContain("2");
  const spaced = spacedPhrase();
  ui.rerender(
    <Notation
      events={spaced.events}
      hands={spaced.initial.hands}
      positions={spaced.positions}
      settings={spaced.settings}
      startBar={0}
      reveal={false}
    />,
  );
  expect(fingers().map((n) => n.textContent)).toEqual(["1", "2"]);
  const firstFive = spaced.events.filter((e) => e.kind === "note").slice(0, 5);
  expect(
    firstFive.map((e) =>
      [
        ...ui.container
          .querySelector(`[id="vf-${e.id}"]`)!
          .querySelectorAll("text"),
      ]
        .filter((t) => /^[1-5]$/.test(t.textContent ?? ""))
        .map((t) => t.textContent),
    ),
  ).toEqual([["1"], ["2"], [], [], []]);
  ui.rerender(
    <Notation
      events={spaced.events.filter((e) => e.bar >= 1)}
      hintEvents={spaced.events}
      hands={spaced.initial.hands}
      positions={spaced.positions}
      settings={{ ...spaced.settings, bars: 2 }}
      startBar={1}
      reveal={false}
    />,
  );
  expect(fingers()).toHaveLength(0);
  cleanup();
  vi.unstubAllGlobals();
});
