import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("Guided stage navigation remembers levels across tracks and reload without changing the score until Apply", async ({
  page,
}) => {
  await page.goto("/");
  const target = page.getByTestId("target");
  const pitches = await target.getAttribute("data-pitches");
  const staff = page.getByTestId("notation").locator("svg");
  const hands = page.getByLabel("Hands", { exact: true });
  const path = page.getByRole("region", { name: "Guided learning path" });
  const previous = path.getByRole("button", { name: "Previous stage" });
  const next = path.getByRole("button", { name: "Next stage" });
  const position = path.locator(".guided-position");
  const numbers = path.getByRole("group", { name: "Level progression" });
  await expect(previous).toBeDisabled();
  await numbers
    .getByRole("button", { name: "Level 2 · Keep the pulse" })
    .click();
  await next.click();
  await expect(
    path.getByRole("heading", { name: "Rhythmic fluency" }),
  ).toBeVisible();
  await expect(position).toHaveText("Stage 2/10 · Level 10/90");
  await expect(numbers.getByRole("button")).toHaveCount(9);
  await numbers.getByRole("button", { name: /Level 12 ·/ }).click();
  await previous.click();
  await expect(position).toHaveText("Stage 1/10 · Level 2/90");
  await expect(previous).toBeDisabled();

  await hands.selectOption("left");
  await next.click();
  await expect(position).toHaveText("Stage 2/10 · Level 10/90");
  await numbers.getByRole("button", { name: /Level 11 ·/ }).click();
  await path.getByText("Browse stages and levels", { exact: true }).click();
  await path
    .getByLabel("Guided stage", { exact: true })
    .selectOption("sustain");
  await path
    .getByLabel("Level in stage", { exact: true })
    .selectOption("left-ties");
  await expect(page.getByRole("slider", { name: "Tempo" })).toHaveValue("62");

  await hands.selectOption("both");
  await next.click();
  await expect(
    path.getByRole("heading", { name: "A slower bass" }),
  ).toBeVisible();
  await numbers.getByRole("button", { name: /Level 11 ·/ }).click();
  await previous.click();
  await expect(target).toHaveAttribute("data-pitches", pitches!);
  await expect(staff).toHaveAttribute("data-staff-count", "1");
  await expect(
    page.getByRole("button", { name: "Apply & generate" }),
  ).toBeEnabled();
  await page.reload();
  await expect(hands).toHaveValue("both");
  await expect(position).toHaveText("Stage 1/10 · Level 1/89");
  await next.click();
  await expect(
    path.getByRole("heading", { name: "Release the bass separately" }),
  ).toBeVisible();
  await expect(position).toHaveText("Stage 2/10 · Level 11/89");
  await expect(staff).toHaveAttribute("data-staff-count", "1");
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await expect(staff).toHaveAttribute("data-staff-count", "2");
  await hands.selectOption("left");
  await expect(
    path.getByRole("heading", { name: "Hold through a tie" }),
  ).toBeVisible();
  await path.getByText("Browse stages and levels", { exact: true }).click();
  await path
    .getByLabel("Guided stage", { exact: true })
    .selectOption("rhythmic-fluency");
  await expect(position).toHaveText("Stage 2/10 · Level 11/90");
  await hands.selectOption("right");
  await expect(
    path.getByRole("heading", { name: "Keep the pulse" }),
  ).toBeVisible();
  await next.click();
  await expect(
    path.getByRole("heading", { name: "Read through the offbeat" }),
  ).toBeVisible();
  await expect(position).toHaveText("Stage 2/10 · Level 12/90");
});

test("Guided mastery stages its tempo and register and restores explicit overrides", async ({
  page,
}) => {
  await page.goto("/");
  const path = page.getByRole("region", { name: "Guided learning path" });
  const tempo = page.getByRole("slider", { name: "Tempo" });
  await path.getByText("Browse stages and levels", { exact: true }).click();
  await path
    .getByLabel("Guided stage", { exact: true })
    .selectOption("mastery");
  await expect(path.getByRole("button", { name: "Next stage" })).toBeDisabled();
  await path
    .getByLabel("Level in stage", { exact: true })
    .selectOption("right-concert-study");
  await expect(
    path.getByRole("heading", { name: "Read a mobile concert study" }),
  ).toBeVisible();
  await expect(path.locator(".guided-recommendation")).toContainText("G3–G6");
  await expect(tempo).toHaveValue("92");
  await tempo.focus();
  await tempo.press("ArrowDown");
  await expect(path.getByText("Custom level settings")).toBeVisible();
  await expect(tempo).toHaveValue("91");
  await page.getByRole("button", { name: "Edit range" }).click();
  const range = page.getByRole("dialog", { name: "Edit keyboard range" });
  await range.getByRole("button", { name: "A3", exact: true }).click();
  await range.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(path.locator(".guided-recommendation")).toContainText("A3–G6");
  await page.reload();
  await expect(tempo).toHaveValue("91");
  await expect(path.locator(".guided-recommendation")).toContainText("A3–G6");
  await path.getByRole("button", { name: "Restore level settings" }).click();
  await expect(tempo).toHaveValue("92");
  await expect(path.locator(".guided-recommendation")).toContainText("G3–G6");
  await expect(path.getByText("Custom level settings")).toHaveCount(0);
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await expect(page.getByRole("heading", { name: /92 BPM/ })).toBeVisible();
  await expect(page.getByTestId("notation").locator("svg")).toHaveAttribute(
    "data-staff-count",
    "1",
  );
  await page.setViewportSize({ width: 390, height: 740 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("Advanced controls, hand linking, profiles and JSON share the staged configuration", async ({
  page,
}) => {
  await page.goto("/");
  const staff = page.getByTestId("notation").locator("svg");
  await page.getByLabel("Practice profile").selectOption("custom");
  const hands = page.getByLabel("Hands", { exact: true });
  await hands.selectOption("both");
  const jump = page.getByRole("button", { name: "Edit music settings" });
  await jump.click();
  await page
    .getByText("Shared music and coordination", { exact: true })
    .click();
  const independent = page.getByRole("checkbox", {
    name: "Independent rhythm",
  });
  await independent.check();
  await page.getByText("Melody", { exact: true }).click();
  const hand = page.getByLabel("Edit hand");
  const link = page.getByLabel("Link hand edits");
  const limit = page.getByLabel("Largest melodic interval");
  const steps = page.getByRole("spinbutton", {
    name: "Stepwise motion weight · Value",
  });
  await limit.selectOption({ label: "Fourth" });
  await steps.fill("12");
  await steps.press("Enter");
  await hand.selectOption("left");
  await expect(limit).toHaveValue("1");
  await page
    .getByRole("button", { name: "Copy left parameters to right" })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await hand.selectOption("right");
  await expect(limit).toHaveValue("3");
  await hand.selectOption("left");
  await page
    .getByRole("button", { name: "Copy left parameters to right" })
    .click();
  await page.getByRole("button", { name: "Confirm copy" }).click();
  await hand.selectOption("right");
  await expect(limit).toHaveValue("1");
  await steps.fill("12");
  await steps.press("Enter");
  await link.check();
  await limit.selectOption({ label: "Fifth" });
  await hand.selectOption("left");
  await expect(limit).toHaveValue("4");
  await expect(steps).not.toHaveValue("12");
  await link.uncheck();
  await page.getByText("Rhythm and rests", { exact: true }).click();
  const eighths = page.getByRole("checkbox", { name: "Eighth note" });
  const halves = page.getByRole("checkbox", { name: "Half note" });
  await eighths.check();
  await hand.selectOption("right");
  await expect(eighths).not.toBeChecked();
  await link.check();
  await halves.check();
  await hand.selectOption("left");
  await expect(eighths).toBeChecked();
  await expect(halves).toBeChecked();
  await link.uncheck();
  await independent.click();
  await expect(
    page.getByRole("button", { name: "Switch to shared rhythm" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(independent).toBeChecked();
  await hands.selectOption("left");
  await expect(limit).toHaveValue("4");
  await hands.selectOption("both");
  await expect(limit).toHaveValue("4");
  await page.getByText("Expert settings", { exact: true }).click();
  await page.getByText("Generator parameters (JSON)", { exact: true }).click();
  const editor = page.getByLabel("GeneratorConfig JSON");
  const config = JSON.parse(await editor.inputValue());
  expect(config.handParameters.right.melody.maxIntervalSteps).toBe(4);
  expect(config.handParameters.right.melody.stepBonus).toBe(12);
  config.handParameters.left.melody.maxIntervalSteps = 2;
  await editor.fill(JSON.stringify(config));
  await page.getByRole("button", { name: "Use parameters" }).click();
  await expect(limit).toHaveValue("2");
  await expect(staff).toHaveAttribute("data-staff-count", "1");
  await expect(
    page.getByText("Unapplied changes", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(staff).toHaveAttribute("data-staff-count", "2");
  await expect(
    page.getByText("Settings applied", { exact: true }),
  ).toBeVisible();
  await page.getByText("Custom profiles", { exact: true }).click();
  await page.getByLabel("Profile name").fill("Bass and treble");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export parameters" }).click();
  const profile = await download;
  const exported = await readFile(await profile.path());
  expect(JSON.parse(exported.toString()).config).toEqual(config);
  await page
    .getByRole("button", { name: "Reset all Advanced parameters" })
    .click();
  await expect(page.getByLabel("Hands", { exact: true })).toHaveValue("right");
  await page.getByLabel("Import parameters").setInputFiles({
    name: "profile.json",
    mimeType: "application/json",
    buffer: exported,
  });
  await expect(page.getByLabel("Hands", { exact: true })).toHaveValue("both");
  await page.reload();
  await expect(page.getByLabel("Practice profile")).toHaveValue("custom");
  await jump.click();
  await page.getByText("Custom profiles", { exact: true }).click();
  await page.getByLabel("Saved profiles").selectOption("Bass and treble");
  await page.getByRole("button", { name: "Load profile" }).click();
  await page.getByText("Melody", { exact: true }).click();
  await expect(limit).toHaveValue("4");
  await page.getByRole("button", { name: "Reset · Melody" }).click();
  await expect(limit).toHaveValue("2");
  await page.setViewportSize({ width: 390, height: 740 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("music settings adapt to screen width and keep exact values and dependencies visible", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "tablet")
    await page.addInitScript(() => {
      Object.assign(window, { CapacitorCustomPlatform: { name: "android" } });
    });
  await page.goto("/");
  await page.getByLabel("Practice profile").selectOption("custom");
  const panel = page.locator(".music-settings");
  const sidebar = page.locator(".controls");
  await expect(panel).not.toHaveAttribute("open");
  await expect(sidebar.getByLabel("Scoring mode")).toBeVisible();
  await expect(
    sidebar.getByRole("group", { name: "Practice duration" }),
  ).toBeVisible();
  await sidebar.getByRole("button", { name: "Edit music settings" }).click();
  await expect(panel.locator(":scope > summary")).toBeFocused();
  const columns = panel.locator(".hand-categories");
  expect(
    await columns.evaluate((element) =>
      Number(getComputedStyle(element).columnCount),
    ),
  ).toBe(testInfo.project.name === "desktop" ? 3 : 2);
  const bounds = (await panel.boundingBox())!;
  const score = (await page.locator(".practice-main").boundingBox())!;
  const controls = (await sidebar.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(score.width + 100);
  expect(bounds.y).toBeGreaterThanOrEqual(
    Math.max(score.y + score.height, controls.y + controls.height),
  );
  await panel.getByText("Ties", { exact: true }).click();
  const ties = panel.getByRole("checkbox", { name: "Write ties" });
  await expect(ties).toBeDisabled();
  await panel.getByText("Note holds and duration", { exact: true }).click();
  const holds = panel.getByRole("checkbox", {
    name: "Required physical key holds",
  });
  await holds.check();
  await expect(ties).toBeEnabled();
  await ties.check();
  await expect(holds).toBeDisabled();
  await ties.uncheck();
  await expect(holds).toBeEnabled();

  await panel.getByText("Finger spacing", { exact: true }).click();
  const gap = panel.getByRole("checkbox", {
    name: "Gap between thumb and index",
  });
  const chance = panel.getByRole("spinbutton", {
    name: "Variable spacing chance (%)",
  });
  await expect(
    panel.getByRole("checkbox", { name: "Five consecutive notes" }),
  ).toBeDisabled();
  await expect(chance).toBeHidden();
  await gap.check();
  await chance.fill("12.375");
  await chance.press("Enter");
  await expect(
    panel.getByRole("slider", { name: "Variable spacing chance" }),
  ).toHaveAttribute("aria-valuetext", "12.375%");

  await panel.getByText("Rhythm and rests", { exact: true }).click();
  const weight = panel.getByRole("spinbutton", {
    name: "Weight · Quarter note",
  });
  await weight.fill("3.25");
  await weight.press("Enter");
  await panel.getByText("Expert settings", { exact: true }).click();
  await panel.getByText("Generator parameters (JSON)", { exact: true }).click();
  const editor = panel.getByLabel("GeneratorConfig JSON");
  const config = JSON.parse(await editor.inputValue());
  expect(config.fingering.variablePositionProbability).toBe(0.12375);
  expect(
    config.rhythm.durations.find(
      ({ value }: { value: number }) => value === 480,
    ).weight,
  ).toBe(3.25);
  await editor.fill(JSON.stringify({ ...config, harmony: config.harmony }));
  await gap.uncheck();
  await expect(chance).toBeHidden();
  await expect(
    panel.getByRole("button", { name: "Replace staged settings with JSON" }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Reload JSON from staged settings" })
    .click();
  expect(
    JSON.parse(await editor.inputValue()).fingering.variablePositionProbability,
  ).toBe(0);

  await page.setViewportSize({ width: 390, height: 740 });
  expect(
    await columns.evaluate((element) =>
      Number(getComputedStyle(element).columnCount),
    ),
  ).toBe(1);
  await editor.scrollIntoViewIfNeeded();
  const apply = panel.getByRole("button", { name: "Apply changes" });
  await expect(apply).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await panel.locator(":scope > summary").click();
  await expect(editor).toBeHidden();
});
