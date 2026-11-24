import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import {
  generateConfigured,
  resolveGeneratorConfig,
  type ValidatedGeneratorConfig,
} from "../src/generation";
import {
  articulatedStudy,
  dynamicFingeringExample,
  movingTrebleWithHeldBass,
} from "../src/generation/examples";
import { isContinuousMovement, noteheads, TPQ } from "../src/score/model";
import { stageConfiguration } from "./fixtures/configuredPractice";

function stream(config: ValidatedGeneratorConfig, seed: string, count: number) {
  const phrases = [generateConfigured(config, seed)];
  while (phrases.length < count)
    phrases.push(generateConfigured(config, seed, phrases.at(-1)!.final));
  return phrases;
}

type Edge = { midi: number; down: boolean };
async function virtualMidi(page: Page, edges: Edge[]) {
  await page.evaluate((batch) => {
    for (const { midi, down } of batch) {
      const key = document.querySelector<HTMLButtonElement>(
        `[data-midi="${midi}"]`,
      );
      if (!key || key.disabled)
        throw new Error(`Virtual key ${midi} is unavailable.`);
      key.dispatchEvent(
        new PointerEvent(down ? "pointerdown" : "pointerup", { bubbles: true }),
      );
    }
  }, edges);
}

async function loadPractice(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    // Synthetic pointer events use the normal piano handlers without a captured pointer.
    HTMLElement.prototype.setPointerCapture = () => {};
  });
  const date = new Date("2026-11-01T10:00:00Z");
  await page.clock.install({ time: date });
  await page.clock.pauseAt(date.getTime() + 1000);
  await page.goto("/");
  await page.locator(".piano-card summary").click();
  return errors;
}

async function finishAndExport(page: Page) {
  await page.getByRole("button", { name: "Save & finish" }).click();
  await expect(page.locator(".session")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const file = await download;
  return JSON.parse(await readFile(await file.path(), "utf8")).sessions[0];
}

test("timed practice streams independent voices, wide leaps and tied bass holds through real scoring", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = await loadPractice(page);
  const config = movingTrebleWithHeldBass();
  const seed = Array.from(
    { length: 20 },
    (_, index) => `held-bass-${index}`,
  ).find((candidate) => {
    const [first, second] = stream(config, candidate, 2);
    return (
      first.movements.some((move) => move.technique === "lifted-wide-leap") &&
      second.events.some(
        (event) =>
          event.bar === 4 &&
          noteheads(event).some((head) => (head.tie?.index ?? 0) > 0),
      )
    );
  });
  expect(seed).toBeDefined();
  const phrases = stream(config, seed!, 3);
  await stageConfiguration(page, config, seed!);
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByLabel("Scoring mode").selectOption("timed");
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await expect(page.getByTestId("notation").locator("svg")).toHaveAttribute(
    "data-staff-count",
    "2",
  );
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();

  const trace = new Map<number, Edge[]>();
  const attacks = new Map<number, number[]>();
  const attackIds: string[] = [];
  const add = (tick: number, edge: Edge) =>
    trace.set(tick, [...(trace.get(tick) ?? []), edge]);
  const cutoffTick = 9 * config.notation.beats * TPQ;
  for (const event of phrases.flatMap((phrase) => phrase.events)) {
    for (const head of noteheads(event)) {
      const lifetime = head.lifetime!;
      if (event.bar >= 9 || (head.tie?.index ?? 0) > 0) continue;
      attackIds.push(head.id);
      attacks.set(lifetime.onsetTick, [
        ...(attacks.get(lifetime.onsetTick) ?? []),
        head.midi,
      ]);
      add(lifetime.onsetTick, { midi: head.midi, down: true });
      if (lifetime.releaseTick <= cutoffTick)
        add(lifetime.releaseTick, { midi: head.midi, down: false });
    }
  }
  let previousMs = -config.notation.beats * 1000;
  let sawCarry = false;
  let sawWideCue = false;
  for (const [tick, edges] of [...trace].sort(([a], [b]) => a - b)) {
    const ms = (tick * 1000) / TPQ;
    await page.clock.fastForward(ms - previousMs);
    previousMs = ms;
    const pitches = attacks.get(tick);
    if (pitches) {
      const rendered = await page
        .getByTestId("target")
        .getAttribute("data-pitches");
      expect(
        rendered!
          .split(",")
          .map(Number)
          .sort((a, b) => a - b),
      ).toEqual(pitches.sort((a, b) => a - b));
    }
    sawCarry ||=
      tick >= 3 * config.notation.beats * TPQ &&
      (await page.locator(".vf-stavetie").count()) > 0;
    sawWideCue ||= /Wide leap/i.test(
      (await page.getByTestId("placement-plan").textContent()) ?? "",
    );
    await virtualMidi(
      page,
      edges.sort((a, b) => Number(a.down) - Number(b.down)),
    );
  }
  expect(sawCarry).toBe(true);
  expect(sawWideCue).toBe(true);
  expect(
    Number(await page.getByTestId("target").getAttribute("data-bar")),
  ).toBeGreaterThanOrEqual(9);
  const saved = await finishAndExport(page);
  expect(saved.setup.config).toEqual(config);
  expect(
    saved.results
      .map((outcome: { id: string; kind: string }) => {
        expect(outcome.kind).toBe("correct");
        return outcome.id;
      })
      .sort(),
  ).toEqual(attackIds.sort());
  expect(
    saved.durationResults.filter(
      (result: { status: string }) => result.status === "correct",
    ).length,
  ).toBeGreaterThan(10);
  const carried = phrases[1].events
    .filter((event) => event.bar === 4)
    .flatMap(noteheads)
    .flatMap((head) => (head.tie?.index ? [head.tie.lifetimeId] : []));
  expect(carried.length).toBeGreaterThan(0);
  for (const id of carried) {
    expect(saved.durationResults).toContainEqual(
      expect.objectContaining({
        id,
        status: "correct",
        physical: expect.objectContaining({ status: "correct" }),
      }),
    );
  }
  expect(errors).toEqual([]);
});

test("custom dynamic fingering and articulation survive streaming, hints, replay and profile switches", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = await loadPractice(page);
  const config = resolveGeneratorConfig(
    {
      noteLifetimes: {
        kind: "explicit",
        keyHold: "required",
        evaluation: { kind: "disabled" },
      },
      articulation: {
        ...articulatedStudy().articulation!,
        emphasisProbability: 0.55,
      },
    },
    dynamicFingeringExample(["thumb-under", "finger-over"]),
  );
  const seed = Array.from(
    { length: 20 },
    (_, index) => `touch-study-${index}`,
  ).find((candidate) => {
    const [first] = stream(config, candidate, 1);
    return (
      first.events.some(
        (event) => event.bar < 2 && event.articulation?.emphasis,
      ) &&
      first.movements.some(
        (move) => isContinuousMovement(move) && move.landingTick < 8 * TPQ,
      )
    );
  });
  expect(seed).toBeDefined();
  await stageConfiguration(page, config, seed!);
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await expect(
    page.getByRole("slider", { name: "Tempo", exact: true }),
  ).toHaveValue("72");
  await expect(page.getByTestId("notation").locator("svg")).toContainText(
    /[\uE4A0-\uE4AD]/u,
  );
  await expect(page.getByTestId("placement-plan")).toContainText(
    /thumb under|finger over/i,
  );

  const before = await page.getByTestId("target").getAttribute("data-pitches");
  await page.getByLabel("Fingering assistance").selectOption("hidden");
  await expect(page.getByTestId("target")).toHaveAttribute(
    "data-pitches",
    before!,
  );
  await page.getByLabel("Fingering assistance").selectOption("smart");
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  let played = 0;
  for (; played < 40; played++) {
    const target = page.getByTestId("target");
    if (Number(await target.getAttribute("data-bar")) >= 9) break;
    const midi = Number(await target.getAttribute("data-pitches"));
    await page.clock.fastForward(300);
    await virtualMidi(page, [
      { midi, down: true },
      { midi, down: false },
    ]);
  }
  expect(
    Number(await page.getByTestId("target").getAttribute("data-bar")),
  ).toBeGreaterThanOrEqual(9);
  const saved = await finishAndExport(page);
  expect(saved.generatorVersion).toBe("12.0.1");
  expect(saved.results).toHaveLength(played);
  expect(
    saved.results.every(
      (result: { kind: string }) => result.kind === "correct",
    ),
  ).toBe(true);
  expect(
    saved.articulationResults.some(
      (result: { dimension: string; status: string }) =>
        result.dimension === "velocity" &&
        ["low", "correct", "high"].includes(result.status),
    ),
  ).toBe(true);

  await page.locator(".session summary").click();
  await page.getByRole("button", { name: "Replay seed" }).click();
  await expect(page.getByTestId("target")).toHaveAttribute(
    "data-pitches",
    before!,
  );
  await page.getByText("Advanced settings", { exact: true }).click();
  await page.getByLabel("Scoring mode").selectOption("benchmark");
  await page.getByLabel("Practice profile").selectOption("guided");
  await expect(page.getByLabel("Scoring mode")).toHaveValue("benchmark");
  await page.getByRole("button", { name: "Apply & generate" }).click();
  await expect(page.getByRole("button", { name: "Reveal hint" })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByLabel("Practice profile")).toHaveValue("guided");
  await page.getByLabel("Practice profile").selectOption("custom");
  await page.getByText("Generator parameters", { exact: true }).click();
  expect(
    JSON.parse(await page.getByLabel("GeneratorConfig JSON").inputValue()),
  ).toEqual(config);
  await page.getByText("Advanced settings", { exact: true }).click();
  await expect(page.getByLabel("Scoring mode")).toHaveValue("benchmark");
  expect(errors).toEqual([]);
});
