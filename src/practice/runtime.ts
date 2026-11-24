import { generateConfigured, type GeneratedPhrase } from "../generation";
import { resolveSettings } from "../generation/config/presets";
import { generateLegacyReplay } from "../generation/planner";
import {
  automaticAssistance,
  type Settings,
  type StreamState,
} from "../score/model";
import { DEFAULT_CHORD_ONSET_MS, Scorer } from "../scoring/engine";
import { createLocalId } from "../shared/ids";
import {
  playbackSettings,
  practiceOptionsSchema,
  type PracticeSetup,
} from "./configuration";
import type { PracticeDuration } from "../progress/preferences";

export function legacyReplaySetup(settings: Settings): PracticeSetup {
  return {
    profile: "custom",
    config: resolveSettings(settings),
    options: practiceOptionsSchema.parse({
      ...settings,
      hints: settings.hints === "reveal" ? "smart" : settings.hints,
    }),
  };
}

const sounded = (phrase: GeneratedPhrase) =>
  phrase.events
    .filter((event) => event.kind === "note")
    .sort((a, b) => a.bar - b.bar || a.onset - b.onset);

export type Runtime = {
  setup: PracticeSetup;
  phrases: GeneratedPhrase[];
  seed: string;
  id: string;
  engine: Scorer;
  generateNext: (previous?: StreamState) => GeneratedPhrase;
  initialHands: GeneratedPhrase["initial"]["hands"];
  assistanceUsed: boolean;
  legacy?: Settings;
  replay: boolean;
  duration?: PracticeDuration;
  complete?: boolean;
};

export function createRuntime(
  setup: PracticeSetup,
  seed: string,
  replay = false,
  legacy?: Settings,
): Runtime {
  const settings = playbackSettings(setup);
  const generateNext = legacy
    ? (previous?: StreamState) =>
        generateLegacyReplay(legacy, setup.config, seed, previous)
    : (previous?: StreamState) =>
        generateConfigured(setup.config, seed, previous);
  const first = generateNext();
  const second = generateNext(first.final);
  const engine = new Scorer(
    sounded(first),
    settings,
    DEFAULT_CHORD_ONSET_MS,
    setup.config,
  );
  engine.appendNotes(sounded(second));
  return {
    setup,
    phrases: [first, second],
    seed,
    id: createLocalId("session"),
    engine,
    generateNext,
    initialHands: first.initial.hands,
    assistanceUsed: automaticAssistance(settings),
    legacy,
    replay,
  };
}

/** Keep look-ahead and the preceding score context for clipped ties, slurs and cues. */
export function extendRuntime(run: Runtime) {
  const previous = run.phrases.at(-1)!;
  const targetBar = run.engine.target?.bar ?? previous.final.bar;
  if (targetBar + run.setup.config.notation.phraseBars < previous.final.bar)
    return;
  const next = run.generateNext(previous.final);
  run.engine.appendNotes(sounded(next));
  run.phrases = [...run.phrases, next].slice(-4);
}
