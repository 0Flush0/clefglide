import type {
  ArticulationAttackRef,
  ArticulationMark,
  ArticulationTiming,
  SlurGroup,
} from "../score/articulationModel";
import { TPQ, isContinuousMovement, type Phrase } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { generatorConfigFingerprint } from "./config";
import {
  ArticulationTimeline,
  articulationContext,
  attackRef,
  localTouch,
  slurId,
  slurMember,
} from "./articulationConstraints";
import { boundaryTick, voiceOf } from "./fingeringTimeline";

type Plan = Omit<Phrase, "settings">;
const propertiesEqual = (a: object | undefined, b: object | undefined) =>
  a === undefined || b === undefined
    ? a === b
    : Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(
        ([key, value]) =>
          Object.hasOwn(b, key) && Reflect.get(b, key) === value,
      );

export function validateArticulation(
  p: Plan,
  c: ValidatedGeneratorConfig,
  previous?: Plan,
): string[] {
  const errors: string[] = [];
  const a = c.articulation;
  const incoming = p.initial.articulation;
  const outgoing = p.final.articulation;
  if (!a)
    return incoming ||
      outgoing ||
      p.events.some((e) => e.articulation || e.slur)
      ? ["Articulation annotations require an enabled configuration."]
      : [];
  const context = articulationContext(p.seed, generatorConfigFingerprint(c));
  if (
    !outgoing ||
    outgoing.context !== context ||
    (p.initial.bar === 0 ? !!incoming : incoming?.context !== context)
  )
    return ["Invalid articulation stream context."];
  if (
    previous &&
    (previous.final.bar !== p.initial.bar ||
      JSON.stringify(previous.final.articulation) !== JSON.stringify(incoming))
  )
    errors.push(
      "Articulation continuation differs from the previous phrase commitment.",
    );
  const start = boundaryTick(p.initial, c);
  const end = boundaryTick(p.final, c);
  const timeline = new ArticulationTimeline([p], c);
  const slurs = a.slurs;
  const idToGroup = new Map<string, ArticulationAttackRef[]>();
  const groupIds = new Set<string>();
  const members = new Set<string>();
  const verifyGroup = (group: SlurGroup, cross?: number) => {
    const refs = group.members;
    const first = refs[0];
    const last = refs.at(-1);
    const voice = group.voiceId;
    if (
      !slurs ||
      !first ||
      !last ||
      groupIds.has(group.id) ||
      group.id !== slurId(voice, first.id) ||
      !(slurs.voices ?? a.voices).includes(voice) ||
      group.placement !== slurs.placement ||
      !slurs.styles.some((r) => r.value === group.style && r.probability > 0) ||
      !slurs.lengths.some((r) => r.value === refs.length) ||
      (cross !== undefined &&
        (!slurs.crossPhrase ||
          first.start >= cross ||
          last.start < cross ||
          first.start < cross - (end - start) ||
          last.start >= cross + (end - start)))
    ) {
      errors.push("Invalid slur group identity, policy or boundary.");
      return;
    }
    groupIds.add(group.id);
    const lane = timeline.lanes.get(voice) ?? [];
    for (const [i, ref] of refs.entries()) {
      const prior = refs[i - 1];
      const local = ref.start >= start && ref.start < end;
      const attack = timeline.byId.get(ref.id);
      if (
        members.has(ref.id) ||
        !Number.isSafeInteger(ref.start) ||
        !Number.isSafeInteger(ref.end) ||
        ref.end <= ref.start ||
        (prior && prior.end !== ref.start) ||
        (!slurs.crossMeasure &&
          Math.floor(first.start / (c.notation.beats * TPQ)) !==
            Math.floor(ref.start / (c.notation.beats * TPQ)))
      )
        errors.push("Invalid or duplicate slur attack sequence.");
      members.add(ref.id);
      if (!local) {
        if (cross === undefined || attack)
          errors.push("Slur refers to a missing local attack.");
        continue;
      }
      if (
        !attack ||
        voiceOf(attack.event) !== voice ||
        !propertiesEqual(ref, attackRef(attack)) ||
        !propertiesEqual(attack.event.slur, slurMember(group, i)) ||
        !timeline.member(attack, group.style)
      ) {
        errors.push("Invalid slur membership or articulation contact.");
        continue;
      }
      if (prior) {
        const previousAttack = lane[lane.indexOf(attack) - 1];
        if (
          prior.start >= start
            ? !previousAttack ||
              previousAttack.id !== prior.id ||
              !timeline.slurEdge(previousAttack, attack, group.style)
            : previousAttack !== undefined ||
              (attack.start !== start &&
                !p.initial.activeLifetimes?.some(
                  (hold) =>
                    hold.eventId === prior.id &&
                    hold.lifetime.voiceId === voice &&
                    hold.lifetime.releaseTick === attack.start,
                )) ||
              p.movements.some(
                (m) =>
                  m.hand === attack.event.hand &&
                  m.landingTick === attack.start &&
                  (group.style === "portato" ||
                    a.interactions.continuous === "exclude" ||
                    !isContinuousMovement(m)),
              ) ||
              (group.style === "legato" &&
                a.interactions.legatoFallback === "omit" &&
                !p.movements.some(
                  (m) =>
                    isContinuousMovement(m) &&
                    m.source.eventId === prior.id &&
                    m.landingTick === attack.start &&
                    m.hand === attack.event.hand,
                ))
        )
          errors.push(
            "Slur crosses an incompatible attack, rest or hand movement.",
          );
      }
      idToGroup.set(ref.id, refs);
    }
  };
  for (const [boundary, at] of [
    [incoming, start],
    [outgoing, end],
  ] as const)
    for (const group of boundary?.groups ?? []) verifyGroup(group, at);

  // Local groups are reconstructed from the annotations, then checked against the voice lane.
  const local = new Map<string, typeof p.events>();
  for (const e of p.events)
    if (e.slur && !groupIds.has(e.slur.id)) {
      const group = local.get(e.slur.id) ?? [];
      group.push(e);
      local.set(e.slur.id, group);
    }
  for (const [id, events] of local) {
    const first = events[0];
    const { style, placement } = first.slur!;
    const attacks = events.map((e) => timeline.byId.get(e.id));
    if (attacks.some((attack) => !attack)) {
      errors.push("Slurs must annotate attacks.");
      continue;
    }
    verifyGroup({
      id,
      voiceId: voiceOf(first),
      style,
      placement,
      members: attacks.map((n) => attackRef(n!)),
    });
  }
  const terminal: NonNullable<typeof outgoing>["terminal"] = {};
  for (const e of p.events) {
    if (!e.articulation && !e.slur) continue;
    const attack = timeline.byId.get(e.id);
    if (!attack?.eligible || (e.slur && !idToGroup.has(e.id))) {
      errors.push("Invalid articulation or slur on an ineligible score event.");
      continue;
    }
    const voice = voiceOf(e);
    const { touch, emphasis, timing } = e.articulation ?? {};
    const enabled = <T>(
      rules: readonly { value: T; probability: number }[],
      value: T,
    ) =>
      a.voices.includes(voice) &&
      rules.some((r) => r.value === value && r.probability > 0);
    if (
      (touch !== undefined && !enabled(a.touch, touch)) ||
      (emphasis !== undefined && !enabled(a.emphasis, emphasis)) ||
      (touch &&
        (e.slur?.style === "portato" ||
          (e.slur && (touch === "legato" || touch === "non-legato")))) ||
      (e.articulation &&
        (!Object.keys(e.articulation).length ||
          Object.keys(e.articulation).some(
            (key) => !["touch", "emphasis", "timing"].includes(key),
          )))
    )
      errors.push(
        "Articulation marking conflicts with its voice, policy or slur.",
      );
    const lane = timeline.lanes.get(voice)!;
    const next = lane[lane.indexOf(attack) + 1];
    const ref = e.slur && idToGroup.get(e.id)?.[e.slur.index + 1];
    let expected: ArticulationTiming | undefined;
    if (e.slur?.style === "portato")
      expected = timeline.duration(attack, "portato");
    else if (touch && touch !== "natural")
      expected = localTouch(timeline, attack, touch, next);
    else if (ref) {
      if (ref.start >= end && ref.start === attack.end && !next)
        expected = {
          kind: "connected",
          ticks: attack.end - attack.start,
          offsetTicks: 0,
          nextEventId: ref.id,
        };
      else if (next?.id === ref.id)
        expected = timeline.connection(attack, next, "legato");
    }
    if (
      !propertiesEqual(timing, expected) ||
      (!expected &&
        ((touch && touch !== "natural") || e.slur?.style === "portato" || ref))
    )
      errors.push("Invalid articulation timing or physical connection target.");
    if (attack.end === end && (touch || emphasis))
      terminal[voice] = { ...attackRef(attack), touch, emphasis };
  }
  const sameTerminal = (got: typeof terminal, expected: typeof terminal) =>
    Object.keys(got).length === Object.keys(expected).length &&
    Object.entries(got).every(([voice, value]) => {
      const normalize = ({
        id,
        start,
        end,
        touch,
        emphasis,
      }: ArticulationAttackRef &
        Pick<ArticulationMark, "touch" | "emphasis">) => ({
        id,
        start,
        end,
        touch,
        emphasis,
      });
      return (
        expected[voice] &&
        propertiesEqual(normalize(value), normalize(expected[voice]))
      );
    });
  if (!sameTerminal(outgoing.terminal, terminal))
    errors.push("Invalid outgoing articulation persistence state.");
  for (const [voice, ref] of Object.entries(incoming?.terminal ?? {}))
    if (
      !a.voices.includes(voice) ||
      ref.end !== start ||
      !Number.isSafeInteger(ref.start) ||
      ref.start >= start ||
      ref.start < start - (end - start) ||
      (!ref.touch && !ref.emphasis) ||
      (ref.touch &&
        !a.touch.some((r) => r.value === ref.touch && r.probability > 0)) ||
      (ref.emphasis &&
        !a.emphasis.some((r) => r.value === ref.emphasis && r.probability > 0))
    )
      errors.push("Invalid incoming articulation persistence state.");
  return errors;
}
