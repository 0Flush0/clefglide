import type { HandState, Notehead, ScoreEvent, Settings } from "../score/model";
import { resolveSettings } from "./config/presets";
import { chordCandidatesForConfig } from "./voicings";
export { chordCandidatesForConfig } from "./voicings";
export { chordShapes } from "./config/presets";
/** Legacy candidate API; core generation uses only resolved voicings. */
export function chordCandidates(
  event: ScoreEvent,
  pos: HandState,
  settings: Settings,
  harmony: string[],
  previous?: number[],
): Notehead[][] {
  return chordCandidatesForConfig(
    event,
    pos,
    resolveSettings(settings),
    harmony,
    previous,
  );
}
