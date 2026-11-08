import {
  TPQ,
  noteheads,
  type HandState,
  type MovementPlan,
  type ScoreEvent,
  type Settings,
  type HintMemory,
} from "./model";
import { Note } from "tonal";
export type HintReason =
  "initial" | "position-change" | "non-obvious" | "all" | "manual";
export interface FingeringHint {
  noteId: string;
  hand: ScoreEvent["hand"];
  plannedFinger: number;
  expectedFinger: number;
  positionBefore: HandState;
  position: HandState;
  nonObvious: boolean;
  movement?: MovementPlan;
  reasons: HintReason[];
  show: boolean;
}
/** Pure projection of an already validated plan. Never uses melodic intervals,
 * mutates the exercise, or influences MIDI/scoring. Legacy reveal = on demand. */
export function selectFingeringHints(
  events: ScoreEvent[],
  positions: HandState[],
  movements: MovementPlan[],
  mode: Settings["hints"],
  revealed = false,
  memory: HintMemory = {},
): FingeringHint[] {
  return inferFingeringHints(
    events,
    positions,
    movements,
    mode,
    revealed,
    memory,
  ).hints;
}
/** Explicit inference convention: adjacent scale notes from an established
 * finger until a new annotated offset is encountered. Each cue establishes a
 * new plateau, not five exceptions. A lower established finger takes precedence;
 * before it, extrapolate from the nearest higher established finger. No melody
 * interval heuristic or knowledge of which library pattern was sampled is used.
 * State is computed in score order, including future notes, independently of
 * playback and visibility mode. It can be carried through chunks/window eviction. */
export function inferFingeringHints(
  events: ScoreEvent[],
  positions: HandState[],
  movements: MovementPlan[],
  mode: Settings["hints"] = "smart",
  revealed = false,
  memory: HintMemory = {},
): { hints: FingeringHint[]; state: HintMemory } {
  const state = structuredClone(memory);
  const notes = events
    .filter((e) => e.kind === "note")
    .sort((a, b) => a.bar - b.bar || a.onset - b.onset)
    .flatMap((e) => noteheads(e).map((n) => ({ ...e, ...n })));
  const hints = notes.map((note) => {
    const position = positions.find(
      (p) => p.hand === note.hand && p.id === note.positionId,
    );
    if (!position) throw new Error(`Missing validated position for ${note.id}`);
    const movement = movements.find(
      (m) => m.hand === note.hand && m.landingNoteId === note.id,
    );
    const positionBefore = movement
      ? (positions.find(
          (p) => p.hand === note.hand && p.id === movement.fromPositionId,
        ) ?? position)
      : position;
    const expectedFinger =
      position.fingerToMidi.findIndex(
        (m, i) =>
          m === note.midi || position.pitchOptions?.[i]?.includes(note.pitch),
      ) + 1;
    const previous = state[note.hand];
    const starting =
      !previous || previous.positionId !== position.id || !!movement;
    if (starting) {
      const established = previous?.established ?? {};
      state[note.hand] = {
        positionId: position.id,
        anchors: { ...established[position.id] },
        established,
      };
    }
    const knowledge = state[note.hand]!;
    const n = Note.get(note.pitch);
    const coordinate =
      (note.hand === "right" ? 1 : -1) *
        (n.oct! * 7 + "CDEFGAB".indexOf(n.letter)) -
      (expectedFinger - 1);
    const known = Object.keys(knowledge.anchors)
      .map(Number)
      .sort((a, b) => a - b);
    const reference =
      known.filter((f) => f <= expectedFinger).at(-1) ?? known[0];
    const spacingException =
      reference !== undefined && knowledge.anchors[reference] !== coordinate;
    const nonObvious = note.finger !== expectedFinger || spacingException;
    // The first note establishes a conventional baseline; later cues establish
    // only a previously uninferable offset. Tagged alternatives do not remap it.
    if (starting || spacingException)
      knowledge.anchors[expectedFinger] = coordinate;
    knowledge.established[position.id] = { ...knowledge.anchors };
    const initial = starting && !movement && note.bar === 0;
    const reasons: HintReason[] = revealed
      ? ["manual"]
      : mode === "all"
        ? ["all"]
        : mode === "smart"
          ? [
              ...(initial ? ["initial" as const] : []),
              ...(movement ? ["position-change" as const] : []),
              ...(nonObvious ? ["non-obvious" as const] : []),
            ]
          : [];
    return {
      noteId: note.id,
      hand: note.hand,
      plannedFinger: note.finger,
      expectedFinger,
      positionBefore,
      position,
      nonObvious,
      movement,
      reasons,
      show: reasons.length > 0,
    };
  });
  return { hints, state };
}
export function showPlacement(mode: Settings["hints"], revealed: boolean) {
  return mode === "all" || mode === "smart" || revealed;
}
export function visibleMovements(
  movements: MovementPlan[],
  startBar: number,
  bars: number,
  beats: number,
) {
  const start = startBar * beats * TPQ,
    end = (startBar + bars) * beats * TPQ;
  return movements
    .filter((m) => m.landingTick >= start && m.cueTick < end)
    .sort((a, b) => a.landingTick - b.landingTick);
}
export function movementAnnotation(m: MovementPlan) {
  return `Move ${m.hand === "right" ? "RH" : "LH"} · ${m.landingFinger}`;
}
export function nextMovements(
  movements: MovementPlan[],
  bar: number,
  beats: number,
) {
  const future = movements
    .filter((m) => m.landingTick >= bar * beats * TPQ)
    .sort((a, b) => a.landingTick - b.landingTick);
  return future.filter(
    (m, i) => future.findIndex((other) => other.hand === m.hand) === i,
  );
}
