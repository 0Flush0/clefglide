import {
  isContinuousMovement,
  noteheads,
  type ScoreEvent,
  type Phrase,
} from "../score/model";
import type {
  ArticulationTiming,
  SlurGroup,
  SlurMember,
  SlurStyle,
  Touch,
} from "../score/articulationModel";
import type { ValidatedGeneratorConfig } from "./config";
import { boundaryTick, eventTick, voiceOf } from "./fingeringTimeline";
import { comfortableMap, isBlack, keyCenter } from "./ergonomics";

export type ArticulationPolicy = NonNullable<
  ValidatedGeneratorConfig["articulation"]
>;
export type ArticulationFrame = Pick<
  Phrase,
  "events" | "positions" | "movements" | "initial" | "final"
>;
type DurationTouch = "staccatissimo" | "staccato" | "tenuto" | "portato";
export interface ArticulationAttack {
  id: string;
  start: number;
  end: number;
  event: ScoreEvent;
  frame: ArticulationFrame;
  eligible: boolean;
  pinned: boolean;
}

/** Reconstruct attacks and protected contacts from score facts, independent of sampling. */
export class ArticulationTimeline {
  readonly lanes = new Map<string, ArticulationAttack[]>();
  readonly byId = new Map<string, ArticulationAttack>();
  readonly policy: ArticulationPolicy;
  private readonly substituted: Set<string>;
  constructor(
    readonly frames: ArticulationFrame[],
    readonly config: ValidatedGeneratorConfig,
  ) {
    this.policy = config.articulation!;
    const events = frames.flatMap((frame) =>
      frame.events.map((event) => ({ frame, event })),
    );
    const substitutions = events.flatMap(({ event }) =>
      noteheads(event).flatMap((n) =>
        n.substitution && n.lifetime
          ? [
              {
                hand: event.hand,
                start: n.substitution.startTick,
                release: n.lifetime.releaseTick,
                id: n.substitution.lifetimeId,
              },
            ]
          : [],
      ),
    );
    this.substituted = new Set(substitutions.map((s) => s.id));
    const dynamicBoundary = config.dynamicFingering?.techniques.some(
      ({ technique }) =>
        technique === "thumb-under" ||
        technique === "finger-over" ||
        technique === "continuous-shift",
    );
    for (const { frame, event } of events) {
      const heads = noteheads(event);
      if (!heads.some((n) => (n.tie?.index ?? 0) === 0)) continue;
      const start = eventTick(event, config);
      const end = Math.max(
        ...heads.map((n) => n.lifetime?.releaseTick ?? start + event.duration),
      );
      const tied = heads.some((n) => n.tie);
      const interactions = this.policy.interactions;
      const otherHeld =
        interactions.sustained === "exclude" &&
        (frame.events.some(
          (e) =>
            e.hand === event.hand &&
            voiceOf(e) !== voiceOf(event) &&
            eventTick(e, config) < end &&
            noteheads(e).some((n) => (n.lifetime?.releaseTick ?? 0) > start),
        ) ||
          frame.initial.activeLifetimes?.some(
            (n) =>
              n.hand === event.hand &&
              n.lifetime.voiceId !== voiceOf(event) &&
              n.lifetime.releaseTick > start &&
              n.lifetime.onsetTick < end,
          ));
      const attack: ArticulationAttack = {
        id: event.id,
        start,
        end,
        event,
        frame,
        eligible:
          heads.every(
            (n) => (n.tie?.index ?? 0) === 0 && n.lifetime?.releaseTick === end,
          ) &&
          !(tied && interactions.ties === "exclude") &&
          !(heads.length > 1 && interactions.chords === "exclude") &&
          !otherHeld,
        pinned:
          tied ||
          heads.some((n) => this.substituted.has(n.tie?.lifetimeId ?? n.id)) ||
          substitutions.some(
            (s) => s.hand === event.hand && start < s.start && end >= s.release,
          ) ||
          frames.some((f) =>
            f.movements.some(
              (m) => isContinuousMovement(m) && m.source.eventId === event.id,
            ),
          ) ||
          (!!dynamicBoundary && end === boundaryTick(frame.final, config)),
      };
      const voice = voiceOf(event);
      const lane = this.lanes.get(voice) ?? [];
      lane.push(attack);
      this.lanes.set(voice, lane);
      this.byId.set(event.id, attack);
    }
    for (const lane of this.lanes.values())
      lane.sort((a, b) => a.start - b.start);
  }

  duration(
    attack: ArticulationAttack,
    touch: DurationTouch,
  ): ArticulationTiming | undefined {
    const { min, target, max } = this.policy.timing[touch];
    const length = attack.end - attack.start;
    const ticks = Math.min(
      touch === "tenuto" ? length : length - 1,
      Math.round(length * target),
    );
    if (
      !attack.eligible ||
      (attack.pinned && (touch !== "tenuto" || target !== 1)) ||
      ticks <= 0
    )
      return;
    return {
      kind: "duration",
      ticks,
      minTicks: attack.pinned
        ? length
        : Math.max(1, Math.min(ticks, Math.ceil(length * min))),
      maxTicks: Math.max(ticks, Math.floor(length * max)),
    };
  }

  /** Evaluate a local adjacency, including transitions to the next generated frame. */
  adjacent(from: ArticulationAttack, to: ArticulationAttack) {
    if (
      !from.eligible ||
      !to.eligible ||
      from.end !== to.start ||
      voiceOf(from.event) !== voiceOf(to.event)
    )
      return false;
    const moves = to.frame.movements.filter(
      (m) => m.hand === to.event.hand && m.landingTick === to.start,
    );
    return moves.every(
      (m) =>
        isContinuousMovement(m) &&
        this.policy.interactions.continuous === "connected",
    );
  }

  connection(
    from: ArticulationAttack,
    to: ArticulationAttack,
    touch: "legato" | "non-legato",
  ): ArticulationTiming | undefined {
    if (!this.adjacent(from, to)) return;
    const base = from.end - from.start;
    const target = (
      kind: "overlap" | "separation" | "connected",
      offsetTicks: number,
    ): ArticulationTiming => ({
      kind,
      ticks: base + offsetTicks,
      offsetTicks,
      nextEventId: to.id,
    });
    const { separationTicks, overlapTicks } = this.policy.timing;
    const continuous = to.frame.movements.some(
      (m) =>
        isContinuousMovement(m) &&
        m.hand === to.event.hand &&
        m.landingTick === to.start,
    );
    if (touch === "non-legato")
      return !from.pinned && !continuous && base > separationTicks
        ? target("separation", -separationTicks)
        : undefined;
    if (!continuous && this.canOverlap(from, to, overlapTicks))
      return target("overlap", overlapTicks);
    if (continuous || this.policy.interactions.legatoFallback === "connected")
      return target("connected", 0);
  }

  private canOverlap(
    from: ArticulationAttack,
    to: ArticulationAttack,
    ticks: number,
  ) {
    const end = to.start + ticks;
    if (
      from.pinned ||
      from.frame !== to.frame ||
      end > to.end ||
      from.event.positionId !== to.event.positionId ||
      from.frame.movements.some(
        (m) => m.cueTick < end && m.landingTick >= to.start,
      )
    )
      return false;
    const source = noteheads(from.event);
    const position = from.frame.positions.find(
      (p) => p.id === from.event.positionId,
    );
    if (
      !position ||
      source.some((n) => position.fingerToMidi[n.finger - 1] !== n.midi)
    )
      return false;
    const others = from.frame.events.flatMap((e) => {
      if (e.id === from.id) return [];
      const start = eventTick(e, this.config);
      if (start >= end) return [];
      return noteheads(e).flatMap((n) => {
        const hold = n.lifetime?.keyHold;
        const release = Math.min(
          hold?.kind === "required" ? hold.releaseTick : start,
          start + e.duration,
        );
        return release > to.start
          ? [{ n, start, end: release, positionId: e.positionId }]
          : [];
      });
    });
    const independent = this.config.independentVoices;
    const unrepresentedHold = from.frame.initial.activeLifetimes?.some(
      ({ id, hand, midi, lifetime }) =>
        lifetime.keyHold.kind === "required" &&
        lifetime.keyHold.releaseTick > to.start &&
        (!!independent ||
          hand === from.event.hand ||
          source.some((n) => n.midi === midi)) &&
        !others.some(({ n }) => n.tie?.lifetimeId === id),
    );
    if (independent) {
      const voice = voiceOf(from.event);
      const exceeds = (start: number, stop: number) =>
        independent.overlapProbability === 0 ||
        Math.min(end, stop) - Math.max(from.start, start) >
          independent.maxOverlapTicks;
      if (
        others.some(
          ({ n }) =>
            n.lifetime!.voiceId !== voice &&
            exceeds(n.lifetime!.onsetTick, n.lifetime!.releaseTick),
        )
      )
        return false;
      // Reserve one extension per hand at a time. Competing extensions in
      // other hands must also fit the configured inter-voice overlap cap.
      if (
        [...this.lanes].some(
          ([id, attacks]) =>
            id !== voice &&
            attacks.some(
              (attack, i) =>
                attack.frame === from.frame &&
                !attack.pinned &&
                attack.end > to.start - ticks &&
                attack.end < end &&
                attacks[i + 1] &&
                this.adjacent(attack, attacks[i + 1]) &&
                (attack.event.hand === from.event.hand ||
                  exceeds(attack.start, attack.end + ticks)),
            ),
        )
      )
        return false;
    }
    if (
      unrepresentedHold ||
      others.some(
        ({ n, positionId }) =>
          source.some(
            (s) =>
              s.midi === n.midi || (s.hand === n.hand && s.finger === n.finger),
          ) ||
          (n.hand === from.event.hand &&
            (positionId !== position.id ||
              this.substituted.has(n.tie?.lifetimeId ?? n.id))),
      )
    )
      return false;
    // The combined model must fit throughout the extension, including new
    // attacks or releases in independent voices between its endpoints.
    const checks = [
      to.start,
      ...others.flatMap((n) => [n.start, n.end]),
    ].filter((t) => t >= to.start && t < end);
    return checks.every((tick) => {
      const map = [...position.fingerToMidi];
      const held = [
        ...source,
        ...others
          .filter(
            (o) =>
              o.n.hand === position.hand && o.start <= tick && tick < o.end,
          )
          .map((o) => o.n),
      ].sort((a, b) => a.finger - b.finger);
      if (independent && held.length > independent[position.hand]!.maxPolyphony)
        return false;
      for (const n of held) map[n.finger - 1] = n.midi;
      return (
        comfortableMap(map, position.hand) &&
        held.every(
          (n, i) =>
            !i ||
            Math.abs(keyCenter(n.midi) - keyCenter(held[i - 1].midi)) <=
              (n.finger - held[i - 1].finger) * 1.5 + 0.5,
        ) &&
        !(
          held.some(
            (n) => (n.finger === 1 || n.finger === 5) && isBlack(n.midi),
          ) &&
          held.some((n) => n.finger > 1 && n.finger < 5 && !isBlack(n.midi))
        )
      );
    });
  }

  member(attack: ArticulationAttack, style: SlurStyle) {
    return (
      attack.eligible &&
      (style !== "portato" || !!this.duration(attack, "portato"))
    );
  }

  slurEdge(from: ArticulationAttack, to: ArticulationAttack, style: SlurStyle) {
    const slurs = this.policy.slurs;
    if (
      !slurs ||
      !this.adjacent(from, to) ||
      (!slurs.crossMeasure && from.event.bar !== to.event.bar) ||
      (!slurs.crossPhrase && from.frame !== to.frame)
    )
      return false;
    return style === "legato"
      ? !!this.connection(from, to, "legato")
      : !to.frame.movements.some(
          (m) => m.hand === from.event.hand && m.landingTick === to.start,
        );
  }
}

export function localTouch(
  timeline: ArticulationTimeline,
  attack: ArticulationAttack,
  touch: Touch | undefined,
  next: ArticulationAttack | undefined,
): ArticulationTiming | undefined {
  switch (touch) {
    case "staccato":
    case "staccatissimo":
    case "tenuto":
      return timeline.duration(attack, touch);
    case "legato":
    case "non-legato":
      return next && timeline.connection(attack, next, touch);
  }
}

export function attackRef({ id, start, end }: ArticulationAttack) {
  return { id, start, end };
}

export function slurId(voice: string, startId: string) {
  return JSON.stringify([voice, startId]);
}
export const articulationContext = (seed: string, fingerprint: string) =>
  JSON.stringify([seed, fingerprint]);

export function slurMember(group: SlurGroup, index: number): SlurMember {
  return {
    id: group.id,
    index,
    length: group.members.length,
    style: group.style,
    placement: group.placement,
  };
}
