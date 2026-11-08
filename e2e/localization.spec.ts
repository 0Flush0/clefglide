import { test, expect } from "@playwright/test";

test.use({ locale: "de-DE" });
test("German first visit covers practice, help and progress and remembers language", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(
    page.getByRole("heading", { name: "Schwierigkeitsgrad" }),
  ).toBeVisible();
  await expect(page.getByTestId("placement-plan")).toContainText("Daumen auf");
  await expect(page.getByTestId("placement-plan")).toContainText("Beginne auf");
  await page.getByRole("tab", { name: "Einstellungen & Hilfe" }).click();
  await expect(
    page.getByRole("heading", { name: "Verbindungsprobleme lösen" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Fortschritt" }).click();
  await expect(
    page.getByRole("heading", { name: "Dein Blattspiel im Zeitverlauf." }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Einstellungen & Hilfe" }).click();
  await page
    .getByRole("combobox", { name: "Sprache der Hilfe", exact: true })
    .selectOption("en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("button", { name: "Start practice", exact: true }),
  ).toBeVisible();
});
