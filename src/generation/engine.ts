import { Note } from "tonal";
import {
  TPQ,
  VERSION,
  noteheads,
  type StreamState,
  type ScoreEvent,
  type MovementPlan,
} from "../score/model";
import { hash, random } from "./random";
import {
  positionsForConfig,
  spacingSignature,
  positionCenter,
} from "./positionMaps";
import { validateGeneratedPhrase } from "./phraseValidator";
import {
  generatorConfigFingerprint,
  type ValidatedGeneratorConfig,
} from "./config";
import type { GeneratedPhrase } from "./model";
import { initialHands } from "./initialHands";
import { chooseWeighted } from "./sampling";
import { barRhythm } from "./rhythm";
import { melodicChoices, melodicWeights } from "./melody";
import { planMovements } from "./movement";
import { planChromatic } from "./chromatic";
import { planPhrase } from "./harmony";
import { inferFingeringHints } from "../score/hints";
import { writtenPitch } from "../score/pitch";
import { chordCandidatesForConfig } from "./voicings";
import { playableTransition } from "./ergonomics";
import { planRangeCoverage, recordRangeCoverage } from "./rangeCoverage";
export function generateConfigured(
  c: ValidatedGeneratorConfig,
  seed: string,
  previous?: StreamState,
  // Internal legacy stream identity override; parameter-driven callers omit this.
  contextKey = generatorConfigFingerprint(c),
): GeneratedPhrase {
  const movement = c.movement;
  const state: StreamState = previous
    ? structuredClone(previous)
    : { rng: hash(seed), bar: 0, hands: [], hints: {} };
  if (!previous) state.hands = initialHands(c, state);
  const initial = structuredClone(state),
    events: ScoreEvent[] = [],
    positions = structuredClone(state.hands),
    movements: MovementPlan[] = [];
  const available = new Map(
    state.hands.map((h) => [h.hand, positionsForConfig(c, h.hand)]),
  );
  const usePreparation =
    movement.kind === "rested-reposition" && movement.probability > 0;
  const useCoverage = usePreparation && c.coverage.kind === "guided";
  if (!useCoverage) delete state.coverage;
  else state.coverage ??= {};
  for (const h of useCoverage ? state.hands : []) {
    state.coverage![h.hand] = planRangeCoverage(
      state.coverage![h.hand],
      {
        min: c.hands[h.hand].min,
        max: c.hands[h.hand].max,
        context: contextKey,
        position: positionCenter(h),
        destinations: available
          .get(h.hand)!
          .filter((to) => spacingSignature(to) === spacingSignature(h))
          .map(positionCenter),
      },
      state,
      c.coverage.kind === "guided" ? c.coverage : undefined,
    );
  }
  const { harmony, motif, shapes, chords } = planPhrase(c, state);
  for (let b = 0; b < c.notation.phraseBars; b++) {
    const bar = state.bar + b;
    const landings = planMovements(
      c,
      seed,
      state,
      available,
      b,
      positions,
      movements,
    );
    const { durations, breath } = barRhythm(c, b, state);
    let onset = 0;
    for (let j = 0; j < durations.length; j++) {
      const rest = breath && j === durations.length - 1;
      for (const h of state.hands) {
        const previousFingering = h.lastFingering ?? [];
        const finalAttack =
          b === c.notation.phraseBars - 1 &&
          j === durations.length - (breath ? 2 : 1);
        const choices = melodicChoices(c, h, chords[b], finalAttack);
        const goal = Math.max(
          0,
          Math.min(
            4,
            shapes.get(h.hand)![b] +
              motif[j % motif.length] +
              c.melody.motifOffset,
          ),
        );
        const weighted = melodicWeights(
          c,
          h,
          choices,
          goal,
          chords[b],
          b === c.notation.phraseBars - 1 && j === durations.length - 1,
        );
        const index =
          h.resolutionPitch && !(j === 0 && landings.has(h.hand))
            ? h.pitches.indexOf(h.resolutionPitch)
            : j === 0 && landings.has(h.hand)
              ? landings.get(h.hand)!
              : chooseWeighted(weighted, state);
        if (index === undefined || index < 0)
          throw new Error(
            "No playable melodic transition. Widen the range or maximum melodic interval.",
          );
        const { pitch, finger, resolving } = planChromatic(
          c,
          h,
          index,
          rest,
          j === 0 && landings.has(h.hand),
          chords[b],
          state,
        );
        const midi = Note.midi(pitch)!;
        const id = `${seed}-${bar}-${onset}-${h.hand}`;
        const event: ScoreEvent = {
          id,
          kind: rest ? "rest" : "note",
          bar,
          onset,
          duration: durations[j],
          hand: h.hand,
          positionId: h.id,
          midi,
          pitch,
          finger,
          notes: rest
            ? []
            : [
                {
                  id,
                  midi,
                  pitch,
                  written: writtenPitch(pitch, c.notation.key),
                  finger,
                  hand: h.hand,
                },
              ],
          action: rest
            ? "REST"
            : midi === Note.midi(h.lastPitch ?? "")
              ? "REPEAT_NOTE"
              : "PLAY_WITHIN_POSITION",
        };
        if (
          !rest &&
          !h.resolutionPitch &&
          !resolving &&
          !(j === 0 && landings.has(h.hand)) &&
          c.chords.kind === "voicings" &&
          random(state) < c.chords.probability
        ) {
          const candidates = chordCandidatesForConfig(
            event,
            h,
            c,
            chords[b],
            h.lastVoicing,
          );
          const playable = candidates.filter((heads) =>
            playableTransition(previousFingering, heads),
          );
          if (playable.length)
            event.notes = chooseWeighted(
              playable.map((heads) => ({
                value: heads,
                weight:
                  c.chords.kind === "voicings"
                    ? c.chords.shapes.find(
                        (shape) =>
                          shape.value ===
                          [...heads]
                            .sort((a, b) => a.finger - b.finger)
                            .map((n) => n.finger)
                            .join(""),
                      )!.weight
                    : 1,
              })),
              state,
            );
        }
        events.push(event);
        if (!rest) {
          h.lastIndex = h.hand === "right" ? finger - 1 : 5 - finger;
          h.lastPitch = pitch;
          h.lastVoicing = event.notes!.map((n) => n.midi);
          h.lastFingering = event.notes!.map(({ midi, finger }) => ({
            midi,
            finger,
          }));
          h.lastNoteEnd = bar * c.notation.beats * TPQ + onset + durations[j];
        }
      }
      onset += durations[j];
    }
  }
  state.bar += c.notation.phraseBars;
  for (const h of useCoverage ? state.hands : [])
    recordRangeCoverage(
      state.coverage![h.hand]!,
      events
        .filter((e) => e.hand === h.hand)
        .flatMap(noteheads)
        .map((n) => n.midi),
      c.coverage.kind === "guided" ? c.coverage : undefined,
    );
  state.hints = inferFingeringHints(
    events,
    positions,
    movements,
    "smart",
    false,
    initial.hints,
  ).state;
  const p: GeneratedPhrase = {
    seed,
    version: VERSION,
    config: c,
    configFingerprint: generatorConfigFingerprint(c),
    events,
    initial,
    final: state,
    positions,
    movements,
    harmonies: harmony.map(
      (degree, i) => `${degree}: ${chords[i].join(" · ")}`,
    ),
  };
  const errors = validateGeneratedPhrase(p);
  if (errors.length) throw new Error(errors.join(" "));
  return p;
}
