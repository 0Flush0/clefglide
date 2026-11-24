import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Provide the audit directory and output CSV path.");

const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = (values) => values.map(quote).join(",");
const pitches = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
const pitch = (midi) => `${pitches[midi % 12]}${Math.floor(midi / 12) - 1}`;
const band = (min, max) => `${pitch(min)}–${pitch(max)}`;
const counts = (entries) =>
  Object.entries(entries)
    .map(([name, n]) => `${name}=${n}`)
    .join(" ");
const rows = [
  csv([
    "track",
    "id",
    "level",
    "stage",
    "title",
    "focus",
    "default BPM",
    "suggested BPM",
    "key",
    "meter",
    "configured ranges",
    "observed ranges and distinct pitches",
    "melodic caps (scale steps)",
    "hand rhythm weights (480 ticks/beat)",
    "register coverage",
    "phrases",
    "exhaustions",
    "other failures",
    "attack events",
    "onset groups per minute",
    "offbeat attacks",
    "rest beats across lanes",
    "max lift or shift distance (scale steps)",
    "total movement distance (scale steps)",
    "max hold (beats)",
    "peak simultaneous keys",
    "peak keys in one hand",
    "absolute intervals (scale steps)",
    "attack glyph durations",
    "new attacks by chord size",
    "articulation marks",
    "feature events",
    "phrases with feature",
  ]),
];
for (const track of ["left", "right", "both"]) {
  const result = JSON.parse(readFileSync(join(input, `${track}.json`), "utf8"));
  for (const row of result) {
    const hands = (text) =>
      row.registers
        .map((register) => `${register.hand} ${text(register)}`)
        .join("; ");
    rows.push(
      csv([
        track,
        row.id,
        row.level,
        row.stage,
        row.title,
        row.description,
        row.bpm,
        row.tempo.join("–"),
        row.key,
        `${row.meter}/4`,
        hands(({ band: range }) => band(range.min, range.max)),
        hands(
          ({ observed }) =>
            `${band(observed.lowest, observed.highest)} (${observed.pitches} pitches)`,
        ),
        hands(({ melody }) => melody),
        hands(({ rhythm }) =>
          rhythm.map(({ value, weight }) => `${value}=${weight}`).join(" "),
        ),
        hands(({ coverage }) => coverage),
        row.phrases,
        row.exhausted,
        row.failed,
        row.attacks,
        ((row.groups * row.bpm) / row.beats).toFixed(1),
        row.offbeats,
        row.rests,
        row.distanceMax,
        row.totalDistance,
        row.longestHold,
        row.peak,
        row.peakHand,
        counts(row.intervals),
        counts(row.durations),
        counts(row.chords),
        counts(row.marks),
        counts(row.features),
        counts(row.featurePhrases),
      ]),
    );
  }
}
writeFileSync(output, rows.join("\n") + "\n");
