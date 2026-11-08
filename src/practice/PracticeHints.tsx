import { Hand } from "lucide-react";
import {
  TPQ,
  noteheads,
  type HandState,
  type ScoreEvent,
  type MovementPlan,
  type Settings,
} from "../score/model";
import { showPlacement } from "../score/hints";
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
  settings: Settings;
  revealed: boolean;
  atStart?: boolean;
}) {
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
          {show
            ? atStart
              ? "Before you play"
              : "Hand position"
            : settings.mode === "benchmark"
              ? "Independent reading"
              : "Hand placement hint available"}
        </strong>
        <p>
          {show
            ? initialHands
                .map((h) => {
                  const first = firstNotes.find((n) => n.hand === h.hand);
                  const thumb =
                    h.hand === "right" ? h.pitches[0] : h.pitches[4];
                  const heads = first ? noteheads(first) : [];
                  const start =
                    heads.length > 1
                      ? ` Start with ${heads.map((n) => `${n.pitch}/${n.finger}`).join(" · ")} (note/finger).`
                      : ` Start on ${first?.pitch} with finger ${first?.finger}.`;
                  return `${h.hand === "right" ? "Right hand" : "Left hand"}: thumb on ${thumb}, position ${h.pitches[0]}–${h.pitches[4]}.${atStart ? start : ""}`;
                })
                .join(" / ")
            : settings.mode === "benchmark"
              ? "Independent reading · fingering hidden"
              : "Reveal the starting position before playing, whenever you need it."}
        </p>
        {next.map((m) => {
          const pos = positions.find(
            (p) => p.hand === m.hand && p.id === m.toPositionId,
          );
          const note =
            pos?.pitches[
              m.hand === "right" ? m.landingFinger - 1 : 5 - m.landingFinger
            ];
          const bar = Math.floor(m.landingTick / (settings.beats * TPQ)) + 1;
          return (
            <p key={m.id} data-movement-id={m.id} className="movement-cue">
              {show
                ? `Bar ${bar} · Move ${m.hand === "right" ? "right" : "left"} hand: thumb to ${pos?.pitches[m.hand === "right" ? 0 : 4]}, position ${pos?.pitches[0]}–${pos?.pitches[4]}. Land on ${note} with finger ${m.landingFinger}.`
                : `Position change before bar ${bar} · ${settings.mode === "benchmark" ? "fingering hidden" : "hint available"}`}
            </p>
          );
        })}
      </div>
    </div>
  );
}
