import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { db, record, importSessions, csv } from "./store";
import {
  defaults,
  fingerprint,
  legacySettingsSchema,
  settingsSchema,
  v2SettingsSchema,
  v3SettingsSchema,
  v4SettingsSchema,
} from "../score/model";
import { applyHandMovements } from "../practice/presets";
it("persists and reloads each hand range independently", async () => {
  const settings = { ...defaults, min: 72, max: 84, leftMin: 33, leftMax: 52 };
  await db.preferences.put({ id: "range-settings", settings });
  const saved = (await db.preferences.get("range-settings"))!;
  expect(settingsSchema.parse(saved.settings)).toEqual(settings);
  const updated = { ...saved.settings, leftMin: 36, leftMax: 57 };
  await db.preferences.put({ id: "range-settings", settings: updated });
  expect(
    settingsSchema.parse(
      (await db.preferences.get("range-settings"))!.settings,
    ),
  ).toEqual(updated);
  expect(fingerprint(settings)).not.toBe(fingerprint(updated));
  const session = record("range-session", "range-seed", updated, 0, []);
  await importSessions(
    JSON.stringify({ format: "sightflow-1", sessions: [session] }),
  );
  expect((await db.sessions.get(session.id))!.settings).toEqual(updated);
});

it("migrates shared left-only preferences once and preserves right/both preferences", () => {
  for (const schema of [
    legacySettingsSchema,
    v2SettingsSchema,
    v3SettingsSchema,
    v4SettingsSchema,
  ]) {
    const old = schema.parse({
      ...defaults,
      hints: "all",
      hand: "left",
      min: 57,
      max: 76,
      leftMin: 36,
      leftMax: 55,
    });
    const migrated = settingsSchema.parse(old);
    expect(migrated).toMatchObject({
      rangeVersion: 2,
      min: 57,
      max: 76,
      leftMin: 57,
      leftMax: 76,
    });
    const edited = { ...migrated, leftMin: 45, leftMax: 64 };
    expect(settingsSchema.parse(edited)).toEqual(edited);
    for (const hand of ["right", "both"]) {
      expect(settingsSchema.parse({ ...old, hand })).toMatchObject({
        min: 57,
        max: 76,
        leftMin: 36,
        leftMax: 55,
      });
    }
  }
  expect(
    settingsSchema.parse({ hand: "left", min: 48, max: 55 }),
  ).toMatchObject({ leftMin: 48, leftMax: 55 });
  expect(settingsSchema.safeParse({ ...defaults, min: 20 }).success).toBe(
    false,
  );
  expect(settingsSchema.safeParse({ ...defaults, leftMax: 109 }).success).toBe(
    false,
  );
});

it("retains v4 backups and fingerprints without migrating historical left-only bounds", async () => {
  const settings = v4SettingsSchema.parse({
    ...defaults,
    hand: "left",
    min: 60,
    max: 79,
    leftMin: 36,
    leftMax: 55,
  });
  const session = {
    id: "v4-ranges",
    date: 100,
    seed: "old-left",
    settings,
    fingerprint: "4.0.0:" + JSON.stringify(settings) + "|assistance:assisted",
    ms: 0,
    results: [],
    assistanceUsed: true,
    generatorVersion: "4.0.0",
  };
  await importSessions(
    JSON.stringify({ format: "sightflow-1", sessions: [session] }),
  );
  expect(await db.sessions.get(session.id)).toEqual(session);
  expect(fingerprint(settingsSchema.parse(settings))).not.toBe(
    session.fingerprint,
  );
  await expect(
    importSessions(
      JSON.stringify({
        format: "sightflow-1",
        sessions: [{ ...session, settings: { ...settings, leftMin: 37 } }],
      }),
    ),
  ).rejects.toThrow(/fingerprint/);
});
it("roundtrips validated IndexedDB sessions and exports real metrics", async () => {
  const s = record("fixture", "seed", defaults, 1000, [
    { id: "a", pitch: 60, hand: "right", kind: "correct", first: true },
  ]);
  await db.sessions.put(s);
  expect(await db.sessions.get("fixture")).toEqual(s);
  await db.sessions.clear();
  expect(
    await importSessions(
      JSON.stringify({ format: "sightflow-1", sessions: [s] }),
    ),
  ).toBe(1);
  expect(csv([s])).toContain("wait,1,0,0,0,100.00,60.00");
  await expect(importSessions('{"format":"bad"}')).rejects.toThrow();
  await expect(
    importSessions(
      JSON.stringify({
        format: "sightflow-1",
        sessions: [
          { ...s, settings: { ...s.settings, fingerSpacing: "invalid" } },
        ],
      }),
    ),
  ).rejects.toThrow();
});
it("preserves v3 history verbatim while new preferences default both dimensions Off", async () => {
  const settings = v3SettingsSchema.parse(defaults);
  const old = {
    id: "v3",
    date: 100,
    seed: "old-v3",
    settings,
    fingerprint: "3.0.0:" + JSON.stringify(settings) + "|assistance:assisted",
    ms: 1000,
    results: [],
    assistanceUsed: true,
    generatorVersion: "3.0.0",
  };
  await importSessions(
    JSON.stringify({ format: "sightflow-1", sessions: [old] }),
  );
  expect(await db.sessions.get("v3")).toEqual(old);
  expect(settingsSchema.parse(settings)).toMatchObject({
    accidentals: "off",
    chords: "off",
  });
  expect(fingerprint({ ...defaults, chords: "easy" })).not.toBe(
    fingerprint(defaults),
  );
  expect(fingerprint({ ...defaults, accidentals: "easy" })).not.toBe(
    fingerprint(defaults),
  );
});
it("roundtrips real per-notehead and chord outcomes in JSON and CSV", async () => {
  const results = [60, 64, 67].map((pitch, i) => ({
    id: `chord:${i}`,
    pitch,
    hand: "right",
    kind: "correct" as const,
    first: true,
    eventId: "chord",
    eventSize: 3,
    simultaneous: true,
  }));
  const saved = record(
    "chord-history",
    "seed",
    { ...defaults, chords: "medium", accidentals: "easy" },
    1500,
    results,
  );
  await importSessions(
    JSON.stringify({ format: "sightflow-1", sessions: [saved] }),
  );
  expect((await db.sessions.get(saved.id))?.results).toEqual(results);
  expect(csv([saved])).toContain(",1,1,100.00");
});
it("separates movement settings and assistance in progress comparisons", () => {
  const s = applyHandMovements(
    {
      ...defaults,
      noteJumps: "large" as const,
      interval: 7,
      max: 84,
      hints: "hidden",
    },
    "hard",
  );
  expect(fingerprint(s, true)).not.toBe(fingerprint(s, false));
  expect(fingerprint(s)).not.toBe(fingerprint({ ...s, maxShift: 1 }));
  expect(fingerprint(s)).not.toBe(fingerprint({ ...s, shiftFrequency: 0 }));
  expect(fingerprint(s)).not.toBe(fingerprint({ ...s, interval: 2 }));
  expect(fingerprint(s)).not.toBe(fingerprint({ ...s, hints: "all" }));
  expect(fingerprint(s)).not.toBe(fingerprint({ ...s, fingerSpacing: "hard" }));
  expect(fingerprint(s)).not.toBe(
    fingerprint({ ...s, handMovements: "medium" }),
  );
  expect(fingerprint(s)).not.toBe(fingerprint({ ...s, noteJumps: "medium" }));
});
it("preserves v2 history/fingerprints while migrating active preferences to independent controls", async () => {
  const settings = v2SettingsSchema.parse({
    difficulty: "hard",
    shiftFrequency: 0.85,
    maxShift: 4,
    interval: 7,
  });
  const old = {
    id: "v2",
    date: 100,
    seed: "v2-seed",
    settings,
    fingerprint: "2.0.0:" + JSON.stringify(settings) + "|assistance:assisted",
    ms: 100,
    results: [],
    assistanceUsed: true,
    generatorVersion: "2.0.0",
  };
  await importSessions(
    JSON.stringify({ format: "sightflow-1", sessions: [old] }),
  );
  const saved = (await db.sessions.get("v2"))!;
  expect(saved.settings).toEqual(settings);
  expect(saved.fingerprint).toBe(old.fingerprint);
  expect(saved.fingerprint).not.toBe(
    fingerprint(settingsSchema.parse(settings)),
  );
  await expect(
    importSessions(
      JSON.stringify({ format: "sightflow-1", sessions: [saved] }),
    ),
  ).resolves.toBe(1);
  expect(settingsSchema.parse(settings)).toMatchObject({
    noteJumps: "large",
    handMovements: "hard",
    fingerSpacing: "off",
    interval: 7,
  });
});
it("retains legacy history through backup import without mixing its generator version", async () => {
  const settings = legacySettingsSchema.parse({ hints: "starts" });
  const s = {
    id: "legacy",
    date: 100,
    seed: "old-seed",
    settings,
    fingerprint: "1.0.0:" + JSON.stringify(settings),
    ms: 1000,
    results: [],
  };
  await importSessions(
    JSON.stringify({ format: "sightflow-1", sessions: [s] }),
  );
  const saved = (await db.sessions.get("legacy"))!;
  expect(saved.generatorVersion).toBe("1.0.0");
  expect(saved.settings.hints).toBe("reveal");
  expect(saved.fingerprint).toBe(s.fingerprint);
  await expect(
    importSessions(
      JSON.stringify({ format: "sightflow-1", sessions: [saved] }),
    ),
  ).resolves.toBe(1);
  await expect(
    importSessions(
      JSON.stringify({
        format: "sightflow-1",
        sessions: [
          { ...saved, settings: { ...saved.settings, hints: "hidden" } },
        ],
      }),
    ),
  ).rejects.toThrow(/fingerprint/);
});
