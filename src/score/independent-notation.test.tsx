import { cleanup, render } from "@testing-library/react";
import { createCanvas } from "@napi-rs/canvas";
import { afterEach, expect, it, vi } from "vitest";
import {
  generateConfigured,
  noteLifetimeDefaults,
  resolveGeneratorConfig,
  tieDefaults,
} from "../generation";
import { defaults, noteheads } from "./model";
import { Notation } from "./Notation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("engraves independently timed voice lanes, displaced rests and rolling per-head ties on a grand staff", () => {
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
  const c = resolveGeneratorConfig({
    hands: { active: "both" },
    rhythm: { breathBars: [] },
    notation: {
      voices: "independent",
      ties: {
        ...tieDefaults,
        probability: 1,
        crossPhrase: true,
        voices: ["right:2"],
        patterns: [{ value: "carry", weight: 1 }],
      },
    },
    noteLifetimes: noteLifetimeDefaults,
    independentVoices: {
      right: {
        minPolyphony: 2,
        voices: [
          {
            fingers: [3, 4, 5],
            activity: 0.65,
            durations: [{ value: 240, weight: 1 }],
          },
          { fingers: [1, 2], durations: [{ value: 960, weight: 1 }] },
        ],
      },
      left: { voices: [{ durations: [{ value: 480, weight: 1 }] }] },
    },
  });
  const a = generateConfigured(c, "voices-svg");
  const b = generateConfigured(c, a.seed, a.final);
  const settings = { ...defaults, hand: "both" as const, bars: 2 as const };
  const carried = b.events.find((e) =>
    noteheads(e).some((n) => n.tie?.previousId),
  )!;
  expect(carried.voiceId).toBe("right:2");
  const props = {
    hands: a.initial.hands,
    settings,
    reveal: false,
    currentId: carried.id,
  };
  const ui = render(
    <Notation {...props} events={[...a.events, ...b.events]} startBar={3} />,
  );
  const svg = ui.container.querySelector("svg")!;
  expect(svg.getAttribute("data-staff-count")).toBe("2");
  expect(svg.querySelectorAll(".vf-stavetie")).toHaveLength(1);
  expect(svg.querySelector(".current-note")?.id).toBe(`vf-${carried.id}`);
  const visible = [...a.events, ...b.events].filter(
    (e) => e.bar === 3 || e.bar === 4,
  );
  expect(svg.querySelectorAll(".vf-stavenote").length).toBe(visible.length);
  expect(visible.some((e) => e.kind === "rest")).toBe(true);
  const glyph = (id: string) =>
    [...svg.querySelectorAll(".vf-stavenote")].find((n) => n.id === `vf-${id}`);
  const main = b.events.find(
    (e) => e.bar === 4 && e.voiceId === "right:main" && e.kind === "note",
  )!;
  expect(glyph(main.id)?.querySelector(".vf-stem")).toBeTruthy();
  expect(glyph(carried.id)?.querySelector(".vf-stem")).toBeTruthy();
  ui.rerender(<Notation {...props} events={b.events} startBar={4} />);
  const tie = ui.container.querySelector(".vf-stavetie path");
  expect(tie?.getAttribute("d")).toBeTruthy();
  expect(tie?.getAttribute("d")).not.toMatch(/NaN|Infinity/);
});
