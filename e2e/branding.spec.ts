import { test, expect } from "@playwright/test";

for (const language of ["en", "de"] as const) {
  test(`ClefGlide branding, metadata and downloads in ${language}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((lang) => {
      // This key predates the rebrand and must keep restoring existing choices.
      localStorage.setItem("sightflow-language", lang);
    }, language);
    await page.goto("/");
    await expect(page).toHaveTitle("ClefGlide · Read ahead. Play naturally.");
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://piano.rit.cl",
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /ClefGlide/,
    );
    for (const selector of [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]) {
      await expect(page.locator(selector)).toHaveAttribute(
        "content",
        "ClefGlide · Read ahead. Play naturally.",
      );
    }
    const icon = await page.request.get("/favicon.svg");
    expect(icon.ok()).toBe(true);
    expect(await icon.text()).toContain("ClefGlide");
    await expect(
      page.getByRole("link", {
        name: language === "en" ? "ClefGlide home" : "ClefGlide Startseite",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name:
          language === "en"
            ? "Read ahead. Play naturally."
            : "Vorauslesen. Natürlich spielen.",
      }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("practice-light.png"),
      fullPage: true,
    });
      if (await page.locator(".theme").isVisible()) {
        await page.locator(".theme").click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await page.screenshot({
          path: testInfo.outputPath("practice-dark.png"),
          fullPage: true,
        });
        await page.locator(".theme").click();
      }
    for (const tab of language === "en"
      ? ["Practice", "Settings & help", "Progress"]
      : ["Üben", "Einstellungen & Hilfe", "Fortschritt"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.locator("body")).not.toContainText(/sightflow/i);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await expect(
      page.getByLabel(
        language === "en"
          ? "Import a ClefGlide JSON backup"
          : "ClefGlide-JSON-Sicherung importieren",
      ),
    ).toBeAttached();
    for (const format of ["JSON", "CSV"]) {
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: format, exact: true }).click();
      expect((await downloading).suggestedFilename()).toBe(
        `clefglide-progress.${format.toLowerCase()}`,
      );
    }
  });
}
