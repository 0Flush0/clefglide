import { defaults, type Phrase, type Settings } from "./model";
import { generate } from "../generation/planner";
import { applyHandMovements } from "../practice/presets";
import { inferFingeringHints } from "./hints";
/** Deliberate validator fixture; the normal planner never requests alternatives. */
export function restedAlternatePhrase(): Phrase {
  const s = {
    ...applyHandMovements({ ...defaults, rhythm: "quarters" }, "medium"),
    shiftFrequency: 0,
    maxShift: 0,
  };
  const p = generate(s, "rested-alternate"),
    base = p.events[0];
  base.notes = undefined;
  p.events.splice(
    0,
    4,
    {
      ...base,
      id: "c-thumb",
      midi: 60,
      pitch: "C4",
      finger: 1,
      onset: 0,
      duration: 480,
    },
    {
      ...base,
      id: "prepare",
      kind: "rest",
      onset: 480,
      duration: 480,
      action: "REST",
    },
    {
      ...base,
      id: "e-index",
      midi: 64,
      pitch: "E4",
      finger: 2,
      onset: 960,
      duration: 480,
      fingering: { technique: "rested-alternate", expectedFinger: 3 },
    },
    {
      ...base,
      id: "g-fifth",
      midi: 67,
      pitch: "G4",
      finger: 5,
      onset: 1440,
      duration: 480,
    },
  );
  let previous: string | undefined;
  for (const note of p.events) {
    note.action =
      note.kind === "rest"
        ? "REST"
        : note.pitch === previous
          ? "REPEAT_NOTE"
          : "PLAY_WITHIN_POSITION";
    if (note.kind === "note") previous = note.pitch;
  }
  return p;
}
/** A generated, approved position; replace only the melody to exercise every
 * mapped finger in order. No finger is retrofitted onto an arbitrary pitch. */
export function spacedPhrase(
  hand: Settings["hand"] = "right",
  pattern = "thumbGap",
): Phrase {
  const settings: Settings = {
    ...defaults,
    hand,
    max: pattern === "thumbGap" ? 69 : 84,
    leftMax: 57,
    fingerSpacing: pattern === "thumbGap" ? "easy" : "hard",
    rhythm: "quarters",
    noteJumps: "large",
    interval: 7,
  };
  let p: Phrase | undefined;
  for (let seed = 0; seed < 100; seed++) {
    const candidate = generate(settings, `spacing-${seed}`);
    if (candidate.initial.hands.every((h) => h.id.endsWith(`-${pattern}`))) {
      p = candidate;
      break;
    }
  }
  if (!p)
    throw new Error("Expected the spacing library to generate thumb gaps.");
  for (const h of p.initial.hands) {
    let previous: string | undefined;
    const notes = p.events.filter(
      (e) => e.hand === h.hand && e.kind === "note",
    );
    notes.forEach((e, i) => {
      const finger = (i % 5) + 1;
      e.midi = h.fingerToMidi[finger - 1];
      e.pitch = h.pitches[h.hand === "right" ? finger - 1 : 5 - finger];
      e.finger = finger;
      e.notes = undefined;
      e.action = e.pitch === previous ? "REPEAT_NOTE" : "PLAY_WITHIN_POSITION";
      previous = e.pitch;
    });
    const last = notes.at(-1)!;
    Object.assign(
      p.final.hands.find((f) => f.hand === h.hand)!,
      {
        lastPitch: last.pitch,
        lastIndex: h.pitches.indexOf(last.pitch),
        lastNoteEnd:
          last.bar * settings.beats * 480 + last.onset + last.duration,
        lastVoicing: undefined,
      },
    );
  }
  p.final.hints = inferFingeringHints(
    p.events,
    p.positions,
    p.movements,
    "smart",
    false,
    p.initial.hints,
  ).state;
  return p;
}
