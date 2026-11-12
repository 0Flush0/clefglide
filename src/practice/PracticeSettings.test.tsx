import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useState } from "react";
import { defaults, type Settings } from "../score/model";
import { PracticeSettings } from "./PracticeSettings";
afterEach(cleanup);
it("offers five independent four-button groups with details collapsed", () => {
  let latest = defaults;
  function SettingsHarness() {
    const [draft, update] = useState<Settings>({ ...defaults, max: 84 });
    latest = draft;
    return (
      <PracticeSettings
        draft={draft}
        onChange={update}
        onHints={() => {}}
        onSeed={() => {}}
        onApply={() => {}}
        seed="settings"
        pending
        assistanceUsed
      >
        {null}
      </PracticeSettings>
    );
  }
  const ui = render(<SettingsHarness />);
  expect(ui.queryByLabelText("Difficulty preset")).toBeNull();
  for (const label of [
    "Note jumps",
    "Hand movements",
    "Finger spacing",
    "Accidentals",
    "Chords",
  ]) {
    expect(
      within(ui.getByRole("group", { name: label })).getAllByRole("button"),
    ).toHaveLength(4);
  }
  const choose = (group: string, name: string) =>
    fireEvent.click(
      within(ui.getByRole("group", { name: group })).getByRole("button", {
        name,
      }),
    );
  choose("Finger spacing", "Hard");
  expect(latest).toEqual({ ...defaults, max: 84, fingerSpacing: "hard" });
  choose("Note jumps", "Large");
  expect(latest).toMatchObject({
    noteJumps: "large",
    interval: 7,
    handMovements: "off",
    maxShift: 0,
    shiftFrequency: 0,
    fingerSpacing: "hard",
    min: 60,
    max: 84,
  });
  choose("Hand movements", "Easy");
  expect(latest).toMatchObject({
    noteJumps: "large",
    interval: 7,
    handMovements: "easy",
    maxShift: 1,
    shiftFrequency: 0.25,
    fingerSpacing: "hard",
  });
  choose("Hand movements", "Off");
  expect(latest).toMatchObject({
    noteJumps: "large",
    interval: 7,
    handMovements: "off",
    maxShift: 0,
    shiftFrequency: 0,
    fingerSpacing: "hard",
  });
  expect(ui.container.querySelector(".advanced")?.hasAttribute("open")).toBe(
    false,
  );
  expect(ui.queryByRole("dialog")).toBeNull();
  expect(ui.getByRole("button", { name: "Edit range" })).toBeTruthy();
  const before = latest;
  choose("Accidentals", "Hard");
  expect(latest).toEqual({ ...before, accidentals: "hard" });
  choose("Chords", "Medium");
  expect(latest).toEqual({ ...before, accidentals: "hard", chords: "medium" });
});
