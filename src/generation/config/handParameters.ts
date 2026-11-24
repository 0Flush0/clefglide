import type { Hand } from "../../score/model";
import type { ValidatedGeneratorConfig } from "./schema";

const effective = new WeakMap<
  ValidatedGeneratorConfig,
  Partial<Record<Hand, ValidatedGeneratorConfig>>
>();

/** Resolve only the musical modules scoped to this hand. Coordination stays shared. */
export function configForHand(
  c: ValidatedGeneratorConfig,
  hand: Hand,
): ValidatedGeneratorConfig {
  const overrides = c.handParameters?.[hand];
  if (!overrides) return c;
  const pair = effective.get(c) ?? {};
  effective.set(c, pair);
  // Each effective module has already passed the configuration schema for this hand.
  const { dynamicFingering, ties, articulation, ...modules } = overrides;
  return (pair[hand] ??= Object.freeze({
    ...c,
    ...modules,
    articulation:
      articulation === false ? undefined : (articulation ?? c.articulation),
    notation:
      ties === undefined ? c.notation : Object.freeze({ ...c.notation, ties }),
    dynamicFingering:
      dynamicFingering === false
        ? undefined
        : (dynamicFingering ?? c.dynamicFingering),
  }) as ValidatedGeneratorConfig);
}

export function hasArticulation(c: ValidatedGeneratorConfig | undefined) {
  return (
    !!c && activeHands(c).some((hand) => !!configForHand(c, hand).articulation)
  );
}

export function hasTies(c: ValidatedGeneratorConfig | undefined) {
  return (
    !!c &&
    activeHands(c).some(
      (hand) => configForHand(c, hand).notation.ties !== false,
    )
  );
}

export function fingeringPolicies(c: ValidatedGeneratorConfig) {
  return activeHands(c).flatMap((hand) => {
    const policy = configForHand(c, hand).dynamicFingering;
    return policy ? [policy] : [];
  });
}

export function planningTempo(c: ValidatedGeneratorConfig) {
  return (
    c.dynamicFingering ||
    c.handParameters?.right?.dynamicFingering ||
    c.handParameters?.left?.dynamicFingering ||
    undefined
  )?.tempoBpm;
}

export function withPlanningTempo(
  c: ValidatedGeneratorConfig,
  tempoBpm: number,
) {
  const update = (
    policy: ValidatedGeneratorConfig["dynamicFingering"] | false,
  ) => (policy ? { ...policy, tempoBpm } : policy);
  const parameters = c.handParameters;
  return {
    ...c,
    dynamicFingering: update(c.dynamicFingering),
    ...(parameters && {
      handParameters: Object.fromEntries(
        Object.entries(parameters).map(([hand, modules]) => [
          hand,
          {
            ...modules,
            dynamicFingering: update(modules.dynamicFingering),
          },
        ]),
      ),
    }),
  };
}

export function activeHands(
  c: Pick<ValidatedGeneratorConfig, "hands">,
): readonly Hand[] {
  return c.hands.active === "both" ? ["right", "left"] : [c.hands.active];
}
