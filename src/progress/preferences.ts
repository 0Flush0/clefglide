import { defaults, settingsSchema, type Settings } from "../score/model";
import { db } from "./store";

export type HandProfiles = Record<Settings["hand"], Settings>;
export type PracticeDuration = 0 | 3 | 5;
export function defaultProfiles(): HandProfiles {
  return {
    right: { ...defaults, hand: "right" },
    left: { ...defaults, hand: "left" },
    both: { ...defaults, hand: "both" },
  };
}
function activeSettings(value: unknown): Settings {
  const parsed = settingsSchema.parse(value);
  return {
    ...parsed,
    hints: parsed.hints === "reveal" ? "smart" : parsed.hints,
  };
}
export async function loadPracticePreferences() {
  const saved = await db.preferences.get("settings");
  const profiles = defaultProfiles();
  const settings = saved ? activeSettings(saved.settings) : defaults;
  profiles[settings.hand] = settings;
  for (const hand of ["right", "left", "both"] as const) {
    const parsed = settingsSchema.safeParse(saved?.profiles?.[hand]);
    if (saved?.profiles?.[hand] && parsed.success)
      profiles[hand] = { ...activeSettings(parsed.data), hand };
  }
  const selectedHand = saved?.selectedHand;
  return {
    saved: !!saved,
    settings:
      selectedHand === "right" ||
      selectedHand === "left" ||
      selectedHand === "both"
        ? profiles[selectedHand]
        : settings,
    profiles,
    duration:
      saved?.duration === 3 || saved?.duration === 5
        ? saved.duration
        : (0 as PracticeDuration),
  };
}
/** Merge inside one transaction so concurrent duration/profile writes cannot erase each other. */
export async function savePracticePreferences(update: {
  settings?: Settings;
  profile?: Settings;
  selectedHand?: Settings["hand"];
  duration?: PracticeDuration;
}) {
  await db.transaction("rw", db.preferences, async () => {
    const saved = await db.preferences.get("settings");
    const settings = activeSettings(
      update.settings ?? saved?.settings ?? defaults,
    );
    const profiles = {
      ...defaultProfiles(),
      [settings.hand]: settings,
      ...saved?.profiles,
    };
    if (update.profile)
      profiles[update.profile.hand] = activeSettings(update.profile);
    await db.preferences.put({
      ...saved,
      id: "settings",
      settings,
      profiles,
      ...(update.selectedHand ? { selectedHand: update.selectedHand } : {}),
      ...(update.duration !== undefined ? { duration: update.duration } : {}),
    });
  });
}
