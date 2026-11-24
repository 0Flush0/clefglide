import { Note } from "tonal";
import {
  noteheads,
  type DynamicAttack,
  type HandState,
  type ContinuousMovementPlan,
  type Notehead,
  type Phrase,
  type ScoreEvent,
  type StreamState,
} from "../score/model";
import { writtenPitch } from "../score/pitch";
import type { ValidatedGeneratorConfig } from "./config";
import { playableTransition } from "./ergonomics";
import {
  continuousTransfer,
  permitsAlternateContact,
  permitsContinuousContact,
} from "./fingeringGeometry";
import {
  alternateWindow,
  continuousWindow,
  eventTick,
  fingeringSpans,
  mainVoice,
  nextRun,
  runAllowed,
  sourceAt,
  voiceOf,
} from "./fingeringTimeline";
import { melodicWeights } from "./melody";
import { diatonicIndex } from "./positionMaps";
import { random } from "./random";
import { chooseWeighted } from "./sampling";

type Plan = Pick<Phrase, "initial" | "events" | "positions" | "movements">;
type Attack = {
  head: Notehead;
  position: HandState;
  movement?: ContinuousMovementPlan;
};

/** Enumerate joint pitch/finger/position candidates before choosing the attack. */
export function chooseDynamicAttack(
  c: ValidatedGeneratorConfig,
  state: StreamState,
  plan: Plan,
  e: Pick<ScoreEvent, "id" | "bar" | "onset" | "hand" | "voiceId">,
  from: HandState,
  available: HandState[],
  goal: number,
  harmony: readonly string[],
  last: boolean,
  safe: (head: Notehead, position: HandState) => boolean,
  maxInterval = c.melody.maxIntervalSteps,
  pendingResolution = from.resolutionPitch,
): Attack | undefined {
  const policy = c.dynamicFingering;
  const attackPolicy = policy?.attacks;
  if (
    !policy ||
    !attackPolicy ||
    voiceOf(e) !== mainVoice(e.hand) ||
    pendingResolution
  )
    return;
  const tick = eventTick(e, c);
  const spans = fingeringSpans(plan, c);
  if (spans.some((s) => s.hand === e.hand && s.start <= tick && s.end > tick))
    return;
  const source = sourceAt(spans, e.hand, tick);
  const previous = from.lastFingering ?? [];
  const eligible = (
    position: HandState,
    pitch: string,
    finger: number,
    fingering?: Notehead["fingering"],
  ) => {
    if (
      from.lastPitch &&
      Math.abs(diatonicIndex(from.lastPitch) - diatonicIndex(pitch)) >
        maxInterval
    )
      return undefined;
    const head = {
      id: e.id,
      pitch,
      finger,
      hand: e.hand,
      midi: Note.midi(pitch)!,
      written: writtenPitch(pitch, c.notation.key),
      ...(fingering ? { fingering } : {}),
    };
    return safe(head, position) ? head : undefined;
  };
  const candidates: { value: Attack; weight: number }[] = [];
  for (const rule of policy.techniques) {
    if (rule.technique === "substitution") continue;
    if (
      !runAllowed(
        policy,
        nextRun(state.dynamicFingering!.runs[e.hand], rule.technique),
      )
    )
      continue;
    if (random(state) >= rule.probability) continue;
    const choices: typeof candidates = [];
    const add = (value: Attack, distance: number) => {
      const { head, position } = value;
      const index = position.pitches.indexOf(head.pitch);
      const [{ weight }] = melodicWeights(
        c,
        { ...position, lastPitch: from.lastPitch },
        [index],
        goal,
        harmony,
        last,
      );
      choices.push({
        value,
        weight:
          (weight * policy.fingerWeights[head.finger - 1]) /
          (1 + attackPolicy.distanceCost * distance),
      });
    };
    if ("maxPositionSteps" in rule) {
      if (!source || source.end !== tick) continue;
      for (const to of available) {
        const distance =
          diatonicIndex(to.pitches[0]) - diatonicIndex(from.pitches[0]);
        if (!distance || Math.abs(distance) > rule.maxPositionSteps) continue;
        for (const [sourceFinger, finger] of rule.fingerPairs) {
          if (source.finger !== sourceFinger) continue;
          const pitch =
            to.pitches[e.hand === "right" ? finger - 1 : 5 - finger];
          const head = eligible(to, pitch, finger);
          if (
            !head ||
            !permitsContinuousContact(rule, from, to, source, head) ||
            !continuousWindow(plan, spans, c, rule, from, to, source, tick)
          )
            continue;
          add(
            {
              head,
              position: to,
              movement: {
                id: `${e.id}:continuous`,
                technique: rule.technique,
                hand: e.hand,
                fromPositionId: from.id,
                toPositionId: to.id,
                cueTick: source.start,
                landingTick: tick,
                landingNoteId: e.id,
                transferStartTick:
                  tick - continuousTransfer(rule, policy.tempoBpm),
                landingMidi: head.midi,
                landingFinger: head.finger,
                distance,
                source: {
                  eventId: source.eventId,
                  midi: source.midi,
                  finger: source.finger,
                },
              },
            },
            Math.abs(distance),
          );
        }
      }
    } else {
      for (const [expectedFinger, finger] of rule.fingerPairs) {
        const midi = from.fingerToMidi[expectedFinger - 1];
        const pitch = from.pitches.find((p) => Note.midi(p) === midi)!;
        const head = eligible(from, pitch, finger, {
          technique: rule.technique,
          expectedFinger,
        });
        if (
          !head ||
          !playableTransition(previous, [head]) ||
          !permitsAlternateContact(rule, from, midi, expectedFinger, finger) ||
          !alternateWindow(plan, spans, c, rule, e.hand, tick, head)
        )
          continue;
        add(
          { head, position: from },
          Math.abs(midi - from.fingerToMidi[finger - 1]),
        );
      }
    }
    const harmonic =
      last && c.melody.preferHarmonicEnding
        ? choices.filter(({ value }) =>
            harmony.includes(Note.pitchClass(value.head.pitch)),
          )
        : choices;
    candidates.push(
      ...harmonic.map(({ value, weight }) => ({
        value,
        weight: rule.weight * weight,
      })),
    );
  }
  return candidates.length ? chooseWeighted(candidates, state) : undefined;
}

export function applyDynamicAttack(
  plan: Plan,
  e: ScoreEvent,
  from: HandState,
  attack: Attack,
) {
  const { head, position, movement } = attack;
  if (movement) {
    plan.movements.push(movement);
    if (!plan.positions.some((p) => p.id === position.id))
      plan.positions.push(structuredClone(position));
    Object.assign(from, position);
  }
  Object.assign(e, {
    kind: "note",
    positionId: position.id,
    midi: head.midi,
    pitch: head.pitch,
    finger: head.finger,
    notes: [head],
    ...(head.fingering ? { fingering: head.fingering } : {}),
  });
}

export function recordFingeringAttack(
  state: StreamState,
  e: ScoreEvent,
  technique?: DynamicAttack,
) {
  if (
    !state.dynamicFingering ||
    voiceOf(e) !== mainVoice(e.hand) ||
    !noteheads(e).length
  )
    return;
  const runs = state.dynamicFingering.runs;
  if (technique) runs[e.hand] = nextRun(runs[e.hand], technique);
  else delete runs[e.hand];
}
