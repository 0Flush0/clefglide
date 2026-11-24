export const touches = [
  "natural",
  "legato",
  "non-legato",
  "staccato",
  "staccatissimo",
  "tenuto",
] as const;
export const emphases = ["accent", "marcato"] as const;
export const slurStyles = ["legato", "portato"] as const;
export const slurPlacements = ["auto", "above", "below"] as const;
export type Touch = (typeof touches)[number];
export type Emphasis = (typeof emphases)[number];
export type SlurStyle = (typeof slurStyles)[number];
export type SlurPlacement = (typeof slurPlacements)[number];

export interface SlurMember {
  id: string;
  index: number;
  length: number;
  style: SlurStyle;
  placement: SlurPlacement;
}

/** Relative to the score attack. Connections also identify the next attack
 * for evaluation against its observed MIDI onset. Positive offsets overlap. */
export type ArticulationTiming =
  | { kind: "duration"; ticks: number; minTicks: number; maxTicks: number }
  | {
      kind: "overlap" | "separation" | "connected";
      ticks: number;
      offsetTicks: number;
      nextEventId: string;
    };

export interface ArticulationMark {
  touch?: Touch;
  emphasis?: Emphasis;
  timing?: ArticulationTiming;
}

export interface ArticulationAttackRef {
  id: string;
  start: number;
  end: number;
}

export interface SlurGroup {
  id: string;
  voiceId: string;
  style: SlurStyle;
  placement: SlurPlacement;
  members: ArticulationAttackRef[];
}

export interface ArticulationBoundary {
  context: string;
  /** Non-overlapping groups committed to both sides of this boundary. */
  groups: SlurGroup[];
  /** Last independently chosen marks on attacks ending at this boundary. */
  terminal: Record<
    string,
    ArticulationAttackRef & Pick<ArticulationMark, "touch" | "emphasis">
  >;
}
