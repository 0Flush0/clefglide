import "fake-indexeddb/auto";
import { afterEach, it, expect, vi } from "vitest";
import {
  within,
  render,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { createCanvas } from "@napi-rs/canvas";
import { App } from "./App";
import {
  db,
  record,
  isConfiguredSession,
  sessionPlayback,
} from "../progress/store";
import { defaults, noteheads, v4SettingsSchema } from "../score/model";
import { metrics } from "../scoring/engine";
import {
  generateConfigured,
  resolveGeneratorConfig,
  repositionDefaults,
  chordDefaults,
  chromaticDefaults,
  type ValidatedGeneratorConfig,
} from "../generation";
import { practiceFingerprint } from "./configuration";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setupNotationDom() {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value() {
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      },
    },
  });
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
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => {},
  });
}

function stageConfig(
  ui: ReturnType<typeof render>,
  config: ValidatedGeneratorConfig,
) {
  fireEvent.change(ui.getByLabelText("Practice profile"), {
    target: { value: "custom" },
  });
  fireEvent.change(ui.getByLabelText("GeneratorConfig JSON"), {
    target: { value: JSON.stringify(config) },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Use parameters", hidden: true }),
  );
}

it("migrates old left-only preferences and restores independent ranges through hand switches and reload", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  await db.table("preferences").put({
    id: "settings",
    settings: v4SettingsSchema.parse({
      ...defaults,
      hand: "left",
      min: 48,
      max: 55,
      leftMin: 36,
      leftMax: 43,
    }),
  });
  const ui = render(<App />);
  await waitFor(() =>
    expect((ui.getByLabelText("Hands") as HTMLSelectElement).value).toBe(
      "left",
    ),
  );
  expect(ui.container.querySelector(".keyboard-range")?.textContent).toContain(
    "C3–G3",
  );
  expect(
    ui
      .getByTestId("target")
      .getAttribute("data-pitches")
      ?.split(",")
      .map(Number)
      .every((n) => n >= 48 && n <= 55),
  ).toBe(true);
  fireEvent.change(ui.getByLabelText("Hands"), { target: { value: "right" } });
  fireEvent.click(ui.getByRole("button", { name: "Edit range" }));
  const dialog = within(ui.getByRole("dialog"));
  fireEvent.click(dialog.getByRole("button", { name: "C5" }));
  fireEvent.click(dialog.getByRole("button", { name: "G5" }));
  fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
  fireEvent.click(ui.getByRole("button", { name: "Apply & generate" }));
  await waitFor(async () =>
    expect(
      (await db.preferences.get("practice-v2"))?.setup?.config.hands,
    ).toMatchObject({
      right: { min: 72, max: 79 },
      left: { min: 48, max: 55 },
    }),
  );
  fireEvent.change(ui.getByLabelText("Hands"), { target: { value: "both" } });
  fireEvent.click(ui.getByRole("button", { name: "Apply & generate" }));
  await waitFor(async () =>
    expect(
      (await db.preferences.get("practice-v2"))?.setup?.config.hands.active,
    ).toBe("both"),
  );
  ui.unmount();
  const restored = render(<App />);
  await waitFor(() =>
    expect((restored.getByLabelText("Hands") as HTMLSelectElement).value).toBe(
      "both",
    ),
  );
  expect(
    restored.container.querySelector(".keyboard-range")?.textContent,
  ).toContain("C3–G3");
  expect(
    restored.container.querySelector(".keyboard-range")?.textContent,
  ).toContain("C4–G4");
  fireEvent.change(restored.getByLabelText("Hands"), {
    target: { value: "right" },
  });
  expect(
    restored.container.querySelector(".keyboard-range")?.textContent,
  ).toContain("C5–G5");
  fireEvent.change(restored.getByLabelText("Hands"), {
    target: { value: "left" },
  });
  expect(
    restored.container.querySelector(".keyboard-range")?.textContent,
  ).toContain("C3–G3");
});

it("remembers all three staged hand profiles without changing the running exercise", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const initial = { ...defaults, bpm: 61 };
  await db.preferences.put({ id: "settings", settings: initial });
  const ui = render(<App />);
  // Wait for initial hydration before starting a session.
  await waitFor(() =>
    expect((ui.getByLabelText("Tempo") as HTMLInputElement).value).toBe("61"),
  );
  fireEvent.click(ui.getByRole("button", { name: "Start practice" }));
  const originalTarget = ui.getByTestId("target").getAttribute("data-pitches");
  for (const [hand, bpm, key, tolerance] of [
    ["right", 82, "G", 120],
    ["left", 55, "F", 220],
    ["both", 74, "D", 160],
  ] as const) {
    fireEvent.change(ui.getByLabelText("Hands"), { target: { value: hand } });
    fireEvent.change(ui.getByLabelText("Tempo"), { target: { value: bpm } });
    fireEvent.change(ui.getByLabelText("Key", { exact: true }), {
      target: { value: key },
    });
    fireEvent.change(ui.getByLabelText("Timing tolerance (ms)"), {
      target: { value: tolerance },
    });
    expect(ui.getByTestId("target").getAttribute("data-pitches")).toBe(
      originalTarget,
    );
    expect(ui.getByRole("button", { name: "Pause" })).toBeTruthy();
  }
  expect((await db.preferences.get("settings"))?.settings).toEqual(initial);
  fireEvent.change(ui.getByLabelText("Hands"), { target: { value: "right" } });
  expect((ui.getByLabelText("Tempo") as HTMLInputElement).value).toBe("82");
  expect(
    (ui.getByLabelText("Key", { exact: true }) as HTMLSelectElement).value,
  ).toBe("G");
  fireEvent.click(ui.getByRole("button", { name: "New exercise" }));
  await waitFor(async () =>
    expect((await db.preferences.get("practice-v2"))?.setup).toMatchObject({
      config: { hands: { active: "right" }, notation: { key: "G" } },
      options: { bpm: 82, tolerance: 120 },
    }),
  );
  ui.unmount();
  const restored = render(<App />);
  await waitFor(() =>
    expect((restored.getByLabelText("Tempo") as HTMLInputElement).value).toBe(
      "82",
    ),
  );
  fireEvent.change(restored.getByLabelText("Hands"), {
    target: { value: "left" },
  });
  expect((restored.getByLabelText("Tempo") as HTMLInputElement).value).toBe(
    "55",
  );
  fireEvent.change(restored.getByLabelText("Hands"), {
    target: { value: "both" },
  });
  expect((restored.getByLabelText("Tempo") as HTMLInputElement).value).toBe(
    "74",
  );
});

it.each(["3 min", "5 min", "Unlimited"])(
  "restores %s after reload and keeps duration locked through pause",
  async (label) => {
    setupNotationDom();
    await db.sessions.clear();
    await db.preferences.clear();
    await db.preferences.put({
      id: "settings",
      settings: { ...defaults, bpm: 61 },
    });
    const ui = render(<App />);
    await waitFor(() =>
      expect((ui.getByLabelText("Tempo") as HTMLInputElement).value).toBe("61"),
    );
    fireEvent.click(ui.getByRole("button", { name: label }));
    const minutes = label === "3 min" ? 3 : label === "5 min" ? 5 : 0;
    await waitFor(async () =>
      expect((await db.preferences.get("practice-v2"))?.duration).toBe(minutes),
    );
    ui.unmount();
    const restored = render(<App />);
    await waitFor(() =>
      expect((restored.getByLabelText("Tempo") as HTMLInputElement).value).toBe(
        "61",
      ),
    );
    await waitFor(() =>
      expect(
        restored
          .getByRole("button", { name: label })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    fireEvent.click(restored.getByRole("button", { name: "Start practice" }));
    fireEvent.click(restored.getByRole("button", { name: "Pause" }));
    const buttons = within(
      restored.getByRole("group", { name: "Practice duration" }),
    ).getAllByRole("button");
    expect(
      buttons.every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    fireEvent.click(restored.getByRole("button", { name: "New exercise" }));
    await waitFor(() =>
      expect(
        buttons.every((button) => !(button as HTMLButtonElement).disabled),
      ).toBe(true),
    );
  },
);

it("counts down only during active practice and expires on the session clock", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  let clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const ui = render(<App />);
  const duration = within(ui.getByRole("group", { name: "Practice duration" }));
  expect(
    duration
      .getByRole("button", { name: "Unlimited" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(ui.queryByRole("timer")).toBeNull();

  fireEvent.click(duration.getByRole("button", { name: "5 min" }));
  clock += 5000;
  ui.rerender(<App />);
  expect(ui.getByRole("timer").textContent).toBe("05:00");
  fireEvent.click(ui.getByRole("button", { name: "Start practice" }));
  clock += 61_250;
  await waitFor(() => expect(ui.getByRole("timer").textContent).toBe("03:59"));
  fireEvent.click(ui.getByRole("button", { name: "Pause" }));
  clock += 300_000;
  ui.rerender(<App />);
  expect(ui.getByRole("timer").textContent).toBe("03:59");

  fireEvent.click(ui.getByRole("button", { name: "Start practice" }));
  clock += 237_751;
  await waitFor(() => expect(ui.getByRole("timer").textContent).toBe("00:01"));
  clock += 999;
  await waitFor(() =>
    expect(ui.getByTestId("target").textContent).toBe("Session complete"),
  );
  expect(ui.getByRole("timer").textContent).toBe("00:00");
  await waitFor(async () =>
    expect(await db.sessions.toArray()).toMatchObject([
      { ms: 300_000, results: [] },
    ]),
  );
});

it("saves played notes at expiry, rejects late input and starts a fresh session", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  let clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const ui = render(<App />);
  const playTarget = () => {
    const pitch = ui.getByTestId("target").getAttribute("data-pitches");
    const key = ui.container.querySelector(`[data-midi="${pitch}"]`)!;
    fireEvent.pointerDown(key, { pointerId: 1 });
    fireEvent.pointerUp(key, { pointerId: 1 });
  };
  fireEvent.click(ui.container.querySelector(".piano-card summary")!);
  fireEvent.click(ui.getByRole("button", { name: "3 min" }));
  fireEvent.click(ui.getByRole("button", { name: "Start practice" }));
  clock += 500;
  playTarget();
  clock += 180_000;
  playTarget();
  expect(ui.getByTestId("target").textContent).toBe("Session complete");
  expect(ui.container.querySelector(".stat strong")?.textContent).toBe("1");
  await waitFor(async () =>
    expect(await db.sessions.toArray()).toMatchObject([
      { ms: 180_000, results: [{ kind: "correct", first: true }] },
    ]),
  );

  fireEvent.click(ui.getByRole("button", { name: "Start another session" }));
  await waitFor(() =>
    expect(ui.getByRole("button", { name: "Pause" })).toBeTruthy(),
  );
  expect(ui.getByRole("timer").textContent).toBe("03:00");
  expect(ui.container.querySelector(".stat strong")?.textContent).toBe("0");
  expect(ui.getByTestId("target").getAttribute("data-bar")).toBe("0");
});

it("excludes the rhythm count-in and pauses when the page is left", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  let clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const ui = render(<App />);
  fireEvent.click(ui.getByRole("button", { name: "3 min" }));
  fireEvent.change(ui.getByLabelText("Scoring mode"), {
    target: { value: "timed" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Apply & play" }));
  await waitFor(() =>
    expect(ui.getByRole("button", { name: "Pause" })).toBeTruthy(),
  );

  const bpm = (ui.getByLabelText("Tempo") as HTMLInputElement).valueAsNumber;
  const countIn = (defaults.beats * 60_000) / bpm;
  clock += countIn - 1000;
  ui.rerender(<App />);
  expect(ui.getByRole("timer").textContent).toBe("03:00");
  fireEvent(window, new Event("pagehide"));
  clock += 60_000;
  fireEvent.click(ui.getByRole("button", { name: "Start practice" }));
  clock += 1500;
  ui.rerender(<App />);
  expect(ui.getByRole("timer").textContent).toBe("03:00");
  clock += 500;
  await waitFor(() => expect(ui.getByRole("timer").textContent).toBe("02:59"));

  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  fireEvent.change(ui.getByLabelText("Language"), { target: { value: "de" } });
  const duration = within(ui.getByRole("group", { name: "Übungsdauer" }));
  expect(duration.getByRole("button", { name: "Unbegrenzt" })).toBeTruthy();
  expect(ui.getByRole("timer", { name: "Verbleibende Zeit" }).textContent).toBe(
    "02:59",
  );
});

it("ClefGlide preserves historical fingerprints and offers exact historical seed replay", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const settings = { ...defaults, bpm: 72, hints: "all" as const };
  const session = record("before-rebrand", "original-seed", settings, 2000, [
    { id: "a", pitch: 60, hand: "right", kind: "correct", first: true },
  ]);
  expect(db.name).toBe("sightflow");
  await db.sessions.put(session);
  await db.preferences.put({ id: "settings", settings });
  db.close();
  await db.open();

  const ui = render(<App />);
  expect(ui.getByRole("link", { name: "ClefGlide home" })).toBeTruthy();
  await waitFor(() =>
    expect((ui.getByLabelText("Tempo") as HTMLInputElement).value).toBe("72"),
  );
  expect(
    (ui.getByLabelText("Fingering assistance") as HTMLSelectElement).value,
  ).toBe("all");
  fireEvent.mouseDown(ui.getByRole("tab", { name: /^Progress$/ }), {
    button: 0,
    ctrlKey: false,
  });
  expect(ui.container.querySelectorAll(".session")).toHaveLength(0);
  fireEvent.click(ui.getByLabelText(/Show all/));
  await waitFor(() =>
    expect(ui.container.querySelectorAll(".session")).toHaveLength(1),
  );
  expect(ui.container.textContent).not.toMatch(/sightflow/i);
  const row = ui.container.querySelector(".session")!;
  fireEvent.click(row.querySelector("summary")!);
  fireEvent.click(
    within(row as HTMLElement).getByRole("button", { name: "Replay seed" }),
  );
  await waitFor(() =>
    expect(
      ui.container.querySelector('[id^="vf-original-seed-0-"]'),
    ).not.toBeNull(),
  );
  expect(await db.sessions.get(session.id)).toEqual(session);
  expect(await db.preferences.get("settings")).toEqual({
    id: "settings",
    settings,
  });
});

it("plays actual both-hand chromatic chords through four bars and persists separate chord accuracy", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  let clock = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const config = resolveGeneratorConfig({
    hands: { active: "both" },
    chords: { ...chordDefaults, probability: 1 },
    chromatic: { ...chromaticDefaults, probability: 0.45 },
  });
  const seed = Array.from({ length: 30 }, (_, i) => `ui-chord-${i}`).find(
    (seed) => {
      const p = generateConfigured(config, seed);
      return (
        p.events.some((e) => noteheads(e).length > 1) &&
        p.events.some((e) => e.pitch.includes("#") || e.pitch.includes("b"))
      );
    },
  )!;
  expect(seed).toBeDefined();
  const ui = render(<App />);
  stageConfig(ui, config);
  fireEvent.change(ui.getByLabelText("Exercise seed"), {
    target: { value: seed },
  });
  fireEvent.click(ui.getByRole("button", { name: "Apply & generate" }));
  await waitFor(() =>
    expect(
      ui.container
        .querySelector(".notation svg")
        ?.getAttribute("data-staff-count"),
    ).toBe("2"),
  );
  fireEvent.click(ui.getByRole("button", { name: /^Start practice$/ }));
  let playedChord = false;
  for (let i = 0; i < 50; i++) {
    const target = ui.getByTestId("target");
    if (Number(target.getAttribute("data-bar")) >= 4) break;
    const pitches = target.getAttribute("data-pitches")!.split(",");
    playedChord ||= pitches.length > 2;
    const before = target.getAttribute("data-pitches");
    for (let index = 0; index < pitches.length; index++) {
      clock += 5;
      const key = ui.container.querySelector(
        `[data-midi="${pitches[index]}"]`,
      )!;
      fireEvent.pointerDown(key, { pointerId: index + 1 });
      fireEvent.pointerUp(key, { pointerId: index + 1 });
      if (index < pitches.length - 1)
        expect(ui.getByTestId("target").getAttribute("data-pitches")).toBe(
          before,
        );
    }
    clock += 200;
  }
  expect(playedChord).toBe(true);
  expect(
    Number(ui.getByTestId("target").getAttribute("data-bar")),
  ).toBeGreaterThanOrEqual(4);
  fireEvent.click(ui.getByRole("button", { name: "Save & finish" }));
  await waitFor(async () =>
    expect((await db.sessions.toArray()).length).toBe(1),
  );
  const stored = (await db.sessions.toArray())[0],
    summary = metrics(
      stored.results,
      stored.ms,
      sessionPlayback(stored).tolerance,
    );
  expect(summary.chordEvents).toBeGreaterThan(0);
  expect(summary).toMatchObject({
    chordAccuracy: 100,
    accuracy: 100,
    wrong: 0,
    missed: 0,
  });
  if (!isConfiguredSession(stored))
    throw new Error("Expected a configured session");
  expect(stored.setup.config).toEqual(config);
}, 20000);

it("Smart placement is automatic, hint modes apply immediately, and reveal never changes the music", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const ui = render(<App />);
  const banner = ui.getByTestId("placement-plan");
  expect(banner.textContent).toContain(
    "Right hand: thumb on C4, position C4–G4. Start on",
  );
  expect(banner.textContent).toMatch(/with finger [1-5]/);
  const ids = () =>
    [...ui.container.querySelectorAll(".vf-stavenote")].map((n) => n.id);
  const fingers = () =>
    [...ui.container.querySelectorAll(".notation svg text")].filter((n) =>
      /^[1-5]$/.test(n.textContent ?? ""),
    );
  const original = ids();
  expect(fingers()).toHaveLength(1);
  fireEvent.change(ui.getByLabelText("Fingering assistance"), {
    target: { value: "all" },
  });
  expect(fingers().length).toBeGreaterThan(8);
  expect(ids()).toEqual(original);
  fireEvent.change(ui.getByLabelText("Fingering assistance"), {
    target: { value: "hidden" },
  });
  expect(fingers()).toHaveLength(0);
  expect(banner.textContent).not.toMatch(/thumb on|with finger/);
  expect(ids()).toEqual(original);
  fireEvent.click(ui.getByRole("button", { name: "Reveal hint" }));
  expect(fingers().length).toBeGreaterThan(8);
  expect(ids()).toEqual(original);
  fireEvent.click(ui.getByRole("button", { name: "Hide hint" }));
  expect(fingers()).toHaveLength(0);
  expect(
    (ui.getByRole("button", { name: "Apply & generate" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it("fresh None practice stays independent until a measured manual reveal", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const ui = render(<App />);
  fireEvent.click(ui.container.querySelector(".piano-card summary")!);
  fireEvent.change(ui.getByLabelText("Fingering assistance"), {
    target: { value: "hidden" },
  });
  fireEvent.click(ui.getByRole("button", { name: "New exercise" }));
  await waitFor(() =>
    expect(ui.container.querySelector('[id^="vf-exercise-"]')).not.toBeNull(),
  );
  fireEvent.click(ui.getByRole("button", { name: /^Start practice$/ }));
  const key = ui.container.querySelector(
    `[data-midi="${ui.getByTestId("target").getAttribute("data-pitches")}"]`,
  )!;
  fireEvent.pointerDown(key, { pointerId: 1 });
  fireEvent.pointerUp(key, { pointerId: 1 });
  fireEvent.click(ui.getByRole("button", { name: "Pause" }));
  await waitFor(async () =>
    expect((await db.sessions.toArray())[0]?.assistanceUsed).toBe(false),
  );
  const saved = (await db.sessions.toArray())[0];
  const target = ui.getByTestId("target").getAttribute("data-pitches");
  fireEvent.click(ui.getByRole("button", { name: "Reveal hint" }));
  await waitFor(async () =>
    expect((await db.sessions.get(saved.id))?.assistanceUsed).toBe(true),
  );
  expect(ui.getByTestId("target").getAttribute("data-pitches")).toBe(target);
  expect((await db.sessions.get(saved.id))?.results).toHaveLength(1);
});
it("switches All/Smart/None and Reveal during play without resetting the target, clock or results", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const ui = render(<App />);
  fireEvent.click(ui.container.querySelector(".piano-card summary")!);
  fireEvent.click(ui.getByRole("button", { name: /^Start practice$/ }));
  const playTarget = () => {
    const pitch = ui.getByTestId("target").getAttribute("data-pitches");
    const key = ui.container.querySelector(`[data-midi="${pitch}"]`)!;
    fireEvent.pointerDown(key, { pointerId: 1 });
    fireEvent.pointerUp(key, { pointerId: 1 });
  };
  playTarget();
  const target = ui.getByTestId("target").getAttribute("data-pitches");
  const ids = () =>
    [...ui.container.querySelectorAll(".vf-stavenote")].map((n) => n.id);
  const original = ids();
  for (const mode of ["all", "hidden", "smart", "hidden"]) {
    fireEvent.change(ui.getByLabelText("Fingering assistance"), {
      target: { value: mode },
    });
    expect(ui.getByRole("button", { name: "Pause" })).not.toBeNull();
    expect(ui.getByTestId("target").getAttribute("data-pitches")).toBe(target);
    expect(ids()).toEqual(original);
  }
  fireEvent.click(ui.getByRole("button", { name: "Reveal hint" }));
  expect(ui.getByTestId("target").getAttribute("data-pitches")).toBe(target);
  playTarget();
  fireEvent.click(ui.getByRole("button", { name: "Pause" }));
  await waitFor(async () =>
    expect(
      (await db.sessions.toArray())[0]?.results.filter(
        (r) => r.kind === "correct",
      ),
    ).toHaveLength(2),
  );
  expect((await db.sessions.toArray())[0].ms).toBeGreaterThan(0);
});

it("pending exercise changes can generate and start in one action; invalid ranges cannot apply", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const ui = render(<App />);
  fireEvent.click(ui.getByRole("button", { name: "Edit range" }));
  const dialog = within(ui.getByRole("dialog"));
  expect(dialog.getByRole("button", { name: "Lowest note · C4" })).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "E4" }));
  expect(
    (dialog.getByRole("button", { name: "Apply" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(dialog.getByRole("button", { name: "Lowest note · E4" }));
  fireEvent.click(dialog.getByRole("button", { name: "C4" }));
  fireEvent.click(dialog.getByRole("button", { name: "C6" }));
  fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
  fireEvent.click(ui.getByRole("button", { name: "Apply & play" }));
  await waitFor(() =>
    expect(ui.getByRole("button", { name: "Pause" })).not.toBeNull(),
  );
  expect(ui.container.querySelector('[id^="vf-first-light-0-"]')).toBeNull();
  fireEvent.change(ui.getByLabelText("Practice profile"), {
    target: { value: "custom" },
  });
  // Editing future settings must leave Pause available for the current attempt.
  fireEvent.click(ui.getByRole("button", { name: "Pause" }));
  expect(ui.getByRole("button", { name: "Apply & play" })).not.toBeNull();
});

it("uses parameter-driven repositioning, advance hints, and the configured history fingerprint", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const ui = render(<App />);
  fireEvent.click(ui.container.querySelector(".piano-card summary")!);
  const config = resolveGeneratorConfig({
    hands: { right: { max: 84 } },
    melody: { maxIntervalSteps: 7 },
    movement: {
      ...repositionDefaults,
      eligibleBars: [1, 2, 3],
      probability: 1,
      maxDistanceSteps: 4,
    },
  });
  stageConfig(ui, config);
  fireEvent.change(ui.getByLabelText("Exercise seed"), {
    target: { value: "ui-shift" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Apply & generate" }));
  const plan = generateConfigured(config, "ui-shift");
  expect(plan.movements.length).toBeGreaterThan(0);
  await waitFor(() =>
    expect(ui.container.querySelector(".level-pill")?.textContent).toContain(
      "Right hand",
    ),
  );
  const banner = ui.getByTestId("placement-plan");
  expect(banner.textContent).toContain("Right hand: thumb on");
  expect(banner.textContent).toMatch(/finger \d/);
  fireEvent.click(ui.getByRole("button", { name: "Reveal hint" }));
  for (const move of plan.movements) {
    const hint = ui.container.querySelector(`[data-movement-id="${move.id}"]`);
    if (hint)
      expect(hint.textContent).toContain(`finger ${move.landingFinger}`);
  }
  expect(banner.textContent).toContain(
    `Start on ${plan.events[0].pitch} with finger ${plan.events[0].finger}`,
  );
  fireEvent.click(ui.getByRole("button", { name: /^Start practice$/ }));
  for (let i = 0; i < 50; i++) {
    const target = ui.getByTestId("target");
    if (Number(target.getAttribute("data-bar")) >= 4) break;
    for (const pitch of target.getAttribute("data-pitches")!.split(",")) {
      const key = ui.container.querySelector(`[data-midi="${pitch}"]`)!;
      fireEvent.pointerDown(key, { pointerId: 1 });
      fireEvent.pointerUp(key, { pointerId: 1 });
    }
  }
  expect(
    Number(ui.getByTestId("target").getAttribute("data-bar")),
  ).toBeGreaterThanOrEqual(4);
  fireEvent.click(ui.getByRole("button", { name: "Save & finish" }));
  await waitFor(async () =>
    expect((await db.sessions.toArray())[0]?.assistanceUsed).toBe(true),
  );
  const saved = (await db.sessions.toArray())[0];
  if (!isConfiguredSession(saved))
    throw new Error("Expected a configured session");
  expect(saved.fingerprint).toBe(
    practiceFingerprint(config, saved.setup.options, true),
  );
  expect(saved.fingerprint).not.toBe(
    practiceFingerprint(config, saved.setup.options, false),
  );
}, 20000);

it.each([undefined, { randomUUID: undefined, getRandomValues: undefined }])(
  "renders and practices on HTTP LAN without Web Crypto: %j",
  async (crypto) => {
    setupNotationDom();
    vi.stubGlobal("crypto", crypto);
    vi.stubGlobal("isSecureContext", false);
    const requestMidi = vi.fn();
    vi.stubGlobal("navigator", { requestMIDIAccess: requestMidi });
    await db.sessions.clear();
    await db.preferences.clear();
    const ui = render(<App />);
    fireEvent.click(ui.container.querySelector(".piano-card summary")!);
    expect(ui.container.querySelector(".notation svg")).not.toBeNull();
    expect(ui.container.querySelector(".connection")?.textContent).toContain(
      "MIDI requires HTTPS or localhost",
    );
    fireEvent.click(ui.getByRole("button", { name: "Connect MIDI" }));
    await waitFor(() =>
      expect(ui.getByRole("alert").textContent).toContain("HTTP LAN"),
    );
    expect(requestMidi).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole("button", { name: "New exercise" }));
    await waitFor(() =>
      expect(ui.container.querySelector('[id^="vf-exercise-"]')).not.toBeNull(),
    );
    fireEvent.click(ui.getByRole("button", { name: "Restart" }));
    await waitFor(() =>
      expect(
        ui.getByRole("button", { name: /^Start practice$/ }),
      ).not.toBeNull(),
    );
    fireEvent.click(ui.getByRole("button", { name: /^Start practice$/ }));
    const pitch = ui.getByTestId("target").getAttribute("data-pitches");
    const key = ui.container.querySelector(`[data-midi="${pitch}"]`)!;
    fireEvent.pointerDown(key, { pointerId: 1 });
    fireEvent.pointerUp(key, { pointerId: 1 });
    expect(ui.container.querySelector(".stat strong")?.textContent).toBe("1");
    fireEvent.click(ui.getByRole("button", { name: "Save & finish" }));
    await waitFor(async () =>
      expect((await db.sessions.toArray())[0]?.results[0]?.kind).toBe(
        "correct",
      ),
    );
  },
  20000,
);

it("real practice UI plays through four bars, displays genuine look-ahead, saves and reloads outcomes", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const ui = render(<App />);
  fireEvent.click(ui.container.querySelector(".piano-card summary")!);
  fireEvent.click(ui.getByRole("button", { name: /^Start practice$/ }));
  let preview = false;
  for (let i = 0; i < 40; i++) {
    const target = ui.getByTestId("target"),
      bar = Number(target.getAttribute("data-bar"));
    if (bar >= 4) break;
    if (bar >= 1)
      preview = !!ui.container.querySelector('[id^="vf-first-light-4-"]');
    const pitches = target.getAttribute("data-pitches")!.split(",").map(Number);
    for (const p of pitches) {
      const key = ui.container.querySelector(`[data-midi="${p}"]`)!;
      fireEvent.pointerDown(key, { pointerId: 1 });
      fireEvent.pointerUp(key, { pointerId: 1 });
    }
  }
  expect(
    Number(ui.getByTestId("target").getAttribute("data-bar")),
  ).toBeGreaterThanOrEqual(4);
  expect(preview).toBe(true);
  fireEvent.click(ui.getByRole("button", { name: "Save & finish" }));
  await waitFor(async () =>
    expect(
      (await db.sessions.toArray())[0]?.results.filter(
        (r) => r.kind === "correct",
      ).length,
    ).toBeGreaterThan(0),
  );
  const stored = (await db.sessions.toArray())[0];
  expect(stored.results.every((r) => r.kind === "correct" && r.first)).toBe(
    true,
  );
  expect(stored.ms).toBeGreaterThan(0);
  cleanup();
  vi.unstubAllGlobals();
}, 20000);
