import { z } from "zod";
import { settingsValuesSchema } from "../score/model";
import { resolveGeneratorConfig } from "../generation/config";
import { legacyRhythms } from "../generation/config/presets";
import {
  defaultPractice,
  defaultExerciseSeed,
  guidedPractice,
  practiceOptionsSchema,
  savedSetupSchema,
  type PracticeSetup,
} from "../practice/configuration";
import { db } from "./store";

const hands = ["right", "left", "both"] as const;
const handSchema = z.enum(hands);
type HandSelection = z.infer<typeof handSchema>;
export type GuidedProfiles = Record<HandSelection, PracticeSetup>;
export type PracticeDuration = 0 | 3 | 5;
export function defaultProfiles(): GuidedProfiles {
  return {
    right: defaultPractice,
    left: guidedPractice("left"),
    both: guidedPractice("both"),
  };
}

const currentPreferences = z.object({
  setup: savedSetupSchema,
  seed: z.string().default(defaultExerciseSeed),
  guided: z.record(handSchema, savedSetupSchema),
  guidedHand: handSchema,
  custom: savedSetupSchema.optional(),
  duration: z.union([z.literal(0), z.literal(3), z.literal(5)]).catch(0),
  midiChannel: z.number().int().min(0).max(16).catch(0),
  metronome: z.boolean().catch(false),
});
const legacyPreferences = settingsValuesSchema
  .pick({
    hand: true,
    key: true,
    beats: true,
    rhythm: true,
    min: true,
    max: true,
    leftMin: true,
    leftMax: true,
    rhClef: true,
    lhClef: true,
    bpm: true,
    mode: true,
    hints: true,
    bars: true,
    offset: true,
    tolerance: true,
  })
  .extend({ rangeVersion: z.literal(2).optional() });

function migrateGuided(
  s: z.infer<typeof legacyPreferences>,
  hand = s.hand,
): PracticeSetup {
  const sharedLeftRange = s.rangeVersion === undefined && s.hand === "left";
  return {
    profile: "guided",
    config: resolveGeneratorConfig({
      hands: {
        active: hand,
        right: { min: s.min, max: s.max, clef: s.rhClef },
        left: {
          min: sharedLeftRange ? s.min : s.leftMin,
          max: sharedLeftRange ? s.max : s.leftMax,
          clef: s.lhClef,
        },
      },
      notation: { key: s.key, beats: s.beats },
      rhythm: legacyRhythms[s.rhythm],
    }),
    options: practiceOptionsSchema.parse({
      ...s,
      hints: s.hints === "reveal" ? "smart" : s.hints,
    }),
  };
}

type Preferences = z.infer<typeof currentPreferences>;
export type PreferenceRow = {
  id: string;
  settings?: unknown;
  profiles?: Partial<Record<HandSelection, unknown>>;
  selectedHand?: HandSelection;
  duration?: PracticeDuration;
  midiChannel?: number;
  metronome?: boolean;
  setup?: PracticeSetup;
  seed?: string;
  guided?: GuidedProfiles;
  guidedHand?: HandSelection;
  custom?: PracticeSetup;
};

async function readPreferences(): Promise<Preferences> {
  const current = currentPreferences.safeParse(
    await db.preferences.get("practice-v2"),
  );
  if (current.success) return current.data;

  const legacy = await db.preferences.get("settings");
  const guided = defaultProfiles();
  const selected = legacyPreferences.safeParse(legacy?.settings);
  if (selected.success)
    guided[selected.data.hand] = migrateGuided(selected.data);
  for (const hand of hands) {
    const value = legacyPreferences.safeParse(legacy?.profiles?.[hand]);
    if (value.success) guided[hand] = migrateGuided(value.data, hand);
  }
  const selectedHand = handSchema.safeParse(legacy?.selectedHand);
  const guidedHand = selectedHand.success
    ? selectedHand.data
    : selected.success
      ? selected.data.hand
      : "right";
  return {
    guided,
    guidedHand,
    setup: guided[guidedHand],
    seed: defaultExerciseSeed,
    duration:
      legacy?.duration === 3 || legacy?.duration === 5 ? legacy.duration : 0,
    midiChannel: z
      .number()
      .int()
      .min(0)
      .max(16)
      .catch(0)
      .parse(legacy?.midiChannel),
    metronome: legacy?.metronome === true,
  };
}

export const loadPracticePreferences = readPreferences;

/** Migrate lazily and merge edits within the same IndexedDB transaction. */
export async function savePracticePreferences(update: Partial<Preferences>) {
  await db.transaction("rw", db.preferences, async () => {
    const previous = await readPreferences();
    await db.preferences.put({
      id: "practice-v2",
      ...currentPreferences.parse({ ...previous, ...update }),
    });
  });
}
