import { useTranslation } from "../shared/i18n";
import { Settings2, ArrowRight, Info } from "lucide-react";
import { settingsSchema, type Settings } from "../score/model";
import {
  jumpLevels,
  movementLevels,
  spacingLevels,
  fourLevels,
  applyNoteJumps,
  applyHandMovements,
} from "./presets";
import {
  movementRules,
  rangeSummary,
  rangeError,
} from "../generation/positions";
import { KeyboardRange } from "./KeyboardRange";
function DifficultyButtons<T extends string>({
  label,
  help,
  value,
  levels,
  onChange,
}: {
  label: string;
  help: string;
  value: T;
  levels: Record<T, { label: string; description?: string }>;
  onChange: (value: T) => void;
}) {
  const tr = useTranslation();
  return (
    <div className="difficulty-row">
      <details className="difficulty-info">
        <summary aria-label={tr(`About ${label.toLowerCase()}`)}>
          <span>{tr(label)}</span>
          <span className="difficulty-info-icon">
            <Info size={14} aria-hidden="true" />
          </span>
        </summary>
        <p>{tr(help)}</p>
      </details>
      <div className="segmented" role="group" aria-label={tr(label)}>
        {(Object.keys(levels) as T[]).map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={level === value}
            title={tr(levels[level].description)}
            onClick={() => onChange(level)}
          >
            {tr(levels[level].label)}
          </button>
        ))}
      </div>
    </div>
  );
}
export function PracticeSettings({
  draft,
  seed,
  pending,
  onChange,
  onSeed,
  onHints,
  onApply,
  children,
  assistanceUsed,
}: {
  draft: Settings;
  seed: string;
  pending: boolean;
  onChange: (s: Settings) => void;
  onSeed: (s: string) => void;
  onHints: (mode: Settings["hints"]) => void;
  onApply: () => void;
  children: React.ReactNode;
  assistanceUsed: boolean;
}) {
  const tr = useTranslation();
  const error = rangeError(draft);
  const valid = settingsSchema.safeParse(draft).success && !error;
  const field = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...draft, [key]: value });
  return (
    <aside className="controls">
      <div className="controls-title">
        <Settings2 size={17} />
        <h2>{tr("Your practice")}</h2>
      </div>
      <div className="settings-scroll">
        <section
          className="exercise-difficulty"
          aria-label={tr("Exercise difficulty")}
        >
          <h3>{tr("Exercise difficulty")}</h3>
          <DifficultyButtons
            label={tr("Note jumps")}
            help={tr(
              "Changes the distance between successive melody notes. Small allows neighboring scale notes, Easy up to thirds, Medium up to fifths, and Large up to an octave.",
            )}
            value={draft.noteJumps}
            levels={jumpLevels}
            onChange={(level) => onChange(applyNoteJumps(draft, level))}
          />
          <DifficultyButtons
            label={tr("Hand movements")}
            help={tr(
              "Changes how often and how far your hand may move to a new position. Off keeps one position; Easy, Medium and Hard allow progressively more movement. Every planned move has a full beat of rest and an advance cue.",
            )}
            value={draft.handMovements}
            levels={movementLevels}
            onChange={(level) => onChange(applyHandMovements(draft, level))}
          />
          <DifficultyButtons
            label={tr("Finger spacing")}
            help={tr(
              "Changes the gaps between the keys assigned to your fingers. Off uses five consecutive scale notes. Higher levels introduce more varied approved gaps near the thumb and index finger, while retaining the planned hand position.",
            )}
            value={draft.fingerSpacing}
            levels={spacingLevels}
            onChange={(level) => field("fingerSpacing", level)}
          />
          <p className="settings-help">
            {tr(
              "Adjust one skill at a time. All five controls respect your keyboard ranges, movement and jump limits. Allowed shapes may not fit every range.",
            )}
          </p>
          <DifficultyButtons
            label={tr("Accidentals")}
            help={tr(
              "Adds notes outside the selected key. Off uses only the key's notes, including its key-signature sharps or flats. Easy adds occasional chromatic neighbors, Medium adds more neighbors and passing notes, and Hard adds more frequent chromatic figures and harmonic alterations.",
            )}
            value={draft.accidentals}
            levels={{
              off: {
                ...fourLevels.off,
                description:
                  "Selected key notes only, including the key signature.",
              },
              easy: {
                ...fourLevels.easy,
                description:
                  "Occasional chromatic neighbors that resolve by semitone.",
              },
              medium: {
                ...fourLevels.medium,
                description: "More chromatic neighbors and passing notes.",
              },
              hard: {
                ...fourLevels.hard,
                description:
                  "Frequent chromatic figures and dominant-color alterations.",
              },
            }}
            onChange={(level) => field("accidentals", level)}
          />
          <DifficultyButtons
            label={tr("Chords")}
            help={tr(
              "Changes how many notes you play together and how often. Off uses single notes per hand. Easy adds occasional two-note shapes; Medium adds triads and simple inversions; Hard adds more chords and selected four-note shapes. Every chord must fit the validated fingering and keyboard range.",
            )}
            value={draft.chords}
            levels={{
              off: {
                ...fourLevels.off,
                description: "One note at a time per hand.",
              },
              easy: {
                ...fourLevels.easy,
                description:
                  "Occasional approved two-note shapes, up to a fifth.",
              },
              medium: {
                ...fourLevels.medium,
                description:
                  "Dyads, major/minor triads and selected inversions.",
              },
              hard: {
                ...fourLevels.hard,
                description:
                  "More chords, inversions and selected four-note shapes; ergonomic limits always apply.",
              },
            }}
            onChange={(level) => field("chords", level)}
          />
        </section>
        <div className="control-grid">
          <label>
            {tr("Hands")}
            <select
              aria-label={tr("Hands")}
              value={draft.hand}
              onChange={(e) =>
                field("hand", e.target.value as Settings["hand"])
              }
            >
              <option value="right">{tr("Right")}</option>
              <option value="left">{tr("Left")}</option>
              <option value="both">{tr("Both")}</option>
            </select>
          </label>
        </div>
        <KeyboardRange settings={draft} onChange={onChange} />
        <p className="range-explanation">
          {tr("Music stays inside this range.")}
          {tr(rangeSummary(draft))}
        </p>
        {error && (
          <p role="alert" className="settings-help">
            {tr(error)}
          </p>
        )}
        <label>
          {tr("Tempo")}
          <span className="range-value">
            {draft.bpm} {tr("BPM")}
          </span>
          <input
            aria-label={tr("Tempo")}
            type="range"
            min="10"
            max="180"
            value={draft.bpm}
            onChange={(e) => field("bpm", +e.target.value)}
          />
        </label>
        <label>
          {tr("Fingering assistance")}
          <select
            value={
              draft.mode === "benchmark"
                ? "hidden"
                : draft.hints === "reveal"
                  ? "smart"
                  : draft.hints
            }
            disabled={draft.mode === "benchmark"}
            onChange={(e) => onHints(e.target.value as Settings["hints"])}
          >
            <option value="all">{tr("All — every finger")}</option>
            <option value="smart">{tr("Smart — just what you need")}</option>
            <option value="hidden">{tr("None — independent reading")}</option>
          </select>
        </label>
        <p className="settings-help">
          {tr("Hints change immediately.")}{" "}
          {tr(
            draft.hints === "hidden" && assistanceUsed
              ? "This exercise has already shown hints. New exercise starts independent practice."
              : draft.mode === "benchmark"
                ? "Independent mode hides all guidance."
                : "Smart shows starting fingers, necessary spacing cues and planned moves.",
          )}
        </p>
        <details className="advanced">
          <summary>{tr("Advanced settings")}</summary>
          <div className="control-grid">
            {draft.hand !== "both" && (
              <label>
                {tr("Clef")}
                <select
                  value={draft.hand === "right" ? draft.rhClef : draft.lhClef}
                  onChange={(e) =>
                    field(
                      draft.hand === "right" ? "rhClef" : "lhClef",
                      e.target.value as "treble" | "bass",
                    )
                  }
                >
                  <option value="treble">{tr("Treble")}</option>
                  <option value="bass">{tr("Bass")}</option>
                </select>
              </label>
            )}
            {draft.hand === "both" && (
              <>
                <label>
                  {tr("Right clef")}
                  <select
                    value={draft.rhClef}
                    onChange={(e) =>
                      field("rhClef", e.target.value as "treble" | "bass")
                    }
                  >
                    <option value="treble">{tr("Treble")}</option>
                    <option value="bass">{tr("Bass")}</option>
                  </select>
                </label>
                <label>
                  {tr("Left clef")}
                  <select
                    value={draft.lhClef}
                    onChange={(e) =>
                      field("lhClef", e.target.value as "treble" | "bass")
                    }
                  >
                    <option value="bass">{tr("Bass")}</option>
                    <option value="treble">{tr("Treble")}</option>
                  </select>
                </label>
              </>
            )}
          </div>
          <label>
            {tr("Practice mode")}
            <select
              value={draft.mode}
              onChange={(e) =>
                field("mode", e.target.value as Settings["mode"])
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
                value={draft.key}
                onChange={(e) =>
                  field("key", e.target.value as Settings["key"])
                }
              >
                {["C", "G", "F", "D"].map((k) => (
                  <option key={k}>{tr(k)}</option>
                ))}
              </select>
            </label>
            <label>
              {tr("Meter")}
              <select
                value={draft.beats}
                onChange={(e) => field("beats", +e.target.value as 3 | 4)}
              >
                <option value="4">4/4</option>
                <option value="3">3/4</option>
              </select>
            </label>
          </div>
          <label>
            {tr("Rhythm")}
            <select
              value={draft.rhythm}
              onChange={(e) =>
                field("rhythm", e.target.value as Settings["rhythm"])
              }
            >
              <option value="gentle">{tr("Gentle notes & rests")}</option>
              <option value="quarters">{tr("Quarter notes")}</option>
              <option value="mixed">
                {tr("Mixed eighths through whole notes")}
              </option>
            </select>
          </label>
          <label>
            {tr("Hand-shift frequency")}{" "}
            <span className="range-value">
              {Math.round(draft.shiftFrequency * 100)}%
            </span>
            <input
              aria-label={tr("Hand-shift frequency")}
              type="range"
              min="0"
              max="1"
              step=".05"
              value={draft.shiftFrequency}
              disabled={draft.handMovements === "off"}
              onChange={(e) => field("shiftFrequency", +e.target.value)}
            />
          </label>
          <label>
            {tr("Maximum repositioning distance")}
            <select
              disabled={draft.handMovements === "off"}
              value={draft.maxShift}
              onChange={(e) => field("maxShift", +e.target.value)}
            >
              {Array.from(
                { length: movementRules[draft.handMovements].distance + 1 },
                (_, i) => (
                  <option key={i} value={i}>
                    {i} {tr("scale steps")}
                  </option>
                ),
              )}
            </select>
          </label>
          <p className="settings-help">
            {tr(
              draft.handMovements === "off"
                ? "Off keeps one mapped position for the whole exercise."
                : "Frequency applies at eligible phrase boundaries. A narrow range may prevent shifts even at 100%.",
            )}
          </p>
          <label>
            {tr("Maximum melodic interval")}
            <select
              value={draft.interval}
              onChange={(e) => field("interval", +e.target.value)}
            >
              {[
                "Second",
                "Third",
                "Fourth",
                "Fifth",
                "Sixth",
                "Seventh",
                "Octave",
              ].map((name, i) => (
                <option
                  key={name}
                  value={i + 1}
                  disabled={i + 1 > jumpLevels[draft.noteJumps].interval}
                >
                  {tr(name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr("Bars in view")}
            <select
              value={draft.bars}
              onChange={(e) => field("bars", +e.target.value as 2 | 3 | 4)}
            >
              {[2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            {tr("Input timing offset (ms)")}
            <input
              type="number"
              min="-500"
              max="500"
              value={draft.offset}
              onChange={(e) => field("offset", +e.target.value)}
            />
          </label>
          <label>
            {tr("Timing tolerance (ms)")}
            <input
              type="number"
              min="50"
              max="400"
              value={draft.tolerance}
              onChange={(e) => field("tolerance", +e.target.value)}
            />
          </label>
          <label>
            {tr("Exercise seed")}
            <input value={seed} onChange={(e) => onSeed(e.target.value)} />
          </label>
          {tr(children)}
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
