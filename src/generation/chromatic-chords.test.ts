import { expect, it } from "vitest";
import fc from "fast-check";
import { Chord, Note, Scale } from "tonal";
import { defaults, noteheads, type Settings } from "../score/model";
import { generate } from "./planner";
import { validatePhrase } from "./validator";
import { applyHandMovements, jumpLevels } from "./difficulty";
import { diatonicIndex, positionsFor } from "./positions";
import { chordCandidates } from "./chords";
import { inferFingeringHints } from "../score/hints";

it("validates deterministic chromatic/chord phrases across all five dimensions and continuation", () => {
  const level = fc.constantFrom("off", "easy", "medium", "hard" as const);
  fc.assert(
    fc.property(
      fc.integer(),
      level,
      level,
      level,
      level,
      fc.constantFrom("small", "easy", "medium", "large" as const),
      fc.constantFrom("C", "G", "F", "D" as const),
      fc.constantFrom("right", "left", "both" as const),
      (seed, accidentals, chords, spacing, moves, jumps, key, hand) => {
        const s: Settings = applyHandMovements(
          {
            ...defaults,
            hand,
            key,
            accidentals: accidentals as Settings["accidentals"],
            chords: chords as Settings["chords"],
            fingerSpacing: spacing as Settings["fingerSpacing"],
            noteJumps: jumps as Settings["noteJumps"],
            interval: jumpLevels[jumps as Settings["noteJumps"]].interval,
            min: hand === "left" ? 48 : 60,
            max: hand === "left" ? 67 : 79,
            leftMin: 36,
            leftMax: 55,
          },
          moves as Settings["handMovements"],
        );
        const first = generate(s, String(seed)),
          next = generate(s, String(seed), first.final);
        expect(first).toEqual(generate(s, String(seed)));
        expect(next.initial).toEqual(first.final);
        for (const p of [first, next]) {
          expect(validatePhrase(p)).toEqual([]);
          expect(
            inferFingeringHints(
              p.events,
              p.positions,
              p.movements,
              "smart",
              false,
              p.initial.hints,
            ).state,
          ).toEqual(p.final.hints);
          for (const e of p.events) {
            const heads = noteheads(e);
            if (e.kind === "rest") {
              expect(heads).toEqual([]);
              continue;
            }
            expect(new Set(heads.map((n) => n.finger)).size).toBe(heads.length);
            if (chords === "off") expect(heads).toHaveLength(1);
            if (chords === "easy") expect(heads.length).toBeLessThanOrEqual(2);
            if (chords === "medium")
              expect(heads.length).toBeLessThanOrEqual(3);
            expect(
              Math.max(...heads.map((n) => n.midi)) -
                Math.min(...heads.map((n) => n.midi)),
            ).toBeLessThanOrEqual(chords === "easy" ? 7 : 9);
            heads.forEach((n) => {
              expect(Note.midi(n.pitch)).toBe(n.midi);
              expect(n.written).toMatchObject({
                key,
                letter: Note.get(n.pitch).letter,
                accidental: Note.get(n.pitch).acc,
                octave: Note.get(n.pitch).oct,
              });
              if (accidentals === "off")
                expect(Scale.get(`${key} major`).notes).toContain(
                  Note.pitchClass(n.pitch),
                );
            });
          }
        }
        if (moves === "off") {
          expect(
            next.final.hands.map((h) => [h.id, h.fingerToMidi, h.pitchOptions]),
          ).toEqual(
            first.initial.hands.map((h) => [
              h.id,
              h.fingerToMidi,
              h.pitchOptions,
            ]),
          );
          expect([...first.movements, ...next.movements]).toEqual([]);
        }
        const notes = [...first.events, ...next.events].filter(
          (e) => e.kind === "note",
        );
        for (const hand of first.initial.hands) {
          const line = notes.filter((e) => e.hand === hand.hand);
          line
            .slice(1)
            .forEach((e, i) =>
              expect(
                Math.abs(diatonicIndex(e.pitch) - diatonicIndex(line[i].pitch)),
              ).toBeLessThanOrEqual(s.interval),
            );
        }
      },
    ),
    { seed: 20261109, numRuns: 600 },
  );
}, 120000);

it("emits actual chromatic notes, dyads, major/minor triads, inversions and approved four-note voicings", () => {
  const sizes = new Set<number>(),
    qualities = new Set<string>(),
    inversions = new Set<number>(),
    chromatics = new Set<string>();
  for (let seed = 0; seed < 120; seed++) {
    const p = generate(
      {
        ...defaults,
        accidentals: "hard",
        chords: "hard",
        fingerSpacing: "hard",
        noteJumps: "large",
        interval: 7,
        max: 81,
        hand: seed % 2 ? "left" : "right",
      },
      String(seed),
    );
    for (const e of p.events) {
      const heads = noteheads(e);
      sizes.add(heads.length);
      heads
        .filter(
          (n) => !Scale.get("C major").notes.includes(Note.pitchClass(n.pitch)),
        )
        .forEach((n) => chromatics.add(n.pitch));
      if (heads.length === 3) {
        const sorted = [...heads].sort((a, b) => a.midi - b.midi);
        const detected = Chord.detect(
          sorted.map((n) => Note.pitchClass(n.pitch)),
        )[0];
        const chord = Chord.get(detected);
        qualities.add(chord.quality);
        const harmony = p.harmonies[e.bar].split(": ")[1].split(" · ");
        inversions.add(harmony.indexOf(Note.pitchClass(sorted[0].pitch)));
      }
    }
  }
  expect(chromatics.size).toBeGreaterThan(5);
  expect(sizes).toEqual(new Set([0, 1, 2, 3, 4]));
  expect(qualities).toContain("Major");
  expect(qualities).toContain("Minor");
  expect([...inversions].some((i) => i > 0)).toBe(true);
});

it("plans a black key under finger 4 without a shift and rejects corrupted chords or spelling", () => {
  const s: Settings = {
    ...defaults,
    accidentals: "hard",
    chords: "hard",
    noteJumps: "large",
    interval: 7,
  };
  const pos = positionsFor(s, "right")[0];
  expect(pos.pitchOptions?.[3]).toContain("F#4");
  const p = generate(s, "corruption");
  for (const corrupt of [
    (q: typeof p) => {
      const e = q.events.find((e) => e.kind === "note")!;
      e.notes![0].written!.letter = "B";
    },
    (q: typeof p) => {
      const e = q.events.find((e) => e.kind === "note")!;
      e.notes!.push({
        ...e.notes![0],
        id: "duplicate-finger",
        midi: 72,
        pitch: "C5",
      });
    },
    (q: typeof p) => {
      q.positions[0].pitchOptions![3].push("G#4");
    },
    (q: typeof p) => {
      q.final.hands[0].resolutionPitch = "C9";
    },
  ]) {
    const q = structuredClone(p);
    corrupt(q);
    expect(validatePhrase(q).length).toBeGreaterThan(0);
  }
});

it("derives root triads and inversions from harmony rather than arbitrary pitch subsets", () => {
  const s: Settings = {
    ...defaults,
    chords: "hard",
    fingerSpacing: "hard",
    max: 81,
    noteJumps: "large",
    interval: 7,
  };
  const shapes = positionsFor(s, "right");
  for (const harmony of [
    ["C", "E", "G"],
    ["D", "F", "A"],
  ]) {
    const candidates = shapes.flatMap((pos) =>
      pos.fingerToMidi.flatMap((midi, i) =>
        chordCandidates(
          {
            id: "e",
            kind: "note",
            midi,
            pitch: pos.pitches.find((p) => Note.midi(p) === midi)!,
            finger: i + 1,
            hand: "right",
            positionId: pos.id,
            bar: 0,
            onset: 0,
            duration: 480,
            action: "PLAY_WITHIN_POSITION",
          },
          pos,
          s,
          harmony,
        ),
      ),
    );
    const triads = candidates
      .filter((ns) => ns.length === 3)
      .map((ns) => [...ns].sort((a, b) => a.midi - b.midi));
    expect(
      triads.some((ns) => Note.pitchClass(ns[0].pitch) === harmony[0]),
    ).toBe(true);
    expect(
      triads.some((ns) => Note.pitchClass(ns[0].pitch) !== harmony[0]),
    ).toBe(true);
  }
});
