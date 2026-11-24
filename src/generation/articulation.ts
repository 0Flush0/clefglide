import { activeHands, configForHand } from "./config/handParameters";
import type { Hand } from "../score/model";
import type {
  ArticulationMark,
  SlurGroup,
  SlurMember,
} from "../score/articulationModel";
import type { GeneratedPhrase } from "./model";
import {
  ArticulationTimeline,
  articulationContext,
  attackRef,
  localTouch,
  slurId,
  slurMember,
} from "./articulationConstraints";
import { boundaryTick } from "./fingeringTimeline";
import { hash, random } from "./random";
import { chooseWeighted } from "./sampling";

/** Overlay only. Each chunk gets independent deterministic draws and commits
 * at most one future chunk of slur membership. */
export function planArticulation(p: GeneratedPhrase, next?: GeneratedPhrase) {
  const configs = p.config.handParameters ? activeHands(p.config) : [undefined];
  const state: NonNullable<GeneratedPhrase["final"]["articulation"]> = {
    context: articulationContext(p.seed, p.configFingerprint),
    groups: [],
    terminal: {},
  };
  for (const hand of configs) {
    const local = planHandArticulation(p, next, hand);
    if (!local) continue;
    state.groups.push(...local.groups);
    Object.assign(state.terminal, local.terminal);
  }
  p.final.articulation = state;
}

function planHandArticulation(
  p: GeneratedPhrase,
  next?: GeneratedPhrase,
  hand?: Hand,
) {
  const config = hand ? configForHand(p.config, hand) : p.config;
  const policy = config.articulation;
  if (!policy) return;
  const includes = (voice: string) => !hand || voice.startsWith(`${hand}:`);
  const timeline = new ArticulationTimeline(next ? [p, next] : [p], config);
  const initial = p.initial.articulation;
  const boundary = boundaryTick(p.final, p.config);
  const rng = {
    rng: hash(
      JSON.stringify([
        "articulation",
        p.seed,
        p.initial.bar,
        ...(hand ? [hand] : []),
      ]),
    ),
  };
  const assigned = new Map<string, SlurMember>();
  const crossing: SlurGroup[] = [];
  const terminal: NonNullable<
    GeneratedPhrase["final"]["articulation"]
  >["terminal"] = {};
  const assign = (group: SlurGroup) =>
    group.members.forEach(({ id }, index) =>
      assigned.set(id, slurMember(group, index)),
    );
  for (const group of initial?.groups ?? []) assign(group);
  const slurs = policy.slurs;
  if (slurs) {
    for (const [voice, lane] of timeline.lanes) {
      if (!includes(voice) || !(slurs.voices ?? policy.voices).includes(voice))
        continue;
      for (const [index, from] of lane.entries()) {
        if (
          from.frame !== p ||
          assigned.has(from.id) ||
          random(rng) >= slurs.probability
        )
          continue;
        const styles = slurs.styles.flatMap((rule) => {
          if (random(rng) >= rule.probability) return [];
          const lengths = slurs.lengths.filter(({ value }) => {
            const group = lane.slice(index, index + value);
            return (
              group.length === value &&
              group.every(
                (member, i) =>
                  !assigned.has(member.id) &&
                  timeline.member(member, rule.value) &&
                  (i === 0 ||
                    timeline.slurEdge(group[i - 1], member, rule.value)),
              )
            );
          });
          return lengths.length
            ? [{ value: { style: rule.value, lengths }, weight: rule.weight }]
            : [];
        });
        if (!styles.length) continue;
        const { style, lengths } = chooseWeighted(styles, rng);
        const length = chooseWeighted(lengths, rng);
        const members = lane.slice(index, index + length).map(attackRef);
        const group = {
          id: slurId(voice, from.id),
          voiceId: voice,
          style,
          placement: slurs.placement,
          members,
        };
        assign(group);
        if (members.at(-1)!.start >= boundary) crossing.push(group);
      }
    }
  }
  const sample = <T>(
    rules: readonly { value: T; weight: number; probability: number }[],
    probability: number,
    eligible: (value: T) => boolean,
    retained?: T,
  ) => {
    if (
      retained !== undefined &&
      rules.some((r) => r.value === retained && r.probability > 0) &&
      eligible(retained) &&
      random(rng) < policy.persistence
    )
      return retained;
    if (!rules.length || random(rng) >= probability) return;
    const candidates = rules.filter(
      (r) => eligible(r.value) && random(rng) < r.probability,
    );
    if (candidates.length) return chooseWeighted(candidates, rng);
  };
  for (const [voice, lane] of timeline.lanes) {
    if (!includes(voice)) continue;
    let last = initial?.terminal[voice];
    for (const [index, attack] of lane.entries()) {
      if (attack.frame !== p) break;
      const slur = assigned.get(attack.id);
      const nextAttack = lane[index + 1];
      const nextLocal = nextAttack?.frame === p ? nextAttack : undefined;
      const mark: ArticulationMark = {};
      if (slur) attack.event.slur = slur;
      if (attack.eligible && policy.voices.includes(voice)) {
        const previous = last?.end === attack.start ? last : undefined;
        const touch = sample(
          policy.touch,
          policy.touchProbability,
          (value) =>
            slur?.style !== "portato" &&
            !(slur && (value === "legato" || value === "non-legato")) &&
            (value === "natural" ||
              !!localTouch(timeline, attack, value, nextLocal)),
          previous?.touch,
        );
        const emphasis = sample(
          policy.emphasis,
          policy.emphasisProbability,
          () => true,
          previous?.emphasis,
        );
        if (touch) mark.touch = touch;
        if (emphasis) mark.emphasis = emphasis;
      }
      const timing =
        slur?.style === "portato"
          ? timeline.duration(attack, "portato")
          : mark.touch && mark.touch !== "natural"
            ? localTouch(timeline, attack, mark.touch, nextLocal)
            : slur && slur.index + 1 < slur.length && nextAttack
              ? timeline.connection(attack, nextAttack, "legato")
              : undefined;
      if (timing) mark.timing = timing;
      if (Object.keys(mark).length) attack.event.articulation = mark;
      last = {
        ...attackRef(attack),
        ...(mark.touch ? { touch: mark.touch } : {}),
        ...(mark.emphasis ? { emphasis: mark.emphasis } : {}),
      };
      if (attack.end === boundary && (mark.touch || mark.emphasis))
        terminal[voice] = last;
    }
  }
  return { groups: crossing, terminal };
}
