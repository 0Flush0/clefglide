import { it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PracticeHints } from "./PracticeHints";
import { defaults } from "../score/model";
import { generate } from "../generation/planner";
it("shows both starting placements in Smart without requiring manual reveal", () => {
  const p = generate({ ...defaults, hand: "both" }, "independent-hands");
  const ui = render(
    <PracticeHints
      initialHands={p.initial.hands}
      firstNotes={p.initial.hands.map((h) =>
        p.events.find((n) => n.hand === h.hand && n.kind === "note")!,
      )}
      positions={p.positions}
      movements={[]}
      settings={p.settings}
      revealed={false}
    />,
  );
  expect(ui.container.textContent).toContain("Right hand: thumb on C4");
  expect(ui.container.textContent).toContain("Left hand: thumb on G3");
  for (const h of p.initial.hands) {
    const first = p.events.find((n) => n.hand === h.hand)!;
    expect(ui.container.textContent).toContain(
      `Start on ${first.pitch} with finger ${first.finger}`,
    );
  }
  ui.rerender(
    <PracticeHints
      initialHands={p.initial.hands}
      firstNotes={p.events}
      positions={p.positions}
      movements={[]}
      settings={{ ...p.settings, hints: "hidden" }}
      revealed={false}
    />,
  );
  expect(ui.container.textContent).not.toMatch(/thumb on|with finger/);
  cleanup();
});
