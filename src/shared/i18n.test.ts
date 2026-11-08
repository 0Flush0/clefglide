import { afterEach, describe, expect, it, vi } from "vitest";
import { initialLanguage, languageKey, translate } from "./i18n";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("language preference", () => {
  it("detects German regional browser languages on first visit", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-AT", "en"]);
    expect(initialLanguage()).toBe("de");
  });
  it("keeps an explicit English choice for a German browser", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
    localStorage.setItem(languageKey, "en");
    expect(initialLanguage()).toBe("en");
  });
  it("falls back to English and ignores invalid stored preferences", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    localStorage.setItem(languageKey, "invalid");
    expect(initialLanguage()).toBe("en");
  });
  it("still detects language when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw Error("blocked");
    });
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-CH"]);
    expect(initialLanguage()).toBe("de");
  });
});
describe("German presentation", () => {
  it("translates numbers and planned hand movements without changing pitches", () => {
    expect(translate("3 wrong · 2 missed · 1 skipped", "de")).toBe(
      "3 falsch · 2 verpasst · 1 übersprungen",
    );
    expect(
      translate(
        "Bar 12 · Move right hand: thumb to C4, position C4–G4. Land on D4 with finger 2.",
        "de",
      ),
    ).toBe(
      "Takt 12 · rechte Hand versetzen: Daumen auf C4, Position C4–G4. Auf D4 mit Finger 2 landen.",
    );
    expect(translate(" Start on C4 with finger 1.", "de")).toBe(
      " Beginne auf C4 mit Finger 1.",
    );
  });
  it("preserves canonical values and English messages", () => {
    expect(translate(60, "de")).toBe(60);
    expect(translate("C4", "de")).toBe("C4");
    expect(translate("Start practice", "en")).toBe("Start practice");
  });
});
