import { writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  generateConfigured,
  inspectGeneratorFeasibility,
  validateGeneratedPhrase,
  type GeneratedPhrase,
} from "../generation";
import { curriculum, guidedRecipe } from "./curriculum";
import { curriculumAudit } from "./curriculumAudit";
import { Scorer } from "../scoring/engine";
import { defaults } from "../score/model";
import { configForHand } from "../generation/config/handParameters";

for (const [scope, levels] of Object.entries(curriculum)) {
  test(`validates and measures the complete ${scope} Guided track`, () => {
    const issues: string[] = [];
    const recipes = new Set<string>();
    expect(new Set(levels.map(({ id }) => id)).size).toBe(levels.length);
    const rows = levels.map((level) => {
      expect(level.german, level.id).toHaveLength(2);
      const audit = curriculumAudit();
      const mastery = level.stageId === "mastery";
      const attempts = mastery ? 8 : 4;
      const chunks = mastery ? 12 : 6;
      let exhausted = 0;
      let failed = 0;
      let config: ReturnType<typeof guidedRecipe> | undefined;
      try {
        config = guidedRecipe(level);
        const identity = JSON.stringify([level.bpm, config]);
        if (recipes.has(identity))
          issues.push(
            `${level.id} duplicates an earlier exercise recipe and tempo`,
          );
        recipes.add(identity);
        const errors = inspectGeneratorFeasibility(config).errors;
        if (errors.length) throw new Error(errors.join(" "));
        for (let index = 0; index < attempts; index++) {
          const seed = `guided-v2-${index}`;
          let previous: GeneratedPhrase | undefined;
          let scorer: Scorer | undefined;
          for (let chunk = 0; chunk < chunks; chunk++) {
            try {
              const phrase = generateConfigured(config, seed, previous?.final);
              const problems = validateGeneratedPhrase(phrase, previous);
              if (problems.length) throw new Error(problems.join(" "));
              if (mastery) {
                const notes = phrase.events.filter(
                  (event) => event.kind === "note",
                );
                if (scorer) scorer.appendNotes(notes);
                else
                  scorer = new Scorer(
                    notes,
                    {
                      ...defaults,
                      beats: config.notation.beats,
                      bpm: level.bpm,
                      mode: "timed",
                    },
                    120,
                    config,
                  );
              }
              audit.add(phrase);
              previous = phrase;
            } catch (err) {
              if (
                err instanceof Error &&
                err.name === "GeneratorSearchExhaustedError"
              )
                exhausted++;
              else failed++;
              if (exhausted + failed <= 2)
                issues.push(`${level.id} ${seed} chunk ${chunk}: ${err}`);
              break;
            }
          }
        }
      } catch (error) {
        failed++;
        issues.push(`${level.id}: ${error}`);
      }
      const result = audit.result();
      for (const feature of level.evidence) {
        const frequency = result.featurePhrases[feature] ?? 0;
        if (frequency < (mastery ? 8 : 2))
          issues.push(
            `${level.id} ${feature} occurred in ${frequency} of ${result.phrases} phrases`,
          );
      }
      const hands = (
        level.hand === "both" ? (["left", "right"] as const) : [level.hand]
      ).map((hand) => {
        const local = config && configForHand(config, hand);
        return {
          hand,
          band: level.recipe.hands[hand],
          melody: local?.melody.maxIntervalSteps,
          rhythm: local?.rhythm.durations,
          coverage: local?.coverage.kind,
          observed: result.hands[hand],
        };
      });
      return {
        id: level.id,
        level: level.levelNumber,
        stage: level.stageId,
        title: level.title,
        description: level.description,
        tempo: level.tempo,
        bpm: level.bpm,
        key: level.recipe.notation.key,
        meter: level.recipe.notation.beats,
        attempted: attempts * chunks,
        exhausted,
        failed,
        ...result,
        registers: hands,
      };
    });
    const attackRate = (row: (typeof rows)[number]) =>
      (row.groups * row.bpm) / row.beats;
    for (let i = 1; i < rows.length; i++) {
      const ratio = attackRate(rows[i]) / attackRate(rows[i - 1]);
      if (ratio > 1.35)
        issues.push(
          `${rows[i].id} increases sampled onset groups per minute by ${Math.round((ratio - 1) * 100)}%`,
        );
    }
    const start = rows[0];
    expect(start.intervals["2"]).toBe(0);
    expect(start.offbeats).toBe(0);
    expect(rows[1].intervals["0"]).toBeLessThan(start.intervals["0"]);
    if (scope === "both") {
      const bassPulse = rows.find((row) => row.id === "both-bass-pulse")!;
      const bassLeads = rows.find((row) => row.id === "both-left-leads")!;
      expect(bassPulse.hands.right.attacks).toBe(
        2 * bassPulse.hands.left.attacks,
      );
      expect(bassLeads.hands.left.attacks).toBe(
        2 * bassLeads.hands.right.attacks,
      );
    } else {
      const eighths = rows.slice(10, 13);
      expect(eighths[1].offbeats / eighths[1].attacks).toBeGreaterThan(
        eighths[0].offbeats / eighths[0].attacks,
      );
      expect(eighths[2].offbeats / eighths[2].attacks).toBeGreaterThan(
        eighths[1].offbeats / eighths[1].attacks,
      );
      const hand = scope === "left" ? "left" : "right";
      const concert = rows.at(-1)!.hands[hand];
      expect(concert.highest - concert.lowest).toBeGreaterThanOrEqual(24);
      expect(concert.pitches).toBeGreaterThan(4 * start.hands[hand].pitches);
    }
    if (process.env.GUIDED_REPORT)
      writeFileSync(
        `${process.env.GUIDED_REPORT}/${scope}.json`,
        JSON.stringify(rows, undefined, 2),
      );
    expect(issues, issues.join("\n")).toEqual([]);
  }, 180_000);
}
