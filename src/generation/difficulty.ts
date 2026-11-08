import type { Settings } from "../score/model";
export const jumpLevels = {
  small: { label: "Small", interval: 1, stepWeight: 7 },
  easy: { label: "Easy", interval: 2, stepWeight: 4 },
  medium: { label: "Medium", interval: 4, stepWeight: 2 },
  large: { label: "Large", interval: 7, stepWeight: 0 },
} as const;
export const movementLevels = {
  off: { label: "Off", shiftFrequency: 0, maxShift: 0 },
  easy: { label: "Easy", shiftFrequency: 0.25, maxShift: 1 },
  medium: { label: "Medium", shiftFrequency: 0.55, maxShift: 2 },
  hard: { label: "Hard", shiftFrequency: 0.85, maxShift: 4 },
} as const;
export const spacingLevels = {
  off: { label: "Off", frequency: 0 },
  easy: { label: "Easy", frequency: 0.3 },
  medium: { label: "Medium", frequency: 0.6 },
  hard: { label: "Hard", frequency: 0.85 },
} as const;
export const fourLevels = {
  off: { label: "Off" },
  easy: { label: "Easy" },
  medium: { label: "Medium" },
  hard: { label: "Hard" },
} as const;
export function applyNoteJumps(
  s: Settings,
  noteJumps: Settings["noteJumps"],
): Settings {
  return { ...s, noteJumps, interval: jumpLevels[noteJumps].interval };
}
export function applyHandMovements(
  s: Settings,
  handMovements: Settings["handMovements"],
): Settings {
  const { shiftFrequency, maxShift } = movementLevels[handMovements];
  return { ...s, handMovements, shiftFrequency, maxShift };
}
export function difficultySummary(
  s: Pick<Settings, "noteJumps" | "handMovements" | "fingerSpacing"> &
    Partial<Pick<Settings, "accidentals" | "chords">>,
) {
  return `${jumpLevels[s.noteJumps].label} jumps · ${movementLevels[s.handMovements].label} moves · ${spacingLevels[s.fingerSpacing].label} spacing${s.accidentals ? ` · ${fourLevels[s.accidentals].label} accidentals · ${fourLevels[s.chords ?? "off"].label} chords` : ""}`;
}
