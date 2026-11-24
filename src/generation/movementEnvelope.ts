import type { Hand, HandState, MovementPlan } from "../score/model";

/** Project the closest edge of the opposite hand, including its swept positions. */
export function oppositeSweepEdge(
  hand: Hand,
  initial: HandState[],
  positions: HandState[],
  movements: MovementPlan[],
  cue: number,
  end: number,
) {
  const other = initial.find((h) => h.hand !== hand);
  if (!other) return undefined;
  const moves = movements.filter((m) => m.hand === other.hand);
  const atCue =
    moves
      .filter((m) => m.landingTick < cue)
      .sort((a, b) => a.landingTick - b.landingTick)
      .at(-1)?.toPositionId ?? other.id;
  const ids = [
    atCue,
    ...moves
      .filter(
        (m) => m.landingTick >= cue && m.cueTick <= end && m.landingTick <= end,
      )
      .flatMap((m) => [m.fromPositionId, m.toPositionId]),
  ];
  const pitches = positions
    .filter((p) => p.hand === other.hand && ids.includes(p.id))
    .flatMap((p) => p.fingerToMidi);
  return pitches.length
    ? hand === "right"
      ? Math.max(...pitches)
      : Math.min(...pitches)
    : undefined;
}

export function clearsOppositeEdge(hand: HandState, edge?: number) {
  return (
    edge === undefined ||
    (hand.hand === "right"
      ? Math.min(...hand.fingerToMidi) > edge
      : Math.max(...hand.fingerToMidi) < edge)
  );
}
