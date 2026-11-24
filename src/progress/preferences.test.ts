import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db, record, recordConfigured } from "./store";
import {
  defaultProfiles,
  loadPracticePreferences,
  savePracticePreferences,
} from "./preferences";
import { defaults, v4SettingsSchema } from "../score/model";
import {
  atGuidedLevel,
  defaultPractice,
  type PracticeSetup,
} from "../practice/configuration";
import { curriculum, curriculumVersion } from "../practice/curriculum";
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

it("stages an equivalent current level from a v1 selection while retaining its exercise and history", async () => {
  const previous: PracticeSetup = {
    profile: "guided",
    config: resolveGeneratorConfig({ melody: { maxIntervalSteps: 3 } }),
    options: { ...defaultPractice.options, bpm: 81, mode: "timed" },
    level: { id: "right-skip", version: 1 },
  };
  const guided = defaultProfiles();
  guided.right = previous;
  const session = recordConfigured(
    "legacy-study",
    "v1",
    previous,
    2000,
    false,
    {
      results: [
        {
          id: "v1-note",
          pitch: 60,
          hand: "right",
          kind: "correct",
          first: true,
        },
      ],
      finished: true,
      durationResults: [],
      articulationResults: [],
    },
  );
  await db.sessions.put(session);
  await db.preferences.put({
    id: "practice-v2",
    guided,
    guidedHand: "right",
    setup: previous,
    seed: "v1",
  });
  const restored = await loadPracticePreferences();
  expect(restored.setup).toEqual(previous);
  expect(restored.draft).toMatchObject({
    level: { id: "right-skip", version: 2 },
    options: { bpm: 60, mode: "timed" },
  });
  expect(restored.guided.right).toEqual(restored.draft);
  expect(restored.guidedStages.right?.["rhythmic-fluency"]).toEqual(
    restored.draft?.level,
  );
  expect(restored.guided.left).toEqual(guided.left);
  expect(await db.sessions.get(session.id)).toEqual(session);
});

it("remembers each track's most recent staged level for every visited stage", async () => {
  const guided = defaultProfiles();
  await db.preferences.put({
    id: "practice-v2",
    setup: guided.right,
    guided,
    guidedHand: "right",
  });

  const select = (hand: keyof typeof curriculum, index: number) =>
    atGuidedLevel(curriculum[hand][index], defaultPractice.options);
  const earlier = select("right", 1);
  const latest = select("right", 3);
  const fluency = select("right", 11);
  const leftFluency = select("left", 10);
  const duet = select("both", 11);
  for (const draft of [earlier, latest, fluency, leftFluency, duet]) {
    await savePracticePreferences({ draft });
  }
  // Applying settings to the active exercise alone must not replace a staged selection.
  await savePracticePreferences({ setup: earlier, metronome: true });
  db.close();
  await db.open();
  const restored = await loadPracticePreferences();
  expect(restored.guidedStages).toMatchObject({
    right: {
      foundations: latest.level,
      "rhythmic-fluency": fluency.level,
    },
    left: { "rhythmic-fluency": leftFluency.level },
    both: { coordination: duet.level },
  });
  expect(restored.guidedStages.left?.foundations).toEqual({
    id: "left-read",
    version: curriculumVersion,
  });
  expect(restored.draft).toEqual(duet);
  expect(restored.setup).toEqual(earlier);
});
