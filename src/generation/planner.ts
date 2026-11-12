import { Note, Chord, Scale } from "tonal";
import {
  TPQ,
  VERSION,
  noteheads,
  type Settings,
  type Hand,
  type HandState,
  type Phrase,
  type StreamState,
  type ScoreEvent,
  type MovementPlan,
} from "../score/model";
import { hash, random } from "./random";
import {
  positionsFor,
  separated,
  diatonicIndex,
  movementRules,
  spacingSignature,
} from "./positions";
import { validatePhrase } from "./validator";
import { jumpLevels, spacingLevels } from "./difficulty";
import { inferFingeringHints } from "../score/hints";
import { writtenPitch } from "../score/pitch";
import { chordCandidates } from "./chords";
import {
  planRangeCoverage,
  coverageMoveWeight,
  recordRangeCoverage,
  coveragePhraseShape,
} from "./rangeCoverage";
function positionCenter(h: HandState): number {
  return (Math.min(...h.fingerToMidi) + Math.max(...h.fingerToMidi)) / 2;
}
function choose<T>(items: T[], state: { rng: number }): T {
  return items[Math.floor(random(state) * items.length)];
}
function connectedStart(h: HandState, interval: number): number[] {
  const segments: number[][] = [[]];
  h.pitches.forEach((pitch, i) => {
    if (
      i > 0 &&
      diatonicIndex(pitch) - diatonicIndex(h.pitches[i - 1]) > interval
    )
      segments.push([]);
    segments.at(-1)!.push(i);
  });
  const largest = Math.max(...segments.map((segment) => segment.length));
  return segments.filter((segment) => segment.length === largest).flat();
}
function initialHands(s: Settings, state: { rng: number }): HandState[] {
  const hands: Hand[] = s.hand === "both" ? ["right", "left"] : [s.hand];
  const lists = hands.map((h) => positionsFor(s, h));
  if (lists.some((xs) => !xs.length))
    throw new Error(
      "This range needs five consecutive notes in the chosen major key. Widen the range or change the key.",
    );
  const prefer = (xs: HandState[]) => {
    const spaced = random(state) < spacingLevels[s.fingerSpacing].frequency;
    const selected = xs.filter(
      (p) => (spacingSignature(p) !== "0,1,2,3,4") === spaced,
    );
    return selected.length ? selected : xs;
  };
  if (hands.length === 1)
    return [structuredClone(choose(prefer(lists[0]), state))];
  const pairs = lists[0].flatMap((r) =>
    lists[1].filter((l) => separated(r, l)).map((l) => [r, l]),
  );
  if (!pairs.length)
    throw new Error(
      "Both hands need non-overlapping five-note positions. Lower the LH range or raise the RH range.",
    );
  let compatible = pairs;
  for (let i = 0; i < hands.length; i++) {
    const allowed = new Set(prefer(compatible.map((pair) => pair[i])));
    compatible = compatible.filter((pair) => allowed.has(pair[i]));
  }
  return structuredClone(choose(compatible, state));
}
export function generate(
  s: Settings,
  seed: string,
  previous?: StreamState,
): Phrase {
  const rule = movementRules[s.handMovements];
  if (s.handMovements === "off" && (s.shiftFrequency !== 0 || s.maxShift !== 0))
    throw new Error(
      "Hand movements Off requires zero shift frequency and distance. Choose Easy or above to enable repositioning.",
    );
  if (s.maxShift > rule.distance)
    throw new Error(
      `This level allows repositioning by at most ${rule.distance} scale steps. Reduce maximum repositioning distance or choose a higher level.`,
    );
  if (s.interval > jumpLevels[s.noteJumps].interval)
    throw new Error(
      "Maximum melodic interval exceeds Note jumps. Reduce it in Advanced settings or choose a higher Note jumps level.",
    );
  const state: StreamState = previous
    ? structuredClone(previous)
    : { rng: hash(seed), bar: 0, hands: [], hints: {} };
  if (!previous) state.hands = initialHands(s, state);
  const initial = structuredClone(state),
    events: ScoreEvent[] = [],
    positions = structuredClone(state.hands),
    movements: MovementPlan[] = [];
  const available = new Map(
    state.hands.map((h) => [h.hand, positionsFor(s, h.hand)]),
  );
  const usePreparation =
    s.handMovements !== "off" && s.shiftFrequency > 0 && s.maxShift > 0;
  if (!usePreparation) delete state.coverage;
  else state.coverage ??= {};
  for (const h of usePreparation ? state.hands : []) {
    state.coverage![h.hand] = planRangeCoverage(
      state.coverage![h.hand],
      {
        min: h.hand === "left" ? s.leftMin : s.min,
        max: h.hand === "left" ? s.leftMax : s.max,
        context: JSON.stringify([
          s.hand,
          s.key,
          s.min,
          s.max,
          s.leftMin,
          s.leftMax,
          s.handMovements,
          s.shiftFrequency,
          s.maxShift,
          s.noteJumps,
          s.interval,
          s.fingerSpacing,
          s.accidentals,
          s.chords,
          s.rhythm,
          s.beats,
        ]),
        position: positionCenter(h),
        destinations: available
          .get(h.hand)!
          .filter((to) => spacingSignature(to) === spacingSignature(h))
          .map(positionCenter),
      },
      state,
    );
  }
  const harmony = choose(
      [
        [1, 4, 5, 1],
        [1, 2, 5, 1],
        [1, 6, 4, 5],
      ],
      state,
    ),
    shape = choose(
      [
        [0, 2, 4, 0],
        [2, 4, 2, 0],
      ],
      state,
    );
  const motif = choose(
    [
      [0, 1, 2, 1],
      [0, 2, 1, 0],
      [2, 1, 0, 1],
    ],
    state,
  );
  const shapes = new Map(
    state.hands.map((h) => [
      h.hand,
      usePreparation
        ? coveragePhraseShape(
            state.coverage![h.hand]!,
            positionCenter(h),
            shape,
            state,
          )
        : shape,
    ]),
  );
  const notesInKey = Scale.get(`${s.key} major`).notes;
  const chords = harmony.map(
    (degree) =>
      Chord.get(
        `${notesInKey[degree - 1]}${degree === 2 || degree === 6 ? "m" : ""}`,
      ).notes,
  );
  for (let b = 0; b < 4; b++) {
    const bar = state.bar + b,
      landings = new Map<Hand, number>();
    if ((rule.eligible as readonly number[]).includes(b) && usePreparation) {
      for (let hi = 0; hi < state.hands.length; hi++) {
        const from = state.hands[hi];
        if (random(state) >= s.shiftFrequency || !from.lastPitch) continue;
        const other = state.hands.find((h) => h.hand !== from.hand);
        // Only move when the old position cannot reach the landing pitch.
        const options = available.get(from.hand)!.flatMap((to) => {
          const distance =
            diatonicIndex(to.pitches[0]) - diatonicIndex(from.pitches[0]);
          if (
            spacingSignature(to) !== spacingSignature(from) ||
            !distance ||
            Math.abs(distance) > s.maxShift ||
            (other && !separated(to, other))
          )
            return [];
          return to.pitches.flatMap((pitch, index) => {
            const leap = Math.abs(
              diatonicIndex(pitch) - diatonicIndex(from.lastPitch!),
            );
            return !from.pitches.includes(pitch) && leap <= s.interval
              ? [{ to, index, distance }]
              : [];
          });
        });
        if (!options.length) continue;
        // Small moves remain more likely, while higher distance limits genuinely
        // admit larger, rested relocations rather than merely changing a label.
        const weights = options.map(
          (o) =>
            (5 - Math.abs(o.distance)) *
            coverageMoveWeight(
              state.coverage![from.hand]!,
              positionCenter(from),
              positionCenter(o.to),
            ),
        );
        // Unused weight defers the relocation. This matters when the landing
        // constraints permit only an away-from-target direction at this rest.
        let draw =
          random(state) *
          options.reduce((sum, o) => sum + 5 - Math.abs(o.distance), 0);
        const selected = options.findIndex((_, i) => (draw -= weights[i]) < 0);
        if (selected < 0) continue;
        const { to, index, distance } = options[selected];
        const tick = bar * s.beats * TPQ,
          pitch = to.pitches[index],
          midi = Note.midi(pitch)!;
        movements.push({
          id: `${seed}-move-${bar}-${from.hand}`,
          hand: from.hand,
          technique: "lift-and-reposition",
          fromPositionId: from.id,
          toPositionId: to.id,
          cueTick: tick - TPQ,
          landingTick: tick,
          landingNoteId: `${seed}-${bar}-0-${from.hand}`,
          landingMidi: midi,
          landingFinger: to.fingerToMidi.indexOf(midi) + 1,
          distance,
        });
        state.hands[hi] = {
          ...to,
          lastIndex: index,
          lastPitch: from.lastPitch,
          lastNoteEnd: from.lastNoteEnd,
          resolutionPitch: undefined,
        };
        positions.push(structuredClone(to));
        landings.set(from.hand, index);
      }
    }
    const prepareNext =
      usePreparation && (rule.eligible as readonly number[]).includes(b + 1);
    const breath = prepareNext || (b === 2 && s.rhythm !== "quarters");
    const durations: number[] = [];
    let remaining = (s.beats - (breath ? 1 : 0)) * TPQ;
    while (remaining) {
      const options =
        s.rhythm === "quarters"
          ? [480]
          : s.rhythm === "mixed"
            ? [240, 480, 960, 1920]
            : [480, 480, 960];
      const legal = options.filter((d) => d <= remaining);
      const d = choose(legal, state);
      durations.push(d);
      remaining -= d;
    }
    if (breath) durations.push(TPQ);
    let onset = 0;
    for (let j = 0; j < durations.length; j++) {
      const rest = breath && j === durations.length - 1;
      for (const h of state.hands) {
        let choices = [0, 1, 2, 3, 4].filter(
          (i) =>
            !h.lastPitch ||
            Math.abs(
              diatonicIndex(h.pitches[i]) - diatonicIndex(h.lastPitch),
            ) <= s.interval,
        );
        // Do not strand Small-jump melodies on an isolated thumb key. Keep the
        // chosen position intact and start in its most connected melodic region.
        if (!h.lastPitch) choices = connectedStart(h, s.interval);
        if (b === 3 && j === durations.length - (breath ? 2 : 1)) {
          const stable = choices.filter((i) =>
            chords[3].includes(Note.pitchClass(h.pitches[i])),
          );
          if (stable.length) choices = stable;
        }
        const goal = Math.max(
          0,
          Math.min(4, shapes.get(h.hand)![b] + motif[j % motif.length] - 1),
        );
        const weighted = choices.flatMap((i) =>
          Array.from(
            {
              length:
                Math.max(1, 6 - Math.abs(i - goal) * 2) +
                (h.lastPitch &&
                Math.abs(
                  diatonicIndex(h.pitches[i]) - diatonicIndex(h.lastPitch),
                ) === 1
                  ? jumpLevels[s.noteJumps].stepWeight
                  : 0) +
                (chords[b].includes(Note.pitchClass(h.pitches[i])) ? 2 : 0) +
                (b === 3 &&
                j === durations.length - 1 &&
                chords[3].includes(Note.pitchClass(h.pitches[i]))
                  ? 5
                  : 0),
            },
            () => i,
          ),
        );
        const index =
          h.resolutionPitch && !(j === 0 && landings.has(h.hand))
            ? h.pitches.indexOf(h.resolutionPitch)
            : j === 0 && landings.has(h.hand)
              ? landings.get(h.hand)!
              : choose(weighted, state);
        if (index === undefined)
          throw new Error(
            "No playable melodic transition. Widen the range or maximum melodic interval.",
          );
        let pitch = h.pitches[index];
        const resolving = !!h.resolutionPitch;
        if (!rest) h.resolutionPitch = undefined;
        const frequency = { off: 0, easy: 0.12, medium: 0.28, hard: 0.45 }[
          s.accidentals
        ];
        if (
          !rest &&
          !resolving &&
          !(j === 0 && landings.has(h.hand)) &&
          random(state) < frequency
        ) {
          const finger = h.fingerToMidi.indexOf(Note.midi(pitch)!) + 1;
          const options = (h.pitchOptions?.[finger - 1] ?? []).filter(
            (p) => p !== pitch,
          );
          // Neighbors resolve on their next attack. Hard also favors applied-dominant alterations.
          const root = chords[b][0];
          const applied = Chord.get(`${root}7`).notes;
          const preferred =
            s.accidentals === "hard"
              ? options.filter((p) => applied.includes(Note.pitchClass(p)))
              : [];
          if (options.length) {
            h.resolutionPitch = pitch;
            pitch = choose(preferred.length ? preferred : options, state);
            const passing = h.pitches.filter(
              (p) =>
                p !== h.pitches[index] &&
                Math.abs(Note.midi(p)! - Note.midi(pitch)!) === 1 &&
                Math.abs(diatonicIndex(p) - diatonicIndex(pitch)) <=
                  s.interval &&
                chords[b].includes(Note.pitchClass(p)),
            );
            if (
              s.accidentals !== "easy" &&
              passing.length &&
              random(state) < (s.accidentals === "hard" ? 0.65 : 0.4)
            )
              h.resolutionPitch = choose(passing, state);
          }
        }
        const basePitch = h.pitches[index],
          midi = Note.midi(pitch)!;
        const finger = h.fingerToMidi.indexOf(Note.midi(basePitch)!) + 1;
        const id = `${seed}-${bar}-${onset}-${h.hand}`;
        const event: ScoreEvent = {
          id,
          kind: rest ? "rest" : "note",
          bar,
          onset,
          duration: durations[j],
          hand: h.hand,
          positionId: h.id,
          midi,
          pitch,
          finger,
          notes: rest
            ? []
            : [
                {
                  id,
                  midi,
                  pitch,
                  written: writtenPitch(pitch, s.key),
                  finger,
                  hand: h.hand,
                },
              ],
          action: rest
            ? "REST"
            : pitch === h.lastPitch
              ? "REPEAT_NOTE"
              : "PLAY_WITHIN_POSITION",
        };
        if (
          !rest &&
          !h.resolutionPitch &&
          !resolving &&
          !(j === 0 && landings.has(h.hand)) &&
          s.chords !== "off" &&
          random(state) < { easy: 0.22, medium: 0.45, hard: 0.7 }[s.chords]
        ) {
          const candidates = chordCandidates(
            event,
            h,
            s,
            chords[b],
            h.lastVoicing,
          );
          if (candidates.length) event.notes = choose(candidates, state);
        }
        events.push(event);
        if (!rest) {
          h.lastIndex = index;
          h.lastPitch = pitch;
          h.lastVoicing = event.notes!.map((n) => n.midi);
          h.lastNoteEnd = bar * s.beats * TPQ + onset + durations[j];
        }
      }
      onset += durations[j];
    }
  }
  state.bar += 4;
  for (const h of usePreparation ? state.hands : [])
    recordRangeCoverage(
      state.coverage![h.hand]!,
      events
        .filter((e) => e.hand === h.hand)
        .flatMap(noteheads)
        .map((n) => n.midi),
    );
  state.hints = inferFingeringHints(
    events,
    positions,
    movements,
    "smart",
    false,
    initial.hints,
  ).state;
  const p: Phrase = {
    seed,
    version: VERSION,
    settings: s,
    events,
    initial,
    final: state,
    positions,
    movements,
    harmonies: harmony.map(
      (degree, i) => `${degree}: ${chords[i].join(" · ")}`,
    ),
  };
  const errors = validatePhrase(p);
  if (errors.length) throw new Error(errors.join(" "));
  return p;
}
