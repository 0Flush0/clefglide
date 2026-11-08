import { it, expect } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { MidiBus } from "../midi/adapter";
import { Scorer } from "../scoring/engine";
import { defaults } from "../score/model";
import { generate } from "../generation/planner";
it("virtual input drives a complete generated phrase through the shared scorer", () => {
  const phrase = generate(defaults, "integration");
  const engine = new Scorer(
    phrase.events.filter((e) => e.kind === "note"),
    defaults,
  );
  const bus = new MidiBus();
  const unsubscribe = bus.subscribe((e) => engine.input(e));
  engine.start(performance.now());
  const notes = [...engine.notes];
  const ui = render(
    <button
      onClick={() => {
        const pitch = engine.target.midi;
        bus.virtual(pitch, "on");
        bus.virtual(pitch, "off");
      }}
    >
      Play virtual key
    </button>,
  );
  for (const _note of notes) fireEvent.click(ui.getByText("Play virtual key"));
  expect(engine.results.filter((r) => r.kind === "correct")).toHaveLength(
    notes.length,
  );
  expect(engine.index).toBe(notes.length);
  unsubscribe();
  cleanup();
});
