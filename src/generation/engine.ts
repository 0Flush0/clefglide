import { Note } from "tonal";
import {
  TPQ,
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
  generatorConfigVersion,
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
import type { MovementDiagnostic } from "./model";
import { inspectGeneratorFeasibility } from "./feasibility";
import { nextLeapPreparation } from "./wideLeaps";
import { attachNoteLifetimes } from "../score/lifetimes";
import { planTies, validateTieCarry, carryHeadId } from "./ties";
import { generateIndependent } from "./independentVoices";
export function generateConfigured(
  c: ValidatedGeneratorConfig,
  seed: string,
  previous?: StreamState,
  // Internal legacy stream identity override; parameter-driven callers omit this.
  contextKey = generatorConfigFingerprint(c),
): GeneratedPhrase {
  if (c.independentVoices) return generateIndependent(c, seed, previous);
  if (previous?.independentVoices)
    throw new Error("Start a new stream to change the voice model.");
  if (previous) validateTieCarry(c, previous, seed);
  if (previous?.activeLifetimes?.length && c.notation.ties === false)
    throw new Error(
      "Shared-rhythm generation cannot consume held carry-in voices; author them with the core lifetime model.",
    );
  if (
    c.notation.ties !== false ||
    (c.wideLeaps.kind !== "disabled" && c.wideLeaps.probability > 0)
  ) {
    const { errors } = inspectGeneratorFeasibility(c);
    if (errors.length) throw new Error(errors.join(" "));
    if (
      previous?.wideLeapPreparation &&
      previous.wideLeapPreparation.configFingerprint !==
        generatorConfigFingerprint(c)
    )
      throw new Error(
        "Wide-leap continuation requires the same configuration.",
      );
  }
  const movement = c.movement;
  const state: StreamState = previous
    ? structuredClone(previous)
    : { rng: hash(seed), bar: 0, hands: [], hints: {} };
  if (!previous) state.hands = initialHands(c, state);
  if (c.noteLifetimes.kind === "explicit") state.activeLifetimes ??= [];
  const initial = structuredClone(state),
    events: ScoreEvent[] = [],
    positions = structuredClone(state.hands),
    movements: MovementPlan[] = [];
  const diagnostics: MovementDiagnostic[] = [];
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
      new Map(
        [...available].map(([hand, options]) => {
          const preparation =
            Math.max(
              movement.kind === "rested-reposition" && movement.probability > 0
                ? movement.preparationBeats
                : 0,
              c.wideLeaps.kind === "lifted-wide" && c.wideLeaps.probability > 0
                ? c.wideLeaps.preparationBeats
                : 0,
            ) * TPQ;
          const cue = bar * c.notation.beats * TPQ - preparation;
          const occupied = (initial.activeLifetimes ?? []).some(
            (n) =>
              n.hand === hand &&
              n.lifetime.keyHold.kind === "required" &&
              n.lifetime.keyHold.releaseTick > cue,
          );
          return [hand, occupied ? [] : options];
        }),
      ),
      b,
      positions,
      movements,
      diagnostics,
    );
    const { durations, noteCount } = barRhythm(c, b, state);
    let soundedCount = noteCount;
    const barStart = bar * c.notation.beats * TPQ;
    const heldUntil = Math.max(
      0,
      ...(initial.pendingTies ?? []).map((p) => p.head.lifetime!.releaseTick),
    );
    if (barStart < heldUntil) {
      const unit = Math.min(...c.rhythm.durations.map((d) => d.value));
      let offset = barStart;
      for (let d = 0; d < soundedCount; d++) {
        const length = durations[d];
        if (offset < heldUntil) {
          // Tile the whole touched slot, including any tail after the release.
          const parts = Array.from({ length: length / unit }, () => unit);
          durations.splice(d, 1, ...parts);
          soundedCount += parts.length - 1;
          d += parts.length - 1;
        }
        offset += length;
      }
    }
    let onset = 0;
    for (let j = 0; j < durations.length; j++) {
      const rest = j >= soundedCount;
      for (const h of state.hands) {
        const previousFingering = h.lastFingering ?? [];
        const carries = (initial.pendingTies ?? []).filter(
          (p) =>
            p.head.hand === h.hand &&
            p.head.lifetime!.releaseTick > barStart + onset,
        );
        const carry = carries[0];
        const finalAttack =
          b === c.notation.phraseBars - 1 && j === soundedCount - 1;
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
        const index = carry
          ? h.hand === "right"
            ? carry.head.finger - 1
            : 5 - carry.head.finger
          : h.resolutionPitch && !(j === 0 && landings.has(h.hand))
            ? h.pitches.indexOf(h.resolutionPitch)
            : j === 0 && landings.has(h.hand)
              ? landings.get(h.hand)!
              : chooseWeighted(weighted, state);
        if (index === undefined || index < 0)
          throw new Error(
            "No playable melodic transition. Widen the range or maximum melodic interval.",
          );
        const { pitch, finger, resolving } = carry
          ? {
              pitch: carry.head.pitch,
              finger: carry.head.finger,
              resolving: false,
            }
          : planChromatic(
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
          (!carry ||
            (carries.length === 1 &&
              c.notation.ties !== false &&
              c.notation.ties.chordTones !== "all" &&
              c.notation.ties.chordTones !== "none")) &&
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
            carries.map((p) => p.head),
          );
          const playable = candidates.filter(
            (heads) =>
              playableTransition(previousFingering, heads) &&
              carries.every((p) =>
                heads.some(
                  (n) =>
                    n.midi === p.head.midi &&
                    n.pitch === p.head.pitch &&
                    n.finger === p.head.finger,
                ),
              ) &&
              (!carry ||
                c.notation.ties === false ||
                c.notation.ties.chordTones !== "outer" ||
                carry.head.midi === Math.min(...heads.map((n) => n.midi)) ||
                carry.head.midi === Math.max(...heads.map((n) => n.midi))),
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
        if (carry) {
          if (rest)
            throw new Error("A committed tie overlaps a shared-voice rest.");
          if (carries.length > 1)
            event.notes = carries.map((p) => ({
              ...structuredClone(p.head),
              id: "",
            }));
          event.notes!.forEach((n, k) => {
            const held = carries.find((p) => p.head.finger === n.finger);
            n.id = held
              ? carryHeadId(id, n.finger, held === carry)
              : k
                ? `${id}:${k}`
                : id;
            delete n.tie;
            delete n.lifetime;
          });
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
  attachNoteLifetimes(events, c);
  if (c.noteLifetimes.kind === "explicit") state.activeLifetimes = [];
  planTies(events, c, initial, state, seed);
  const preparation = nextLeapPreparation(c, state.bar);
  if (preparation) state.wideLeapPreparation = preparation;
  else delete state.wideLeapPreparation;
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
    version: generatorConfigVersion(c),
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
    ...(c.wideLeaps.kind !== "disabled"
      ? { movementDiagnostics: diagnostics }
      : {}),
  };
  const errors = validateGeneratedPhrase(p);
  if (errors.length) throw new Error(errors.join(" "));
  return p;
}
