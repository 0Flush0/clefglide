import {
  isContinuousMovement,
  noteheads,
  type FingeringRun,
  type Hand,
  type Phrase,
  type ScoreEvent,
} from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { configForHand, fingeringPolicies } from "./config/handParameters";
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
  finishFingering,
  mainVoice,
  nextRun,
  overlaps,
  runAllowed,
  sourceAt,
  validFingeringBoundary,
  voiceOf,
} from "./fingeringTimeline";
import { diatonicIndex } from "./positionMaps";
import { validateSubstitutions } from "./substitutions";

export function configuredAlternate(
  c: ValidatedGeneratorConfig,
  e: ScoreEvent,
) {
  return (
    e.fingering &&
    configForHand(c, e.hand).dynamicFingering?.techniques.some(
      (r) => r.technique === e.fingering?.technique,
    )
  );
}

/** Reconstruct dynamic actions from score and boundary data; never samples candidates. */
export function validateDynamicFingering(
  p: Omit<Phrase, "settings">,
  c: ValidatedGeneratorConfig,
) {
  const errors = validateSubstitutions(p, p.final, c);
  if (
    !validFingeringBoundary(c, p.seed, p.initial) ||
    !validFingeringBoundary(c, p.seed, p.final)
  )
    return [...errors, "Invalid dynamic fingering boundary state."];
  const moves = p.movements.filter(isContinuousMovement);
  if (!fingeringPolicies(c).length) {
    if (
      moves.length ||
      p.events.some(
        (e) =>
          e.fingering?.technique === "adjacent-reach" ||
          noteheads(e).some((n) => n.fingering?.technique === "adjacent-reach"),
      )
    )
      errors.push("Dynamic fingering requires the opt-in capability.");
    return errors;
  }
  const spans = fingeringSpans(p, c);
  const byId = new Map(p.events.map((e) => [e.id, e]));
  const movesAt = new Map(moves.map((m) => [m.landingNoteId, m]));
  const runs: Partial<Record<Hand, FingeringRun>> = {
    ...p.initial.dynamicFingering!.runs,
  };
  for (const move of moves) {
    const e = byId.get(move.landingNoteId);
    const source = sourceAt(spans, move.hand, move.landingTick);
    const local = configForHand(c, move.hand);
    const policy = local.dynamicFingering;
    const rule = policy?.techniques.find(
      (r) => r.technique === move.technique && "maxPositionSteps" in r,
    );
    const from = p.positions.find(
      (pos) => pos.hand === move.hand && pos.id === move.fromPositionId,
    );
    const to = p.positions.find(
      (pos) => pos.hand === move.hand && pos.id === move.toPositionId,
    );
    if (
      !rule ||
      !("maxPositionSteps" in rule) ||
      !e ||
      !from ||
      !to ||
      !source ||
      !move.source ||
      e.hand !== move.hand ||
      voiceOf(e) !== mainVoice(move.hand) ||
      eventTick(e, c) !== move.landingTick ||
      move.cueTick !== source.start ||
      move.transferStartTick !==
        move.landingTick - continuousTransfer(rule, policy!.tempoBpm) ||
      e.positionId !== to.id ||
      noteheads(e).length !== 1 ||
      noteheads(e)[0].tie ||
      e.fingering ||
      move.landingMidi !== e.midi ||
      move.landingFinger !== e.finger ||
      move.source.eventId !== source.eventId ||
      move.source.midi !== source.midi ||
      move.source.finger !== source.finger ||
      move.distance !==
        diatonicIndex(to.pitches[0]) - diatonicIndex(from.pitches[0]) ||
      spans.some(
        (s) =>
          s.hand === e.hand &&
          s.eventId !== e.id &&
          s.start === move.landingTick,
      ) ||
      !permitsContinuousContact(rule, from, to, source, e) ||
      !continuousWindow(
        p,
        spans,
        local,
        rule,
        from,
        to,
        source,
        move.landingTick,
      )
    )
      errors.push(
        "Invalid continuous fingering movement, source or clearance.",
      );
  }
  for (const e of [...p.events].sort(
    (a, b) => eventTick(a, c) - eventTick(b, c),
  )) {
    const local = configForHand(c, e.hand);
    const policy = local.dynamicFingering;
    const heads = noteheads(e);
    const primary = heads[0];
    const move = movesAt.get(e.id);
    const tag = e.fingering;
    if (tag || heads.some((n) => n.fingering)) {
      const rule = policy?.techniques.find(
        (r) => r.technique === tag?.technique,
      );
      const pos = p.positions.find(
        (pos) => pos.hand === e.hand && pos.id === e.positionId,
      );
      const start = eventTick(e, c);
      if (
        !tag ||
        !primary ||
        heads.length !== 1 ||
        primary.tie ||
        primary.fingering?.technique !== tag.technique ||
        primary.fingering.expectedFinger !== tag.expectedFinger ||
        voiceOf(e) !== mainVoice(e.hand) ||
        p.movements.some((m) => m.landingNoteId === e.id) ||
        !rule ||
        (rule.technique !== "adjacent-reach" &&
          rule.technique !== "rested-alternate") ||
        !pos ||
        !permitsAlternateContact(
          rule,
          pos,
          e.midi,
          tag.expectedFinger,
          e.finger,
        ) ||
        !alternateWindow(p, spans, local, rule, e.hand, start, e) ||
        spans.some(
          (s) =>
            s.hand === e.hand &&
            s.eventId !== e.id &&
            overlaps(s, start, start + e.duration),
        )
      )
        errors.push("Invalid dynamic alternate fingering or preparation.");
    }
    if (!primary || primary.tie?.index || voiceOf(e) !== mainVoice(e.hand))
      continue;
    const technique = move?.technique ?? tag?.technique;
    if (technique) {
      const run = nextRun(runs[e.hand], technique);
      if (!policy || !runAllowed(policy, run))
        errors.push("Dynamic fingering exceeds configured sequence limits.");
      runs[e.hand] = run;
    } else delete runs[e.hand];
  }
  const reconstructed = {
    ...p.final,
    dynamicFingering: { ...structuredClone(p.initial.dynamicFingering!), runs },
  };
  finishFingering(p, reconstructed, c);
  if (
    JSON.stringify(reconstructed.dynamicFingering.spans) !==
      JSON.stringify(p.final.dynamicFingering!.spans) ||
    (["right", "left"] as const).some(
      (hand) =>
        reconstructed.dynamicFingering.lastMovementTick[hand] !==
          p.final.dynamicFingering!.lastMovementTick[hand] ||
        JSON.stringify(runs[hand]) !==
          JSON.stringify(p.final.dynamicFingering!.runs[hand]),
    )
  )
    errors.push("Final dynamic fingering memory differs from the plan.");
  return errors;
}
