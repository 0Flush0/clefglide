import { Note } from "tonal";
import { configForHand, fingeringPolicies } from "./config/handParameters";
import {
  TPQ,
  noteheads,
  type FingeringRun,
  type FingeringSpan,
  type DynamicAttack,
  type Hand,
  type HandState,
  type Phrase,
  type ScoreEvent,
  type StreamState,
} from "../score/model";
import {
  generatorConfigFingerprint,
  type ValidatedGeneratorConfig,
} from "./config";
import {
  continuousPreparation,
  preparationTicks,
  supportsContact,
  type AlternateRule,
  type DynamicPolicy,
  type TravelRule,
} from "./fingeringGeometry";

type Plan = Pick<Phrase, "events" | "initial" | "positions" | "movements">;
export const eventTick = (
  e: Pick<ScoreEvent, "bar" | "onset">,
  c: ValidatedGeneratorConfig,
) => e.bar * c.notation.beats * TPQ + e.onset;
export const voiceOf = (e: Pick<ScoreEvent, "voiceId" | "hand">) =>
  e.voiceId ?? `${e.hand}:main`;
export const mainVoice = (hand: Hand) => `${hand}:main`;
export const boundaryTick = (state: StreamState, c: ValidatedGeneratorConfig) =>
  state.bar * c.notation.beats * TPQ;
export const fingeringContext = (c: ValidatedGeneratorConfig, seed: string) =>
  JSON.stringify([seed, generatorConfigFingerprint(c)]);
const maximumSegmentTicks = 4 * TPQ;
const historyTicks = (c: ValidatedGeneratorConfig) => {
  return Math.max(
    maximumSegmentTicks,
    ...fingeringPolicies(c).flatMap((policy) =>
      policy.techniques.flatMap((rule) =>
        rule.technique === "rested-alternate"
          ? [preparationTicks(rule.minimumPreparationMs, policy.tempoBpm)]
          : [],
      ),
    ),
  );
};

export function fingeringSpans(
  plan: Plan,
  c: ValidatedGeneratorConfig,
): FingeringSpan[] {
  return [
    ...(plan.initial.dynamicFingering?.spans ?? []),
    ...plan.events.flatMap((e) => {
      const start = eventTick(e, c);
      return noteheads(e).map((n) => ({
        eventId: e.id,
        voiceId: voiceOf(e),
        positionId: e.positionId,
        hand: e.hand,
        pitch: n.pitch,
        midi: n.midi,
        finger: n.finger,
        start,
        end: start + e.duration,
        tied:
          !!n.tie ||
          (plan.initial.pendingTies ?? []).some(
            ({ head }) =>
              head.hand === e.hand &&
              head.midi === n.midi &&
              head.lifetime!.voiceId === voiceOf(e) &&
              head.lifetime!.releaseTick > start,
          ),
        alternate: !!(n.fingering ?? e.fingering),
      }));
    }),
  ];
}

export function beginFingering(
  c: ValidatedGeneratorConfig,
  seed: string,
  state: StreamState,
  continuing: boolean,
) {
  const context = fingeringContext(c, seed);
  if (continuing) {
    if (!validFingeringBoundary(c, seed, state) || state.bar === 0)
      throw new Error(
        "Dynamic fingering continuation requires the original seed, configuration and hand history.",
      );
  } else
    state.dynamicFingering = {
      context,
      spans: [],
      lastMovementTick: {},
      runs: {},
    };
}

export function validFingeringBoundary(
  c: ValidatedGeneratorConfig,
  seed: string,
  state: StreamState,
) {
  const memory = state.dynamicFingering;
  if (!fingeringPolicies(c).length) return memory === undefined;
  const end = boundaryTick(state, c);
  const cutoff = end - historyTicks(c);
  return (
    !!memory &&
    memory.context === fingeringContext(c, seed) &&
    Array.isArray(memory.spans) &&
    !!memory.lastMovementTick &&
    !!memory.runs &&
    (end > 0 ||
      (!memory.spans.length &&
        !Object.keys(memory.lastMovementTick).length &&
        !Object.keys(memory.runs).length)) &&
    memory.spans.every(
      (s) =>
        Number.isSafeInteger(s.start) &&
        s.start >= 0 &&
        Number.isSafeInteger(s.end) &&
        s.start < s.end &&
        s.end <= end &&
        s.end > cutoff &&
        s.end - s.start <= maximumSegmentTicks &&
        Number.isInteger(s.finger) &&
        s.finger >= 1 &&
        s.finger <= 5 &&
        typeof s.tied === "boolean" &&
        typeof s.alternate === "boolean" &&
        !!s.eventId &&
        !!s.positionId &&
        s.voiceId.startsWith(`${s.hand}:`) &&
        state.hands.some(
          (h) => h.hand === s.hand && s.midi >= h.min && s.midi <= h.max,
        ) &&
        Note.midi(s.pitch) === s.midi,
    ) &&
    state.hands.every((h) => {
      const latest = sourceAt(memory.spans, h.hand, end);
      const recorded = h.lastNoteEnd ?? 0;
      if (!latest) return recorded <= Math.max(0, cutoff);
      const contacts = memory.spans.filter((s) => s.eventId === latest.eventId);
      return (
        latest.end === recorded &&
        latest.pitch === h.lastPitch &&
        contacts.length === h.lastFingering?.length &&
        contacts.every(
          (s, i) =>
            s.end === latest.end &&
            s.midi === h.lastFingering![i].midi &&
            s.finger === h.lastFingering![i].finger,
        )
      );
    }) &&
    Object.entries(memory.lastMovementTick).every(
      ([hand, tick]) =>
        state.hands.some((h) => h.hand === hand) &&
        Number.isSafeInteger(tick) &&
        tick >= 0 &&
        tick < end,
    ) &&
    Object.entries(memory.runs).every(([hand, run]) => {
      const policy = configForHand(c, hand as Hand).dynamicFingering;
      return (
        state.hands.some((h) => h.hand === hand) &&
        !!policy &&
        policy.techniques.some((r) => r.technique === run.technique) &&
        runAllowed(policy, run)
      );
    })
  );
}

export function nextRun(
  previous: FingeringRun | undefined,
  technique: DynamicAttack,
): FingeringRun {
  return {
    technique,
    consecutive: (previous?.consecutive ?? 0) + 1,
    repeated: previous?.technique === technique ? previous.repeated + 1 : 1,
  };
}
export function runAllowed(policy: DynamicPolicy, run: FingeringRun) {
  return (
    !!policy.attacks &&
    Number.isInteger(run.consecutive) &&
    Number.isInteger(run.repeated) &&
    run.repeated >= 1 &&
    run.consecutive >= run.repeated &&
    run.consecutive <= policy.attacks.maxConsecutive &&
    run.repeated <= policy.attacks.maxRepeated
  );
}

export function finishFingering(
  plan: Plan,
  state: StreamState,
  c: ValidatedGeneratorConfig,
) {
  const memory = state.dynamicFingering!;
  const end = boundaryTick(state, c);
  memory.spans = fingeringSpans(plan, c).filter(
    (s) => s.end > end - historyTicks(c),
  );
  for (const move of plan.movements)
    memory.lastMovementTick[move.hand] = Math.max(
      memory.lastMovementTick[move.hand] ?? -1,
      move.landingTick,
    );
}

export function sourceAt(
  spans: readonly FingeringSpan[],
  hand: Hand,
  tick: number,
) {
  return spans
    .filter((s) => s.voiceId === mainVoice(hand) && s.start < tick)
    .reduce<FingeringSpan | undefined>(
      (latest, s) => (!latest || s.start > latest.start ? s : latest),
      undefined,
    );
}
export const overlaps = (
  s: { start: number; end: number },
  a: number,
  b: number,
) => s.start < b && s.end > a;

export function continuousWindow(
  plan: Plan,
  spans: FingeringSpan[],
  c: ValidatedGeneratorConfig,
  rule: TravelRule,
  from: HandState,
  to: HandState,
  source: FingeringSpan,
  landing: number,
) {
  const cue = source.start;
  if (
    source.end !== landing ||
    source.positionId !== from.id ||
    source.alternate ||
    (source.tied && !rule.allowTiedSource) ||
    landing - cue < continuousPreparation(rule, c.dynamicFingering!.tempoBpm) ||
    spans.some(
      (s) => s.hand === from.hand && s !== source && overlaps(s, cue, landing),
    ) ||
    plan.movements.some(
      (m) =>
        m.hand === from.hand &&
        m.landingTick > cue &&
        m.cueTick < landing &&
        m.landingTick !== landing,
    ) ||
    (plan.initial.activeLifetimes ?? []).some(
      (n) =>
        n.hand === from.hand &&
        n.lifetime.releaseTick > landing &&
        n.lifetime.onsetTick < landing,
    )
  )
    return false;
  const other = plan.initial.hands.find((h) => h.hand !== from.hand);
  if (!other) return true;
  const priorMovement =
    plan.initial.dynamicFingering?.lastMovementTick[other.hand];
  // A previously delivered sweep is represented by its landing boundary only.
  if (priorMovement !== undefined && priorMovement >= cue) return false;
  const otherMoves = plan.movements.filter((m) => m.hand === other.hand);
  const atCue =
    otherMoves
      .filter((m) => m.landingTick < cue)
      .sort((a, b) => a.landingTick - b.landingTick)
      .at(-1)?.toPositionId ?? other.id;
  const swept = new Set([
    atCue,
    ...otherMoves
      .filter((m) => m.landingTick >= cue && m.cueTick <= landing)
      .flatMap((m) => [m.fromPositionId, m.toPositionId]),
  ]);
  const envelope = (h: HandState) => [
    ...h.fingerToMidi,
    ...(h.pitchOptions ?? []).flat().map((pitch) => Note.midi(pitch)!),
  ];
  const own = [...envelope(from), ...envelope(to)];
  const opposite = plan.positions
    .filter((h) => h.hand === other.hand && swept.has(h.id))
    .flatMap(envelope);
  return (
    opposite.length > 0 &&
    (from.hand === "right"
      ? Math.min(...own) > Math.max(...opposite)
      : Math.max(...own) < Math.min(...opposite))
  );
}

export function alternateWindow(
  plan: Plan,
  spans: FingeringSpan[],
  c: ValidatedGeneratorConfig,
  rule: AlternateRule,
  hand: Hand,
  tick: number,
  contact: { midi: number; finger: number },
) {
  const ms = Math.max(
    rule.minimumPreparationMs,
    rule.technique === "adjacent-reach" ? 100 : 0,
  );
  const prep = Math.max(
    preparationTicks(ms, c.dynamicFingering!.tempoBpm),
    rule.technique === "rested-alternate" ? rule.minimumRestTicks : 0,
  );
  if (
    tick < prep ||
    (plan.initial.dynamicFingering?.lastMovementTick[hand] ?? -1) >=
      tick - prep ||
    plan.movements.some(
      (m) =>
        m.hand === hand &&
        m.landingTick >= tick - prep &&
        m.cueTick < tick &&
        m.landingTick !== tick,
    )
  )
    return false;
  const held = spans.filter(
    (s) => s.hand === hand && overlaps(s, tick - prep, tick),
  );
  if (rule.technique === "rested-alternate") return held.length === 0;
  return (
    held.length === 1 &&
    held[0].voiceId === mainVoice(hand) &&
    !held[0].alternate &&
    held[0].end === tick &&
    held[0].start <= tick - prep &&
    supportsContact(hand, contact, held[0])
  );
}
