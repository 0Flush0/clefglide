import { Note } from "tonal";
import { TPQ, type HandState } from "../score/model";
import type { ValidatedGeneratorConfig } from "./config";
import {
  continuousPreparation,
  permitsAlternateContact,
  permitsContinuousContact,
  permitsSubstitutionContact,
  preparationTicks,
  supportsContact,
} from "./fingeringGeometry";
import { diatonicIndex, separated } from "./positionMaps";
import { smallRestBeats } from "./rhythm";
import { voiceAllows, voiceSpecs } from "./voiceConfig";
import { wideRestBeats } from "./wideLeaps";

export class GeneratorContextInfeasibleError extends Error {
  constructor(message: string) {
    super(`Infeasible generator context: ${message}`);
    this.name = "GeneratorContextInfeasibleError";
  }
}

/** Necessary checks only. A stochastic phrase may have no suitable opportunity. */
export function dynamicFeasibility(
  c: ValidatedGeneratorConfig,
  positions: HandState[][],
) {
  const policy = c.dynamicFingering;
  if (!policy) return [];
  const bpm = policy.tempoBpm;
  const specs = voiceSpecs(c);
  const rest = Math.max(
    ...Array.from(
      { length: c.notation.phraseBars },
      (_, b) => Math.max(smallRestBeats(c, b), wideRestBeats(c, b)) * TPQ,
    ),
  );
  const contact = (pos: HandState, finger: number) => {
    const midi = pos.fingerToMidi[finger - 1];
    return {
      midi,
      finger,
      pitch: pos.pitches.find((p) => Note.midi(p) === midi)!,
    };
  };
  return policy.techniques.flatMap((rule) => {
    const possible = positions.some((list, index) =>
      list.some((from) => {
        const profiles = specs.filter(
          (v) =>
            v.hand === from.hand &&
            (rule.technique === "substitution" || v.id.endsWith(":main")) &&
            v.profile.activity > 0 &&
            v.profile.entryProbability > 0,
        );
        if (c.independentVoices && !profiles.length) return false;
        return (profiles.length ? profiles : [undefined]).some((voice) => {
          const duration = Math.max(
            ...(voice?.durations ?? c.rhythm.durations).map((d) => d.value),
          );
          const accepts = (n: { midi: number; finger: number }) =>
            !voice || voiceAllows(voice.profile, n.midi, n.finger);
          const limit =
            voice?.profile.maxIntervalSteps ?? c.melody.maxIntervalSteps;
          const melodic = (
            a: ReturnType<typeof contact>,
            b: ReturnType<typeof contact>,
          ) =>
            Math.abs(diatonicIndex(a.pitch) - diatonicIndex(b.pitch)) <= limit;
          if (rule.technique === "substitution") {
            const transfer =
              preparationTicks(Math.max(80, rule.minimumPreparationMs), bpm) +
              preparationTicks(rule.transferMs, bpm);
            const tie = c.notation.ties;
            const availableHold =
              rule.allowTies &&
              tie !== false &&
              tie.probability > 0 &&
              tie.voices.some((id) => id === (voice?.id ?? `${from.hand}:main`))
                ? Math.max(duration, tie.maxDurationTicks)
                : duration;
            return (
              availableHold > transfer &&
              rule.fingerPairs.some(([a, b]) => {
                const start = contact(from, a);
                return (
                  accepts(start) &&
                  accepts({ midi: start.midi, finger: b }) &&
                  permitsSubstitutionContact(rule, from, start, b)
                );
              })
            );
          }
          if ("maxPositionSteps" in rule)
            return (
              duration >= continuousPreparation(rule, bpm) &&
              list.some(
                (to) =>
                  Math.abs(
                    diatonicIndex(to.pitches[0]) -
                      diatonicIndex(from.pitches[0]),
                  ) <= rule.maxPositionSteps &&
                  (positions.length === 1 ||
                    positions[1 - index].some(
                      (other) => separated(from, other) && separated(to, other),
                    )) &&
                  rule.fingerPairs.some(([a, b]) => {
                    const source = contact(from, a),
                      landing = contact(to, b);
                    return (
                      accepts(source) &&
                      accepts(landing) &&
                      melodic(source, landing) &&
                      permitsContinuousContact(rule, from, to, source, landing)
                    );
                  }),
              )
            );
          const prep = preparationTicks(
            Math.max(
              rule.minimumPreparationMs,
              rule.technique === "adjacent-reach" ? 100 : 0,
            ),
            bpm,
          );
          if (
            rule.technique === "rested-alternate"
              ? !c.independentVoices &&
                rest < Math.max(prep, rule.minimumRestTicks)
              : duration < prep
          )
            return false;
          return rule.fingerPairs.some(([a, b]) => {
            const scaleKey = contact(from, a);
            const landing = { ...scaleKey, finger: b };
            return (
              accepts(landing) &&
              permitsAlternateContact(rule, from, scaleKey.midi, a, b) &&
              (rule.technique === "rested-alternate" ||
                [1, 2, 3, 4, 5].some((finger) => {
                  const source = contact(from, finger);
                  return (
                    accepts(source) &&
                    melodic(source, landing) &&
                    supportsContact(from.hand, landing, source)
                  );
                }))
            );
          });
        });
      }),
    );
    return possible
      ? []
      : [
          `${rule.technique}: no modeled opportunity fits the configured positions, fingers, register, rhythm and tempo.`,
        ];
  });
}
