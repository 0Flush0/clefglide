import { expect, test } from "@playwright/test";

test("engraves articulation and both clipped ends of a streamed slur", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const fixture = "/e2e/fixtures/articulation.tsx";
    const { mountArticulation } = await import(fixture);
    for (const bar of [2, 4]) {
      const host = document.createElement("section");
      host.id = `articulation-${bar}`;
      document.body.append(host);
      mountArticulation(host, bar);
    }
  });
  const outgoing = page.locator('#articulation-2 [data-clipped-end="true"]');
  await expect(outgoing).toHaveCount(1);
  const id = await outgoing.getAttribute("data-slur-id");
  const incoming = page.locator('#articulation-4 [data-clipped-start="true"]');
  await expect(incoming).toHaveAttribute("data-slur-id", id!);
  await expect(outgoing.locator("path").first()).toHaveAttribute("d", /C/);
  await expect(incoming.locator("path").first()).toHaveAttribute("d", /C/);
  await expect(page.locator("#articulation-2 svg")).toContainText(
    /[\uE4AC\uE4AD]/u,
  );
  await expect(page.locator("#articulation-4 svg")).toContainText(
    /[\uE4A6\uE4A7]/u,
  );
});
