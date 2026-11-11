import Dexie, { type Table } from "dexie";
import { z } from "zod";
import {
  settingsSchema,
  settingsValuesSchema,
  v3SettingsSchema,
  v2SettingsSchema,
  legacySettingsSchema,
  fingerprint,
  VERSION,
  automaticAssistance,
  type Settings,
} from "../score/model";
import { difficultySummary } from "../generation/difficulty";
import { metrics, type Result } from "../scoring/engine";
const resultSchema = z.object({
  id: z.string(),
  pitch: z.number().int().min(0).max(127),
  hand: z.string(),
  kind: z.enum(["correct", "wrong", "extra", "miss", "skip"]),
  first: z.boolean(),
  errorMs: z.number().optional(),
  latency: z.number().optional(),
  eventId: z.string().optional(),
  eventSize: z.number().int().min(1).max(4).optional(),
  simultaneous: z.boolean().optional(),
});
const sessionBase = z.object({
  id: z.string(),
  date: z.number(),
  seed: z.string(),
  fingerprint: z.string(),
  ms: z.number().nonnegative(),
  results: z.array(resultSchema),
  assistanceUsed: z.boolean().default(false),
});
export const sessionSchema = z.preprocess(
  (input) =>
    input && typeof input === "object"
      ? { generatorVersion: "1.0.0", ...input }
      : input,
  z.discriminatedUnion("generatorVersion", [
    sessionBase.extend({
      generatorVersion: z.literal("1.0.0"),
      settings: v2SettingsSchema,
    }),
    sessionBase.extend({
      generatorVersion: z.literal("2.0.0"),
      settings: v2SettingsSchema,
    }),
    sessionBase.extend({
      generatorVersion: z.literal("3.0.0"),
      settings: v3SettingsSchema,
    }),
    sessionBase.extend({
      generatorVersion: z.literal("4.0.0"),
      settings: settingsValuesSchema,
    }),
  ]),
);
export type Session = z.infer<typeof sessionSchema>;
class Database extends Dexie {
  sessions!: Table<Session, string>;
  preferences!: Table<{ id: string; settings: Settings }, string>;
  constructor() {
    super("sightflow");
    this.version(1).stores({
      sessions: "id,date,fingerprint",
      preferences: "id",
    });
  }
}
export const db = new Database();
export function record(
  id: string,
  seed: string,
  settings: Settings,
  ms: number,
  results: Result[],
  assistanceUsed = automaticAssistance(settings),
): Session {
  return sessionSchema.parse({
    id,
    date: Date.now(),
    seed,
    settings,
    fingerprint: fingerprint(settings, assistanceUsed),
    generatorVersion: VERSION,
    assistanceUsed,
    ms,
    results,
  });
}
export async function importSessions(text: string) {
  const data = z
    .object({
      format: z.literal("sightflow-1"),
      sessions: z.array(sessionSchema).max(10000),
    })
    .parse(JSON.parse(text));
  for (const s of data.sessions) {
    const legacyHints =
      s.settings.hints === "reveal" ? ["reveal", "starts"] : [s.settings.hints];
    const valid =
      s.generatorVersion === VERSION
        ? s.fingerprint ===
          fingerprint(settingsSchema.parse(s.settings), s.assistanceUsed)
        : s.generatorVersion === "3.0.0"
          ? s.fingerprint ===
            "3.0.0:" +
              JSON.stringify(v3SettingsSchema.parse(s.settings)) +
              `|assistance:${s.assistanceUsed ? "assisted" : "unassisted"}`
          : s.generatorVersion === "2.0.0"
            ? s.fingerprint ===
              "2.0.0:" +
                JSON.stringify(v2SettingsSchema.parse(s.settings)) +
                `|assistance:${s.assistanceUsed ? "assisted" : "unassisted"}`
            : legacyHints.some((hints) => {
                const legacy = legacySettingsSchema.safeParse({
                  ...s.settings,
                  hints,
                });
                return (
                  legacy.success &&
                  s.fingerprint === "1.0.0:" + JSON.stringify(legacy.data)
                );
              });
    if (!valid) throw new Error("Difficulty fingerprint mismatch.");
  }
  await db.sessions.bulkPut(data.sessions);
  return data.sessions.length;
}
export function download(
  name: string,
  body: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(sessions: Session[]) {
  return [
    "date,mode,correct,wrong,missed,skipped,first_attempt_accuracy,correct_per_minute,difficulty,hints,assistance_used,generator_version,chord_events,chord_correct,chord_accuracy",
    ...sessions.map((s) => {
      const m = metrics(s.results, s.ms, s.settings.tolerance);
      return [
        new Date(s.date).toISOString(),
        s.settings.mode,
        m.correct,
        m.wrong,
        m.missed,
        m.skipped,
        s.results.length ? m.accuracy.toFixed(2) : "",
        m.npm.toFixed(2),
        "noteJumps" in s.settings
          ? difficultySummary(s.settings)
          : (s.settings.difficulty ?? "legacy-fixed"),
        s.settings.hints,
        s.assistanceUsed ?? "unknown",
        s.generatorVersion ?? "1.0.0",
        m.chordEvents,
        m.chordCorrect,
        m.chordEvents ? m.chordAccuracy.toFixed(2) : "",
      ].join(",");
    }),
  ].join("\n");
}
