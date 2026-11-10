import {
  useTranslation,
  initialLanguage,
  languageKey,
  translate,
  LanguageContext,
} from "../shared/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  Hand,
  Keyboard,
  Lightbulb,
  Moon,
  Music2,
  Pause,
  Play,
  Plug,
  RotateCcw,
  SkipForward,
  Sun,
  Volume2,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Note } from "tonal";
import { difficultySummary } from "./presets";
import { PracticeSettings } from "./PracticeSettings";
import { SettingsHelp } from "./SettingsHelp";
import { visibleMovements, nextMovements } from "../score/hints";
import { PracticeHints } from "./PracticeHints";
import {
  defaults,
  fingerprint,
  settingsSchema,
  type Settings,
  type Phrase,
  type HandState,
  VERSION,
  automaticAssistance,
} from "../score/model";
import { generate } from "../generation/planner";
import { Scorer, metrics } from "../scoring/engine";
import {
  HardwareMidi,
  MidiBus,
  midiUnavailableReason,
  type MidiEvent,
} from "../midi/adapter";
import { createLocalId } from "../shared/ids";
import { GitHubLink, SourceLinks } from "../shared/SourceLinks";
import { Notation } from "../score/Notation";
import {
  db,
  record,
  download,
  csv,
  importSessions,
  type Session,
} from "../progress/store";

const bus = new MidiBus();
const initialSeed = "first-light";
type Runtime = {
  phrases: Phrase[];
  engine: Scorer;
  seed: string;
  id: string;
  initialHands: HandState[];
  assistanceUsed: boolean;
};
function runtime(settings: Settings, seed: string): Runtime {
  const first = generate(settings, seed),
    next = generate(settings, seed, first.final);
  return {
    phrases: [first, next],
    engine: new Scorer(
      [...first.events, ...next.events]
        .filter((e) => e.kind === "note")
        .sort((a, b) => a.bar - b.bar || a.onset - b.onset),
      settings,
    ),
    seed,
    id: createLocalId("session"),
    initialHands: structuredClone(first.initial.hands),
    assistanceUsed: automaticAssistance(settings),
  };
}
const labels = {
  en: {
    practice: "Practice",
    progress: "Progress",
    help: "Settings & help",
    title: "Find your reading rhythm.",
    subtitle: "A little less thinking. A little more playing.",
    start: "Start practice",
    pause: "Pause",
    connect: "Connect MIDI",
    settings: "Your practice",
    placement: "Before you play",
    next: "New exercise",
    save: "Save & finish",
  },
  de: {
    practice: "Üben",
    progress: "Fortschritt",
    help: "Einstellungen & Hilfe",
    title: "Finde deinen Leserhythmus.",
    subtitle: "Weniger nachdenken. Mehr Musik spielen.",
    start: "Übung starten",
    pause: "Pause",
    connect: "MIDI verbinden",
    settings: "Deine Übung",
    placement: "Vor dem Spielen",
    next: "Neue Übung",
    save: "Speichern & beenden",
  },
};
export function App() {
  const [compactScore, setCompactScore] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(max-width:1200px)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(max-width:1200px)");
    const update = () => setCompactScore(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [settings, setSettings] = useState(defaults),
    [draft, setDraft] = useState(defaults),
    [seed, setSeed] = useState(initialSeed),
    [run, setRun] = useState(() => runtime(defaults, initialSeed));
  const ref = useRef(run);
  ref.current = run;
  const [, render] = useState(0),
    [tab, setTab] = useState("practice"),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState("Ready when you are."),
    [reveal, setReveal] = useState(false),
    [sim, setSim] = useState(true),
    [device, setDevice] = useState(""),
    [inputs, setInputs] = useState<{ id: string; name: string }[]>([]),
    [status, setStatus] = useState(
      () => midiUnavailableReason() ?? "Piano disconnected",
    ),
    [diagnostic, setDiagnostic] = useState<MidiEvent>(),
    [channel, setChannel] = useState(0),
    [dark, setDark] = useState(false),
    [lang, setLang] = useState<"en" | "de">(initialLanguage),
    [click, setClick] = useState(false),
    [compareAll, setCompareAll] = useState(false);
  const chooseLanguage = (language: "en" | "de") => {
    setLang(language);
    try {
      localStorage.setItem(languageKey, language);
    } catch {
      /* Storage is optional. */
    }
  };
  const tr = <T,>(value: T) => translate(value, lang);
  const t = labels[lang],
    audio = useRef<AudioContext | null>(null),
    lastBeat = useRef(-1),
    hardware = useRef<HardwareMidi | null>(null),
    savedPhrase = useRef(-1),
    presentedBars = useRef<Settings["bars"]>(settings.bars);
  const sessions =
    useLiveQuery(() => db.sessions.orderBy("date").reverse().toArray(), []) ??
    [];
  const persist = useCallback(async (r: Runtime) => {
    if (!r.engine.results.length) return;
    try {
      await db.sessions.put(
        record(
          r.id,
          r.seed,
          { ...r.engine.settings, bars: presentedBars.current },
          r.engine.activeMs(performance.now()),
          r.engine.results,
          r.assistanceUsed,
        ),
      );
    } catch (e) {
      setError(`Could not save local progress: ${String(e)}`);
    }
  }, []);
  useEffect(() => {
    db.preferences
      .get("settings")
      .then((p) => {
        if (p) {
          const parsed = settingsSchema.parse(p.settings);
          const s = {
            ...parsed,
            hints:
              parsed.hints === "reveal" ? ("smart" as const) : parsed.hints,
          };
          const restored = runtime(s, initialSeed);
          setSettings(s);
          setDraft(s);
          setRun(restored);
        }
      })
      .catch(() =>
        setError(
          "Local settings could not be loaded. Export important progress regularly.",
        ),
      );
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.lang = lang;
  }, [dark, lang]);
  useEffect(() => {
    const adapter = new HardwareMidi(
      bus,
      (list, message) => {
        setInputs(list.map((i) => ({ id: i.id, name: i.name })));
        setStatus(message);
      },
      () => {
        ref.current.engine.pause(performance.now());
        setDevice("");
        setFeedback(
          "Piano disconnected. Practice paused; reconnect and press Start.",
        );
        void persist(ref.current);
      },
    );
    hardware.current = adapter;
    return () => adapter.dispose();
  }, [persist]);
  useEffect(
    () =>
      bus.subscribe((e) => {
        setDiagnostic(e);
        if (
          (e.source === "simulator") !== sim ||
          (channel && e.channel !== channel)
        )
          return;
        const r = ref.current;
        const before = r.engine.results.length;
        r.engine.input(e);
        const result = r.engine.results.at(-1);
        if (r.engine.results.length > before) {
          setFeedback(
            result?.kind === "wrong" || result?.kind === "extra"
              ? "Try again — that pitch did not match."
              : r.engine.matched.size > 0
                ? `${r.engine.missingPitches.length} more pitches needed together.`
                : "Good reading. Keep going.",
          );
        }
        render((x) => x + 1);
      }),
    [sim, channel],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      const r = ref.current,
        engine = r.engine;
      if (!engine.running) return;
      const now = performance.now();
      engine.tick(now);
      const targetBar = engine.target?.bar ?? r.phrases.at(-1)!.final.bar;
      if (targetBar + 4 >= r.phrases.at(-1)!.final.bar) {
        const p = generate(engine.settings, r.seed, r.phrases.at(-1)!.final);
        r.phrases.push(p);
        engine.notes.push(
          ...p.events
            .filter((e) => e.kind === "note")
            .sort((a, b) => a.bar - b.bar || a.onset - b.onset),
        );
        if (r.phrases.length > 4) r.phrases.shift();
      }
      const phrase = Math.floor(targetBar / 4);
      if (phrase !== savedPhrase.current) {
        savedPhrase.current = phrase;
        void persist(r);
      }
      const beat = Math.floor(
        (now - engine.origin) / (60000 / engine.settings.bpm),
      );
      if (beat !== lastBeat.current) {
        lastBeat.current = beat;
        if (click && audio.current) {
          const osc = audio.current.createOscillator(),
            gain = audio.current.createGain();
          osc.frequency.value = beat % engine.settings.beats === 0 ? 1050 : 750;
          gain.gain.setValueAtTime(0.07, audio.current.currentTime);
          gain.gain.exponentialRampToValueAtTime(
            0.001,
            audio.current.currentTime + 0.055,
          );
          osc.connect(gain).connect(audio.current.destination);
          osc.start();
          osc.stop(audio.current.currentTime + 0.06);
        }
      }
      render((x) => x + 1);
    }, 30);
    return () => clearInterval(timer);
  }, [click, persist]);
  useEffect(() => {
    const fn = () => {
      ref.current.engine.pause(performance.now());
      void persist(ref.current);
    };
    const hidden = () => {
      if (document.hidden) fn();
    };
    window.addEventListener("pagehide", fn);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", fn);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [persist]);
  const change = async (s: Settings, newSeed: string) => {
    try {
      const parsed = settingsSchema.parse(s);
      const checked = {
        ...parsed,
        hints: parsed.hints === "reveal" ? ("smart" as const) : parsed.hints,
      };
      const next = runtime(checked, newSeed);
      ref.current.engine.pause(performance.now());
      await persist(ref.current);
      setRun(next);
      setSettings(checked);
      setDraft(checked);
      setSeed(newSeed);
      setError("");
      setFeedback("Fresh music. Check your starting hand position.");
      setReveal(false);
      savedPhrase.current = -1;
      ref.current = next;
      await db.preferences.put({ id: "settings", settings: checked });
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const engine = run.engine,
    now = performance.now(),
    m = metrics(engine.results, engine.activeMs(now), settings.tolerance),
    target = engine.target,
    startBar = target?.bar ?? 0;
  const shownBars = compactScore
    ? (Math.min(settings.bars, 2) as 2)
    : settings.bars;
  presentedBars.current = shownBars;
  const events = useMemo(
    () =>
      run.phrases
        .flatMap((p) => p.events)
        .filter((e) => e.bar >= startBar && e.bar < startBar + shownBars),
    [run, startBar, shownBars, run.phrases.length],
  );
  const hands = run.phrases[0].initial.hands;
  const planPositions = useMemo(
    () => [...run.initialHands, ...run.phrases.flatMap((p) => p.positions)],
    [run, startBar, run.phrases.length],
  );
  const hintEvents = useMemo(
    () => run.phrases.flatMap((p) => p.events),
    [run, startBar, run.phrases.length],
  );
  const allMovements = useMemo(
    () => run.phrases.flatMap((p) => p.movements),
    [run, startBar, run.phrases.length],
  );
  const upcomingMovements = useMemo(
    () =>
      visibleMovements(
        run.phrases.flatMap((p) => p.movements),
        startBar,
        shownBars,
        settings.beats,
      ),
    [run, startBar, shownBars, settings.beats, run.phrases.length],
  );
  useEffect(() => setReveal(false), [startBar]);
  const manualMovements = useMemo(
    () =>
      nextMovements(
        run.phrases.flatMap((p) => p.movements),
        startBar,
        settings.beats,
      ),
    [run, startBar, settings.beats, run.phrases.length],
  );
  const guidanceHands =
    startBar === 0
      ? run.initialHands
      : hands.map((hand) => {
          const note = events.find(
            (e) => e.hand === hand.hand && e.kind === "note",
          );
          return (
            planPositions.find(
              (p) => p.hand === hand.hand && p.id === note?.positionId,
            ) ?? hand
          );
        });
  const pianoLow =
      Math.floor(
        (settings.hand === "both"
          ? Math.min(settings.min, settings.leftMin)
          : settings.min) / 12,
      ) * 12,
    pianoHigh =
      Math.floor(
        (settings.hand === "both"
          ? Math.max(settings.max, settings.leftMax)
          : settings.max) / 12,
      ) *
        12 +
      12,
    pianoPitches = Array.from(
      { length: Math.max(24, pianoHigh - pianoLow) },
      (_, i) => pianoLow + i,
    );
  const notationSettings = useMemo(
    () =>
      settings.mode === "benchmark"
        ? { ...settings, bars: shownBars, hints: "hidden" as const }
        : { ...settings, bars: shownBars },
    [settings, shownBars],
  );
  useEffect(() => {
    const mapping = [
      "a",
      "w",
      "s",
      "e",
      "d",
      "f",
      "t",
      "g",
      "y",
      "h",
      "u",
      "j",
      "k",
      "o",
      "l",
      "p",
      ";",
    ];
    const active = new Map<string, number>();
    const down = (e: KeyboardEvent) => {
      if (
        !sim ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(e.target.tagName))
      )
        return;
      const i = mapping.indexOf(e.key.toLowerCase());
      if (i >= 0) {
        e.preventDefault();
        active.set(e.key, pianoLow + i);
        bus.virtual(pianoLow + i, "on");
      }
    };
    const up = (e: KeyboardEvent) => {
      const p = active.get(e.key);
      if (p !== undefined) {
        bus.virtual(p, "off");
        active.delete(e.key);
      }
    };
    const blur = () => {
      active.forEach((p) => bus.virtual(p, "off"));
      active.clear();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      blur();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [sim, pianoLow]);
  const pending =
    JSON.stringify(draft) !== JSON.stringify(settings) || seed !== run.seed;
  const setHints = (hints: Settings["hints"]) => {
    const updated = { ...settings, hints };
    setSettings(updated);
    setDraft((s) => ({ ...s, hints }));
    engine.settings = { ...engine.settings, hints };
    run.assistanceUsed ||= automaticAssistance(updated);
    setReveal(false);
    void persist(run);
    void db.preferences
      .put({ id: "settings", settings: updated })
      .catch((e) => setError(String(e)));
  };
  const apply = () =>
    change(draft, seed !== run.seed ? seed : createLocalId("exercise"));
  const toggle = async () => {
    if (pending && !engine.running) {
      const next = await apply();
      if (next) {
        next.engine.start(performance.now());
        render((x) => x + 1);
      }
      return;
    }
    if (engine.running) {
      engine.pause(performance.now());
      void persist(run);
    } else {
      engine.start(performance.now());
      if (click) {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      }
      setFeedback(
        settings.mode === "timed"
          ? "Count in, then follow the pulse."
          : "Play the highlighted note.",
      );
    }
    render((x) => x + 1);
  };
  const connect = async () => {
    try {
      hardware.current?.dispose();
      await hardware.current?.enable();
      if (hardware.current?.input) selectDevice(hardware.current.input.id);
      setError("");
    } catch (e) {
      setStatus("MIDI connection failed");
      setError(
        `${String(e)} Check Chrome site permissions, then retry or use the simulator.`,
      );
    }
  };
  const selectDevice = (id: string) => {
    engine.pause(performance.now());
    void persist(run);
    hardware.current?.select(id);
    setDevice(id);
    setSim(!id);
    setStatus(id ? "Piano connected" : "Piano disconnected");
    render((x) => x + 1);
  };
  const filtered = sessions.filter(
    (s) =>
      compareAll ||
      s.fingerprint ===
        fingerprint({ ...settings, bars: shownBars }, run.assistanceUsed),
  );
  const chart = filtered
    .slice(0, 30)
    .reverse()
    .map((s, i) => ({
      session: i + 1,
      accuracy: Math.round(
        metrics(s.results, s.ms, s.settings.tolerance).accuracy,
      ),
      npm: Math.round(metrics(s.results, s.ms, s.settings.tolerance).npm),
    }));
  return (
    <LanguageContext.Provider value={lang}>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          if (value !== "practice") {
            engine.pause(performance.now());
            void persist(run);
          }
          setTab(value);
        }}
        className="app-shell"
      >
        <aside className="rail">
          <a className="brand" href="#" aria-label={tr("ClefGlide home")}>
            <Music2 size={25} />
            <span>
              {tr("ClefGlide")}
              <span className="brand-dot">.</span>
            </span>
          </a>
          <p className="rail-caption">{tr("Read ahead. Play naturally.")}</p>
          <Tabs.List className="nav" aria-label={tr("Main navigation")}>
            <Tabs.Trigger value="practice">
              <Music2 size={19} />
              {tr(t.practice)}
            </Tabs.Trigger>
            <Tabs.Trigger value="progress">
              <BarChart3 size={19} />
              {tr(t.progress)}
            </Tabs.Trigger>
            <Tabs.Trigger value="help">
              <CircleHelp size={19} />
              {tr(t.help)}
            </Tabs.Trigger>
          </Tabs.List>
          <div className="rail-bottom">
            <span className="local-dot" /> {tr("Made for your own pace")}
            <p>
              {tr("Private by design.")}
              <br />
              {tr("Your music stays on this device.")}
            </p>
            <button className="theme" onClick={() => setDark(!dark)}>
              {dark ? <Sun size={17} /> : <Moon size={17} />}{" "}
              {tr(dark ? "Light" : "Dark")} {tr("appearance")}
            </button>
            <select
              aria-label={tr("Language")}
              value={lang}
              onChange={(e) => chooseLanguage(e.target.value as "en" | "de")}
            >
              <option value="en">{tr("English")}</option>
              <option value="de">{tr("Deutsch")}</option>
            </select>
          </div>
        </aside>
        <main>
          <header className="topbar">
            <div className="breadcrumb">
              {tr("Your piano companion")}
              <ChevronRight size={14} />
              <strong>
                {tr(
                  tab === "practice"
                    ? t.practice
                    : tab === "progress"
                      ? t.progress
                      : t.help,
                )}
              </strong>
            </div>
            {inputs.length > 0 && (
              <select
                className="device-picker"
                aria-label={tr("MIDI device")}
                value={device}
                onChange={(e) => selectDevice(e.target.value)}
              >
                <option value="">{tr("Choose piano input")}</option>
                {inputs.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className={`device-badge ${device ? "connected" : ""}`}
              aria-label={tr("Connect MIDI")}
              onClick={() => void connect()}
            >
              <span className="status-dot" />
              {tr(
                device
                  ? "MIDI connected"
                  : sim
                    ? "Connect MIDI"
                    : "Connect your piano",
              )}
              <Plug size={15} />
            </button>
            <GitHubLink />
          </header>
          {tr(
            error && (
              <div role="alert" className="error">
                {tr(error)}
                <button
                  onClick={() => setError("")}
                  aria-label={tr("Dismiss error")}
                >
                  ×
                </button>
              </div>
            ),
          )}
          <Tabs.Content value="practice" className="page">
            <div className="page-heading">
              <div>
                <h1>{tr("Read ahead. Play naturally.")}</h1>
                <p>{tr("Fresh music, at your own pace.")}</p>
              </div>
              <span className="level-pill">
                {tr(
                  settings.hand === "both"
                    ? "Both hands"
                    : settings.hand === "right"
                      ? "Right hand"
                      : "Left hand",
                )}{" "}
                · {settings.bpm} {tr("BPM")}
              </span>
            </div>
            <div className="practice-layout">
              <section className="practice-main">
                <div className="score-card">
                  <div className="score-toolbar">
                    <div>
                      <span className="small-label">
                        {tr(
                          settings.mode === "timed"
                            ? "CONTINUOUS RHYTHM"
                            : settings.mode === "benchmark"
                              ? "UNASSISTED · FIRST ATTEMPT"
                              : "GUIDED NOTE READING",
                        )}
                      </span>
                      <h2>
                        {tr(settings.key)} {tr("major")} <span> / </span>{" "}
                        {settings.beats}/4 <span> / </span> {settings.bpm}{" "}
                        {tr("BPM")}
                      </h2>
                    </div>
                    <span className="validated">
                      <Check size={14} /> {tr("Plan checked")}
                    </span>
                  </div>
                  <PracticeHints
                    initialHands={guidanceHands}
                    atStart={startBar === 0}
                    firstNotes={run.initialHands.map((h) =>
                      engine.notes.find((n) => n.hand === h.hand)!,
                    )}
                    positions={planPositions}
                    movements={reveal ? manualMovements : upcomingMovements}
                    settings={notationSettings}
                    revealed={settings.mode !== "benchmark" && reveal}
                  />
                  <div className="measure-labels">
                    <span>
                      {tr("Bar")} {(target?.bar ?? 0) + 1}
                    </span>
                    <span>
                      {tr(
                        settings.mode === "timed"
                          ? "Keep the pulse"
                          : "Take your time. Read ahead.",
                      )}
                    </span>
                  </div>
                  <Notation
                    events={events}
                    hands={hands}
                    positions={planPositions}
                    settings={notationSettings}
                    startBar={startBar}
                    currentId={target?.id}
                    reveal={settings.mode !== "benchmark" && reveal}
                    movements={allMovements}
                    hintEvents={hintEvents}
                    hintMemory={run.phrases[0].initial.hints}
                  />
                  <div className="score-foot">
                    <span>
                      <span
                        className={`pulse-dot ${engine.running ? "live" : ""}`}
                      />
                      {tr(
                        engine.running
                          ? now < engine.origin
                            ? `Count in: ${Math.ceil((engine.origin - now) / (60000 / settings.bpm))}`
                            : "Listening to your playing"
                          : "Ready · place your hand, then start",
                      )}
                    </span>
                    <span>
                      {shownBars} {tr("bars in view · endless music")}
                    </span>
                  </div>
                  <div className="transport">
                    <button className="primary" onClick={toggle}>
                      {engine.running ? (
                        <Pause size={18} />
                      ) : (
                        <Play size={18} />
                      )}{" "}
                      {tr(
                        engine.running
                          ? t.pause
                          : pending
                            ? "Apply & play"
                            : t.start,
                      )}
                    </button>
                    <button
                      title={tr("Restart this seed")}
                      aria-label={tr("Restart")}
                      onClick={() => void change(settings, run.seed)}
                    >
                      <RotateCcw size={18} />
                    </button>
                    <button
                      title={tr("Skip current target")}
                      aria-label={tr("Skip")}
                      onClick={() => {
                        if (engine.running && now >= engine.origin) {
                          engine.skip(now);
                          setFeedback("Target skipped. Continue reading.");
                          render((x) => x + 1);
                        }
                      }}
                      disabled={!engine.running || now < engine.origin}
                    >
                      <SkipForward size={18} />
                      <span>{tr("Skip")}</span>
                    </button>
                    {settings.mode !== "benchmark" && (
                      <button
                        aria-label={tr(reveal ? "Hide hint" : "Reveal hint")}
                        onClick={() => {
                          if (!reveal) {
                            run.assistanceUsed = true;
                            void persist(run);
                          }
                          setReveal((x) => !x);
                        }}
                      >
                        <Lightbulb size={18} />
                        <span>{tr(reveal ? "Hide hint" : "Reveal hint")}</span>
                      </button>
                    )}
                    <button
                      className="next"
                      onClick={() =>
                        void change(
                          pending ? draft : settings,
                          createLocalId("exercise"),
                        )
                      }
                    >
                      {tr(t.next)}
                      <ArrowRight size={16} />
                    </button>
                    <button
                      className="finish"
                      title={tr("Save & finish")}
                      onClick={() => {
                        engine.pause(performance.now());
                        void persist(run);
                        setTab("progress");
                      }}
                    >
                      {tr(t.save)}
                      <Check size={16} />
                    </button>
                  </div>
                </div>
                <div
                  className="feedback"
                  role="status"
                  data-testid="target"
                  data-pitches={engine.required.map((n) => n.midi).join(",")}
                  data-bar={target?.bar ?? 0}
                >
                  <Activity size={17} />
                  <span
                    className={
                      feedback.startsWith("Try again")
                        ? "feedback-error"
                        : undefined
                    }
                  >
                    {tr(feedback)}
                  </span>
                </div>
                <div className="stats">
                  {settings.chords !== "off" && (
                    <Stat
                      label={tr("Chord-event accuracy")}
                      value={
                        m.chordEvents ? `${Math.round(m.chordAccuracy)}%` : "—"
                      }
                      detail={tr(
                        `${m.chordCorrect} / ${m.chordEvents} first-attempt simultaneous chords`,
                      )}
                    />
                  )}
                  <Stat
                    label={tr("Correct notes")}
                    value={String(m.correct)}
                    detail={tr("Matched pitches")}
                  />
                  <Stat
                    label={tr("First-attempt accuracy")}
                    value={
                      engine.results.length ? `${Math.round(m.accuracy)}%` : "—"
                    }
                    detail={tr(
                      `${m.wrong} wrong · ${m.missed} missed · ${m.skipped} skipped`,
                    )}
                  />
                  <Stat
                    label={tr(
                      settings.mode === "timed"
                        ? "Correct notes / min"
                        : "Wait-mode notes / min",
                    )}
                    value={engine.results.length ? m.npm.toFixed(1) : "—"}
                    detail={tr("Active practice time only")}
                  />
                  {settings.mode === "timed" && (
                    <Stat
                      label={tr("Timing within window")}
                      value={m.correct ? `${Math.round(m.timing)}%` : "—"}
                      detail={tr(
                        `±${settings.tolerance} ms · separate from pitch`,
                      )}
                    />
                  )}
                </div>
                <details className="piano-card">
                  <summary>
                    <span>
                      <Keyboard size={18} />
                      {tr("Virtual piano")}
                    </span>
                    <span className="tag">
                      {tr("SIMULATOR · OPEN KEYBOARD")}
                    </span>
                  </summary>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={sim}
                      onChange={(e) => {
                        engine.pause(performance.now());
                        void persist(run);
                        setSim(e.target.checked);
                      }}
                    />
                    {tr("Enable")}
                  </label>
                  <p>
                    {tr(
                      "Try without a piano. Use the keys below or your computer keyboard: A W S E D F T G Y H U J…",
                    )}
                  </p>
                  <div className={`piano ${!sim ? "disabled" : ""}`}>
                    {pianoPitches.map((p) => {
                      const black = [1, 3, 6, 8, 10].includes(p % 12);
                      return (
                        <button
                          key={p}
                          className={`${black ? "black" : "white"} ${engine.held.has(p) ? "pressed" : ""}`}
                          disabled={!sim}
                          aria-label={tr(`Play ${Note.fromMidi(p)}`)}
                          data-midi={p}
                          onPointerDown={(e) => {
                            e.currentTarget.setPointerCapture(e.pointerId);
                            bus.virtual(p, "on");
                          }}
                          onPointerUp={() => bus.virtual(p, "off")}
                          onPointerCancel={() => bus.virtual(p, "off")}
                          onLostPointerCapture={() => bus.virtual(p, "off")}
                        >
                          <span>
                            {tr(p % 12 === 0 ? Note.fromMidi(p) : "")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </details>
                <p className="honesty">
                  <Hand size={14} />{" "}
                  {tr(
                    "Fingering is suggested. MIDI checks pitch and timing, never which finger you use.",
                  )}
                </p>
              </section>
              <PracticeSettings
                draft={draft}
                seed={seed}
                pending={pending}
                onChange={setDraft}
                onSeed={setSeed}
                onHints={setHints}
                onApply={() => void apply()}
                assistanceUsed={run.assistanceUsed}
              >
                <label className="check metronome">
                  <input
                    type="checkbox"
                    checked={click}
                    onChange={(e) => {
                      setClick(e.target.checked);
                      if (e.target.checked) {
                        audio.current ??= new AudioContext();
                        void audio.current.resume();
                      }
                    }}
                  />
                  <Volume2 size={16} />
                  {tr("Metronome click (immediate)")}
                </label>
                <div className="connection">
                  <p>{tr(status)}</p>
                  <button onClick={() => void connect()}>
                    <Plug size={16} />
                    {tr("Retry MIDI connection")}
                  </button>
                  <label>
                    {tr("MIDI channel")}
                    <select
                      value={channel}
                      onChange={(e) => setChannel(+e.target.value)}
                    >
                      <option value="0">{tr("All channels")}</option>
                      {Array.from({ length: 16 }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    {tr("Input activity:")}{" "}
                    {tr(
                      diagnostic
                        ? diagnostic.source +
                            " · " +
                            diagnostic.type +
                            (diagnostic.type === "sustain"
                              ? " · CC "
                              : " · note ") +
                            diagnostic.pitch +
                            " · velocity " +
                            diagnostic.velocity
                        : "No input yet",
                    )}
                  </p>
                </div>
              </PracticeSettings>
            </div>
          </Tabs.Content>
          <Tabs.Content value="progress" className="page">
            <div className="eyebrow">{tr("SMALL STEPS, REAL PROGRESS")}</div>
            <h1>{tr("Your reading, over time.")}</h1>
            <p>
              {tr(
                "Recorded performances only. First-attempt pitch accuracy includes misses and skips.",
              )}
            </p>
            <div className="panel">
              <div className="section-line">
                <h2>{tr("Comparable practice")}</h2>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={compareAll}
                    onChange={(e) => setCompareAll(e.target.checked)}
                  />
                  {tr("Show all difficulties (not comparable)")}
                </label>
              </div>
              <p>
                {tr(
                  compareAll
                    ? "Mixed settings; this chart is not an improvement comparison."
                    : "Showing only the current mode and exact settings, including assistance and tempo.",
                )}
              </p>
              {chart.length ? (
                <div className="chart">
                  <ResponsiveContainer width="100%" height={270}>
                    <LineChart data={chart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="session" />
                      <YAxis yAxisId="accuracy" domain={[0, 100]} />
                      <YAxis yAxisId="rate" orientation="right" />
                      <Tooltip />
                      <Legend />
                      <Line
                        yAxisId="accuracy"
                        type="monotone"
                        dataKey="accuracy"
                        name={tr("First-attempt accuracy %")}
                        stroke="#43836e"
                        strokeWidth={2}
                      />
                      <Line
                        yAxisId="rate"
                        type="monotone"
                        dataKey="npm"
                        name={tr("Correct notes/min")}
                        stroke="#b78945"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty">
                  <BarChart3 size={35} />
                  <h3>{tr("Your first session starts the story.")}</h3>
                  <p>
                    {tr(
                      "Play a few notes, then pause or finish to save. Different settings begin a separate series.",
                    )}
                  </p>
                  <button
                    className="primary"
                    onClick={() => setTab("practice")}
                  >
                    {tr("Go to practice")}
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </div>
            <div className="panel">
              <div className="section-line">
                <h2>{tr("Session history")}</h2>
                <div className="inline-actions">
                  <button
                    onClick={() =>
                      download(
                        "clefglide-progress.json",
                        JSON.stringify(
                          { format: "sightflow-1", sessions },
                          null,
                          2,
                        ),
                      )
                    }
                  >
                    <Download size={16} />
                    {tr("JSON")}
                  </button>
                  <button
                    onClick={() =>
                      download(
                        "clefglide-progress.csv",
                        csv(sessions),
                        "text/csv",
                      )
                    }
                  >
                    <Download size={16} />
                    {tr("CSV")}
                  </button>
                </div>
              </div>
              <div className="history">
                {filtered.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    replay={() => {
                      void change(settingsSchema.parse(s.settings), s.seed);
                      setTab("practice");
                    }}
                    remove={() => void db.sessions.delete(s.id)}
                  />
                ))}
              </div>
              <label className="import-label">
                {tr("Import a ClefGlide JSON backup")}
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={async (e) => {
                    try {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 20_000_000)
                          throw new Error("Backup is too large (20 MB limit).");
                        const n = await importSessions(await file.text());
                        setFeedback(`Imported ${n} sessions.`);
                      }
                    } catch (err) {
                      setError(`Import rejected: ${String(err)}`);
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              <p role="status">
                {tr(feedback.startsWith("Imported") ? feedback : "")}
              </p>
            </div>
          </Tabs.Content>
          <Tabs.Content value="help" className="page help">
            <SettingsHelp
              dark={dark}
              onToggleTheme={() => setDark(!dark)}
              language={lang}
              onLanguage={chooseLanguage}
              onConnect={() => void connect()}
              inputs={inputs}
              device={device}
              onSelectDevice={selectDevice}
              status={status}
              diagnostic={diagnostic}
              onPractice={() => setTab("practice")}
              onSimulator={() => {
                setSim(true);
                setTab("practice");
              }}
            />
          </Tabs.Content>
          <footer>
            {tr("ClefGlide")}
            <span>{tr("Read ahead. Play naturally.")}</span>
            <SourceLinks />
            <span>
              {tr("Local-first · Generator v")}
              {tr(VERSION)}
              {" · "}
              {tr("Private, non-commercial project for personal use.")}
            </span>
          </footer>
        </main>
      </Tabs.Root>
    </LanguageContext.Provider>
  );
}
function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  const tr = useTranslation();
  return (
    <div className="stat">
      <span>{tr(label)}</span>
      <strong>{tr(value)}</strong>
      <small>{tr(detail)}</small>
    </div>
  );
}
function SessionRow({
  session: s,
  replay,
  remove,
}: {
  session: Session;
  replay: () => void;
  remove: () => void;
}) {
  const tr = useTranslation();
  const m = metrics(s.results, s.ms, s.settings.tolerance);
  return (
    <details className="session">
      <summary>
        <span>
          {tr(new Date(s.date).toLocaleString())}
          <small>
            {tr(s.settings.hand)} · {s.settings.key} {tr("major ·")}
            {tr(s.settings.mode)}
          </small>
        </span>
        <strong>
          {m.correct} {tr("notes")}
        </strong>
        <span>
          {Math.round(m.accuracy)}
          {tr("% first attempt")}
        </span>
      </summary>
      <p>
        {tr((s.ms / 60000).toFixed(1))} {tr("active minutes ·")}
        {tr(m.npm.toFixed(1))} {tr("correct/min ·")}
        {m.wrong} {tr("wrong ·")}
        {m.missed} {tr("missed ·")}
        {m.skipped} {tr("skipped")}
        {tr(
          s.settings.mode === "timed"
            ? ` · ${Math.round(m.timing)}% on time`
            : "",
        )}
      </p>
      <p>
        {tr("Seed:")}
        {s.seed} · {s.settings.bpm} {tr("BPM · hints:")}{" "}
        {tr(s.settings.mode === "benchmark" ? "hidden" : s.settings.hints)}
      </p>
      {m.chordEvents > 0 && (
        <p>
          {m.chordCorrect} / {m.chordEvents}{" "}
          {tr("simultaneous first-attempt chords ·")}{" "}
          {Math.round(m.chordAccuracy)}
          {tr("% chord-event accuracy")}
        </p>
      )}
      {s.generatorVersion === VERSION ? (
        <button onClick={replay}>{tr("Replay seed")}</button>
      ) : (
        <p>
          {tr("Legacy generator")}
          {tr(s.generatorVersion)}
          {tr(
            ": history retained; exact replay requires that generator version.",
          )}
        </p>
      )}
      <p>
        {tr(
          "noteJumps" in s.settings
            ? difficultySummary(s.settings)
            : "Legacy difficulty",
        )}{" "}
        ·{" "}
        {tr(
          s.generatorVersion === VERSION
            ? s.assistanceUsed
              ? "Assisted practice"
              : "No hints used"
            : "Legacy assistance not tracked",
        )}
      </p>
      <button onClick={remove}>{tr("Delete session")}</button>
    </details>
  );
}
