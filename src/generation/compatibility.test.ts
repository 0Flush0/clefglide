import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import baselineText from "./compatibility-v5.2.json?raw";
import { type Settings } from "../score/model";
import { generate } from "./planner";

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
