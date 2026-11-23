import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ save: vi.fn(async () => {}) }));
vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  registerPlugin: () => native,
}));
vi.mock("../progress/store", () => ({ download: vi.fn() }));

import { Capacitor } from "@capacitor/core";
import { download as browserDownload } from "../progress/store";
import { download } from "./download";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("keeps the original browser JSON/CSV download path", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("web");
  await download(
    "clefglide-progress.json",
    '{"format":"sightflow-1","sessions":[]}',
  );
  expect(browserDownload).toHaveBeenCalledWith(
    "clefglide-progress.json",
    '{"format":"sightflow-1","sessions":[]}',
    "application/json",
  );
  expect(native.save).not.toHaveBeenCalled();
});

it("passes identical backup text and MIME type to Android's document picker", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  const body = "date,mode\n2026-11-23,Üben\n";
  await download("clefglide-progress.csv", body, "text/csv");
  expect(native.save).toHaveBeenCalledWith({
    name: "clefglide-progress.csv",
    body,
    type: "text/csv",
  });
  expect(browserDownload).not.toHaveBeenCalled();
});

it("surfaces native file errors to the existing error UI", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  native.save.mockRejectedValueOnce(new Error("Destination unavailable"));
  await expect(download("clefglide-progress.json", "{}")).rejects.toThrow(
    "Destination unavailable",
  );
});
