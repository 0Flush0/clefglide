import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db, record } from "./store";
import {
  defaultProfiles,
  loadPracticePreferences,
  savePracticePreferences,
} from "./preferences";
import { defaults, v4SettingsSchema } from "../score/model";

beforeEach(async () => {
  await db.preferences.clear();
  await db.sessions.clear();
});
it("keeps the duration default and restores each supported saved duration", async () => {
  expect((await loadPracticePreferences()).duration).toBe(0);
  for (const duration of [3, 5, 0] as const) {
    await savePracticePreferences({ duration });
    db.close();
    await db.open();
    expect((await loadPracticePreferences()).duration).toBe(duration);
  }
  await db.table("preferences").update("settings", { duration: 99 });
  expect((await loadPracticePreferences()).duration).toBe(0);
});
it.each(["right", "left", "both"] as const)(
  "migrates only the matching %s profile without changing history",
  async (hand) => {
    const legacy = v4SettingsSchema.parse({
      ...defaults,
      hand,
      min: 60,
      max: 76,
      bpm: 85,
      hints: "reveal",
    });
    const session = record("history", "seed", defaults, 42, []);
    await db.sessions.put(session);
    await db.table("preferences").put({ id: "settings", settings: legacy });
    const restored = await loadPracticePreferences();
    expect(restored.settings).toMatchObject({ hand, bpm: 85, hints: "smart" });
    if (hand === "left")
      expect(restored.settings).toMatchObject({ leftMin: 60, leftMax: 76 });
    for (const other of ["right", "left", "both"] as const)
      if (other !== hand)
        expect(restored.profiles[other]).toEqual(defaultProfiles()[other]);
    await savePracticePreferences({ duration: 5 });
    expect((await loadPracticePreferences()).profiles[hand]).toEqual(
      restored.settings,
    );
    expect(await db.sessions.get("history")).toEqual(session);
  },
);
it("persists complete independent profiles and merges concurrent duration updates", async () => {
  const profiles = defaultProfiles();
  profiles.right = {
    ...profiles.right,
    min: 72,
    max: 84,
    key: "G",
    bpm: 88,
    rhythm: "mixed",
    tolerance: 120,
  };
  profiles.left = {
    ...profiles.left,
    leftMin: 33,
    leftMax: 57,
    key: "F",
    bpm: 70,
    beats: 3,
    fingerSpacing: "hard",
  };
  profiles.both = {
    ...profiles.both,
    accidentals: "hard",
    chords: "medium",
    offset: 32,
    hints: "hidden",
  };
  await Promise.all([
    ...Object.values(profiles).map((profile) =>
      savePracticePreferences({ profile }),
    ),
    savePracticePreferences({ duration: 3 }),
  ]);
  await savePracticePreferences({
    selectedHand: "left",
    settings: profiles.left,
  });
  const restored = await loadPracticePreferences();
  expect(restored.profiles).toEqual(profiles);
  expect(restored.settings).toEqual(profiles.left);
  expect(restored.duration).toBe(3);
});
