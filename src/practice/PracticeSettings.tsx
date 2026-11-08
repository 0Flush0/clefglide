import { Note } from "tonal";
import { useMemo } from "react";
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
  positionsFor,
  separated,
  movementRules,
  rangeSummary,
} from "../generation/positions";
export function playableRangeOption(
  s: Settings,
  left: boolean,
  edge: "low" | "high",
  value: number,
) {
  const proposed = {
    ...s,
    [left
      ? edge === "low"
        ? "leftMin"
        : "leftMax"
      : edge === "low"
        ? "min"
        : "max"]: value,
  };
  const hand = left ? "left" : s.hand === "left" ? "left" : "right";
  const positions = positionsFor(proposed, hand);
  if (!positions.length) return false;
  if (s.hand !== "both") return true;
  const other = positionsFor(proposed, left ? "right" : "left");
  return positions.some((a) => other.some((b) => separated(a, b)));
}
function RangeEditor({
  settings,
  left = false,
  onChange,
}: {
  settings: Settings;
  left?: boolean;
  onChange: (s: Settings) => void;
}) {
  const options = useMemo(
    () =>
      Array.from(
        { length: (left ? 84 : 96) - (left ? 24 : 36) + 1 },
        (_, i) => i + (left ? 24 : 36),
      ).map((midi) => ({
        midi,
        low: playableRangeOption(settings, left, "low", midi),
        high: playableRangeOption(settings, left, "high", midi),
      })),
    [settings, left],
  );
  return (
    <fieldset className="range-editor">
      <legend>
        {settings.hand === "both"
          ? left
            ? "Left hand range"
            : "Right hand range"
          : "Keyboard range"}
      </legend>
      <div className="control-grid">
        {(["low", "high"] as const).map((edge) => {
          const key = left
            ? edge === "low"
              ? "leftMin"
              : "leftMax"
            : edge === "low"
              ? "min"
              : "max";
          const minAllowed = left ? (edge === "low" ? 24 : 24) : 36,
            maxAllowed = left
              ? edge === "low"
                ? 72
                : 84
              : edge === "low"
                ? 84
                : 96;
          return (
            <label key={edge}>
              {edge === "low" ? "Lowest note" : "Highest note"}
              <select
                aria-label={`${left ? "Left hand " : ""}${edge === "low" ? "Lowest note" : "Highest note"}`}
                value={settings[key]}
                onChange={(e) => {
                  const midi = +e.target.value;
                  if (
                    midi >= minAllowed &&
                    midi <= maxAllowed &&
                    playableRangeOption(settings, left, edge, midi)
                  )
                    onChange({ ...settings, [key]: midi });
                }}
              >
                {options.map(({ midi, ...valid }) => (
                  <option
                    key={midi}
                    value={midi}
                    disabled={
                      midi < minAllowed || midi > maxAllowed || !valid[edge]
                    }
                  >
                    {Note.fromMidi(midi)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
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
  return (
    <div className="difficulty-row">
      <details className="difficulty-info">
        <summary aria-label={`About ${label.toLowerCase()}`}>
          <span>{label}</span>
          <span className="difficulty-info-icon">
            <Info size={14} aria-hidden="true" />
          </span>
        </summary>
        <p>{help}</p>
      </details>
      <div className="segmented" role="group" aria-label={label}>
        {(Object.keys(levels) as T[]).map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={level === value}
            title={levels[level].description}
            onClick={() => onChange(level)}
          >
            {levels[level].label}
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
  const feasible =
    draft.hand !== "both" ||
    positionsFor(draft, "right").some((r) =>
      positionsFor(draft, "left").some((l) => separated(r, l)),
    );
  const valid = settingsSchema.safeParse(draft).success && feasible;
  const field = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...draft, [key]: value });
  return (
    <aside className="controls">
      <div className="controls-title">
        <Settings2 size={17} />
        <h2>Your practice</h2>
      </div>
      <div className="settings-scroll">
        <section
          className="exercise-difficulty"
          aria-label="Exercise difficulty"
        >
          <h3>Exercise difficulty</h3>
          <DifficultyButtons
            label="Note jumps"
            help="Changes the distance between successive melody notes. Small allows neighboring scale notes, Easy up to thirds, Medium up to fifths, and Large up to an octave."
            value={draft.noteJumps}
            levels={jumpLevels}
            onChange={(level) => onChange(applyNoteJumps(draft, level))}
          />
          <DifficultyButtons
            label="Hand movements"
            help="Changes how often and how far your hand may move to a new position. Off keeps one position; Easy, Medium and Hard allow progressively more movement. Every planned move has a full beat of rest and an advance cue."
            value={draft.handMovements}
            levels={movementLevels}
            onChange={(level) => onChange(applyHandMovements(draft, level))}
          />
          <DifficultyButtons
            label="Finger spacing"
            help="Changes the gaps between the keys assigned to your fingers. Off uses five consecutive scale notes. Higher levels introduce more varied approved gaps near the thumb and index finger, while retaining the planned hand position."
            value={draft.fingerSpacing}
            levels={spacingLevels}
            onChange={(level) => field("fingerSpacing", level)}
          />
          <p className="settings-help">
            Five independent skills. Chords and accidentals stay within your
            movement and jump limits.
          </p>
          <DifficultyButtons
            label="Accidentals"
            help="Adds notes outside the selected key. Off uses only the key's notes, including its key-signature sharps or flats. Easy adds occasional chromatic neighbors, Medium adds more neighbors and passing notes, and Hard adds more frequent chromatic figures and harmonic alterations."
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
            label="Chords"
            help="Changes how many notes you play together and how often. Off uses single notes per hand. Easy adds occasional two-note shapes; Medium adds triads and simple inversions; Hard adds more chords and selected four-note shapes. Every chord must fit the validated fingering and keyboard range."
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
            Hands
            <select
              value={draft.hand}
              onChange={(e) =>
                field("hand", e.target.value as Settings["hand"])
              }
            >
              <option value="right">Right</option>
              <option value="left">Left</option>
              <option value="both">Both</option>
            </select>
          </label>
        </div>
        <details className="keyboard-range">
          <summary>
            Keyboard range · {Note.fromMidi(draft.min)}–
            {Note.fromMidi(draft.max)}
            {draft.hand === "both"
              ? ` / LH ${Note.fromMidi(draft.leftMin)}–${Note.fromMidi(draft.leftMax)}`
              : ""}
          </summary>
          <RangeEditor settings={draft} onChange={onChange} />
          {draft.hand === "both" && (
            <RangeEditor settings={draft} left onChange={onChange} />
          )}
        </details>
        <p className="range-explanation">
          Music stays inside this range. {rangeSummary(draft)}
        </p>
        {!feasible && (
          <p role="alert" className="settings-help">
            These hand ranges overlap. Lower the left-hand range or raise the
            right-hand range.
          </p>
        )}
        <label>
          Tempo <span className="range-value">{draft.bpm} BPM</span>
          <input
            aria-label="Tempo"
            type="range"
            min="30"
            max="180"
            value={draft.bpm}
            onChange={(e) => field("bpm", +e.target.value)}
          />
        </label>
        <label>
          Fingering assistance
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
            <option value="all">All — every finger</option>
            <option value="smart">Smart — just what you need</option>
            <option value="hidden">None — independent reading</option>
          </select>
        </label>
        <p className="settings-help">
          Hints change immediately.{" "}
          {draft.hints === "hidden" && assistanceUsed
            ? "This exercise has already shown hints. New exercise starts independent practice."
            : draft.mode === "benchmark"
              ? "Independent mode hides all guidance."
              : "Smart shows starting fingers, necessary spacing cues and planned moves."}
        </p>
        <details className="advanced">
          <summary>Advanced settings</summary>
          <div className="control-grid">
            {draft.hand !== "both" && (
              <label>
                Clef
                <select
                  value={draft.hand === "right" ? draft.rhClef : draft.lhClef}
                  onChange={(e) =>
                    field(
                      draft.hand === "right" ? "rhClef" : "lhClef",
                      e.target.value as "treble" | "bass",
                    )
                  }
                >
                  <option value="treble">Treble</option>
                  <option value="bass">Bass</option>
                </select>
              </label>
            )}
            {draft.hand === "both" && (
              <>
                <label>
                  Right clef
                  <select
                    value={draft.rhClef}
                    onChange={(e) =>
                      field("rhClef", e.target.value as "treble" | "bass")
                    }
                  >
                    <option value="treble">Treble</option>
                    <option value="bass">Bass</option>
                  </select>
                </label>
                <label>
                  Left clef
                  <select
                    value={draft.lhClef}
                    onChange={(e) =>
                      field("lhClef", e.target.value as "treble" | "bass")
                    }
                  >
                    <option value="bass">Bass</option>
                    <option value="treble">Treble</option>
                  </select>
                </label>
              </>
            )}
          </div>
          <label>
            Practice mode
            <select
              value={draft.mode}
              onChange={(e) =>
                field("mode", e.target.value as Settings["mode"])
              }
            >
              <option value="wait">Wait for correct notes</option>
              <option value="timed">Timed playing</option>
              <option value="benchmark">Independent benchmark</option>
            </select>
          </label>
          <div className="control-grid">
            <label>
              Key
              <select
                value={draft.key}
                onChange={(e) =>
                  field("key", e.target.value as Settings["key"])
                }
              >
                {["C", "G", "F", "D"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Meter
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
            Rhythm
            <select
              value={draft.rhythm}
              onChange={(e) =>
                field("rhythm", e.target.value as Settings["rhythm"])
              }
            >
              <option value="gentle">Gentle notes & rests</option>
              <option value="quarters">Quarter notes</option>
              <option value="mixed">Mixed eighths through whole notes</option>
            </select>
          </label>
          <label>
            Hand-shift frequency{" "}
            <span className="range-value">
              {Math.round(draft.shiftFrequency * 100)}%
            </span>
            <input
              aria-label="Hand-shift frequency"
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
            Maximum repositioning distance
            <select
              disabled={draft.handMovements === "off"}
              value={draft.maxShift}
              onChange={(e) => field("maxShift", +e.target.value)}
            >
              {Array.from(
                { length: movementRules[draft.handMovements].distance + 1 },
                (_, i) => (
                  <option key={i} value={i}>
                    {i} scale steps
                  </option>
                ),
              )}
            </select>
          </label>
          <p className="settings-help">
            {draft.handMovements === "off"
              ? "Off keeps one mapped position for the whole exercise."
              : "Frequency applies at eligible phrase boundaries. A narrow range may prevent shifts even at 100%."}
          </p>
          <label>
            Maximum melodic interval
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
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bars in view
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
            Input timing offset (ms)
            <input
              type="number"
              min="-500"
              max="500"
              value={draft.offset}
              onChange={(e) => field("offset", +e.target.value)}
            />
          </label>
          <label>
            Timing tolerance (ms)
            <input
              type="number"
              min="50"
              max="400"
              value={draft.tolerance}
              onChange={(e) => field("tolerance", +e.target.value)}
            />
          </label>
          <label>
            Exercise seed
            <input value={seed} onChange={(e) => onSeed(e.target.value)} />
          </label>
          {children}
        </details>
      </div>
      <div className="settings-apply">
        <p role="status">
          {!valid
            ? "Check the advanced values before generating."
            : pending
              ? "Changes ready — generate new music to apply."
              : "Ready. Exercise settings apply to new music."}
        </p>
        <button
          className="apply"
          disabled={!pending || !valid}
          onClick={onApply}
        >
          Apply & generate <ArrowRight size={16} />
        </button>
      </div>
    </aside>
  );
}
