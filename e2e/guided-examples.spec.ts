import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { generateConfigured, type GeneratedPhrase } from "../src/generation";
import {
  curriculum,
  guidedRecipe,
  type HandScope,
} from "../src/practice/curriculum";
import { noteheads } from "../src/score/model";

const examples: {
  file: string;
  hand: HandScope;
  id: string;
  includes: (phrase: GeneratedPhrase) => boolean;
}[] = [
  {
    file: "beginner.png",
    hand: "right",
    id: "right-read",
    includes: () => true,
  },
  {
    file: "intermediate.png",
    hand: "left",
    id: "left-register-targets",
    includes: ({ movements }) =>
      movements.some((move) => move.technique === "lift-and-reposition"),
  },
  {
    file: "advanced.png",
    hand: "both",
    id: "both-expressive-voices",
    includes: ({ events }) =>
      events.some((e) => e.slur) &&
      ["left:2", "right:2"].every((voice) =>
        events.some((e) => e.voiceId === voice && e.kind === "note"),
      ),
  },
  {
    file: "mastery.png",
    hand: "both",
    id: "both-concert-study",
    includes: ({ events, movements }) =>
      movements.some((move) => move.technique === "lifted-wide-leap") &&
      events.some((e) => e.slur) &&
      events.some((e) => noteheads(e).some((head) => head.tie)) &&
      events.some((e) => noteheads(e).length === 4),
  },
];

for (const example of examples) {
  test(`engraves the ${example.file.replace(".png", "")} Guided sample in production practice`, async ({
    page,
  }, testInfo) => {
    const level = curriculum[example.hand].find(
      (level) => level.id === example.id,
    )!;
    const config = guidedRecipe(level);
    const seed = Array.from(
      { length: 40 },
      (_, i) => `guided-example-${i}`,
    ).find((seed) => example.includes(generateConfigured(config, seed)));
    expect(seed, example.id).toBeDefined();

    await page.goto("/");
    const practice = page.getByRole("region", { name: "Guided learning path" });
    await practice
      .getByLabel("Hands", { exact: true })
      .selectOption(example.hand);
    await practice
      .getByText("Browse stages and levels", { exact: true })
      .click();
    if (level.stageNumber > 1) {
      await practice.getByLabel("Guided stage").selectOption(level.stageId);
      await practice.getByLabel("Level in stage").selectOption(level.id);
    }
    await page.getByText("Advanced settings", { exact: true }).click();
    await page.getByLabel("Exercise seed").fill(seed!);
    await page.getByLabel("Bars in view").selectOption("4");
    await page.getByRole("button", { name: "Apply & generate" }).click();
    const notation = page.getByTestId("notation");
    const svg = notation.locator("svg");
    await expect(svg).toHaveAttribute(
      "data-staff-count",
      example.hand === "both" ? "2" : "1",
    );
    await expect(svg.locator(`[id^="vf-${seed}-0-"]`).first()).toBeAttached();
    await expect(
      page.getByRole("heading", { name: new RegExp(`${level.bpm} BPM`) }),
    ).toBeVisible();
    if (
      process.env.GUIDED_EXAMPLES_DIR &&
      testInfo.project.name === "desktop"
    ) {
      // Preserve the live engraving while including bars beyond the score's scroll viewport.
      const size = await svg.evaluate((element: SVGSVGElement) => {
        const crop = document.createElement("div");
        const { width, height } = element.viewBox.baseVal;
        crop.id = "score-sample";
        crop.style.cssText = `background:white;padding:16px;width:${width + 32}px;`;
        crop.append(element.cloneNode(true));
        document.body.replaceChildren(crop);
        return { width: Math.ceil(width) + 32, height: Math.ceil(height) + 32 };
      });
      await page.setViewportSize(size);
      await page
        .locator("#score-sample")
        .screenshot({
          path: join(process.env.GUIDED_EXAMPLES_DIR, example.file),
          animations: "disabled",
        });
      console.info(
        `${example.id} · ${seed} · ${level.bpm} BPM · ${example.file}`,
      );
    }
  });
}
