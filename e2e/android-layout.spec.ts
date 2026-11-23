import { test, expect } from "@playwright/test";

// Browser layout simulation only. This does not run Android or verify its bars.
test("Android paints to the edge while content clears dynamic safe areas", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, { CapacitorCustomPlatform: { name: "android" } });
    localStorage.setItem("sightflow-language", "en");
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-platform",
    "android",
  );
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );

  for (const size of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    for (const dark of [false, true]) {
      for (const inset of [
        { top: 32, bottom: 24, left: 0, right: 0 },
        { top: 24, bottom: 48, left: 44, right: 24 },
        // Capacitor's native fallback zeros CSS insets on older WebViews.
        { top: 0, bottom: 0, left: 0, right: 0 },
      ]) {
        await page.evaluate(
          ({ dark, inset }) => {
            document.documentElement.dataset.theme = dark ? "dark" : "light";
            for (const [side, value] of Object.entries(inset)) {
              document.documentElement.style.setProperty(
                `--android-safe-${side}`,
                `${value}px`,
              );
            }
            document.querySelector(".app-shell > main")!.scrollTo(0, 0);
          },
          { dark, inset },
        );

        const layout = await page.evaluate(() => {
          const rail = document.querySelector<HTMLElement>(".rail")!;
          const main =
            document.querySelector<HTMLElement>(".app-shell > main")!;
          const box = rail.getBoundingClientRect();
          return {
            railBottom: box.bottom,
            railBackground: getComputedStyle(rail).backgroundColor,
            railPaintsBottom: !!document
              .elementFromPoint(box.width / 2, innerHeight - 1)
              ?.closest(".rail"),
            brandTop: document.querySelector(".brand")!.getBoundingClientRect()
              .top,
            headingTop: document
              .querySelector(".page-heading h1")!
              .getBoundingClientRect().top,
            mainTopPadding: parseFloat(getComputedStyle(main).paddingTop),
            mainBottomPadding: parseFloat(getComputedStyle(main).paddingBottom),
            mainRightPadding: parseFloat(getComputedStyle(main).paddingRight),
            horizontalOverflow:
              document.documentElement.scrollWidth > innerWidth,
          };
        });
        expect(layout.brandTop).toBeGreaterThanOrEqual(inset.top);
        expect(layout.headingTop).toBeGreaterThanOrEqual(inset.top);
        expect(layout.mainTopPadding).toBe(size.width <= 700 ? 0 : inset.top);
        expect(layout.mainBottomPadding).toBe(inset.bottom);
        expect(layout.mainRightPadding).toBe(inset.right);
        expect(layout.horizontalOverflow).toBe(false);
        if (size.width > 700) {
          expect(layout.railBottom).toBe(size.height);
          expect(layout.railBackground).toBe("rgb(20, 47, 44)");
          expect(layout.railPaintsBottom).toBe(true);
        }
        await page
          .locator(".app-shell > main")
          .evaluate((node) => node.scrollTo(0, node.scrollHeight));
        const footerBottom = await page
          .locator("footer")
          .evaluate((node) => node.getBoundingClientRect().bottom);
        expect(footerBottom).toBeLessThanOrEqual(
          size.height - inset.bottom + 1,
        );
      }
    }
  }
});

test("Android main content scrolls independently without moving its navigation", async ({
  page,
}) => {
  await page.goto("/");
  // Exercise Android CSS without pretending that browser tests run native bars.
  await page.evaluate(() => {
    document.documentElement.dataset.platform = "android";
    document.documentElement.style.setProperty("--android-safe-top", "32px");
    document.documentElement.style.setProperty("--android-safe-bottom", "24px");
  });
  const main = page.locator(".app-shell > main");
  const rail = page.locator(".rail");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await main.evaluate((node) => node.scrollTo(0, 0));
    const before = await rail.boundingBox();
    const bounds = (await main.boundingBox())!;
    expect(
      await main.evaluate((node) => getComputedStyle(node).overscrollBehaviorY),
    ).toBe("contain");
    expect(
      await main.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);

    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => main.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    expect(await rail.boundingBox()).toEqual(before);

    await main.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await page.mouse.wheel(0, 1000);
    await expect
      .poll(() =>
        main.evaluate(
          (node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1,
        ),
      )
      .toBe(true);
    expect(await rail.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Navigation remains clickable at the scroll boundary, including phone headers.
    await page.getByRole("tab", { name: "Progress", exact: true }).click();
    await expect(
      page.getByRole("tabpanel", { name: "Progress", exact: true }),
    ).toBeVisible();
    expect(await rail.boundingBox()).toEqual(before);
    await page.getByRole("tab", { name: "Practice", exact: true }).click();
  }
});

test("regular web pages keep their existing viewport and spacing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-platform",
    "android",
  );
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    "width=device-width,initial-scale=1",
  );
  const padding = await page.locator(".app-shell > main").evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.paddingTop, style.paddingBottom];
  });
  expect(padding).toEqual(["0px", "0px"]);
});
