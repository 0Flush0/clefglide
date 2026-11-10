import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const language of ["en", "de"]) {
  test(`source link and complete license notices in ${language}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(
      (lang) => localStorage.setItem("sightflow-language", lang),
      language,
    );
    await page.goto("/");
    const source = page.locator(".topbar").getByRole("link", {
      name:
        language === "en"
          ? "View source code on GitHub"
          : "Quellcode auf GitHub ansehen",
    });
    await expect(source).toHaveAttribute(
      "href",
      "https://github.com/0Flush0/clefglide",
    );
    await expect(source).toHaveAttribute("target", "_blank");
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    await page
      .context()
      .route("https://github.com/0Flush0/clefglide", (route) =>
        route.fulfill({ body: "Repository destination" }),
      );
    const popupPromise = page.waitForEvent("popup");
    await source.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url()).toBe("https://github.com/0Flush0/clefglide");
    await popup.close();

    const opener = page.getByRole("button", {
      name: language === "en" ? "Open-source licenses" : "Open-Source-Lizenzen",
      exact: true,
    });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", {
      name: language === "en" ? "Close licenses" : "Lizenzen schließen",
    });
    await expect(close).toBeFocused();
    const search = dialog.getByRole("searchbox");
    await expect(search).toBeVisible();

    const response = await page.request.get("/licenses/dependencies.json");
    expect(response.ok()).toBe(true);
    const raw = await response.text();
    expect(raw).not.toMatch(
      /"(?:path|email|publisher|licenseFile|noticeFile)":|[A-Z]:\\\\/,
    );
    const report = JSON.parse(raw);
    const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
    const reactVersion = lock.packages["node_modules/react"].version;
    const react = report.packages.find(
      (entry: { name: string }) => entry.name === "react",
    );
    expect(react.version).toBe(reactVersion);
    for (const entry of report.packages) {
      expect(entry.notices.length).toBeGreaterThan(0);
      expect(entry.license).not.toMatch(/UNKNOWN|UNLICENSED/);
    }
    await search.fill("react");
    const reactEntry = dialog
      .locator("details")
      .filter({ has: page.locator("strong", { hasText: /^react$/ }) });
    await reactEntry.locator("summary").click();
    await expect(reactEntry).toContainText(reactVersion);
    await expect(reactEntry).toContainText(
      "Copyright (c) Meta Platforms, Inc.",
    );
    await expect(reactEntry).toContainText("Permission is hereby granted");
    await expect(reactEntry.getByRole("link")).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    const notices = await page.request.get("/licenses/THIRD_PARTY_NOTICES.txt");
    expect(notices.ok()).toBe(true);
    const text = await notices.text();
    expect(text).toContain("Apache License");
    expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(text).toContain("Copyright (c) 2020-present LongYinan");

    await search.fill("no-such-library-123");
    await expect(dialog.locator("details")).toHaveCount(0);
    await search.fill("OFL-1.1");
    await expect(dialog.locator("details")).toHaveCount(2);
    await dialog.locator("summary").first().click();
    await expect(dialog).toContainText("Reserved Font Name");
    await page.screenshot({
      path: testInfo.outputPath("licenses-light.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    if (await page.locator(".theme").isVisible()) {
      await page.locator(".theme").click();
      await opener.click();
      await expect(dialog).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("licenses-dark.png"),
        fullPage: true,
      });
      await close.click();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("license report failure can be retried", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("sightflow-language", "en"),
  );
  await page.goto("/");
  let fail = true;
  await page.route("**/licenses/dependencies.json", (route) =>
    fail
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.continue(),
  );
  await page
    .getByRole("button", { name: "Open-source licenses", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Could not load");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("searchbox")).toBeVisible();
});
