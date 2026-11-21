import { expect, test } from "@playwright/test";

for (const language of ["en", "de"] as const) {
  test(`legal notice navigation in ${language}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("sightflow-language", value);
    }, language);
    await page.goto("/");
    const title = language === "de" ? "Impressum" : "Legal Notice (Impressum)";
    await page.locator("footer").getByRole("link", { name: title }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.locator("address")).toBeVisible();
    await page
      .getByRole("link", {
        name: language === "de" ? "English" : "Deutsch",
        exact: true,
      })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      language === "de" ? "en" : "de",
    );
    await page.setViewportSize({ width: 320, height: 640 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.locator('a[href="#"]').click();
    await expect(
      page.getByRole("tab", {
        name: language === "de" ? "Üben" : "Practice",
        exact: true,
      }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.locator("address")).toBeVisible();
  });
}
