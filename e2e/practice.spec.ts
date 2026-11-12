import { test, expect } from "@playwright/test";

test("keyboard range dialog supports independent ranges, keyboard access and narrow screens", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Hands", { exact: true }).selectOption("both");
  const edit = page.getByRole("button", { name: "Edit range" });
  await edit.click();
  const dialog = page.getByRole("dialog", { name: "Edit keyboard range" });
  await expect(dialog).toBeVisible();
  const piano = dialog.getByRole("group", { name: "Piano keyboard" });
  await expect(piano.getByRole("button")).toHaveCount(88);
  await expect(
    dialog.getByRole("button", { name: "Lowest note · C4" }),
  ).toBeFocused();
  const choose = async (name: string) => {
    const key = piano.getByRole("button", { name, exact: true });
    if (testInfo.project.name === "tablet") await key.tap();
    else await key.click();
  };
  const c4 = piano.getByRole("button", { name: "C4", exact: true });
  await c4.focus();
  await c4.press("ArrowRight");
  const db4 = piano.getByRole("button", { name: "Db4", exact: true });
  await expect(db4).toBeFocused();
  await db4.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Lowest note · Db4" }),
  ).toHaveAttribute("aria-pressed", "false");
  await choose("C5");
  await dialog.getByRole("button", { name: "Left hand · C3–G3" }).click();
  await choose("C3");
  await choose("C5");
  await expect(
    dialog.getByRole("button", { name: "Apply", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: `.tools/range-dialog-${testInfo.project.name}.png`,
  });
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 390, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await dialog.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.width <= innerWidth &&
          rect.height <= innerHeight &&
          node.scrollWidth <= innerWidth
        );
      }),
    ).toBe(true);
    expect(
      await page
        .locator(".range-keyboard-scroll")
        .evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await expect(
      piano.getByRole("button", { name: "C5", exact: true }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "Apply", exact: true }),
    ).toBeInViewport();
  }
  await page.screenshot({
    path: `.tools/range-dialog-phone-${testInfo.project.name}.png`,
  });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(edit).toBeFocused();
  await expect(page.locator(".keyboard-range")).toContainText("C3–C5");
  await expect(page.locator(".keyboard-range")).toContainText("Db4–C5");
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await page.reload();
  await expect(page.getByLabel("Hands", { exact: true })).toHaveValue("both");
  await expect(page.locator(".keyboard-range")).toContainText("Db4–C5");
  await edit.click();
  await choose("A0");
  await dialog.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(edit).toBeFocused();
  await expect(page.locator(".keyboard-range")).toContainText("Db4–C5");
  await page.evaluate(() => {
    localStorage.setItem("sightflow-language", "de");
  });
  await page.reload();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.getByRole("button", { name: "Bereich bearbeiten" }).click();
  const germanDialog = page.getByRole("dialog", {
    name: "Tastaturbereich bearbeiten",
  });
  await expect(
    germanDialog.getByRole("button", { name: "Tiefste Note · Db4" }),
  ).toBeFocused();
  await expect(
    germanDialog.getByRole("button", { name: "Übernehmen", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `.tools/range-dialog-dark-de-${testInfo.project.name}.png`,
  });
  await germanDialog
    .getByRole("button", { name: "Abbrechen", exact: true })
    .click();
});
test("slow tempo and responsive menus remain accessible", async ({ page }) => {
  await page.goto("/");
  const tempo = page.getByRole("slider", { name: "Tempo", exact: true });
  await tempo.fill("10");
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await expect(tempo).toHaveValue("10");
  for (const viewport of [
    { width: 1440, height: 600 },
    { width: 1024, height: 600 },
    { width: 390, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.locator(".rail .nav").evaluate((nav) => {
        const rect = nav.getBoundingClientRect();
        return (
          rect.top >= 0 &&
          rect.bottom <= innerHeight &&
          rect.right <= innerWidth
        );
      }),
    ).toBe(true);
    expect(
      await page
        .locator(".settings-scroll")
        .evaluate((panel) => panel.scrollHeight <= panel.clientHeight + 1),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
test("plays four simulated bars, streams ahead, saves real progress, stays within viewport", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator(".piano-card summary").click();
  await expect(page.getByTestId("notation").locator("svg")).toBeVisible();
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  for (let i = 0; i < 35; i++) {
    const target = page.getByTestId("target");
    const bar = Number(await target.getAttribute("data-bar"));
    if (bar >= 4) break;
    const pitches = (await target.getAttribute("data-pitches"))!
      .split(",")
      .map(Number);
    for (const p of pitches) {
      await page.locator(`[data-midi="${p}"]`).click();
    }
  }
  await expect(page.getByTestId("target")).toHaveAttribute(
    "data-bar",
    /^[4-9]/,
  );
  await expect(page.locator(".stat").first().locator("strong")).not.toHaveText(
    "0",
  );
  await page.getByRole("button", { name: "Save & finish" }).click();
  await expect(page.locator(".session")).toHaveCount(1);
  await expect(page.locator(".session")).toContainText("100% first attempt");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("hints disappear while pitch expectations remain, range and clef apply", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".piano-card summary").click();
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByRole("button", { name: "Edit range" }).click();
  const range = page.getByRole("dialog", { name: "Edit keyboard range" });
  await range.getByRole("button", { name: "C3", exact: true }).click();
  await range.getByRole("button", { name: "G3", exact: true }).click();
  await range.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("combobox", { name: /^Clef/ }).selectOption("bass");
  await page.getByLabel("Fingering assistance").selectOption("all");
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await expect(page.locator(".placement")).toContainText("C3");
  const fingers = page.locator("svg text").filter({ hasText: /^[1-5]$/ });
  await expect(fingers.first()).toBeVisible();
  await page.getByLabel("Fingering assistance").selectOption("hidden");
  await expect(fingers).toHaveCount(0);
});
test("independent difficulty buttons apply a spaced exercise without page overflow", async ({
  page,
}) => {
  await page.goto("/");
  for (const label of ["Note jumps", "Hand movements", "Finger spacing"]) {
    await expect(
      page.getByRole("group", { name: label }).getByRole("button"),
    ).toHaveCount(4);
  }
  await page
    .getByRole("group", { name: "Finger spacing" })
    .getByRole("button", { name: "Hard" })
    .click();
  await expect(
    page.getByText(/No approved spacing pattern fits/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit range" }).click();
  const range = page.getByRole("dialog", { name: "Edit keyboard range" });
  await range.getByRole("button", { name: "Highest note · G4" }).click();
  await range.getByRole("button", { name: "C6", exact: true }).click();
  await range.getByRole("button", { name: "Apply", exact: true }).click();
  await page
    .getByRole("group", { name: "Note jumps" })
    .getByRole("button", { name: "Large" })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Hand movements" })
      .getByRole("button", { name: "Off" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Apply & generate" }).click();
  const ids = await page
    .locator(".vf-stavenote")
    .evaluateAll((nodes) => nodes.map((n) => n.id));
  for (const hints of ["all", "hidden", "smart"]) {
    await page.getByLabel("Fingering assistance").selectOption(hints);
    expect(
      await page
        .locator(".vf-stavenote")
        .evaluateAll((nodes) => nodes.map((n) => n.id)),
    ).toEqual(ids);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("both hands show grand staff and require both pitches", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".piano-card summary").click();
  await page.getByLabel("Hands", { exact: true }).selectOption("both");
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await expect(page.getByTestId("notation").locator("svg")).toHaveAttribute(
    "data-staff-count",
    "2",
  );
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  const target = page.getByTestId("target"),
    pitches = (await target.getAttribute("data-pitches"))!
      .split(",")
      .map(Number);
  expect(pitches).toHaveLength(2);
  for (const p of pitches) {
    await page.locator(`[data-midi="${p}"]`).click();
  }
  await expect(page.locator(".stat").first().locator("strong")).toHaveText("2");
});
