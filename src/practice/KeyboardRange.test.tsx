import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useState } from "react";
import { defaults, type Settings } from "../score/model";
import { LanguageContext } from "../shared/i18n";
import { PracticeSettings } from "./PracticeSettings";

beforeEach(() => {
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
});
afterEach(cleanup);

function setup(settings = defaults, language: "en" | "de" = "en") {
  let latest = settings;
  const ui = render(
    <LanguageContext.Provider value={language}>
      <Harness />
    </LanguageContext.Provider>,
  );
  function Harness() {
    const [draft, update] = useState(settings);
    latest = draft;
    return (
      <PracticeSettings
        draft={draft}
        onChange={update}
        onApply={() => {}}
        onHints={() => {}}
        onSeed={() => {}}
        seed="range"
        pending
        assistanceUsed
      >
        {null}
      </PracticeSettings>
    );
  }
  return {
    ui,
    latest: () => latest,
    open: () => {
      fireEvent.click(
        ui.getByRole("button", {
          name: language === "de" ? "Bereich bearbeiten" : "Edit range",
        }),
      );
      return within(ui.getByRole("dialog"));
    },
  };
}

it("selects white and black endpoints with staged Apply and Cancel", () => {
  const { ui, open, latest } = setup();
  expect(ui.queryByRole("dialog")).toBeNull();
  const dialog = open();
  const piano = within(dialog.getByRole("group", { name: "Piano keyboard" }));
  expect(piano.getAllByRole("button")).toHaveLength(88);
  expect(piano.getByRole("button", { name: "A0" })).toBeTruthy();
  expect(piano.getByRole("button", { name: "C8" })).toBeTruthy();
  fireEvent.click(piano.getByRole("button", { name: "Db4" }));
  expect(
    dialog
      .getByRole("button", { name: "Highest note · G4" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    (dialog.getByRole("button", { name: "Apply" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(dialog.getByRole("alert").textContent).toContain("five consecutive");
  fireEvent.click(piano.getByRole("button", { name: "C5" }));
  expect(
    piano.getByRole("button", { name: "Db4" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    piano.getByRole("button", { name: "C4" }).getAttribute("aria-pressed"),
  ).toBe("false");
  expect(latest()).toEqual(defaults);
  fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
  expect(latest()).toEqual({ ...defaults, min: 61, max: 72 });
  expect(ui.queryByRole("dialog")).toBeNull();
  const reopened = open();
  fireEvent.click(
    within(reopened.getByRole("group", { name: "Piano keyboard" })).getByRole(
      "button",
      { name: "A0" },
    ),
  );
  fireEvent.click(reopened.getByRole("button", { name: "Cancel" }));
  expect(latest()).toMatchObject({ min: 61, max: 72 });
});

it("preserves independent edits through hand switches and accepts overlapping ranges", () => {
  const { ui, open, latest } = setup({ ...defaults, hand: "both" });
  const dialog = open();
  const piano = within(dialog.getByRole("group", { name: "Piano keyboard" }));
  fireEvent.click(dialog.getByRole("button", { name: "Left hand · C3–G3" }));
  fireEvent.click(piano.getByRole("button", { name: "C3" }));
  fireEvent.click(piano.getByRole("button", { name: "C5" }));
  fireEvent.click(dialog.getByRole("button", { name: "Right hand · C4–G4" }));
  fireEvent.click(piano.getByRole("button", { name: "C4" }));
  fireEvent.click(piano.getByRole("button", { name: "C6" }));
  fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
  const expected: Settings = {
    ...defaults,
    hand: "both",
    leftMin: 48,
    leftMax: 72,
    min: 60,
    max: 84,
  };
  expect(latest()).toEqual(expected);
  for (const hand of ["left", "right", "both"]) {
    fireEvent.change(ui.getByLabelText("Hands"), { target: { value: hand } });
    expect(latest()).toEqual({ ...expected, hand });
    const overview = ui.container.querySelector(".keyboard-range")!;
    expect(overview.querySelectorAll(".range-label")).toHaveLength(
      hand === "both" ? 2 : 1,
    );
    if (hand !== "both")
      expect(overview.textContent).toContain(
        hand === "left" ? "C3–C5" : "C4–C6",
      );
  }
});

it("blocks colliding positions without prohibiting every overlapping range", () => {
  const { open } = setup({ ...defaults, hand: "both" });
  const dialog = open();
  fireEvent.click(dialog.getByRole("button", { name: "Left hand · C3–G3" }));
  const piano = within(dialog.getByRole("group", { name: "Piano keyboard" }));
  fireEvent.click(piano.getByRole("button", { name: "C4" }));
  fireEvent.click(piano.getByRole("button", { name: "G4" }));
  expect(dialog.getByRole("alert").textContent).toContain(
    "No separate hand positions",
  );
  expect(
    (dialog.getByRole("button", { name: "Apply" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("supports arrow/Home/End navigation with one key in the tab order", () => {
  const { open } = setup();
  const dialog = open();
  const piano = within(dialog.getByRole("group", { name: "Piano keyboard" }));
  const c = piano.getByRole("button", { name: "C4" });
  c.focus();
  fireEvent.keyDown(c, { key: "ArrowRight" });
  expect(document.activeElement).toBe(
    piano.getByRole("button", { name: "Db4" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(
    piano.getByRole("button", { name: "A0" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement).toBe(
    piano.getByRole("button", { name: "C8" }),
  );
  expect(
    piano.getAllByRole("button").filter((b) => b.tabIndex === 0),
  ).toHaveLength(1);
});

it("translates dialog controls and actionable feedback into German", () => {
  const { open } = setup(defaults, "de");
  const dialog = open();
  expect(
    dialog.getByRole("heading", { name: "Tastaturbereich bearbeiten" }),
  ).toBeTruthy();
  expect(
    dialog.getByRole("button", { name: "Tiefste Note · C4" }),
  ).toBeTruthy();
  fireEvent.click(
    within(dialog.getByRole("group", { name: "Klaviertastatur" })).getByRole(
      "button",
      { name: "G4" },
    ),
  );
  expect(dialog.getByRole("alert").textContent).toContain(
    "Rechte Hand: Wähle einen Bereich",
  );
  expect(dialog.getByRole("button", { name: "Übernehmen" })).toBeTruthy();
  expect(dialog.getByRole("button", { name: "Abbrechen" })).toBeTruthy();
});
