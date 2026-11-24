import { useTranslation } from "../shared/i18n";
import { Hand } from "lucide-react";
import { Note } from "tonal";
import {
  TPQ,
  noteheads,
  type HandState,
  type ScoreEvent,
  type MovementPlan,
  type Settings,
} from "../score/model";
import { showPlacement } from "../score/hints";

const movementNames = {
  "lifted-wide-leap": "Wide leap",
  "thumb-under": "Thumb under",
  "finger-over": "Finger over",
  "continuous-shift": "Continuous shift",
} as const;
export function PracticeHints({
  initialHands,
  firstNotes,
  positions,
  movements,
  settings,
  revealed,
  atStart = true,
}: {
  initialHands: HandState[];
  firstNotes: ScoreEvent[];
  positions: HandState[];
  movements: MovementPlan[];
  settings: Pick<Settings, "beats" | "mode" | "hints">;
  revealed: boolean;
  atStart?: boolean;
}) {
  const tr = useTranslation();
  const show = showPlacement(settings.hints, revealed);
  const next = movements.filter(
    (m, i, all) => all.findIndex((x) => x.hand === m.hand) === i,
  );
  return (
    <div className="placement" data-testid="placement-plan">
      <div className="hand-icon">
        <Hand size={23} />
      </div>
      <div>
        <strong>
          {tr(
            show
              ? atStart
                ? "Before you play"
                : "Hand position"
              : settings.mode === "benchmark"
                ? "Independent reading"
                : "Hand placement hint available",
          )}
        </strong>
        <p>
          {tr(
            show
              ? initialHands
                  .map((h) => {
                    const first = firstNotes.find((n) => n.hand === h.hand);
                    const thumb =
                      h.hand === "right" ? h.pitches[0] : h.pitches[4];
                    const heads = first ? noteheads(first) : [];
                    const start =
                      heads.length > 1
                        ? ` Start with ${heads.map((n) => `${n.pitch}/${n.finger}`).join(" · ")} (note/finger).`
                        : heads[0]
                          ? ` Start on ${heads[0].pitch} with finger ${heads[0].finger}.`
                          : "";
                    return tr(
                      `${h.hand === "right" ? "Right hand" : "Left hand"}: thumb on ${thumb}, position ${h.pitches[0]}–${h.pitches[4]}.${atStart ? tr(start) : ""}`,
                    );
                  })
                  .join(" / ")
              : settings.mode === "benchmark"
                ? "Independent reading · fingering hidden"
                : "Reveal the starting position before playing, whenever you need it.",
          )}
        </p>
        {next.map((m) => {
          const pos = positions.find(
            (p) => p.hand === m.hand && p.id === m.toPositionId,
          );
          const note =
            pos?.pitches.find((pitch) => Note.midi(pitch) === m.landingMidi) ??
            Note.fromMidi(m.landingMidi);
          const technique =
            m.technique === "lift-and-reposition"
              ? undefined
              : movementNames[m.technique];
          const bar = Math.floor(m.landingTick / (settings.beats * TPQ)) + 1;
          return (
            <p key={m.id} data-movement-id={m.id} className="movement-cue">
              {show && technique && <>{tr(technique)} · </>}
              {tr(
                show
                  ? `Bar ${bar} · Move ${m.hand === "right" ? "right" : "left"} hand: thumb to ${pos?.pitches[m.hand === "right" ? 0 : 4]}, position ${pos?.pitches[0]}–${pos?.pitches[4]}. Land on ${note} with finger ${m.landingFinger}.`
                  : `Position change before bar ${bar} · ${settings.mode === "benchmark" ? "fingering hidden" : "hint available"}`,
              )}
            </p>
          );
        })}
      </div>
    </div>
  );
}
