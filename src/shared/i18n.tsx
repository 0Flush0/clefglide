import { createContext, useContext } from "react";
import { german } from "./translations";

export type Language = "en" | "de";
export const languageKey = "sightflow-language";
export const LanguageContext = createContext<Language>("en");

export function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(languageKey);
    if (saved === "de" || saved === "en") return saved;
  } catch {
    /* Practice also works when browser storage is disabled. */
  }
  return (navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  ).some((language) => /^de(?:-|$)/i.test(language))
    ? "de"
    : "en";
}

// Translation happens at the presentation boundary; stored settings, MIDI data,
// exercise seeds and comparison fingerprints keep their canonical values.
const templates = Object.entries(german)
  .filter(([source]) => source.includes("{n}"))
  .sort((a, b) => b[0].length - a[0].length)
  .map(([source, target]) => ({
    pattern: new RegExp(
      "^" +
        source
          .split("{n}")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("(.+?)") +
        "$",
    ),
    target,
  }));

export function translate<T>(value: T, language: Language): T {
  if (language !== "de" || typeof value !== "string") return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  const exact = german[normalized];
  if (exact)
    return (value.match(/^\s*/)?.[0] + exact + value.match(/\s*$/)?.[0]) as T;
  for (const { pattern, target } of templates) {
    const matches = pattern.exec(value);
    if (matches) {
      let index = 1;
      return target.replace(/\{n\}/g, () =>
        translate(matches[index++], language),
      ) as T;
    }
  }
  const result = value;
  return result as T;
}

export function useTranslation() {
  const language = useContext(LanguageContext);
  return <T,>(value: T): T => translate(value, language);
}
