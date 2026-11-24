import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db, record } from "./store";
import {
  defaultProfiles,
  loadPracticePreferences,
  savePracticePreferences,
} from "./preferences";
import { defaults, v4SettingsSchema } from "../score/model";
import { defaultPractice, type PracticeSetup } from "../practice/configuration";
import { movingTrebleWithHeldBass } from "../generation/examples";
import { resolveGeneratorConfig } from "../generation/config";

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
  await db.table("preferences").update("practice-v2", { duration: 99 });
  expect((await loadPracticePreferences()).duration).toBe(0);
});
it.each(["right", "left", "both"] as const)(
  "migrates the %s profile to a fixed beginner configuration without changing history",
  async (hand) => {
    const legacy = v4SettingsSchema.parse({
      ...defaults,
      hand,
      min: 60,
      max: 76,
      rhClef: "bass",
      bpm: 85,
      hints: "reveal",
      mode: "timed",
      handMovements: "hard",
      chords: "hard",
      accidentals: "hard",
    });
    const session = record("history", "seed", defaults, 42, []);
    await db.sessions.put(session);
    await db.preferences.put({
      id: "settings",
      settings: { ...legacy, noteJumps: "obsolete-label" },
      duration: 3,
      midiChannel: 5,
    });
    const restored = await loadPracticePreferences();
    expect(restored).toMatchObject({
      duration: 3,
      midiChannel: 5,
      setup: {
        profile: "guided",
        options: { bpm: 85, hints: "smart", mode: "timed" },
        config: {
          hands: { active: hand, right: { min: 60, max: 76, clef: "bass" } },
          movement: { kind: "fixed" },
          chromatic: { kind: "diatonic" },
          chords: { kind: "single-notes" },
        },
      },
    });
    if (hand === "left")
      expect(restored.setup.config.hands.left).toMatchObject({
        min: 60,
        max: 76,
      });
    for (const other of ["right", "left", "both"] as const)
      if (other !== hand)
        expect(restored.guided[other]).toEqual(defaultProfiles()[other]);
    await savePracticePreferences({ duration: 5 });
    expect((await loadPracticePreferences()).guided[hand]).toEqual(
      restored.setup,
    );
    expect(await db.sessions.get("history")).toEqual(session);
  },
);
it("persists the complete custom profile and merges concurrent playback preference updates", async () => {
  const guided = defaultProfiles();
  guided.right = {
    ...defaultPractice,
    config: resolveGeneratorConfig({
      hands: { right: { min: 72, max: 84 } },
      notation: { key: "G" },
    }),
    options: { ...defaultPractice.options, bpm: 88 },
  };
  const custom: PracticeSetup = {
    ...defaultPractice,
    profile: "custom",
    config: movingTrebleWithHeldBass(),
  };
  await Promise.all([
    savePracticePreferences({
      setup: custom,
      custom,
      guided,
      guidedHand: "right",
    }),
    savePracticePreferences({ duration: 3 }),
    savePracticePreferences({ midiChannel: 11, metronome: true }),
  ]);
  db.close();
  await db.open();
  const restored = await loadPracticePreferences();
  expect(restored).toMatchObject({
    setup: custom,
    custom,
    guided,
    duration: 3,
    midiChannel: 11,
    metronome: true,
  });
  expect(Object.isFrozen(restored.setup.config)).toBe(true);
});
