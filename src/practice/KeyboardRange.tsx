import { useEffect, useRef, useState } from "react";
import { Note } from "tonal";
import { Pencil, X } from "lucide-react";
import { type Hand, type Settings, settingsSchema } from "../score/model";
import { rangeError } from "../generation/positions";
import { useTranslation } from "../shared/i18n";

const keys = Array.from({ length: 88 }, (_, i) => i + 21);
const black = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
const whiteKeys = keys.filter((midi) => !black(midi));
const bounds = (s: Settings, hand: Hand) =>
  hand === "left" ? [s.leftMin, s.leftMax] : [s.min, s.max];

export function KeyboardRange({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const tr = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const keyboard = useRef<HTMLDivElement>(null);
  const lowerEndpoint = useRef<HTMLButtonElement>(null);
  const centeredHand = useRef<Hand | undefined>(undefined);
  const [selection, setSelection] = useState<Settings>();
  const [hand, setHand] = useState<Hand>("right");
  const [edge, setEdge] = useState<"low" | "high">("low");
  const [focusMidi, setFocusMidi] = useState(60);
  const editing = Boolean(selection);
  const hands: Hand[] =
    settings.hand === "both" ? ["left", "right"] : [settings.hand];
  const [low, high] = bounds(selection ?? settings, hand);
  const error = selection ? rangeError(selection) : undefined;
  const valid =
    selection && settingsSchema.safeParse(selection).success && !error;

  useEffect(() => {
    if (selection && !dialog.current?.open) {
      dialog.current?.showModal();
      lowerEndpoint.current?.focus({ preventScroll: true });
    }
    if (!selection && dialog.current?.open) dialog.current.close();
  }, [selection]);

  function scrollToKey(midi: number) {
    keyboard.current
      ?.querySelector<HTMLElement>(`[data-range-midi="${midi}"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }

  useEffect(() => {
    if (!selection) centeredHand.current = undefined;
    else if (centeredHand.current !== hand) {
      scrollToKey(bounds(selection, hand)[0]);
      centeredHand.current = hand;
    }
  }, [hand, selection]);

  useEffect(() => {
    const viewport = keyboard.current?.parentElement;
    if (!editing || !viewport || typeof ResizeObserver === "undefined") return;
    // Keep a selected endpoint visible after rotating a tablet or resizing.
    const observer = new ResizeObserver(() => {
      keyboard.current
        ?.querySelector<HTMLElement>('[tabindex="0"]')
        ?.scrollIntoView?.({ block: "nearest", inline: "center" });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [editing]);

  function selectKey(midi: number) {
    if (!selection) return;
    const min = edge === "low" ? midi : Math.min(midi, low);
    const max = edge === "high" ? midi : Math.max(midi, high);
    setSelection({
      ...selection,
      ...(hand === "left" ? { leftMin: min, leftMax: max } : { min, max }),
    });
    setFocusMidi(midi);
    if (edge === "low") setEdge("high");
  }

  return (
    <div className="keyboard-range">
      <div className="range-overview">
        <span>{tr("Keyboard range")}</span>
        <button
          type="button"
          onClick={() => {
            const active = settings.hand === "left" ? "left" : "right";
            setHand(active);
            setEdge("low");
            setFocusMidi(bounds(settings, active)[0]);
            setSelection({ ...settings });
          }}
        >
          <Pencil size={14} aria-hidden="true" />
          {tr("Edit range")}
        </button>
      </div>
      {hands.map((h) => (
        <div className={`range-label range-${h}`} key={h}>
          <span>{tr(h === "left" ? "Left hand" : "Right hand")}</span>
          <strong>
            {bounds(settings, h)
              .map((midi) => Note.fromMidi(midi))
              .join("–")}
          </strong>
        </div>
      ))}
      <dialog
        ref={dialog}
        className="range-dialog"
        aria-labelledby="range-title"
        aria-describedby="range-instructions"
        onClose={() => setSelection(undefined)}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      >
        {selection && (
          <div className="range-dialog-content">
            <header className="range-dialog-heading">
              <h2 id="range-title">{tr("Edit keyboard range")}</h2>
              <button
                type="button"
                aria-label={tr("Cancel range editing")}
                onClick={() => setSelection(undefined)}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <p id="range-instructions">
              {tr(
                "Tap the lowest key, then the highest key. Select an endpoint to adjust it.",
              )}
            </p>
            <div
              className="range-hand-switch"
              role="group"
              aria-label={tr("Hand to edit")}
            >
              {hands.map((h) => (
                <button
                  type="button"
                  key={h}
                  className={`range-${h}`}
                  aria-pressed={hand === h}
                  onClick={() => {
                    setHand(h);
                    setEdge("low");
                    setFocusMidi(bounds(selection, h)[0]);
                  }}
                >
                  {tr(h === "left" ? "Left hand" : "Right hand")}
                  {" · "}
                  {bounds(selection, h)
                    .map((midi) => Note.fromMidi(midi))
                    .join("–")}
                </button>
              ))}
            </div>
            <div
              className="range-endpoints"
              role="group"
              aria-label={tr("Endpoint to edit")}
            >
              {(["low", "high"] as const).map((e) => (
                <button
                  type="button"
                  key={e}
                  aria-pressed={edge === e}
                  ref={e === "low" ? lowerEndpoint : undefined}
                  onClick={() => {
                    setEdge(e);
                    const midi = e === "low" ? low : high;
                    setFocusMidi(midi);
                    scrollToKey(midi);
                  }}
                >
                  {tr(e === "low" ? "Lowest note" : "Highest note")}
                  {" · "}
                  <strong>{Note.fromMidi(e === "low" ? low : high)}</strong>
                </button>
              ))}
            </div>
            <p className="settings-help">
              {tr(
                "Scroll to explore A0–C8. Use arrow keys to move, Home/End for the ends, and Enter or Space to select.",
              )}
            </p>
            <div className="range-keyboard-scroll">
              <div
                className={`range-keyboard range-${hand}`}
                ref={keyboard}
                role="group"
                aria-label={tr("Piano keyboard")}
              >
                {keys.map((midi) => {
                  const isBlack = black(midi);
                  const index = isBlack
                    ? whiteKeys.filter((n) => n < midi).length - 0.32
                    : whiteKeys.indexOf(midi);
                  const selected = midi >= low && midi <= high;
                  const endpoint = midi === low || midi === high;
                  return (
                    <button
                      key={midi}
                      type="button"
                      data-range-midi={midi}
                      className={`range-key ${isBlack ? "black-key" : "white-key"}${endpoint ? " range-key-endpoint" : ""}`}
                      style={{
                        left: `${(index * 100) / 52}%`,
                        width: `${((isBlack ? 0.64 : 1) * 100) / 52}%`,
                      }}
                      aria-label={Note.fromMidi(midi)}
                      aria-pressed={selected}
                      tabIndex={focusMidi === midi ? 0 : -1}
                      onFocus={() => setFocusMidi(midi)}
                      onClick={() => selectKey(midi)}
                      onKeyDown={(event) => {
                        const next = {
                          ArrowLeft: Math.max(21, midi - 1),
                          ArrowRight: Math.min(108, midi + 1),
                          Home: 21,
                          End: 108,
                        }[event.key];
                        if (next === undefined) return;
                        event.preventDefault();
                        setFocusMidi(next);
                        keyboard.current
                          ?.querySelector<HTMLElement>(
                            `[data-range-midi="${next}"]`,
                          )
                          ?.focus();
                        scrollToKey(next);
                      }}
                    >
                      {(endpoint || midi % 12 === 0 || midi === 21) && (
                        <span>{Note.fromMidi(midi)}</span>
                      )}
                      {endpoint && (
                        <span className="range-key-marker" aria-hidden="true">
                          {midi === low ? "▼" : "▲"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className={`range-label range-${hand}`} aria-live="polite">
              {tr(hand === "left" ? "Left hand range" : "Right hand range")}
              {": "}
              {Note.fromMidi(low)}–{Note.fromMidi(high)}
            </p>
            <div className="range-feedback" aria-live="polite">
              {error && <p role="alert">{tr(error)}</p>}
            </div>
            <footer className="range-dialog-actions">
              <button type="button" onClick={() => setSelection(undefined)}>
                {tr("Cancel")}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!valid}
                onClick={() => {
                  if (valid && selection) {
                    onChange(selection);
                    setSelection(undefined);
                  }
                }}
              >
                {tr("Apply")}
              </button>
            </footer>
          </div>
        )}
      </dialog>
    </div>
  );
}
