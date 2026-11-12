import { describe, it, expect } from "vitest";
import { defaults, type MovementPlan } from "./model";
import { positionsFor } from "../generation/positions";
import { generate } from "../generation/planner";
import { validatePhrase } from "../generation/validator";
import { applyHandMovements } from "../practice/presets";
import {
  selectFingeringHints,
  showPlacement,
  visibleMovements,
  nextMovements,
  inferFingeringHints,
} from "./hints";
import { restedAlternatePhrase, spacedPhrase } from "./test-fixtures";
import { Scorer } from "../scoring/engine";
describe("plan-driven Smart hints", () => {
  it.each(["right", "left"] as const)(
    "uses only the required offsets for more complex %s patterns",
    (hand) => {
      for (const pattern of ["indexGap", "twoGaps"]) {
        const p = spacedPhrase(hand, pattern);
        expect(validatePhrase(p)).toEqual([]);
        const hints = selectFingeringHints(p.events, p.positions, [], "smart");
        expect(hints.filter((h) => h.show).map((h) => h.plannedFinger)).toEqual(
          pattern === "indexGap" ? [1, 3] : [1, 2, 3],
        );
        expect(
          hints.filter((h) => h.plannedFinger >= 4).every((h) => !h.show),
        ).toBe(true);
      }
    },
  );
  it("remembers established exceptions when a hand returns to a familiar position", () => {
    const p = spacedPhrase();
    const first = p.initial.hands[0];
    const second = positionsFor({ ...p.settings, max: 84 }, "right").find(
      (h) => h.id === "right-D4-thumbGap",
    )!;
    const base = p.events[0];
    const events = [first, second, first].flatMap((position, bar) =>
      [1, 2].map((finger, i) => ({
        ...base,
        id: `return-${bar}-${finger}`,
        bar,
        onset: i * 480,
        positionId: position.id,
        finger,
        pitch: position.pitches[finger - 1],
        midi: position.fingerToMidi[finger - 1],
      })),
    );
    const movements: MovementPlan[] = [1, 2].map((bar) => ({
      id: `move-${bar}`,
      hand: "right",
      technique: "lift-and-reposition",
      fromPositionId: bar === 1 ? first.id : second.id,
      toPositionId: bar === 1 ? second.id : first.id,
      landingTick: bar * 4 * 480,
      cueTick: bar * 4 * 480 - 480,
      landingNoteId: events[bar * 2].id,
      landingMidi: events[bar * 2].midi,
      landingFinger: 1,
      distance: bar === 1 ? 1 : -1,
    }));
    const hints = selectFingeringHints(
      events,
      [first, second],
      movements,
      "smart",
    );
    expect(hints.map((h) => h.show)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(hints[4].reasons).toContain("position-change");
  });
  it.each(["right", "left", "both"] as const)(
    "shows only the initial finger and first spacing exception for %s",
    (hand) => {
      const p = spacedPhrase(hand);
      expect(validatePhrase(p)).toEqual([]);
      expect(p.movements).toEqual([]);
      const before = structuredClone(p);
      const projection = inferFingeringHints(
        p.events,
        p.positions,
        [],
        "smart",
      );
      for (const position of p.initial.hands) {
        if (position.hand === "right")
          expect(position.pitches).toEqual(["C4", "E4", "F4", "G4", "A4"]);
        else
          expect(position.fingerToMidi).toEqual(
            hand === "both" ? [57, 53, 52, 50, 48] : [69, 65, 64, 62, 60],
          );
        const hints = projection.hints.filter((h) => h.hand === position.hand);
        expect(hints.filter((h) => h.show).map((h) => h.plannedFinger)).toEqual(
          [1, 2],
        );
        expect(hints.slice(0, 5).map((h) => h.show)).toEqual([
          true,
          true,
          false,
          false,
          false,
        ]);
        expect(hints[1].reasons).toEqual(["non-obvious"]);
      }
      expect(p).toEqual(before);
      expect(projection.state).toEqual(p.final.hints);
      for (const mode of ["all", "smart", "hidden"] as const) {
        const next = generate({ ...p.settings, hints: mode }, p.seed, p.final);
        expect(next.initial.hints).toEqual(p.final.hints);
        expect(
          selectFingeringHints(
            next.events,
            next.positions,
            next.movements,
            "smart",
            false,
            next.initial.hints,
          ).every((h) => !h.show),
        ).toBe(true);
      }
    },
  );
  it("retains the same inference after window eviction or splitting before an exception", () => {
    const p = spacedPhrase();
    for (let split = 1; split < p.events.length; split++) {
      const first = inferFingeringHints(
        p.events.slice(0, split),
        p.positions,
        [],
        "smart",
      );
      const next = inferFingeringHints(
        p.events.slice(split),
        p.positions,
        [],
        "smart",
        false,
        first.state,
      );
      expect([...first.hints, ...next.hints]).toEqual(
        selectFingeringHints(p.events, p.positions, [], "smart"),
      );
    }
  });
  it("manual guidance includes the next movement beyond the visible bars", () => {
    const s = {
      ...applyHandMovements(
        { ...defaults, noteJumps: "large" as const, interval: 7, max: 84 },
        "hard",
      ),
      shiftFrequency: 1,
    };
    // Coverage may defer any particular relocation, even at full opportunity
    // frequency. Select the required scenario independently of one seed's plan.
    const p = Array.from({ length: 20 }, (_, i) =>
      generate(s, `future-manual-${i}`),
    ).find((phrase) =>
      phrase.movements.some((m) => m.landingTick >= 3 * s.beats * 480),
    )!;
    expect(p).toBeDefined();
    const later = p.movements.filter((m) => m.landingTick >= 3 * s.beats * 480);
    expect(later.length).toBeGreaterThan(0);
    expect(visibleMovements(later, 0, 2, s.beats)).toEqual([]);
    expect(nextMovements(later, 0, s.beats)).toHaveLength(1);
  });
  it("shows initial placement and first fingers independently for both hands", () => {
    const p = generate({ ...defaults, hand: "both" }, "hands");
    const hints = selectFingeringHints(
      p.events,
      p.positions,
      p.movements,
      "smart",
    );
    expect(showPlacement("smart", false)).toBe(true);
    expect(
      hints.filter((h) => h.reasons.includes("initial")).map((h) => h.hand),
    ).toEqual(["right", "left"]);
    expect(hints.filter((h) => h.show)).toHaveLength(2);
  });
  it("omits natural movement and exposes position/mapping for each note", () => {
    const p = generate(defaults, "natural"),
      hints = selectFingeringHints(p.events, p.positions, p.movements, "smart");
    expect(hints[0].show).toBe(true);
    expect(
      hints
        .slice(1)
        .every(
          (h) =>
            !h.show &&
            !h.nonObvious &&
            h.expectedFinger === h.plannedFinger &&
            h.positionBefore.id === h.position.id,
        ),
    ).toBe(true);
  });
  it("shows E4 finger 2 after C4 finger 1 only with an intentional validated alternative", () => {
    const p = restedAlternatePhrase();
    expect(validatePhrase(p)).toEqual([]);
    const hint = selectFingeringHints(
      p.events,
      p.positions,
      p.movements,
      "smart",
    ).find((h) => h.noteId === "e-index")!;
    expect(hint).toMatchObject({
      plannedFinger: 2,
      expectedFinger: 3,
      nonObvious: true,
      show: true,
      reasons: ["non-obvious"],
    });
    expect(hint.positionBefore.id).toBe(hint.position.id);
    delete p.events.find((n) => n.id === "e-index")!.fingering;
    expect(validatePhrase(p)).toContain(
      "Pitch, spelling or finger violates hand plan.",
    );
  });
  it("rejects alternative fingers without preparation or at beginner difficulty", () => {
    const p = restedAlternatePhrase();
    p.events.find((n) => n.id === "prepare")!.kind = "note";
    expect(validatePhrase(p)).toContain("Invalid rested alternate fingering.");
    const beginner = restedAlternatePhrase();
    beginner.settings.handMovements = "off";
    expect(validatePhrase(beginner)).toContain(
      "Invalid rested alternate fingering.",
    );
  });
  it("shows exact planned landing fingers and exposes upcoming moves before execution", () => {
    const s = {
      ...applyHandMovements(
        {
          ...defaults,
          noteJumps: "large" as const,
          interval: 7,
          max: 84,
          hand: "both",
        },
        "hard",
      ),
      shiftFrequency: 1,
    };
    const p = generate(s, "upcoming"),
      hints = selectFingeringHints(p.events, p.positions, p.movements, "smart");
    expect(p.movements.length).toBeGreaterThan(0);
    for (const m of p.movements) {
      const hint = hints.find((h) => h.noteId === m.landingNoteId)!;
      expect(hint.show).toBe(true);
      expect(hint.reasons).toContain("position-change");
      expect(hint.plannedFinger).toBe(m.landingFinger);
      expect(hint.positionBefore.id).toBe(m.fromPositionId);
      expect(hint.position.id).toBe(m.toPositionId);
      const before = Math.floor(m.cueTick / (s.beats * 480));
      expect(visibleMovements(p.movements, before, 2, s.beats)).toContain(m);
    }
  });
  it("All shows every note; None hides automatic notes and initial guidance", () => {
    const p = generate(defaults, "modes");
    expect(
      selectFingeringHints(p.events, p.positions, p.movements, "all").every(
        (h) => h.show,
      ),
    ).toBe(true);
    expect(
      selectFingeringHints(p.events, p.positions, p.movements, "hidden").every(
        (h) => !h.show,
      ),
    ).toBe(true);
    expect(showPlacement("hidden", false)).toBe(false);
  });
  it("manual reveal exposes full fingering without modifying generation or scoring", () => {
    const p = generate(defaults, "reveal"),
      before = structuredClone(p);
    expect(
      selectFingeringHints(
        p.events,
        p.positions,
        p.movements,
        "hidden",
        true,
      ).every((h) => h.show && h.reasons.includes("manual")),
    ).toBe(true);
    expect(p).toEqual(before);
    const none = generate({ ...defaults, hints: "hidden" }, p.seed);
    expect(none.events).toEqual(p.events);
    expect(none.movements).toEqual(p.movements);
    const a = new Scorer(
        p.events.filter((n) => n.kind === "note"),
        defaults,
      ),
      b = new Scorer(
        none.events.filter((n) => n.kind === "note"),
        none.settings,
      );
    a.start(1);
    b.start(1);
    a.notes.forEach((note, i) => {
      for (const engine of [a, b]) {
        engine.input({
          type: "on",
          pitch: note.midi,
          time: 100 + i * 100,
          velocity: 100,
          source: "simulator",
          channel: 1,
        });
        engine.input({
          type: "off",
          pitch: note.midi,
          time: 110 + i * 100,
          velocity: 0,
          source: "simulator",
          channel: 1,
        });
      }
    });
    expect(a.results).toEqual(b.results);
  });
  it("does not repeat initial finger hints at a continuation boundary", () => {
    const p = generate(defaults, "boundary"),
      next = generate(defaults, p.seed, p.final);
    expect(
      selectFingeringHints(
        next.events,
        next.positions,
        next.movements,
        "smart",
      ).every((h) => !h.show),
    ).toBe(true);
  });
});
