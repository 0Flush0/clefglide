import { afterEach, expect, it, vi } from "vitest";
import { createLocalId } from "./ids";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([undefined, {}, { randomUUID: undefined, getRandomValues: undefined }])(
  "creates local IDs with missing Web Crypto: %j",
  (crypto) => {
    vi.stubGlobal("crypto", crypto);
    vi.stubGlobal("isSecureContext", false);
    expect(createLocalId("session")).toMatch(/^session-/);
    expect(createLocalId("exercise")).toMatch(/^exercise-/);
  },
);

it("does not invoke crypto even when its methods are present but unavailable", () => {
  const unavailable = vi.fn(() => {
    throw new Error("Unavailable on this origin");
  });
  vi.stubGlobal("crypto", {
    randomUUID: unavailable,
    getRandomValues: unavailable,
  });
  expect(createLocalId()).toMatch(/^ui-/);
  expect(unavailable).not.toHaveBeenCalled();
});

it("keeps distinct IDs under a fixed clock and random source without truncating seeds", () => {
  vi.spyOn(Date, "now").mockReturnValue(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
  const ids = Array.from({ length: 10000 }, () => createLocalId("exercise"));
  expect(new Set(ids).size).toBe(10000);
});
