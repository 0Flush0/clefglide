import { noteheads, TPQ, type Hand } from "../score/model";
import { diatonicIndex } from "../generation/positionMaps";
import type { GeneratedPhrase } from "../generation";
import type { Feature } from "./curriculumRecipe";

const counts = (values: string[]) =>
  Object.fromEntries(values.map((value) => [value, 0]));
const range = () => ({
  lowest: 108,
  highest: 21,
  pitches: new Set<number>(),
  attacks: 0,
});
const summarize = (hand: ReturnType<typeof range>) => ({
  ...hand,
  pitches: hand.pitches.size,
});

export function curriculumAudit() {
  const features: Partial<Record<Feature, number>> = {};
  const featurePhrases: Partial<Record<Feature, number>> = {};
  const hands = { right: range(), left: range() };
  const intervals = counts(["0", "1", "2", "3", "4", "5+"]);
  const durations = counts(["240", "480", "960", "1920"]);
  const chords = counts(["1", "2", "3", "4"]);
  const marks: Record<string, number> = {};
  let attacks = 0,
    groups = 0,
    offbeats = 0,
    rests = 0,
    beats = 0,
    longestHold = 0;
  let peak = 0,
    peakHand = 0,
    totalDistance = 0,
    distanceMax = 0,
    phrases = 0;
  const add = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1;
  };

  return {
    add(p: GeneratedPhrase) {
      phrases++;
      const seen = new Set<Feature>();
      const bump = (feature: Feature) => {
        features[feature] = (features[feature] ?? 0) + 1;
        seen.add(feature);
      };
      const measure = p.config.notation.beats * TPQ;
      const end = p.final.bar * measure;
      const tick = (e: { bar: number; onset: number }) =>
        e.bar * measure + e.onset;
      beats += (p.final.bar - p.initial.bar) * p.config.notation.beats;
      const lastPitch = new Map<string, string>();
      const grouped = new Map<number, Set<Hand>>();
      const occupied = (p.initial.activeLifetimes ?? []).map((n) => ({
        hand: n.hand,
        voice: n.lifetime.voiceId,
        start: n.lifetime.onsetTick,
        end: n.lifetime.releaseTick,
      }));
      const positions = new Map(p.positions.map((h) => [h.id, h]));
      for (const event of p.events) {
        if (event.kind === "rest") {
          rests += event.duration / TPQ;
          bump("rest");
          continue;
        }
        const heads = noteheads(event);
        const fresh = heads.filter((head) => !head.tie?.index);
        const start = tick(event);
        if (fresh.length) {
          attacks++;
          hands[event.hand].attacks++;
          add(chords, String(fresh.length));
          add(durations, String(event.duration));
          if (start % TPQ) offbeats++;
          const group = grouped.get(start) ?? new Set<Hand>();
          group.add(event.hand);
          grouped.set(start, group);
          if (fresh.length > 1)
            bump(
              fresh.length === 2
                ? "dyad"
                : fresh.length === 3
                  ? "triad"
                  : "extension",
            );
          if (event.duration !== TPQ)
            bump(
              ({ 240: "eighth", 960: "half", 1920: "whole" } as const)[
                event.duration as 240 | 960 | 1920
              ],
            );
          const voice = event.voiceId ?? `${event.hand}:main`;
          if (!voice.endsWith(":main")) bump("voices");
          const previous = lastPitch.get(voice);
          if (previous) {
            const distance = Math.abs(
              diatonicIndex(fresh[0].pitch) - diatonicIndex(previous),
            );
            add(intervals, distance > 4 ? "5+" : String(distance));
            if (distance === 2) bump("third");
            if (distance === 3) bump("fourth");
          }
          lastPitch.set(voice, fresh[0].pitch);
        }
        if (event.articulation?.touch) {
          bump("touch");
          add(marks, event.articulation.touch);
        }
        if (event.articulation?.emphasis) {
          bump("emphasis");
          add(marks, event.articulation.emphasis);
        }
        if (event.slur?.index === 0) {
          bump("slur");
          if (event.slur.style === "portato") bump("portato");
        }
        if (fresh.length && fresh.length < heads.length) bump("partial");
        for (const head of heads) {
          const registers = hands[head.hand];
          registers.lowest = Math.min(registers.lowest, head.midi);
          registers.highest = Math.max(registers.highest, head.midi);
          registers.pitches.add(head.midi);
          if (head.tie?.index) continue;
          if (head.fingering) bump(head.fingering.technique);
          if (head.substitution) bump("substitution");
          if (head.tie) {
            bump("tie");
            if (head.tie.pattern === "carry") {
              bump("carry");
              const release = head.lifetime!.releaseTick;
              if (release > end + measure * p.config.notation.phraseBars)
                bump("longCarry");
            }
          }
          if (
            !positions.get(event.positionId)?.pitches.includes(head.pitch) &&
            !head.fingering
          )
            bump("chromatic");
          const hold = head.lifetime?.durationTicks ?? event.duration;
          longestHold = Math.max(longestHold, hold / TPQ);
          occupied.push({
            hand: event.hand,
            voice: event.voiceId ?? `${event.hand}:main`,
            start,
            end: start + (event.articulation?.timing?.ticks ?? hold),
          });
        }
      }
      groups += grouped.size;
      if (p.config.hands.active === "both")
        for (const pair of grouped.values()) if (pair.size === 1) bump("async");
      for (const movement of p.movements) {
        const distance = Math.abs(movement.distance);
        totalDistance += distance;
        distanceMax = Math.max(distanceMax, distance);
        bump(
          movement.technique === "lifted-wide-leap"
            ? "wide"
            : movement.technique === "lift-and-reposition"
              ? "shift"
              : movement.technique,
        );
      }
      for (const group of p.final.articulation?.groups ?? []) {
        if (group.members[0].start >= p.initial.bar * measure)
          bump("crossSlur");
      }
      // Sort releases before same-tick attacks to measure simultaneous contact.
      const edges = occupied
        .flatMap(({ hand, voice, start, end }) => [
          { hand, voice, tick: start, delta: 1 },
          { hand, voice, tick: end, delta: -1 },
        ])
        .sort((a, b) => a.tick - b.tick || a.delta - b.delta);
      const held = { left: 0, right: 0 };
      const lanes = {
        left: new Map<string, number>(),
        right: new Map<string, number>(),
      };
      let overlapped = false;
      for (const edge of edges) {
        held[edge.hand] += edge.delta;
        const active = lanes[edge.hand];
        const count = (active.get(edge.voice) ?? 0) + edge.delta;
        if (count) active.set(edge.voice, count);
        else active.delete(edge.voice);
        if (edge.delta < 0 || edge.tick >= end) continue;
        overlapped ||= active.size > 1;
        peak = Math.max(peak, held.left + held.right);
        peakHand = Math.max(peakHand, held.left, held.right);
      }
      if (overlapped) bump("polyphony");
      for (const feature of seen)
        featurePhrases[feature] = (featurePhrases[feature] ?? 0) + 1;
    },
    result() {
      return {
        phrases,
        attacks,
        groups,
        offbeats,
        rests,
        beats,
        longestHold,
        peak,
        peakHand,
        totalDistance,
        distanceMax,
        features,
        featurePhrases,
        intervals,
        durations,
        chords,
        marks,
        hands: { right: summarize(hands.right), left: summarize(hands.left) },
      };
    },
  };
}
