import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { defaultPractice } from "./configuration";
import { PracticeSettings } from "./PracticeSettings";

it("keeps controls compact, stages validated parameters, and preserves the scoring mode", () => {
  function Harness() {
    const [draft, onChange] = useState({
      ...defaultPractice,
      options: { ...defaultPractice.options, mode: "timed" as const },
    });
    return (
      <PracticeSettings
        draft={draft}
        onChange={(setup) =>
          onChange({ ...setup, options: { ...setup.options, mode: "timed" } })
        }
        onProfile={(profile) => onChange({ ...draft, profile })}
        onSeed={() => {}}
        onHints={() => {}}
        onApply={() => {}}
        seed="test"
        pending
        assistanceUsed={false}
      >
        {null}
      </PracticeSettings>
    );
  }

  const ui = render(<Harness />);
  expect(ui.getByRole("button", { name: "Edit range" })).toBeTruthy();
  expect(ui.getByText("Advanced settings").closest("details")?.open).toBe(
    false,
  );
  expect(ui.queryByLabelText("GeneratorConfig JSON")).toBeNull();
  fireEvent.change(ui.getByLabelText("Practice profile"), {
    target: { value: "custom" },
  });
  fireEvent.click(ui.getByText("Generator parameters", { exact: true }));
  const editor = ui.getByLabelText(
    "GeneratorConfig JSON",
  ) as HTMLTextAreaElement;
  const apply = ui.getByRole("button", { name: "Use parameters" });
  fireEvent.change(editor, { target: { value: "{}" } });
  fireEvent.click(apply);
  expect(ui.getByRole("alert").textContent).toContain(
    "Invalid generator configuration",
  );
  const config = JSON.parse(JSON.stringify(defaultPractice.config));
  config.hands.right.max = 84;
  fireEvent.change(editor, { target: { value: JSON.stringify(config) } });
  fireEvent.click(apply);
  expect(ui.queryByRole("alert")).toBeNull();
  expect(JSON.parse(editor.value).hands.right.max).toBe(84);
  expect((ui.getByLabelText("Scoring mode") as HTMLSelectElement).value).toBe(
    "timed",
  );
});
