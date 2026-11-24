import {
  noteheads,
  type FingerSubstitution,
  type LifetimeNote,
  type Notehead,
  type Phrase,
  type ScoreEvent,
  type StreamState,
} from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { configForHand, fingeringPolicies } from "./config/handParameters";
import {
  permitsSubstitutionContact,
  preparationTicks,
  type SubstitutionRule,
} from "./fingeringGeometry";
import { boundaryTick, eventTick } from "./fingeringTimeline";
import { voiceAllows, voiceSpecs } from "./voiceConfig";
import { random } from "./random";
import { chooseWeighted } from "./sampling";

type Plan = Pick<Phrase, "events" | "initial" | "positions" | "movements">;
type Segment = { e: ScoreEvent; head: Notehead };

function substitutionContext(plan: Plan) {
  const segments = plan.events.flatMap((e) =>
    noteheads(e).map((head) => ({ e, head })),
  );
  const attacks = [
    ...(plan.initial.activeLifetimes ?? []),
    ...segments.flatMap(({ e, head }) =>
      head.lifetime && !head.tie?.index
        ? [
            {
              id: head.id,
              midi: head.midi,
              finger: head.finger,
              hand: head.hand,
              lifetime: head.lifetime,
              eventId: e.id,
              positionId: e.positionId,
            },
          ]
        : [],
    ),
  ];
  return { segments, attacks };
}

function legalHandoff(
  plan: Plan,
  c: ValidatedGeneratorConfig,
  rule: SubstitutionRule,
  segment: Segment,
  attacks: LifetimeNote[],
  toFinger: number,
  boundary: number,
): FingerSubstitution | undefined {
  const { e, head } = segment;
  const life = head.lifetime;
  if (
    !life ||
    life.keyHold.kind !== "required" ||
    head.fingering ||
    e.fingering ||
    (head.tie && (!rule.allowTies || head.tie.index !== head.tie.count - 1))
  )
    return;
  const pos = plan.positions.find((p) => p.id === e.positionId);
  const profile = voiceSpecs(c).find((v) => v.id === life.voiceId)?.profile;
  if (!pos || (profile && !voiceAllows(profile, head.midi, toFinger))) return;
  const bpm = c.dynamicFingering!.tempoBpm;
  const segmentTick = eventTick(e, c);
  const id = head.tie?.lifetimeId ?? head.id;
  const startTick = Math.max(
    segmentTick,
    life.onsetTick +
      preparationTicks(Math.max(80, rule.minimumPreparationMs), bpm),
  );
  const endTick = startTick + preparationTicks(rule.transferMs, bpm);
  const release = life.keyHold.releaseTick;
  const recoveryEnd = release + preparationTicks(rule.minimumRecoveryMs, bpm);
  if (
    endTick >= release ||
    release !== segmentTick + e.duration ||
    recoveryEnd > boundary ||
    plan.movements.some(
      (m) =>
        m.hand === e.hand &&
        m.cueTick < recoveryEnd &&
        m.landingTick > startTick,
    )
  )
    return;
  const related = attacks.filter(
    (n) =>
      n.hand === head.hand &&
      n.id !== id &&
      n.lifetime.onsetTick < recoveryEnd &&
      n.lifetime.releaseTick > startTick,
  );
  if (related.length > 1) return;
  const [anchor] = related;
  if (
    anchor &&
    (anchor.lifetime.onsetTick >= startTick ||
      anchor.lifetime.keyHold.kind !== "required" ||
      anchor.lifetime.keyHold.releaseTick < release)
  )
    return;
  if (!permitsSubstitutionContact(rule, pos, head, toFinger, anchor)) return;
  return {
    technique: "substitution",
    lifetimeId: id,
    fromFinger: head.finger,
    toFinger,
    startTick,
    endTick,
  };
}

export function planSubstitutions(
  plan: Plan,
  state: StreamState,
  c: ValidatedGeneratorConfig,
) {
  if (
    !fingeringPolicies(c).some((policy) =>
      policy.techniques.some((rule) => rule.technique === "substitution"),
    )
  )
    return;
  const { attacks, segments } = substitutionContext(plan);
  const used: Partial<Record<ScoreEvent["hand"], number>> = {};
  const boundary = boundaryTick(state, c);
  const groups = new Map<string, Segment[]>();
  for (const segment of segments) {
    const { e } = segment;
    const key = `${e.hand}:${eventTick(e, c)}`;
    const group = groups.get(key);
    if (group) group.push(segment);
    else groups.set(key, [segment]);
  }
  for (const group of groups.values()) {
    const local = configForHand(c, group[0].e.hand);
    const policy = local.dynamicFingering;
    const rule = policy?.techniques.find((r) => r.technique === "substitution");
    if (!policy || !rule) continue;
    const candidates = group.flatMap((segment) =>
      rule.fingerPairs.flatMap(([from, finger]) => {
        if (segment.head.finger !== from) return [];
        const value = legalHandoff(
          plan,
          local,
          rule,
          segment,
          attacks,
          finger,
          boundary,
        );
        if (!value || value.startTick < (used[segment.e.hand] ?? 0)) return [];
        return [
          {
            value: { head: segment.head, plan: value },
            weight: policy.fingerWeights[finger - 1],
          },
        ];
      }),
    );
    if (!candidates.length || random(state) >= rule.probability) continue;
    const selected = chooseWeighted(candidates, state);
    selected.head.substitution = selected.plan;
    used[selected.head.hand] =
      selected.head.lifetime!.releaseTick +
      preparationTicks(rule.minimumRecoveryMs, policy.tempoBpm);
  }
}

export function validateSubstitutions(
  plan: Plan,
  final: StreamState,
  c: ValidatedGeneratorConfig,
) {
  const errors: string[] = [];

  const { segments, attacks } = substitutionContext(plan);
  const byHand = new Map<string, { start: number; end: number }[]>();
  const ids = new Set<string>();
  for (const segment of segments) {
    const { head } = segment;
    const record = head.substitution;
    if (!record) continue;
    const local = configForHand(c, head.hand);
    const rule = local.dynamicFingering?.techniques.find(
      (r) => r.technique === "substitution",
    );
    if (!rule) {
      errors.push("Substitution requires the enabled fingering capability.");
      continue;
    }
    const legal = legalHandoff(
      plan,
      local,
      rule,
      segment,
      attacks,
      record.toFinger,
      boundaryTick(final, c),
    );
    if (
      !legal ||
      record.technique !== legal.technique ||
      record.lifetimeId !== legal.lifetimeId ||
      record.fromFinger !== legal.fromFinger ||
      record.startTick !== legal.startTick ||
      record.endTick !== legal.endTick ||
      ids.has(record.lifetimeId)
    ) {
      errors.push("Invalid finger substitution, held tone or transfer window.");
      continue;
    }
    const windows = byHand.get(head.hand) ?? [];
    const start = legal.startTick;
    const end =
      head.lifetime!.releaseTick +
      preparationTicks(
        rule.minimumRecoveryMs,
        local.dynamicFingering!.tempoBpm,
      );
    if (windows.some((w) => w.start < end && w.end > start))
      errors.push("Finger substitution overlaps another same-hand transfer.");
    windows.push({ start, end });
    byHand.set(head.hand, windows);
    ids.add(record.lifetimeId);
  }
  return errors;
}
