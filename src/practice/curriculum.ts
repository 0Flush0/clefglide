import {
  generatorDefaults,
  normalizeGeneratorConfig,
  type GeneratorConfig,
} from "../generation/config";
import { duetStages } from "./curriculumDuet";
import { singleHandStages } from "./curriculumSingle";
import { duetGerman, singleGerman } from "./curriculumGerman";
import type { Feature, HandScope, Stage } from "./curriculumRecipe";
import type { Language } from "../shared/i18n";

export type { HandScope } from "./curriculumRecipe";
export const curriculumVersion = 2;

export type GuidedLevel = {
  id: string;
  hand: HandScope;
  version: number;
  title: string;
  description: string;
  german: readonly [title: string, description: string];
  tempo: readonly [number, number];
  bpm: number;
  stageId: string;
  stage: string;
  stageNumber: number;
  levelNumber: number;
  recipe: GeneratorConfig;
  evidence: readonly Feature[];
};

function track(hand: HandScope, stages: readonly Stage[]) {
  let recipe = structuredClone(generatorDefaults);
  recipe.hands.active = hand;
  let levelNumber = 0;
  return stages.flatMap(({ id: stageId, title: stage, studies }, stageIndex) =>
    studies.map(
      ([id, title, description, bpm, edit, evidence]): GuidedLevel => {
        recipe = structuredClone(recipe);
        edit(recipe);
        const policy = recipe.dynamicFingering;
        if (policy) policy.tempoBpm = bpm;
        for (const local of Object.values(recipe.handParameters ?? {})) {
          if (local.dynamicFingering) local.dynamicFingering.tempoBpm = bpm;
        }
        return {
          id: `${hand}-${id}`,
          hand,
          version: curriculumVersion,
          stageId,
          stage,
          stageNumber: stageIndex + 1,
          levelNumber: ++levelNumber,
          title,
          description,
          german: (hand === "both" ? duetGerman : singleGerman)[id],
          tempo: [Math.max(38, bpm - 8), bpm + 8],
          bpm,
          recipe,
          evidence:
            typeof evidence === "string" ? [evidence] : (evidence ?? []),
        };
      },
    ),
  );
}

const stages = {
  left: singleHandStages("left"),
  right: singleHandStages("right"),
  both: duetStages,
};
export const curriculum = {
  left: track("left", stages.left),
  right: track("right", stages.right),
  both: track("both", stages.both),
};
export const curriculumStages = {
  left: stages.left.map(({ id, title, objective }) => ({
    id,
    title,
    objective,
  })),
  right: stages.right.map(({ id, title, objective }) => ({
    id,
    title,
    objective,
  })),
  both: stages.both.map(({ id, title, objective }) => ({
    id,
    title,
    objective,
  })),
};
export type LevelIdentity = Pick<GuidedLevel, "id" | "version">;
const index = new Map(
  Object.values(curriculum)
    .flat()
    .map((level) => [level.id, level]),
);

export function currentGuidedLevel(identity: LevelIdentity | undefined) {
  return identity?.version === curriculumVersion
    ? index.get(identity.id)
    : undefined;
}

/** The same IDs designate corresponding topics in v1. The score stored with
 * each historical session remains the authority for replay and fingerprints. */
export function migratedGuidedLevel(identity: LevelIdentity | undefined) {
  return identity?.version === 1 ? index.get(identity.id) : undefined;
}

const oldSingle = [
  "read",
  "skip",
  "eighths",
  "ties",
  "dyads",
  "touch",
  "shift",
];
const oldDuet = [
  "pulse",
  "shared-rhythm",
  "bass-pulse",
  "treble-thirds",
  "moving-treble",
  "held-bass",
];
export function guidedHistoryLabel(
  identity: LevelIdentity | undefined,
  language: Language,
) {
  const current = currentGuidedLevel(identity);
  const level = current ?? migratedGuidedLevel(identity);
  if (!level) return;
  const order = level.hand === "both" ? oldDuet : oldSingle;
  const levelNumber =
    current?.levelNumber ??
    order.indexOf(level.id.slice(level.hand.length + 1)) + 1;
  return levelNumber
    ? { title: language === "de" ? level.german[0] : level.title, levelNumber }
    : undefined;
}

export function guidedRecipe(level: GuidedLevel) {
  return normalizeGeneratorConfig(level.recipe);
}
