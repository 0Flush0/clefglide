import { afterEach, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { configureAndroidLayout } from "./layout";

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = "";
  delete document.documentElement.dataset.platform;
});

it("leaves the regular browser viewport and platform attributes untouched", () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("web");
  document.head.innerHTML =
    '<meta name="viewport" content="width=device-width,initial-scale=1">';
  const before = document.head.innerHTML;
  configureAndroidLayout();
  expect(document.head.innerHTML).toBe(before);
  expect(document.documentElement.dataset.platform).toBeUndefined();
});

it.each([
  "width=device-width,initial-scale=1",
  "width=device-width,viewport-fit=contain",
])(
  "enables native edge-to-edge without removing viewport options (%s)",
  (content) => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
    document.head.innerHTML = `<meta name="viewport" content="${content}">`;
    configureAndroidLayout();
    configureAndroidLayout();
    const viewport = document.querySelector<HTMLMetaElement>(
      'meta[name="viewport"]',
    )!;
    expect(viewport.content).toContain("width=device-width");
    expect(viewport.content.match(/viewport-fit=/g)).toHaveLength(1);
    expect(viewport.content).toContain("viewport-fit=cover");
    expect(document.documentElement.dataset.platform).toBe("android");
  },
);
