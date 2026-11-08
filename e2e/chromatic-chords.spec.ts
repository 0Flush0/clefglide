import { test, expect } from "@playwright/test";

test("chromatic chord practice engraves, streams, keeps hints stable and saves actual chord outcomes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  for (const label of [
    "Note jumps",
    "Hand movements",
    "Finger spacing",
    "Accidentals",
    "Chords",
  ])
    await expect(
      page.getByRole("group", { name: label }).getByRole("button"),
    ).toHaveCount(4);
  for (const label of ["Accidentals", "Chords"])
    await page
      .getByRole("group", { name: label })
      .getByRole("button", { name: "Hard" })
      .click();
  await page.getByLabel("Fingering assistance").selectOption("all");
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await expect(page.locator(".notation svg")).toBeVisible();
  const eventIds = () =>
    page.locator(".vf-stavenote").evaluateAll((ns) => ns.map((n) => n.id));
  const before = await eventIds();
  // Assert chord noteheads from the engraved SVG, independently of cursor data.
  expect(
    await page
      .locator(".vf-stavenote")
      .evaluateAll((ns) =>
        ns.some((n) => n.querySelectorAll(".vf-notehead").length > 1),
      ),
  ).toBe(true);
  await page.getByLabel("Fingering assistance").selectOption("hidden");
  expect(await eventIds()).toEqual(before);
  await expect(
    page.locator("svg text").filter({ hasText: /^[1-5]$/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  // Use the public computer-keyboard simulator, delivering chord attacks together.
  for (let i = 0; i < 60; i++) {
    const target = page.getByTestId("target");
    if (Number(await target.getAttribute("data-bar")) >= 4) break;
    const pitches = (await target.getAttribute("data-pitches"))!
      .split(",")
      .map(Number);
    await page.evaluate((pitches) => {
      const mapping = [
        "a",
        "w",
        "s",
        "e",
        "d",
        "f",
        "t",
        "g",
        "y",
        "h",
        "u",
        "j",
        "k",
        "o",
        "l",
        "p",
        ";",
      ];
      pitches.forEach((p) =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: mapping[p - 60], bubbles: true }),
        ),
      );
      pitches.forEach((p) =>
        window.dispatchEvent(
          new KeyboardEvent("keyup", { key: mapping[p - 60], bubbles: true }),
        ),
      );
    }, pitches);
  }
  await expect(page.getByTestId("target")).toHaveAttribute(
    "data-bar",
    /^[4-9]/,
  );
  await expect(
    page.getByText("Chord-event accuracy", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save & finish" }).click();
  await expect(page.locator(".session")).toHaveCount(1);
  await page.locator(".session summary").click();
  await expect(page.locator(".session")).toContainText("chord-event accuracy");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
