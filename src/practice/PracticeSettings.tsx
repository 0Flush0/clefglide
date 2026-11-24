import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Settings2, ArrowDown, ArrowRight } from "lucide-react";
import {
  inspectGeneratorFeasibility,
  normalizeGeneratorConfig,
  resolveGeneratorConfig,
  type GeneratorOverrides,
  type ValidatedGeneratorConfig,
} from "../generation";
import {
  planningTempo,
  withPlanningTempo,
} from "../generation/config/handParameters";
import { useTranslation } from "../shared/i18n";
import { KeyboardRange } from "./KeyboardRange";
import { GuidedPath } from "./GuidedPath";
import { AdvancedParameters } from "./AdvancedParameters";
import { AdvancedProfiles, type NamedProfile } from "./AdvancedProfiles";
import { Category, Choice, SliderField } from "./ParameterFields";
import { changePracticeHands, practiceHands } from "./advancedConfiguration";
import type { HandScope, LevelIdentity } from "./curriculum";
import {
  practiceOptionsSchema,
  atGuidedLevel,
  type PracticeOptions,
  type PracticeSetup,
  type PracticeProfile,
} from "./configuration";

function feasibilityMessage(error: string) {
  if (error.startsWith("Both hands need separate positions"))
    return "No separate hand positions fit. Widen the ranges, lower the left range or raise the right range. Overlapping ranges are allowed.";
  if (error.startsWith("left hand: the range needs"))
    return "Left hand: choose a range containing five consecutive notes in the selected key.";
  if (error.startsWith("right hand: the range needs"))
    return "Right hand: choose a range containing five consecutive notes in the selected key.";
  return error;
}

function Parameters({
  config,
  onUse,
}: {
  config: ValidatedGeneratorConfig;
  onUse: (config: unknown) => boolean;
}) {
  const tr = useTranslation();
  const formatted = JSON.stringify(config, undefined, 2);
  const [draft, setText] = useState<{ base: string; value: string }>();
  const stale = !!draft && draft.base !== formatted;
  const [error, setError] = useState("");
  return (
    <Category
      className="generator-parameters"
      title="Generator parameters (JSON)"
      help="Edit the complete configuration, including harmony progressions, fingering rules and other technical settings."
    >
      <label>
        {tr("GeneratorConfig JSON")}
        <textarea
          aria-label={tr("GeneratorConfig JSON")}
          spellCheck={false}
          rows={9}
          value={draft?.value ?? formatted}
          onChange={(e) => {
            setText({ base: draft?.base ?? formatted, value: e.target.value });
            setError("");
          }}
        />
      </label>
      <div className="profile-actions">
        <button
          type="button"
          disabled={!draft}
          onClick={() => {
            if (!draft) return;
            try {
              if (onUse(JSON.parse(draft.value))) setText(undefined);
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {tr(stale ? "Replace staged settings with JSON" : "Use parameters")}
        </button>
        {draft && (
          <button
            type="button"
            onClick={() => {
              setText(undefined);
              setError("");
            }}
          >
            {tr("Reload JSON from staged settings")}
          </button>
        )}
      </div>
      {draft && (
        <p className="settings-help">
          {tr(
            stale
              ? "Settings changed while you were editing JSON. Choose which version to keep."
              : "Use parameters to stage your JSON edits.",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="settings-help">
          {tr(error)}
        </p>
      )}
    </Category>
  );
}

export function PracticeSettings({
  draft,
  seed,
  pending,
  onChange,
  onProfile,
  onSeed,
  onHints,
  onApply,
  children,
  assistanceUsed,
  practisedLevels = new Set(),
  completedLevels = new Set(),
  onGuidedHand,
  guidedStages,
  namedProfiles = [],
  onProfiles = () => {},
  durationControl,
}: {
  draft: PracticeSetup;
  seed: string;
  pending: boolean;
  onChange: (setup: PracticeSetup) => void;
  onProfile: (profile: PracticeProfile) => void;
  onSeed: (seed: string) => void;
  onHints: (mode: PracticeOptions["hints"]) => void;
  onApply: () => void;
  children: ReactNode;
  assistanceUsed: boolean;
  practisedLevels?: ReadonlySet<string>;
  completedLevels?: ReadonlySet<string>;
  onGuidedHand?: (hand: HandScope) => void;
  guidedStages?: Readonly<Record<string, LevelIdentity>>;
  namedProfiles?: readonly NamedProfile[];
  onProfiles?: (profiles: NamedProfile[]) => void;
  durationControl?: ReactNode;
}) {
  const tr = useTranslation();
  const { config, options, profile } = draft;
  const { hands, notation } = config;
  const advanced = profile === "custom";
  const detailId = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [editError, setEditError] = useState("");
  const { errors, warnings } = useMemo(
    () => inspectGeneratorFeasibility(config),
    [config],
  );
  const valid =
    practiceOptionsSchema.safeParse(options).success && !errors.length;
  const option = <K extends keyof PracticeOptions>(
    key: K,
    value: PracticeOptions[K],
  ) => onChange({ ...draft, options: { ...options, [key]: value } });
  const updateConfig = (overrides: GeneratorOverrides, bpm = options.bpm) => {
    try {
      const next = resolveGeneratorConfig(overrides, config);
      setEditError("");
      onChange({ ...draft, config: next, options: { ...options, bpm } });
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    }
  };
  const useCandidate = (candidate: unknown) => {
    try {
      const next = normalizeGeneratorConfig(candidate);
      setEditError("");
      onChange({
        ...draft,
        config: next,
        options: { ...options, bpm: planningTempo(next) ?? options.bpm },
      });
      return true;
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const chooseTempo = (bpm: number) => {
    if (planningTempo(config) === undefined) return option("bpm", bpm);
    try {
      const next = normalizeGeneratorConfig(withPlanningTempo(config, bpm));
      setEditError("");
      onChange({ ...draft, config: next, options: { ...options, bpm } });
    } catch (error) {
      setEditError(String(error));
    }
  };
  const status = tr(
    advanced && editError
      ? "Edit rejected. Open Music settings for details."
      : !valid
        ? "Check the advanced values before generating."
        : pending
          ? "Changes ready — generate new music to apply."
          : "Ready. Exercise settings apply to new music.",
  );
  const feedback = (
    <>
      {(editError || errors.length > 0) && (
        <p role="alert" className="settings-help">
          {tr(
            editError ||
              `Infeasible in the current context. ${errors.map(feasibilityMessage).join(" ")}`,
          )}
        </p>
      )}
      {warnings.length > 0 && (
        <p className="settings-help">{tr(warnings.join(" "))}</p>
      )}
    </>
  );
  const scoring = (
    <label>
      {tr("Scoring mode")}
      <select
        value={options.mode}
        onChange={(e) =>
          option("mode", e.target.value as PracticeOptions["mode"])
        }
      >
        <option value="wait">{tr("Wait for correct notes")}</option>
        <option value="timed">{tr("Timed playing")}</option>
        <option value="benchmark">{tr("Independent benchmark")}</option>
      </select>
    </label>
  );
  const playback = (
    <>
      <div className="control-grid">
        {(hands.active === "both"
          ? (["right", "left"] as const)
          : [hands.active]
        ).map((hand) => (
          <Choice
            key={hand}
            label={
              hands.active === "both"
                ? hand === "right"
                  ? "Right clef"
                  : "Left clef"
                : "Clef"
            }
            value={hands[hand].clef}
            items={[
              ["treble", "Treble"],
              ["bass", "Bass"],
            ]}
            onChange={(clef) => updateConfig({ hands: { [hand]: { clef } } })}
          />
        ))}
      </div>
      {!advanced && scoring}
      {profile === "guided" && (
        <div className="control-grid">
          <Choice
            label="Key"
            value={notation.key}
            items={[
              ["C", "C"],
              ["G", "G"],
              ["F", "F"],
              ["D", "D"],
            ]}
            onChange={(key) => updateConfig({ notation: { key } })}
          />
          <Choice
            label="Meter"
            value={notation.beats}
            items={[
              [4, "4/4"],
              [3, "3/4"],
            ]}
            disabled={!!draft.level && notation.voices === "independent"}
            onChange={(beats) => updateConfig({ notation: { beats } })}
          />
        </div>
      )}
      <label>
        {tr("Bars in view")}
        <select
          value={options.bars}
          onChange={(e) => option("bars", +e.target.value as 2 | 3 | 4)}
        >
          {[2, 3, 4].map((bars) => (
            <option key={bars}>{bars}</option>
          ))}
        </select>
      </label>
      <label>
        {tr("Input timing offset (ms)")}
        <input
          type="number"
          min="-500"
          max="500"
          value={options.offset}
          onChange={(e) => option("offset", +e.target.value)}
        />
      </label>
      <label>
        {tr("Timing tolerance (ms)")}
        <input
          type="number"
          min="50"
          max="400"
          value={options.tolerance}
          onChange={(e) => option("tolerance", +e.target.value)}
        />
      </label>
      <label>
        {tr("Exercise seed")}
        <input value={seed} onChange={(e) => onSeed(e.target.value)} />
      </label>
      {children}
    </>
  );
  return (
    <>
      <aside className={advanced ? "controls controls-advanced" : "controls"}>
        <div className="controls-title">
          <Settings2 size={17} />
          <h2>{tr("Your practice")}</h2>
        </div>
        <div className="settings-scroll">
          <div className="practice-profile-controls">
            <label>
              {tr("Practice profile")}
              <select
                value={profile}
                onChange={(e) => {
                  setEditError("");
                  onProfile(e.target.value as PracticeProfile);
                }}
              >
                <option value="guided">{tr("Guided")}</option>
                <option value="custom">{tr("Advanced")}</option>
              </select>
            </label>
            {advanced && (
              <Choice
                label="Hands"
                value={hands.active}
                items={practiceHands}
                onChange={(active) =>
                  useCandidate(changePracticeHands(config, active))
                }
              />
            )}
          </div>
          {!advanced && (
            <GuidedPath
              setup={draft}
              pending={pending}
              practised={practisedLevels}
              completed={completedLevels}
              stageSelections={guidedStages}
              onHand={(hand) =>
                onGuidedHand
                  ? onGuidedHand(hand)
                  : updateConfig({ hands: { active: hand } })
              }
              onLevel={(level) => {
                setEditError("");
                onChange(atGuidedLevel(level, options));
              }}
            />
          )}
          <KeyboardRange
            settings={hands}
            onChange={(next) => updateConfig({ hands: next })}
            validate={(next) => {
              try {
                const errors = inspectGeneratorFeasibility(
                  resolveGeneratorConfig({ hands: next }, config),
                ).errors;
                return errors[0] && feasibilityMessage(errors[0]);
              } catch (e) {
                return e instanceof Error ? e.message : String(e);
              }
            }}
          />
          {!advanced && feedback}
          {advanced ? (
            <SliderField
              label="Tempo"
              numericLabel="Tempo (BPM)"
              unit="BPM"
              value={options.bpm}
              min={10}
              max={180}
              valueText={`${options.bpm} ${tr("BPM")}`}
              onChange={chooseTempo}
            />
          ) : (
            <label>
              {tr("Tempo")}
              <span className="range-value">
                {options.bpm} {tr("BPM")}
              </span>
              <input
                aria-label={tr("Tempo")}
                type="range"
                min="10"
                max="180"
                value={options.bpm}
                onChange={(e) => chooseTempo(+e.target.value)}
              />
            </label>
          )}
          {advanced && durationControl}
          <label>
            {tr("Fingering assistance")}
            <select
              value={options.mode === "benchmark" ? "hidden" : options.hints}
              disabled={options.mode === "benchmark"}
              onChange={(e) =>
                onHints(e.target.value as PracticeOptions["hints"])
              }
            >
              <option value="all">{tr("All — every finger")}</option>
              <option value="smart">{tr("Smart — just what you need")}</option>
              <option value="hidden">{tr("None — independent reading")}</option>
            </select>
          </label>
          <p className="settings-help">
            {tr("Hints change immediately.")}{" "}
            {tr(
              options.hints === "hidden" && assistanceUsed
                ? "This exercise has already shown hints. New exercise starts independent practice."
                : "",
            )}
          </p>
          {advanced ? (
            <>
              {scoring}
              <button
                type="button"
                className="music-settings-jump"
                aria-controls={detailId}
                onClick={() => {
                  if (details.current) details.current.open = true;
                  summary.current?.focus({ preventScroll: true });
                  details.current?.scrollIntoView?.({ block: "start" });
                }}
              >
                {tr("Edit music settings")}{" "}
                <ArrowDown size={16} aria-hidden="true" />
              </button>
            </>
          ) : (
            <details className="advanced">
              <summary>{tr("Advanced settings")}</summary>
              {playback}
            </details>
          )}
        </div>
        <div className="settings-apply">
          <p role="status">{status}</p>
          <button
            className="apply"
            disabled={!pending || !valid}
            onClick={onApply}
          >
            {tr("Apply & generate")}
            <ArrowRight size={16} />
          </button>
        </div>
      </aside>
      {advanced && (
        <details className="music-settings" id={detailId} ref={details}>
          <summary ref={summary} tabIndex={0}>
            {tr("Music settings")}
          </summary>
          <div className="music-settings-bar">
            <p
              role="status"
              data-state={
                !valid || editError ? "invalid" : pending ? "pending" : "ready"
              }
            >
              {tr(
                editError
                  ? "Edit rejected"
                  : !valid
                    ? "Review configuration"
                    : pending
                      ? "Unapplied changes"
                      : "Settings applied",
              )}
            </p>
            <button
              className="apply"
              type="button"
              disabled={!pending || !valid}
              onClick={onApply}
            >
              {tr("Apply changes")} <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="music-settings-body">
            <div className="music-settings-feedback">{feedback}</div>
            <AdvancedParameters
              config={config}
              bpm={options.bpm}
              onUse={useCandidate}
            />
            <div className="parameter-categories parameter-tools">
              <AdvancedProfiles
                config={config}
                profiles={namedProfiles}
                onUse={useCandidate}
                onProfiles={onProfiles}
              />
              <Category
                className="parameter-expert"
                title="Expert settings"
                help="Adjust score display, playback and input settings, or open the complete generator configuration."
              >
                <div className="expert-playback">{playback}</div>
                <Parameters config={config} onUse={useCandidate} />
              </Category>
            </div>
          </div>
        </details>
      )}
    </>
  );
}
