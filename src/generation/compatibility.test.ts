import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import baselineText from "./compatibility-v5.2.json?raw";
import { type Settings } from "../score/model";
import { generate } from "./planner";
import {
  generateConfigured,
  noteLifetimeDefaults,
  resolveGeneratorConfig,
  repositionDefaults,
  tieDefaults,
  chordDefaults,
} from ".";

const cases = JSON.parse(baselineText) as {
  settings: Settings;
  seed: string;
  sha256: string;
}[];
it("preserves complete 5.2 phrases and PRNG/state continuation captured before the refactor", () => {
  expect(cases).toHaveLength(96);
  for (const { settings, seed, sha256 } of cases) {
    const first = generate(settings, seed);
    const second = generate(settings, seed, first.final);
    const third = generate(settings, seed, second.final);
    expect(
      createHash("sha256")
        .update(JSON.stringify([first, second, third]))
        .digest("hex"),
      seed,
    ).toBe(sha256);
  }
});
it.each([false, true])(
  "preserves complete v9 independent phrases (both hands: %s)",
  (both) => {
    const config = resolveGeneratorConfig({
      notation: {
        voices: "independent",
        ties: { ...tieDefaults, voices: ["right:main"] },
      },
      hands: { active: both ? "both" : "right", right: { max: 84 } },
      noteLifetimes: noteLifetimeDefaults,
      melody: { maxIntervalSteps: 4 },
      movement: repositionDefaults,
      chords: chordDefaults,
      independentVoices: {
        right: { voices: [{}, { activity: 0.7, fingers: [1] }] },
        ...(both
          ? { left: { voices: [{ durations: [{ value: 480, weight: 1 }] }] } }
          : {}),
      },
    });
    const phrases = [generateConfigured(config, "interoperability-v9")];
    while (phrases.length < 3) {
      const last = phrases.at(-1)!;
      phrases.push(generateConfigured(config, last.seed, last.final));
    }
    const hash = createHash("sha256")
      .update(JSON.stringify(phrases))
      .digest("hex");
    expect(hash).toBe(
      both
        ? "694a5b44836f30777c28708f1fa05371f8666bb75b37fa827f7cd1d05502e2e4"
        : "4f4e34b4a84de085b8b8531de0584f54f4a40fbe831c1d0cef5596a71dad6f1a",
    );
  },
);
