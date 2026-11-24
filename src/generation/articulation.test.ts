import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isContinuousMovement, noteheads } from "../score/model";
import {
  generateConfigured,
  generatorConfigFingerprint,
  GeneratorConfigurationError,
  GeneratorContextInfeasibleError,
  noteLifetimeDefaults,
  normalizeGeneratorConfig,
  resolveGeneratorConfig,
  tieDefaults,
  validateGeneratedPhrase,
} from "./index";
import {
  articulatedDuet,
  articulatedStudy,
  dynamicFingeringExample,
} from "./examples";
import { eventTick } from "./fingeringTimeline";

const config = articulatedStudy({
  articulation: {
    touch: [],
    emphasis: [],
    slurs: {
      crossPhrase: true,
      probability: 1,
      lengths: [{ value: 3 }],
      styles: [{ value: "legato" }],
    },
    evaluation: { kind: "disabled" },
  },
});

describe("parameter-driven articulation", () => {
  it("normalizes optional policies and rejects contradictory capabilities", () => {
    expect(() =>
      resolveGeneratorConfig({
        articulation: {
          kind: "enabled",
          voices: ["right:main"],
          touch: [{ value: "staccato" }],
        },
      }),
    ).toThrow(GeneratorConfigurationError);
    for (const override of [
      { voices: ["left:main"] },
      { evaluation: { kind: "evaluate", timingWeight: 1, velocityWeight: 1 } },
      { slurs: { crossMeasure: false } },
      {
        slurs: {
          crossPhrase: false,
          crossMeasure: false,
          lengths: [{ value: 8 }],
        },
      },
      { timing: { staccato: { min: 0.6, target: 0.3, max: 0.8 } } },
      { touch: [{ value: "tenuto" }, { value: "tenuto" }] },
    ] as const)
      expect(() =>
        normalizeGeneratorConfig({
          ...config,
          articulation: {
            ...config.articulation,
            ...override,
            ...(Object.hasOwn(override, "slurs") && {
              slurs: {
                ...(config.articulation!.slurs as object),
                ...Reflect.get(override, "slurs"),
              },
            }),
          },
        }),
      ).toThrow(GeneratorConfigurationError);
    const roundTrip = normalizeGeneratorConfig(
      JSON.parse(JSON.stringify(config)),
    );
    expect(generatorConfigFingerprint(roundTrip)).toBe(
      generatorConfigFingerprint(config),
    );
    expect(Object.isFrozen(roundTrip.articulation!.timing)).toBe(true);
  });

  it("plans both directions of a boundary commitment without changing core notes, rhythms or RNG", () => {
    const p = generateConfigured(config, "cross-3");
    const core = generateConfigured(
      resolveGeneratorConfig({ articulation: false }, config),
      p.seed,
    );
    expect(p.version).toBe("12.0.0");
    const stripped = p.events.map(({ slur, articulation, ...event }) => {
      void slur;
      void articulation;
      return event;
    });
    expect(stripped).toEqual(core.events);
    expect(p.final.rng).toBe(core.final.rng);
    const group = p.final.articulation!.groups[0];
    expect(group.members).toHaveLength(3);
    const from = p.events.at(-1)!;
    expect(from.articulation?.timing).toMatchObject({
      kind: "connected",
      offsetTicks: 0,
      nextEventId: group.members[1].id,
    });
    const q = generateConfigured(
      config,
      p.seed,
      JSON.parse(JSON.stringify(p.final)),
    );
    expect(q.events[0].slur).toMatchObject({ id: group.id, index: 1 });
    expect(validateGeneratedPhrase(p)).toEqual([]);
    expect(validateGeneratedPhrase(q, p)).toEqual([]);
    expect(() => generateConfigured(config, "wrong-seed", p.final)).toThrow(
      GeneratorContextInfeasibleError,
    );
    const bad = structuredClone(q);
    bad.events[0].slur!.index = 0;
    expect(validateGeneratedPhrase(bad, p)).toContain(
      "Invalid slur membership or articulation contact.",
    );
    const orphan = structuredClone(q);
    orphan.initial.articulation!.groups = [];
    expect(validateGeneratedPhrase(orphan, p)).toContain(
      "Articulation continuation differs from the previous phrase commitment.",
    );
    const impossible = structuredClone(p);
    impossible.events.at(-1)!.articulation!.timing!.ticks++;
    expect(validateGeneratedPhrase(impossible)).toContain(
      "Invalid articulation timing or physical connection target.",
    );
  });

  it("samples all touch and emphasis types with seed-stable plans and safe legato", () => {
    const c = articulatedStudy({
      hands: { active: "both" },
      articulation: {
        voices: ["right:main", "left:main"],
        touch: [
          { value: "natural" },
          { value: "non-legato" },
          { value: "legato" },
          { value: "staccato" },
          { value: "staccatissimo" },
          { value: "tenuto" },
        ],
      },
    });
    const types = new Set<string>();
    const timingTypes = new Set<string>();
    let repeated = false;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (n) => {
        const seed = `articulation-${n}`;
        const p = generateConfigured(c, seed);
        const q = generateConfigured(c, seed, p.final);
        expect(q).toEqual(generateConfigured(c, seed, p.final));
        expect(validateGeneratedPhrase(q, p)).toEqual([]);
        const events = [...p.events, ...q.events];
        const byId = new Map(events.map((e) => [e.id, e]));
        for (const e of events) {
          const a = e.articulation;
          for (const value of [a?.touch, a?.emphasis, e.slur?.style])
            if (value) types.add(value);
          const timing = a?.timing;
          if (!timing) continue;
          timingTypes.add(timing.kind);
          if (timing.kind === "duration") continue;
          const next = byId.get(timing.nextEventId);
          if (!next) continue;
          expect(next.hand).toBe(e.hand);
          expect(eventTick(next, c)).toBe(e.lifetime!.releaseTick);
          const shared = noteheads(e).some((x) =>
            noteheads(next).some((y) => x.midi === y.midi),
          );
          if (shared && timing.kind !== "separation") {
            expect(timing.kind).toBe("connected");
            repeated = true;
          }
        }
      }),
      { seed: 999, numRuns: 28 },
    );
    expect([...types].sort()).toEqual([
      "accent",
      "legato",
      "marcato",
      "natural",
      "non-legato",
      "portato",
      "staccatissimo",
      "staccato",
      "tenuto",
    ]);
    expect([...timingTypes].sort()).toEqual([
      "connected",
      "duration",
      "overlap",
      "separation",
    ]);
    expect(repeated).toBe(true);
  });

  it("preserves continuous fingering and substitutions, and leaves tied bass attacks intact", () => {
    const dynamic = dynamicFingeringExample(
      ["thumb-under", "finger-over", "substitution"],
      {
        noteLifetimes: noteLifetimeDefaults,
        notation: {
          ties: {
            ...tieDefaults,
            probability: 0.6,
            patterns: [{ value: "subdivide", weight: 1 }],
          },
        },
        rhythm: {
          durations: [{ value: 960, weight: 1 }],
          breathBars: [1, 2],
          breathBeats: 2,
        },
        articulation: {
          kind: "enabled",
          voices: ["right:main"],
          touch: [{ value: "staccato" }],
          slurs: { probability: 1, lengths: [{ value: 2 }], crossPhrase: true },
          interactions: { ties: "preserve-hold" },
        },
      },
    );
    let transfers = 0,
      continuous = 0,
      tiedBass = 0;
    const duet = articulatedDuet();
    for (let i = 0; i < 12; i++) {
      const p = generateConfigured(dynamic, `dynamic-articulation-${i}`);
      const q = generateConfigured(dynamic, p.seed, p.final);
      expect(validateGeneratedPhrase(q, p)).toEqual([]);
      const events = [...p.events, ...q.events];
      for (const move of [...p.movements, ...q.movements].filter(
        isContinuousMovement,
      )) {
        const timing = events.find((e) => e.id === move.source.eventId)
          ?.articulation?.timing;
        if (timing) expect(timing.kind).toBe("connected");
        continuous++;
      }
      for (const e of events) {
        for (const n of noteheads(e)) {
          if (n.tie?.index) expect(e.articulation).toBeUndefined();
          if (!n.substitution) continue;
          const source = events.find((f) =>
            noteheads(f).some((h) => h.id === n.substitution!.lifetimeId),
          );
          expect(source?.articulation?.touch).not.toBe("staccato");
          transfers++;
        }
      }
      const u = generateConfigured(duet, `articulation-duet-${i}`);
      const v = generateConfigured(duet, u.seed, u.final);
      expect(validateGeneratedPhrase(v, u)).toEqual([]);
      for (const e of [...u.events, ...v.events].filter(
        (e) => e.hand === "left",
      )) {
        expect(e.articulation).toBeUndefined();
        if (noteheads(e).some((n) => n.tie)) tiedBass++;
      }
    }
    expect(transfers).toBeGreaterThan(0);
    expect(continuous).toBeGreaterThan(0);
    expect(tiedBass).toBeGreaterThan(0);
  });
});
