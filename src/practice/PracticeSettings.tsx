import { useMemo, useState, type ReactNode } from "react";
import { Settings2, ArrowRight } from "lucide-react";
import {
  inspectGeneratorFeasibility,
  normalizeGeneratorConfig,
  resolveGeneratorConfig,
  type GeneratorConfig,
  type GeneratorOverrides,
  type ValidatedGeneratorConfig,
} from "../generation";
import { useTranslation } from "../shared/i18n";
import { KeyboardRange } from "./KeyboardRange";
import {
  practiceOptionsSchema,
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
  onUse: (config: ValidatedGeneratorConfig) => void;
}) {
  const tr = useTranslation();
  const formatted = JSON.stringify(config, undefined, 2);
  const [text, setText] = useState<string>();
  const [error, setError] = useState("");
  return (
    <details className="advanced generator-parameters">
      <summary>{tr("Generator parameters")}</summary>
      <label>
        {tr("GeneratorConfig JSON")}
        <textarea
          aria-label={tr("GeneratorConfig JSON")}
          spellCheck={false}
          rows={9}
          value={text ?? formatted}
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
        />
      </label>
      <button
        type="button"
        disabled={text === undefined}
        onClick={() => {
          try {
            const next = normalizeGeneratorConfig(
              JSON.parse(text ?? formatted),
            );
            onUse(next);
            setText(undefined);
            setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {tr("Use parameters")}
      </button>
      {text !== undefined && (
        <p className="settings-help">
          {tr("Use parameters to stage your JSON edits.")}
        </p>
      )}
      {error && (
        <p role="alert" className="settings-help">
          {tr(error)}
        </p>
      )}
    </details>
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
}) {
  const tr = useTranslation();
  const { config, options, profile } = draft;
  const { hands, notation } = config;
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
  const chooseTempo = (bpm: number) => {
    if (config.dynamicFingering)
      updateConfig({ dynamicFingering: { tempoBpm: bpm } }, bpm);
    else option("bpm", bpm);
  };
  return (
    <aside className="controls">
      <div className="controls-title">
        <Settings2 size={17} />
        <h2>{tr("Your practice")}</h2>
      </div>
      <div className="settings-scroll">
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
        {profile === "custom" && (
          <Parameters
            config={config}
            onUse={(next) => {
              setEditError("");
              onChange({
                ...draft,
                config: next,
                options: {
                  ...options,
                  bpm: next.dynamicFingering?.tempoBpm ?? options.bpm,
                },
              });
            }}
          />
        )}
        <label>
          {tr("Hands")}
          <select
            aria-label={tr("Hands")}
            value={hands.active}
            onChange={(e) =>
              updateConfig({
                hands: {
                  active: e.target.value as GeneratorConfig["hands"]["active"],
                },
              })
            }
          >
            <option value="right">{tr("Right")}</option>
            <option value="left">{tr("Left")}</option>
            <option value="both">{tr("Both")}</option>
          </select>
        </label>
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
        {(editError || errors.length > 0) && (
          <p role="alert" className="settings-help">
            {tr(editError || errors.map(feasibilityMessage).join(" "))}
          </p>
        )}
        {warnings.length > 0 && (
          <p className="settings-help">{tr(warnings.join(" "))}</p>
        )}
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
        <details className="advanced">
          <summary>{tr("Advanced settings")}</summary>
          <div className="control-grid">
            {(hands.active === "both"
              ? (["right", "left"] as const)
              : [hands.active]
            ).map((hand) => (
              <label key={hand}>
                {tr(
                  hands.active === "both"
                    ? hand === "right"
                      ? "Right clef"
                      : "Left clef"
                    : "Clef",
                )}
                <select
                  value={hands[hand].clef}
                  onChange={(e) =>
                    updateConfig({
                      hands: {
                        [hand]: { clef: e.target.value as "treble" | "bass" },
                      },
                    })
                  }
                >
                  <option value="treble">{tr("Treble")}</option>
                  <option value="bass">{tr("Bass")}</option>
                </select>
              </label>
            ))}
          </div>
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
          <div className="control-grid">
            <label>
              {tr("Key")}
              <select
                value={notation.key}
                onChange={(e) =>
                  updateConfig({
                    notation: {
                      key: e.target.value as GeneratorConfig["notation"]["key"],
                    },
                  })
                }
              >
                {["C", "G", "F", "D"].map((key) => (
                  <option key={key} value={key}>
                    {tr(key)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr("Meter")}
              <select
                value={notation.beats}
                onChange={(e) =>
                  updateConfig({
                    notation: { beats: +e.target.value as 3 | 4 },
                  })
                }
              >
                <option value="4">4/4</option>
                <option value="3">3/4</option>
              </select>
            </label>
          </div>
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
        </details>
      </div>
      <div className="settings-apply">
        <p role="status">
          {tr(
            !valid
              ? "Check the advanced values before generating."
              : pending
                ? "Changes ready — generate new music to apply."
                : "Ready. Exercise settings apply to new music.",
          )}
        </p>
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
  );
}
