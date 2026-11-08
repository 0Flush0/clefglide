/* global console, document, innerWidth */
// Supplemental in-process Playwright QA against an explicitly started local
// Chromium CDP endpoint. Useful where the test runner cannot fork workers.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "warning" || m.type() === "error")
    console.log("BROWSER", m.type(), m.text());
});
await page.goto("http://127.0.0.1:5173/");
await page.locator(".piano-card summary").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: ".tools/desktop.png", fullPage: true });
console.log(
  "Page text:",
  (await page.locator("body").innerText()).slice(0, 1100),
);
assert.deepEqual(errors, []);
assert.equal(await page.locator('[data-testid="notation"] svg').count(), 1);
await page.getByRole("button", { name: "Start practice", exact: true }).click();
for (let i = 0; i < 40; i++) {
  const bar = Number(await page.getByTestId("target").getAttribute("data-bar"));
  if (bar >= 4) break;
  const pitches = (
    await page.getByTestId("target").getAttribute("data-pitches")
  )
    .split(",")
    .map(Number);
  for (const p of pitches) await page.locator(`[data-midi="${p}"]`).click();
}
assert.ok(
  Number(await page.getByTestId("target").getAttribute("data-bar")) >= 4,
);
await page.getByRole("button", { name: "Save & finish" }).click();
await page.waitForTimeout(500);
assert.equal(await page.locator(".session").count(), 1);
assert.match(await page.locator(".session").innerText(), /100% first attempt/);
await page.getByRole("tab", { name: "Practice", exact: true }).click();
await page.getByLabel("Hands", { exact: true }).selectOption("both");
await page.getByRole("button", { name: "Apply & generate" }).click();
await page.waitForTimeout(200);
assert.equal(
  await page.locator(".notation svg").getAttribute("data-staff-count"),
  "2",
);
await page.getByRole("button", { name: "Start practice", exact: true }).click();
const pitches = (await page.getByTestId("target").getAttribute("data-pitches"))
  .split(",")
  .map(Number);
assert.equal(pitches.length, 2);
// Mouse gestures are deliberately simultaneous, within the 200ms target window.
for (const p of pitches) await page.locator(`[data-midi="${p}"]`).click();
assert.equal(
  await page.locator(".stat").first().locator("strong").innerText(),
  "2",
);
await page.getByRole("button", { name: "Pause", exact: true }).click();
await page.getByLabel("Fingering assistance").selectOption("all");
await page.waitForTimeout(200);
assert.ok(
  (await page
    .locator("svg text")
    .filter({ hasText: /^[1-5]$/ })
    .count()) > 0,
);
await page.getByLabel("Fingering assistance").selectOption("hidden");
await page.waitForTimeout(200);
assert.equal(
  await page
    .locator("svg text")
    .filter({ hasText: /^[1-5]$/ })
    .count(),
  0,
);
await page.setViewportSize({ width: 1024, height: 768 });
await page.waitForTimeout(300);
assert.ok(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
);
await page.screenshot({ path: ".tools/tablet.png", fullPage: true });
assert.deepEqual(errors, []);
console.log(
  "PASS: SVG, full guided phrase, endless continuation, recorded progress, grand staff, two-hand scoring, hidden hints, desktop/tablet layout.",
);
await context.close();
await browser.close();
