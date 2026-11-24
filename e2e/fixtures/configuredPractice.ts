import type { Page } from "@playwright/test";
import type { ValidatedGeneratorConfig } from "../../src/generation";

export async function stageConfiguration(
  page: Page,
  config: ValidatedGeneratorConfig,
  seed: string,
) {
  await page.getByLabel("Practice profile").selectOption("custom");
  await page.getByRole("button", { name: "Edit music settings" }).click();
  const expert = page.getByText("Expert settings", { exact: true });
  const editor = page.getByText("Generator parameters (JSON)", { exact: true });
  await expert.click();
  await editor.click();
  await page.getByLabel("GeneratorConfig JSON").fill(JSON.stringify(config));
  await page.getByRole("button", { name: "Use parameters" }).click();
  await editor.click();
  await page.getByLabel("Exercise seed").fill(seed);
  await expert.click();
}
