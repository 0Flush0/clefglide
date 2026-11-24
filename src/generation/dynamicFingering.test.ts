import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { defaults, isContinuousMovement, noteheads } from "../score/model";
import { lifetimeNotes } from "../score/lifetimes";
import { selectFingeringHints } from "../score/hints";
import {
  generateConfigured,
  GeneratorConfigurationError,
  GeneratorContextInfeasibleError,
  GeneratorSearchExhaustedError,
  validateGeneratedPhrase,
} from "./index";
import { dynamicFingeringExample } from "./examples";
import {
  chordDefaults,
  chromaticDefaults,
  durationEvaluationDefaults,
  noteLifetimeDefaults,
  repositionDefaults,
  tieDefaults,
  wideLeapDefaults,
} from "./config";
import { Scorer } from "../scoring/engine";
import { eventTick } from "./fingeringTimeline";

const attacks = [
  "thumb-under",
  "finger-over",
  "continuous-shift",
  "adjacent-reach",
  "rested-alternate",
] as const;
const tags = (p: ReturnType<typeof generateConfigured>) =>
  p.events
    .flatMap(noteheads)
    .flatMap((n) =>
      [n.fingering?.technique, n.substitution?.technique].filter(Boolean),
    );

describe("opt-in dynamic fingering", () => {
  it.each([...attacks, "substitution"] as const)(
    "generates %s for each hand",
    (technique) => {
      for (const hand of ["right", "left"] as const) {
        const c = dynamicFingeringExample([technique], {
          hands: { active: hand },
        });
        let found = false;
        for (let seed = 0; seed < 36 && !found; seed++) {
          const p = generateConfigured(c, `example-${seed}`);
          expect(p.version).toBe("11.0.0");
          expect(validateGeneratedPhrase(p)).toEqual([]);
          found =
            p.movements.some((m) => m.technique === technique) ||
            tags(p).some((tag) => tag === technique);
        }
        expect(found, hand).toBe(true);
      }
    },
  );

  it("retains deterministic contact plans and explicit cue sources across chunks", () => {
    const c = dynamicFingeringExample(attacks.slice(0, 4), {
      hands: { active: "both" },
      notation: { key: "G" },
    });
    let boundary = false,
      blackKey = false,
      reversal = false;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), (n) => {
        const seed = `stream-${n}`;
        const p = generateConfigured(c, seed);
        const q = generateConfigured(c, seed, p.final);
        expect(q).toEqual(generateConfigured(c, seed, p.final));
        expect(q.initial).toEqual(p.final);
        expect(validateGeneratedPhrase(q)).toEqual([]);
        const moves = [...p.movements, ...q.movements].filter(
          isContinuousMovement,
        );
        for (const hand of ["left", "right"]) {
          const directions = new Set(
            moves
              .filter((m) => m.hand === hand)
              .map((m) => Math.sign(m.distance)),
          );
          reversal ||= directions.size === 2;
        }
        boundary ||= moves.some(
          (m) =>
            m.cueTick < p.final.bar * c.notation.beats * 480 &&
            m.landingTick === p.final.bar * c.notation.beats * 480,
        );
        blackKey ||= moves.some(
          (m) =>
            [1, 3, 6, 8, 10].includes(m.source.midi % 12) ||
            [1, 3, 6, 8, 10].includes(m.landingMidi % 12),
        );
      }),
      { seed: 759, numRuns: 45 },
    );
    expect(boundary).toBe(true);
    expect(blackKey).toBe(true);
    expect(reversal).toBe(true);
  });

  it("rejects corrupted movement contacts, sequence memory and held-key handoffs", () => {
    const c = dynamicFingeringExample([...attacks, "substitution"]);
    const phrases = Array.from({ length: 14 }, (_, n) =>
      generateConfigured(c, `invalid-${n}`),
    );
    const movement = structuredClone(
      phrases.find((p) => p.movements.some(isContinuousMovement))!,
    );
    movement.movements.find(isContinuousMovement)!.source.finger = 5;
    expect(validateGeneratedPhrase(movement)).toContain(
      "Invalid continuous fingering movement, source or clearance.",
    );
    const memory = structuredClone(phrases[0]);
    memory.final.dynamicFingering!.spans.shift();
    expect(validateGeneratedPhrase(memory)).toContain(
      "Final dynamic fingering memory differs from the plan.",
    );
    const substitution = structuredClone(
      phrases.find((p) => tags(p).includes("substitution"))!,
    );
    const n = substitution.events
      .flatMap(noteheads)
      .find((n) => n.substitution)!;
    const lifetimes = lifetimeNotes(substitution.events);
    const hints = selectFingeringHints(
      substitution.events,
      substitution.positions,
      substitution.movements,
      "smart",
    );
    expect(hints.find((hint) => hint.noteId === n.id)).toMatchObject({
      show: true,
      substitution: n.substitution,
    });
    n.substitution!.endTick = n.lifetime!.releaseTick;
    expect(lifetimeNotes(substitution.events)).toEqual(lifetimes);
    expect(validateGeneratedPhrase(substitution)).toContain(
      "Invalid finger substitution, held tone or transfer window.",
    );
  });

  it("composes independent holds, chromatic vocabulary, chords and tied transfers", () => {
    const c = dynamicFingeringExample(
      ["substitution", "thumb-under", "finger-over"],
      {
        hands: { active: "both" },
        notation: {
          voices: "independent",
          ties: {
            ...tieDefaults,
            probability: 1,
            patterns: [{ value: "subdivide", weight: 1 }],
            chordTones: "all",
          },
        },
        independentVoices: {
          right: { voices: [{}, { activity: 0.3, fingers: [5] }] },
          left: { voices: [{ durations: [{ value: 480, weight: 1 }] }] },
        },
        noteLifetimes: noteLifetimeDefaults,
        chromatic: chromaticDefaults,
        chords: { ...chordDefaults, probability: 0.6 },
      },
    );
    let tiedTransfer = false,
      chord = false,
      crossing = false,
      secondVoice = false;
    for (let n = 0; n < 30; n++) {
      const p = generateConfigured(c, `polyphony-${n}`);
      expect(validateGeneratedPhrase(p)).toEqual([]);
      const heads = p.events.flatMap(noteheads);
      tiedTransfer ||= heads.some(
        (h) => h.substitution && h.tie && h.tie.index === h.tie.count - 1,
      );
      chord ||= p.events.some((e) => noteheads(e).length > 1);
      crossing ||= p.movements.some(isContinuousMovement);
      secondVoice ||= p.events.some(
        (e) => e.voiceId === "right:2" && e.kind === "note",
      );
      if (tiedTransfer && chord && crossing && secondVoice) break;
    }
    expect({ tiedTransfer, chord, crossing, secondVoice }).toEqual({
      tiedTransfer: true,
      chord: true,
      crossing: true,
      secondVoice: true,
    });
  });

  it("keeps stable dyads and prepared relocations available in a dynamic stream", () => {
    const c = dynamicFingeringExample(["substitution", "continuous-shift"], {
      hands: { right: { max: 96 } },
      rhythm: { breathBeats: 2 },
      melody: { maxIntervalSteps: 4 },
      movement: { ...repositionDefaults, probability: 1 },
      wideLeaps: { ...wideLeapDefaults, probability: 1, eligibleBars: [0] },
      harmony: { progressions: [{ value: [1, 1, 1, 1], weight: 1 }] },
      chords: { ...chordDefaults, probability: 0.8 },
    });
    let stableDyad = false,
      continuous = false,
      small = false,
      wide = false;
    for (let n = 0; n < 24; n++) {
      const seed = `dyad-${n}`;
      const first = generateConfigured(c, seed);
      const second = generateConfigured(c, seed, first.final);
      for (const p of [first, second]) {
        expect(validateGeneratedPhrase(p)).toEqual([]);
        stableDyad ||= p.events.some(
          (e) =>
            noteheads(e).length === 2 &&
            noteheads(e).some((h) => h.substitution),
        );
        continuous ||= p.movements.some(isContinuousMovement);
        small ||= p.movements.some(
          (m) => m.technique === "lift-and-reposition",
        );
        wide ||= p.movements.some((m) => m.technique === "lifted-wide-leap");
      }
      if (stableDyad && continuous && small && wide) break;
    }
    expect({ stableDyad, continuous, small, wide }).toEqual({
      stableDyad: true,
      continuous: true,
      small: true,
      wide: true,
    });
  });

  it("scores one simulated MIDI attack and release through a tied substitution", () => {
    const c = dynamicFingeringExample(["substitution"], {
      notation: {
        ties: {
          ...tieDefaults,
          probability: 1,
          patterns: [{ value: "subdivide", weight: 1 }],
        },
      },
      noteLifetimes: {
        ...noteLifetimeDefaults,
        evaluation: {
          ...durationEvaluationDefaults,
          waitMode: "performed-duration",
        },
      },
    });
    const p = Array.from({ length: 10 }, (_, n) =>
      generateConfigured(c, `midi-${n}`),
    ).find((phrase) =>
      phrase.events.flatMap(noteheads).some((n) => n.tie && n.substitution),
    )!;
    const note = p.events
      .flatMap(noteheads)
      .find((n) => n.tie && n.substitution)!;
    const chain = p.events.filter(
      (e) => e.tie?.lifetimeId === note.tie!.lifetimeId,
    );
    const bpm = c.dynamicFingering!.tempoBpm;
    const scorer = new Scorer(chain, { ...defaults, bpm }, 120, c);
    const input = { pitch: note.midi, channel: 1, source: "simulator" as const };
    scorer.start(0);
    scorer.input({ ...input, type: "on", time: 0, velocity: 90 });
    scorer.tick(
      (((note.substitution!.endTick - eventTick(chain[0], c)) / 480) * 60_000) /
        bpm,
    );
    expect(scorer.notes).toHaveLength(1);
    expect(scorer.durationResults[0].status).toBe("pending");
    scorer.input({
      ...input,
      type: "off",
      time: ((note.lifetime!.durationTicks / 480) * 60_000) / bpm,
      velocity: 0,
    });
    expect(scorer.results).toHaveLength(1);
    expect(scorer.durationResults[0].status).toBe("correct");
  });

  it("distinguishes contradictions, modeled impossibility and scheduler exhaustion", () => {
    expect(() =>
      dynamicFingeringExample(["substitution"], {
        noteLifetimes: { kind: "disabled" },
      }),
    ).toThrow(GeneratorConfigurationError);
    const noShift = dynamicFingeringExample(["continuous-shift"], {
      melody: { maxIntervalSteps: 1 },
    });
    expect(() => generateConfigured(noShift, "narrow-interval")).toThrow(
      GeneratorContextInfeasibleError,
    );
    const search = dynamicFingeringExample(["thumb-under"], {
      notation: { voices: "independent" },
      noteLifetimes: noteLifetimeDefaults,
      independentVoices: {
        right: { voices: [{ activity: 0.000001, minAttacksPerPhrase: 1 }] },
        maxAttempts: 1,
      },
    });
    expect(() => generateConfigured(search, "budget")).toThrow(
      GeneratorSearchExhaustedError,
    );
  });
});
