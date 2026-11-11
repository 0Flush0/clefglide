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
import { db, record } from "../progress/store";
import { defaults, fingerprint, VERSION, noteheads } from "../score/model";
import { metrics } from "../scoring/engine";
import { generate } from "../generation/planner";
import { applyHandMovements } from "./presets";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setupNotationDom() {
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
  fireEvent.change(ui.getByLabelText("Practice mode"), {
    target: { value: "timed" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Apply & play" }));
  await waitFor(() =>
    expect(ui.getByRole("button", { name: "Pause" })).toBeTruthy(),
  );

  const countIn = (defaults.beats * 60_000) / defaults.bpm;
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

it("ClefGlide restores existing SightFlow settings and progress without migration", async () => {
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
  await waitFor(() =>
    expect(ui.container.querySelectorAll(".session")).toHaveLength(1),
  );
  expect(ui.container.textContent).not.toMatch(/sightflow/i);
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
  const settings = {
    ...defaults,
    hand: "both" as const,
    chords: "hard" as const,
    accidentals: "hard" as const,
  };
  const seed = Array.from({ length: 30 }, (_, i) => `ui-chord-${i}`).find(
    (seed) => {
      const p = generate(settings, seed);
      return (
        p.events.some((e) => noteheads(e).length > 1) &&
        p.events.some((e) => e.pitch.includes("#") || e.pitch.includes("b"))
      );
    },
  )!;
  expect(seed).toBeDefined();
  const ui = render(<App />);
  fireEvent.change(ui.getByLabelText("Hands", { exact: true }), {
    target: { value: "both" },
  });
  for (const label of ["Accidentals", "Chords"])
    fireEvent.click(
      within(ui.getByRole("group", { name: label })).getByRole("button", {
        name: "Hard",
      }),
    );
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
    summary = metrics(stored.results, stored.ms, stored.settings.tolerance);
  expect(summary.chordEvents).toBeGreaterThan(0);
  expect(summary).toMatchObject({
    chordAccuracy: 100,
    accuracy: 100,
    wrong: 0,
    missed: 0,
  });
  expect(stored.settings).toMatchObject({
    hand: "both",
    chords: "hard",
    accidentals: "hard",
    handMovements: "off",
  });
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

it("pending exercise changes can generate and start in one action; invalid note boundaries are disabled", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const ui = render(<App />);
  const low = ui.getByLabelText("Lowest note") as HTMLSelectElement;
  expect(low.selectedOptions[0].textContent).toBe("C4");
  expect(
    (ui.getByLabelText("Highest note") as HTMLSelectElement).selectedOptions[0]
      .textContent,
  ).toBe("G4");
  expect(
    (low.querySelector('option[value="64"]') as HTMLOptionElement).disabled,
  ).toBe(true);
  fireEvent.change(ui.getByLabelText("Highest note"), {
    target: { value: "84" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Apply & play" }));
  await waitFor(() =>
    expect(ui.getByRole("button", { name: "Pause" })).not.toBeNull(),
  );
  expect(ui.container.querySelector('[id^="vf-first-light-0-"]')).toBeNull();
  fireEvent.click(
    within(ui.getByRole("group", { name: "Hand movements" })).getByRole(
      "button",
      { name: "Easy" },
    ),
  );
  // Editing future settings must leave Pause available for the current attempt.
  fireEvent.click(ui.getByRole("button", { name: "Pause" }));
  expect(ui.getByRole("button", { name: "Apply & play" })).not.toBeNull();
});

it("applies real difficulty without changing range, reveals advance shifts, streams and records assistance", async () => {
  setupNotationDom();
  await db.sessions.clear();
  await db.preferences.clear();
  const ui = render(<App />);
  fireEvent.click(ui.container.querySelector(".piano-card summary")!);
  expect(ui.getByText(/Only one hand position fits this range/)).not.toBeNull();
  fireEvent.change(ui.getByLabelText("Highest note"), {
    target: { value: "84" },
  });
  fireEvent.click(
    within(ui.getByRole("group", { name: "Hand movements" })).getByRole(
      "button",
      { name: "Hard" },
    ),
  );
  fireEvent.click(
    within(ui.getByRole("group", { name: "Note jumps" })).getByRole("button", {
      name: "Large",
    }),
  );
  expect((ui.getByLabelText("Highest note") as HTMLSelectElement).value).toBe(
    "84",
  );
  fireEvent.click(ui.getByText("Advanced settings", { exact: true }));
  fireEvent.change(ui.getByLabelText("Hand-shift frequency"), {
    target: { value: "1" },
  });
  fireEvent.change(ui.getByLabelText("Exercise seed"), {
    target: { value: "ui-shift" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Apply & generate" }));
  const settings = {
    ...applyHandMovements(
      { ...defaults, noteJumps: "large" as const, interval: 7, max: 84 },
      "hard",
    ),
    shiftFrequency: 1,
  };
  const plan = generate(settings, "ui-shift");
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
  expect(saved.generatorVersion).toBe(VERSION);
  expect(saved.fingerprint).toBe(fingerprint(settings, true));
  expect(saved.fingerprint).not.toBe(fingerprint(settings, false));
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
