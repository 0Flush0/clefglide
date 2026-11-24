import { ChevronLeft, ChevronRight } from "lucide-react";
import { Note } from "tonal";
import { useContext } from "react";
import { LanguageContext, useTranslation } from "../shared/i18n";
import {
  curriculum,
  curriculumStages,
  currentGuidedLevel,
  type GuidedLevel,
  type HandScope,
  type LevelIdentity,
} from "./curriculum";
import type { PracticeSetup } from "./configuration";

export function GuidedPath({
  setup,
  pending,
  practised,
  completed,
  stageSelections,
  onHand,
  onLevel,
}: {
  setup: PracticeSetup;
  pending: boolean;
  practised: ReadonlySet<string>;
  completed: ReadonlySet<string>;
  stageSelections?: Readonly<Record<string, LevelIdentity>>;
  onHand: (hand: HandScope) => void;
  onLevel: (level: GuidedLevel) => void;
}) {
  const tr = useTranslation();
  const german = useContext(LanguageContext) === "de";
  const title = (level: GuidedLevel) =>
    german ? level.german[0] : level.title;
  const { active, left, right } = setup.config.hands;
  const levels = curriculum[active];
  const stages = curriculumStages[active];
  const selected = currentGuidedLevel(setup.level);
  const current = selected?.hand === active ? selected : undefined;
  const next = levels[current?.levelNumber ?? 0];
  const stageNumber = current?.stageNumber ?? 1;
  const stage = stages[stageNumber - 1];
  const previousStage = stages[stageNumber - 2];
  const nextStage = stages[stageNumber];
  const inStage = levels.filter((level) => level.stageId === stage.id);
  const selectStage = (stageId: string) => {
    const remembered = currentGuidedLevel(stageSelections?.[stageId]);
    const level =
      remembered?.hand === active && remembered.stageId === stageId
        ? remembered
        : levels.find((level) => level.stageId === stageId);
    if (level && level !== current) onLevel(level);
  };
  const identity = (level: GuidedLevel) => `${level.version}:${level.id}`;
  const progress = (level: GuidedLevel) =>
    completed.has(identity(level))
      ? "Completed"
      : practised.has(identity(level))
        ? "Practised"
        : "";
  const config = current?.recipe;
  const acrossHands =
    active === "both" ? (["left", "right"] as const) : [active];
  const range = (hand: "left" | "right") => {
    const { min, max } = hand === "left" ? left : right;
    return `${Note.fromMidi(min)}–${Note.fromMidi(max)}`;
  };
  const overridden =
    !!current &&
    !!config &&
    (setup.options.bpm !== current.bpm ||
      setup.config.notation.key !== config.notation.key ||
      setup.config.notation.beats !== config.notation.beats ||
      acrossHands.some((hand) => {
        const actual = setup.config.hands[hand];
        const standard = config.hands[hand];
        return (
          actual.min !== standard.min ||
          actual.max !== standard.max ||
          actual.clef !== standard.clef
        );
      }));
  return (
    <section className="guided-path" aria-label={tr("Guided learning path")}>
      <label>
        {tr("Hands")}
        <select
          aria-label={tr("Hands")}
          value={active}
          onChange={(e) => onHand(e.target.value as HandScope)}
        >
          <option value="left">{tr("Left")}</option>
          <option value="right">{tr("Right")}</option>
          <option value="both">{tr("Both")}</option>
        </select>
      </label>
      <div className="guided-level">
        <div className="guided-nav">
          <button
            type="button"
            aria-label={tr("Previous stage")}
            disabled={!previousStage}
            onClick={() => previousStage && selectStage(previousStage.id)}
          >
            <ChevronLeft size={16} />
          </button>
          <h3>{tr(stage.title)}</h3>
          <button
            type="button"
            aria-label={tr("Next stage")}
            disabled={!nextStage}
            onClick={() => nextStage && selectStage(nextStage.id)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <p className="guided-position">
          {tr("Stage")} {stageNumber}/{stages.length}
          {current &&
            ` · ${tr("Level")} ${current.levelNumber}/${levels.length}`}
        </p>
        <div
          className="guided-steps"
          role="group"
          aria-label={tr("Level progression")}
        >
          {inStage.map((level) => (
            <button
              key={level.id}
              type="button"
              aria-current={level === current ? "step" : undefined}
              data-practised={!!progress(level)}
              aria-label={`${tr("Level")} ${level.levelNumber} · ${title(level)}${progress(level) ? ` · ${tr(progress(level))}` : ""}`}
              onClick={() => {
                if (level !== current) onLevel(level);
              }}
            >
              {level.levelNumber}
            </button>
          ))}
        </div>
        <h4 className="guided-lesson-title">
          {current ? title(current) : tr("Saved setup")}
        </h4>
        {current && (
          <p className="settings-help">
            <strong>
              {tr(
                pending ? "Selected for next exercise" : "Currently practising",
              )}
            </strong>
            <br />
            {german ? current.german[1] : current.description}
          </p>
        )}
        <p className="settings-help guided-recommendation">
          {acrossHands
            .map(
              (hand) =>
                `${active === "both" ? tr(hand === "left" ? "Left" : "Right") + " " : ""}${range(hand)}`,
            )
            .join(" · ")}
          {" · "}
          {setup.options.bpm} {tr("BPM")}
          {current && (
            <>
              <br />
              {tr("Suggested tempo")} {current.tempo.join("–")} {tr("BPM")}
            </>
          )}
        </p>
        {current && overridden && (
          <div className="guided-override">
            <p className="settings-help">{tr("Custom level settings")}</p>
            <button type="button" onClick={() => onLevel(current)}>
              {tr("Restore level settings")}
            </button>
          </div>
        )}
      </div>
      {next && (
        <p className="settings-help">
          <strong>{tr("Up next")}</strong> · {title(next)}
        </p>
      )}
      <details className="advanced">
        <summary>{tr("Browse stages and levels")}</summary>
        <label>
          {tr("Guided stage")}
          <select
            aria-label={tr("Guided stage")}
            value={stage.id}
            onChange={(e) => selectStage(e.target.value)}
          >
            {stages.map(({ id, title }, i) => (
              <option key={id} value={id}>
                {i + 1}. {tr(title)}
              </option>
            ))}
          </select>
        </label>
        {current && (
          <>
            <p className="settings-help">{tr(stage.objective)}</p>
            <label>
              {tr("Level in stage")}
              <select
                aria-label={tr("Level in stage")}
                value={current.id}
                onChange={(e) => {
                  const level = inStage.find(({ id }) => id === e.target.value);
                  if (level && level !== current) onLevel(level);
                }}
              >
                {inStage.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.levelNumber}. {title(level)}
                    {progress(level) ? ` · ${tr(progress(level))}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </details>
    </section>
  );
}
