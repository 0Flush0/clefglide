import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { LicenseEntry } from "../src/shared/licenseReport";

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
    const projectLicense = dialog.getByRole("link", {
      name:
        language === "en"
          ? "Read ClefGlide’s MIT License"
          : "MIT-Lizenz von ClefGlide lesen",
    });
    await expect(projectLicense).toHaveAttribute(
      "href",
      "/licenses/LICENSE.txt",
    );
    const projectLicenseResponse = await page.request.get(
      "/licenses/LICENSE.txt",
    );
    expect(projectLicenseResponse.ok()).toBe(true);
    expect(await projectLicenseResponse.body()).toEqual(
      await readFile("LICENSE"),
    );

    const response = await page.request.get("/licenses/dependencies.json");
    expect(response.ok()).toBe(true);
    const raw = await response.text();
    expect(raw).not.toMatch(
      /"(?:path|email|publisher|licenseFile|noticeFile)":|[A-Z]:\\\\/,
    );
    const report = JSON.parse(raw) as { packages: LicenseEntry[] };
    const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
    const reactVersion = lock.packages["node_modules/react"].version;
    const react = report.packages.find((entry) => entry.name === "react");
    expect(react?.version).toBe(reactVersion);
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
    expect(text).not.toContain("Copyright (c) 2026 0Flush0");

    const reviewedNotices = [
      [
        "Academico",
        "0.902",
        "Copyright © 2020",
        "Copyright © 2022",
        "DISCLAIMER",
      ],
      ["Bravura", "1.392", "Copyright © 2021", "DISCLAIMER"],
      [
        "spdx-ranges",
        "2.1.1",
        "Copyright (c) 2015 Kyle E. Mitchell",
        "The Linux Foundation and its contributors",
        "Creative Commons Notice",
      ],
      [
        "spdx-exceptions",
        "2.5.0",
        "Copyright © 2010-2015 Linux Foundation and its Contributors.",
        "Creative Commons Notice",
      ],
      [
        "victory-vendor",
        "37.4.1",
        "Copyright 2001 Robert Penner",
        "Copyright (C) 2010-2013 Raymond Hill",
      ],
      [
        "lucide-react",
        "0.511.0",
        "Lucide Contributors 2022",
        "Copyright (c) 2013-2023 Cole Bemis",
      ],
      ["@radix-ui/primitive", "1.1.2", "Copyright (c) 2022 WorkOS"],
    ];
    for (const [name, version, ...expected] of reviewedNotices) {
      await search.fill(name);
      const entry = dialog.locator("details").filter({
        has: page.getByText(name, { exact: true }),
      });
      await entry.locator("summary").click();
      await expect(entry.locator("summary")).toContainText(version);
      const displayed = await entry.locator("pre").allTextContents();
      const reported = report.packages.find((item) => item.name === name);
      expect(displayed).toEqual(reported?.notices.map((notice) => notice.text));
      for (const notice of displayed) expect(text).toContain(notice);
      for (const marker of expected)
        expect(displayed.join("\n")).toContain(marker);
    }

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
  let attempts = 0;
  await page.route("**/licenses/dependencies.json", (route) => {
    attempts += 1;
    if (attempts === 1)
      return route.fulfill({ status: 503, body: "Unavailable" });
    if (attempts === 2) {
      return route.fulfill({
        json: { schemaVersion: 1, packages: [{ name: "Incomplete entry" }] },
      });
    }
    return route.continue();
  });
  await page
    .getByRole("button", { name: "Open-source licenses", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Could not load");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(page.getByRole("alert")).toContainText("Could not load");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("searchbox")).toBeVisible();
  expect(attempts).toBe(3);
});
