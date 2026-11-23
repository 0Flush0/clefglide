import { Chord, Scale } from "tonal";
import type { StreamState } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { chooseWeighted } from "./sampling";
import { coveragePhraseShape } from "./rangeCoverage";
import { positionCenter } from "./positionMaps";

export function planPhrase(c: ValidatedGeneratorConfig, state: StreamState) {
  const useCoverage =
    c.coverage.kind === "guided" &&
    c.movement.kind === "rested-reposition" &&
    c.movement.probability > 0;
  const harmony = chooseWeighted(c.harmony.progressions, state),
    shape = chooseWeighted(c.melody.contours, state);
  const motif = chooseWeighted(c.melody.motifs, state);
  const shapes = new Map(
    state.hands.map((h) => [
      h.hand,
      useCoverage
        ? coveragePhraseShape(
            state.coverage![h.hand]!,
            positionCenter(h),
            shape,
            state,
            c.coverage.kind === "guided" ? c.coverage : undefined,
          )
        : shape,
    ]),
  );
  const notesInKey = Scale.get(`${c.notation.key} major`).notes;
  const chords = harmony.map(
    (degree) =>
      Chord.get(
        `${notesInKey[degree - 1]}${degree === 2 || degree === 6 ? "m" : ""}`,
      ).notes,
  );

  return { harmony, motif, shapes, chords };
}
