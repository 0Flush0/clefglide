import { Note } from "tonal";
import { configForHand } from "./config/handParameters";
import {
  TPQ,
  type Hand,
  type HandState,
  type StreamState,
  type VoiceLeapPreparation,
} from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import { separated, spacingSignature } from "./positionMaps";
import { random } from "./random";
import { voiceAllows, voiceSpecs } from "./voiceConfig";
import { wideLandingOptions } from "./wideLeaps";
import { smallRestBeats } from "./rhythm";

export type VoicePreparation = VoiceLeapPreparation & { hand: Hand };

/** Reserve only sampled hand-local opportunities. Committed ties own their keys first. */
export function planVoicePreparation(
  c: ValidatedGeneratorConfig,
  state: StreamState,
  available: Map<Hand, HandState[]>,
): VoicePreparation[] {
  const wide = c.wideLeaps;
  if (
    !c.handParameters &&
    (wide.kind !== "lifted-wide" || wide.probability === 0)
  )
    return [];
  const specs = voiceSpecs(c);
  const measure = c.notation.beats * TPQ;
  const start = state.bar * measure;
  const end = start + c.notation.phraseBars * measure;
  const windows: VoicePreparation[] = state.hands.flatMap(({ hand }) => {
    const window = state.independentVoices?.leapPreparations?.[hand];
    return window ? [{ ...window, hand }] : [];
  });
  const keepsActivityPossible = (candidate: VoicePreparation) => {
    const local = configForHand(c, candidate.hand);
    const voiceWindows = [
      ...windows.filter((w) => w.hand === candidate.hand),
      candidate,
    ];
    return [start, end].every((phraseStart) =>
      specs
        .filter(
          ({ hand, id, profile }) =>
            hand === candidate.hand &&
            (phraseStart === start
              ? state.independentVoices!.voices[id].active
              : profile.entryProbability > 0),
        )
        .every(({ id, durations, profile }) => {
          const unit = Math.min(...durations.map((d) => d.value));
          const ties = local.notation.ties;
          const attackUnit =
            ties !== false &&
            ties.probability > 0 &&
            ties.voices.some((voice) => voice === id) &&
            ties.patterns.some((p) => p.value === "subdivide") &&
            (ties.chordTones === "any" || ties.chordTones === "outer") &&
            profile.chords &&
            local.chords.kind === "voicings" &&
            local.chords.probability > 0
              ? Math.min(unit, ...ties.subdivisions)
              : unit;
          let sounded = 0,
            attacks = 0;
          for (let bar = 0; bar < c.notation.phraseBars; bar++) {
            const barTick = phraseStart + bar * measure;
            const budget = Math.min(
              measure - smallRestBeats(local, bar) * TPQ,
              ...voiceWindows
                .filter(
                  (w) =>
                    w.landingTick > barTick && w.cueTick < barTick + measure,
                )
                .map((w) => Math.max(0, w.cueTick - barTick)),
            );
            sounded += Math.floor(budget / unit) * unit;
            attacks += Math.floor(budget / attackUnit);
          }
          return (
            sounded >= profile.minSoundedTicks &&
            attacks >= profile.minAttacksPerPhrase
          );
        }),
    );
  };
  for (const phraseStart of [start, end]) {
    const bars = [
      ...new Set(
        state.hands.flatMap(({ hand }) => {
          const wide = configForHand(c, hand).wideLeaps;
          return wide.kind === "lifted-wide" && wide.probability > 0
            ? wide.eligibleBars
            : [];
        }),
      ),
    ].sort((a, b) => a - b);
    for (const bar of bars) {
      const landingTick = phraseStart + bar * measure;
      for (const h of state.hands) {
        const { hand } = h;
        const local = configForHand(c, hand);
        const wide = local.wideLeaps;
        if (
          wide.kind !== "lifted-wide" ||
          wide.probability === 0 ||
          !wide.eligibleBars.includes(bar)
        )
          continue;
        const cueTick = landingTick - wide.preparationBeats * TPQ;
        if (cueTick < start || cueTick >= end) continue;
        const candidate = { hand, cueTick, landingTick };
        const main = specs.find((spec) => spec.hand === hand)!;
        if (
          random(state) >= wide.probability ||
          main.profile.activity === 0 ||
          main.profile.entryProbability === 0 ||
          (phraseStart === start &&
            !state.independentVoices!.voices[main.id].active) ||
          !main.durations.some(
            (d) => d.value <= measure - smallRestBeats(local, bar) * TPQ,
          ) ||
          windows.some(
            (w) =>
              w.hand === hand &&
              w.landingTick >= cueTick &&
              w.cueTick <= landingTick,
          ) ||
          !keepsActivityPossible(candidate) ||
          state.activeLifetimes?.some(
            (n) =>
              n.hand === hand &&
              n.lifetime.onsetTick < landingTick &&
              n.lifetime.keyHold.kind === "required" &&
              n.lifetime.keyHold.releaseTick > cueTick,
          )
        )
          continue;
        const positions = available
          .get(hand)!
          .filter((p) => spacingSignature(p) === spacingSignature(h));
        const opposite = state.hands.find((p) => p.hand !== hand);
        if (
          positions.some((from) =>
            wideLandingOptions(local, from, positions).some(({ to, index }) => {
              const midi = Note.midi(to.pitches[index])!;
              return (
                voiceAllows(
                  main.profile,
                  midi,
                  to.fingerToMidi.indexOf(midi) + 1,
                ) &&
                (!opposite ||
                  available
                    .get(opposite.hand)!
                    .some(
                      (other) => separated(from, other) && separated(to, other),
                    ))
              );
            }),
          )
        )
          windows.push(candidate);
      }
    }
  }
  return windows;
}
