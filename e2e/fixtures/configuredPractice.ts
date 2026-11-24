import type { Page } from "@playwright/test";
import type { ValidatedGeneratorConfig } from "../../src/generation";

export async function stageConfiguration(
  page: Page,
  config: ValidatedGeneratorConfig,
  seed: string,
) {
  await page.getByLabel("Practice profile").selectOption("custom");
  const editor = page.getByText("Generator parameters", { exact: true });
  await editor.click();
  await page.getByLabel("GeneratorConfig JSON").fill(JSON.stringify(config));
  await page.getByRole("button", { name: "Use parameters" }).click();
  await editor.click();
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByLabel("Exercise seed").fill(seed);
  await page.getByText("Advanced settings", { exact: true }).click();
}
