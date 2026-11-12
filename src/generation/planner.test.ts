import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Note } from "tonal";
import { defaults, type Settings } from "../score/model";
import { generate } from "./planner";
import { validatePhrase } from "./validator";
import {
  applyHandMovements,
  applyNoteJumps,
  jumpLevels,
} from "../practice/presets";
import { inferFingeringHints, selectFingeringHints } from "../score/hints";
import {
  movementRules,
  positionsFor,
  rangeSummary,
  diatonicIndex,
} from "./positions";
describe("trusted five-finger planner", () => {
  it("validates 10,000 seeded phrases and 10,000 continuation boundaries", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.constantFrom("right", "left", "both"),
        fc.constantFrom("C", "G", "F", "D"),
        fc.constantFrom(3, 4),
        fc.constantFrom("gentle", "quarters", "mixed"),
        fc.constantFrom("off", "easy", "medium", "hard"),
        fc.integer({ min: 9, max: 19 }),
        fc.integer({ min: 0, max: 2 }),
        fc.constantFrom(0, 0.25, 0.6, 1),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 1, max: 7 }),
        fc.constantFrom("off", "easy", "medium", "hard"),
        fc.constantFrom("small", "easy", "medium", "large"),
        (
          seed,
          hand,
          key,
          beats,
          rhythm,
          difficulty,
          width,
          register,
          frequency,
          distance,
          interval,
          fingerSpacing,
          noteJumps,
        ) => {
          const s: Settings = applyHandMovements(
            {
              ...defaults,
              fingerSpacing: fingerSpacing as Settings["fingerSpacing"],
              hand: hand as Settings["hand"],
              key: key as Settings["key"],
              beats: beats as 3 | 4,
              rhythm: rhythm as Settings["rhythm"],
              min: 60 + register * 6,
              max: 60 + register * 6 + width,
              leftMin: 36 + register * 6,
              leftMax: 36 + register * 6 + width,
            },
            difficulty as Settings["handMovements"],
          );
          s.shiftFrequency = difficulty === "off" ? 0 : frequency;
          s.maxShift = Math.min(
            distance,
            movementRules[s.handMovements].distance,
          );
          s.noteJumps = noteJumps as Settings["noteJumps"];
          s.interval = Math.min(interval, jumpLevels[s.noteJumps].interval);
          const p = generate(s, String(seed)),
            next = generate(s, String(seed), p.final);
          expect(validatePhrase(p)).toEqual([]);
          expect(validatePhrase(next)).toEqual([]);
          expect(next.initial).toEqual(p.final);
          const firstHints = inferFingeringHints(
            p.events,
            p.positions,
            p.movements,
            "smart",
            false,
            p.initial.hints,
          );
          const nextHints = inferFingeringHints(
            next.events,
            next.positions,
            next.movements,
            "smart",
            false,
            next.initial.hints,
          );
          expect(firstHints.state).toEqual(p.final.hints);
          expect(nextHints.state).toEqual(next.final.hints);
          const musicalHints = (
            hints: ReturnType<typeof selectFingeringHints>,
          ) =>
            hints.map(
              ({ noteId, hand, plannedFinger, nonObvious, reasons, show }) => ({
                noteId,
                hand,
                plannedFinger,
                nonObvious,
                reasons,
                show,
              }),
            );
          expect(
            musicalHints(
              selectFingeringHints(
                [...p.events, ...next.events],
                [...p.positions, ...next.positions],
                [...p.movements, ...next.movements],
                "smart",
              ),
            ),
          ).toEqual(musicalHints([...firstHints.hints, ...nextHints.hints]));
          expect(generate(s, String(seed))).toEqual(p);
          expect(generate(s, String(seed), p.final)).toEqual(next);
          if (s.handMovements === "off") {
            expect(p.movements).toHaveLength(0);
            expect(next.movements).toHaveLength(0);
            expect(next.final.hands.map((h) => h.fingerToMidi)).toEqual(
              p.initial.hands.map((h) => h.fingerToMidi),
            );
          }
          for (const phrase of [p, next])
            for (const move of phrase.movements) {
              expect(move.cueTick).toBe(move.landingTick - 480);
              expect(move.landingTick).toBeGreaterThan(
                phrase.initial.bar * s.beats * 480,
              );
              const note = phrase.events.find(
                (n) => n.id === move.landingNoteId,
              )!;
              expect(note.finger).toBe(move.landingFinger);
              expect(note.midi).toBe(move.landingMidi);
            }
          expect(
            p.events
              .filter((e) => e.kind === "note")
              .every(
                (e) =>
                  e.finger >= 1 &&
                  e.finger <= 5 &&
                  Note.midi(e.pitch) === e.midi,
              ),
          ).toBe(true);
        },
      ),
      { numRuns: 10000, seed: 20261108 },
    );
  }, 180000);
  it("has progressively more actual shifts and honors a zero frequency", () => {
    const counts: number[] = [];
    const distances = new Set<number>();
    for (const level of ["off", "easy", "medium", "hard"] as const) {
      let count = 0;
      for (let seed = 0; seed < 300; seed++) {
        const s = applyHandMovements({ ...defaults, min: 60, max: 84 }, level),
          p = generate(s, String(seed));
        count += p.movements.length;
        if (level === "hard")
          p.movements.forEach((m) => distances.add(Math.abs(m.distance)));
        expect(
          generate({ ...s, shiftFrequency: 0 }, String(seed)).movements,
        ).toHaveLength(0);
      }
      counts.push(count);
    }
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[3]).toBeGreaterThan(counts[2]);
    expect(distances.has(4)).toBe(true);
  });
  it("rotates valid initial positions, explains a single position and preserves range when applying presets", () => {
    const s = { ...defaults, min: 62, max: 81 };
    const starts = new Set(
      Array.from(
        { length: 30 },
        (_, i) => generate(s, String(i)).initial.hands[0].id,
      ),
    );
    expect(starts.size).toBeGreaterThan(4);
    expect([...starts].some((x) => x.endsWith("C4"))).toBe(false);
    expect(rangeSummary(defaults)).toContain(
      "Only one hand position fits this range.",
    );
    expect(positionsFor(defaults, "right")).toHaveLength(1);
    expect(applyHandMovements(s, "hard")).toMatchObject({ min: 62, max: 81 });
  });
  it("distinguishes large in-position intervals from repositioning", () => {
    const s = { ...defaults, noteJumps: "medium" as const, interval: 4 };
    const p = generate(s, "large-in-position");
    expect(p.movements).toHaveLength(0);
    expect(p.events.every((e) => e.positionId === p.initial.hands[0].id)).toBe(
      true,
    );
  });
  it("independently rejects missing, late, wrong-finger and unprepared movement plans", () => {
    const s = {
      ...applyHandMovements(
        { ...defaults, noteJumps: "large" as const, interval: 7, max: 84 },
        "hard",
      ),
      shiftFrequency: 1,
    };
    const p = Array.from({ length: 20 }, (_, i) => generate(s, String(i))).find(
      (p) => p.movements.length > 0,
    )!;
    for (const corrupt of [
      (q: typeof p) => {
        q.movements.shift();
      },
      (q: typeof p) => {
        q.movements[0].cueTick = q.movements[0].landingTick;
      },
      (q: typeof p) => {
        q.movements[0].landingFinger = 9;
      },
      (q: typeof p) => {
        q.movements[0].distance = 99;
      },
      (q: typeof p) => {
        const m = q.movements[0];
        q.events.find(
          (e) =>
            e.hand === m.hand && e.bar * s.beats * 480 + e.onset === m.cueTick,
        )!.kind = "note";
      },
      (q: typeof p) => {
        q.final.hands[0].id = "unannounced";
      },
    ]) {
      const q = structuredClone(p);
      corrupt(q);
      expect(validatePhrase(q).length).toBeGreaterThan(0);
    }
  });
  it("reproduces notation and fingering across chunk boundaries", () => {
    const a = generate(defaults, "fixed"),
      b = generate(defaults, "fixed");
    expect(a).toEqual(b);
    expect(generate(defaults, "fixed", a.final)).toEqual(
      generate(defaults, "fixed", b.final),
    );
  });
  it("rejects impossible ranges quickly", () => {
    expect(() => generate({ ...defaults, max: 62 }, "x")).toThrow(
      /five consecutive/,
    );
    // Regression from property seed 20261108: F#4–C#5 contains only
    // G/A/B/C in C major despite spanning seven semitones.
    expect(() => generate({ ...defaults, min: 66, max: 73 }, "0")).toThrow(
      /five consecutive/,
    );
  });
  it("uses C4 for MIDI 60 and changes pitch with register", () => {
    const a = generate(defaults, "x"),
      b = generate({ ...defaults, min: 72, max: 79, rhClef: "bass" }, "x");
    expect(a.initial.hands[0].pitches[0]).toBe("C4");
    expect(b.initial.hands[0].pitches[0]).toBe("C5");
    expect(b.initial.hands[0].clef).toBe("bass");
  });
  it("bounds invalid range previews and rejects shifts in Very Easy", () => {
    expect(positionsFor({ ...defaults, max: 1e12 }, "right")).toEqual([]);
    expect(() => generate({ ...defaults, shiftFrequency: 1 }, "bad")).toThrow(
      /Off/,
    );
    const p = generate({ ...defaults, hand: "both" }, "missing-hand");
    p.initial.hands.pop();
    expect(validatePhrase(p)).toContain("Missing or unexpected hand state.");
  });
  it("validator catches finger, time, pitch and boundary corruption independently", () => {
    const p = generate(defaults, "a");
    p.events[0].finger = 5;
    p.events[0].midi = 1;
    p.events[0].duration = 1;
    p.final.hands[0].fingerToMidi[0] = 2;
    p.final.bar = 9;
    expect(validatePhrase(p).length).toBeGreaterThanOrEqual(4);
  });
  it("spells F sharp in G major and B flat in F major", () => {
    for (const key of ["G", "F"] as const) {
      const candidates = positionsFor(
        { ...defaults, key, min: 60, max: 77 },
        "right",
      );
      expect(
        candidates.some((p) =>
          p.pitches.some((x) => x.includes(key === "G" ? "F#" : "Bb")),
        ),
      ).toBe(true);
    }
  });
  it("changes each dimension without rewriting either other dimension or range", () => {
    const base: Settings = {
      ...defaults,
      min: 60,
      max: 84,
      fingerSpacing: "hard",
    };
    expect(applyNoteJumps(base, "large")).toEqual({
      ...base,
      noteJumps: "large",
      interval: 7,
    });
    expect(applyHandMovements(base, "hard")).toEqual({
      ...base,
      handMovements: "hard",
      shiftFrequency: 0.85,
      maxShift: 4,
    });
    for (const noteJumps of Object.keys(
      jumpLevels,
    ) as Settings["noteJumps"][]) {
      const s = applyNoteJumps(base, noteJumps);
      for (let seed = 0; seed < 30; seed++) {
        const p = generate(s, `independent-${seed}`);
        expect(p.movements).toEqual([]);
        if (noteJumps === "small") {
          const notes = p.events.filter((e) => e.kind === "note");
          const position = p.initial.hands[0];
          const first = position.pitches.indexOf(notes[0].pitch);
          expect(
            [first - 1, first + 1].some(
              (i) =>
                i >= 0 &&
                i < 5 &&
                Math.abs(
                  diatonicIndex(position.pitches[i]) -
                    diatonicIndex(notes[0].pitch),
                ) <= 1,
            ),
          ).toBe(true);
        }
        expect(p.positions.every((h) => h.id === p.initial.hands[0].id)).toBe(
          true,
        );
      }
    }
    expect(
      positionsFor({ ...base, fingerSpacing: "off" }, "right").every((p) =>
        p.pitches.every(
          (pitch, i) =>
            i === 0 ||
            diatonicIndex(pitch) - diatonicIndex(p.pitches[i - 1]) === 1,
        ),
      ),
    ).toBe(true);
  });
  it("generates progressively more varied spacing and more melodic leaps independently", () => {
    const counts: number[] = [];
    const patterns = new Set<string>();
    for (const fingerSpacing of ["off", "easy", "medium", "hard"] as const) {
      let count = 0;
      for (let seed = 0; seed < 150; seed++) {
        const p = generate(
          { ...defaults, max: 84, fingerSpacing },
          `spacing-distribution-${seed}`,
        );
        const signature = p.initial.hands[0].pitches
          .map(diatonicIndex)
          .map((n, i, ns) => n - ns[0])
          .join(",");
        patterns.add(signature);
        if (signature !== "0,1,2,3,4") count++;
        expect(p.movements).toEqual([]);
      }
      counts.push(count);
    }
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(0);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[3]).toBeGreaterThan(counts[2]);
    expect(patterns).toEqual(
      new Set(["0,1,2,3,4", "0,2,3,4,5", "0,1,3,4,5", "0,2,4,5,6"]),
    );
    const leaps: number[] = [];
    for (const noteJumps of ["small", "easy", "medium", "large"] as const) {
      let count = 0;
      for (let seed = 0; seed < 100; seed++) {
        const s = applyNoteJumps(
          { ...defaults, max: 84, fingerSpacing: "hard" },
          noteJumps,
        );
        const p = generate(s, `jump-distribution-${seed}`);
        const comparison = generate(applyNoteJumps(s, "easy"), p.seed);
        expect(p.positions).toEqual(comparison.positions);
        expect(p.movements).toEqual([]);
        const notes = p.events.filter((e) => e.kind === "note");
        count += notes
          .slice(1)
          .filter(
            (e, i) =>
              Math.abs(diatonicIndex(e.pitch) - diatonicIndex(notes[i].pitch)) >
              1,
          ).length;
      }
      leaps.push(count);
    }
    expect(leaps[0]).toBe(0);
    expect(leaps[1]).toBeGreaterThan(0);
    expect(leaps[2]).toBeGreaterThan(leaps[1]);
    expect(leaps[3]).toBeGreaterThan(leaps[2]);
  });
  it("independently rejects unsupported spacing, excessive spans and spacing when Off", () => {
    const s: Settings = { ...defaults, max: 84, fingerSpacing: "hard" };
    const p = Array.from({ length: 30 }, (_, seed) =>
      generate(s, `ergonomics-${seed}`),
    ).find((p) => p.initial.hands[0].id.endsWith("-thumbGap"))!;
    expect(p).toBeDefined();
    const off = structuredClone(p);
    off.settings.fingerSpacing = "off";
    expect(validatePhrase(off)).toContain(
      "Unapproved or excessive finger spacing.",
    );
    const excessive = structuredClone(p);
    excessive.positions[0].pitches[4] = "C6";
    excessive.positions[0].fingerToMidi[4] = 84;
    expect(validatePhrase(excessive)).toContain(
      "Unapproved or excessive finger spacing.",
    );
    expect(rangeSummary({ ...defaults, fingerSpacing: "hard" })).toContain(
      "No approved spacing pattern fits; conventional spacing will be used.",
    );
  });
});
