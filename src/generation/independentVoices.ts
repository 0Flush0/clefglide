import { Note } from "tonal";
import {
  TPQ,
  isContinuousMovement,
  noteheads,
  type Hand,
  type HandState,
  type MovementPlan,
  type Notehead,
  type ScoreEvent,
  type StreamState,
} from "../score/model";
import { attachNoteLifetimes, lifetimeNotes } from "../score/lifetimes";
import { inferFingeringHints } from "../score/hints";
import { writtenPitch } from "../score/pitch";
import {
  generatorConfigFingerprint,
  generatorConfigVersion,
  type ValidatedGeneratorConfig,
} from "./config";
import {
  comfortableMap,
  isBlack,
  keyCenter,
  playableTransition,
} from "./ergonomics";
import { initialHands } from "./initialHands";
import {
  diatonicIndex,
  positionCenter,
  positionsForConfig,
  spacingSignature,
} from "./positionMaps";
import { planPhrase } from "./harmony";
import { planChromatic } from "./chromatic";
import { melodicChoices, melodicWeights } from "./melody";
import { planMovements } from "./movement";
import { smallRestBeats } from "./rhythm";
import { chordCandidatesForConfig } from "./voicings";
import { hash, random } from "./random";
import { chooseWeighted } from "./sampling";
import { carryHeadId, planTies, validateTieCarry } from "./ties";
import {
  positionFitsVoices,
  voiceAllows,
  voiceEventId,
  voiceSpecs,
} from "./voiceConfig";
import { validateGeneratedCore } from "./phraseValidator";
import { inspectGeneratorFeasibility } from "./feasibility";
import type { GeneratedPhrase } from "./model";
import { planVoicePreparation } from "./voicePreparation";
import { clearsOppositeEdge, oppositeSweepEdge } from "./movementEnvelope";
import {
  coveragePhraseShape,
  planRangeCoverage,
  recordRangeCoverage,
  validCoverageMemory,
} from "./rangeCoverage";
import { validVoiceLeapBoundary } from "./wideLeapValidation";
import type { MovementDiagnostic } from "./model";
import {
  applyDynamicAttack,
  chooseDynamicAttack,
  recordFingeringAttack,
} from "./dynamicAttacks";
import { beginFingering, finishFingering } from "./fingeringTimeline";
import { planSubstitutions } from "./substitutions";
import { GeneratorContextInfeasibleError } from "./dynamicFeasibility";

type Key = Pick<Notehead, "midi" | "finger" | "hand">;
type Occupied = Key & {
  voice: string;
  onset: number;
  release: number;
  restedAlternate?: boolean;
};

export class GeneratorSearchExhaustedError extends Error {
  constructor(attempts: number, reason: string) {
    super(
      `Independent voice search budget exhausted after ${attempts} attempts. Last rejected plan: ${reason}`,
    );
    this.name = "GeneratorSearchExhaustedError";
  }
}

/** Plan one exact timeline per voice against the occupied keys of every other voice. */
export function generateIndependent(
  c: ValidatedGeneratorConfig,
  seed: string,
  previous?: StreamState,
): GeneratedPhrase {
  const policy = c.independentVoices!;
  const specs = voiceSpecs(c);
  const fingerprint = generatorConfigFingerprint(c);
  const feasibility = inspectGeneratorFeasibility(c);
  if (feasibility.errors.length) {
    const message = feasibility.errors.join(" ");
    if (c.dynamicFingering || c.articulation)
      throw new GeneratorContextInfeasibleError(message);
    throw new Error(message);
  }
  const context = JSON.stringify([seed, fingerprint]);
  const empty = {
    context,
    voices: Object.fromEntries(specs.map(({ id }) => [id, { active: false }])),
  };
  const start: StreamState = previous ?? {
    rng: hash(seed),
    bar: 0,
    hands: [],
    hints: {},
    activeLifetimes: [],
    independentVoices: empty,
  };
  if (start.independentVoices?.context !== context)
    throw new Error(
      "Independent voice continuation requires the original seed and configuration.",
    );
  if (previous) validateTieCarry(c, previous, seed);
  if (previous && !validVoiceLeapBoundary(previous, c))
    throw new Error("Invalid independent wide-leap boundary preparation.");
  if (
    previous &&
    (c.coverage.kind === "guided"
      ? !validCoverageMemory(previous, context, c.coverage)
      : previous.coverage !== undefined)
  )
    throw new Error("Invalid independent register coverage state.");
  if (
    Object.keys(start.independentVoices.voices).length !== specs.length ||
    specs.some(
      ({ id }) =>
        typeof start.independentVoices!.voices[id]?.active !== "boolean",
    )
  )
    throw new Error("Invalid independent voice continuation state.");
  const accepts = (h: HandState) => positionFitsVoices(c, h);
  const available = new Map(
    start.hands.map((h) => [
      h.hand,
      positionsForConfig(c, h.hand).filter(accepts),
    ]),
  );
  let rng = start.rng;
  let reason = "";
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    const state = structuredClone(start);
    state.rng = rng;
    if (!previous) state.hands = initialHands(c, state, accepts);
    if (c.dynamicFingering) beginFingering(c, seed, state, !!previous);
    else if (state.dynamicFingering)
      throw new Error("Start a new stream to disable dynamic fingering.");
    const initial = structuredClone(previous ?? state);
    // Retries start with the same musical state and take another deterministic draw.
    const phrase = plan(state, initial);
    const errors = validateGeneratedCore(phrase);
    if (!errors.length) return phrase;
    reason = errors[0];
    rng = state.rng;
  }
  throw new GeneratorSearchExhaustedError(policy.maxAttempts, reason);

  function plan(state: StreamState, initial: StreamState): GeneratedPhrase {
    const memories = state.independentVoices!.voices;
    const incoming = initial.pendingTies ?? [];
    const events: ScoreEvent[] = [];
    const positions = structuredClone(state.hands);
    const movements: MovementPlan[] = [];
    const diagnostics: MovementDiagnostic[] = [];
    const fingeringPlan = { initial, events, positions, movements };
    const wideEnabled =
      c.wideLeaps.kind === "lifted-wide" && c.wideLeaps.probability > 0;
    const occupied: Occupied[] = (initial.activeLifetimes ?? []).map((n) => ({
      ...n,
      voice: n.lifetime.voiceId,
      onset: n.lifetime.onsetTick,
      release: n.lifetime.releaseTick,
      restedAlternate: incoming.some(
        (p) =>
          p.head.tie?.lifetimeId === n.id &&
          p.head.fingering?.technique === "rested-alternate",
      ),
    }));
    for (const { id, profile } of specs) {
      const memory = memories[id];
      memory.active =
        incoming.some((p) => p.head.lifetime!.voiceId === id) ||
        (memory.active
          ? random(state) >= profile.exitProbability
          : random(state) < profile.entryProbability);
    }
    const measure = c.notation.beats * TPQ;
    const targets = previous
      ? available
      : new Map(
          state.hands.map((h) => [
            h.hand,
            positionsForConfig(c, h.hand).filter(accepts),
          ]),
        );
    const coverage = c.coverage;
    if (coverage.kind === "guided") {
      state.coverage ??= {};
      for (const h of state.hands) {
        const midis = targets
          .get(h.hand)!
          .filter((to) => spacingSignature(to) === spacingSignature(h))
          .flatMap((to) => to.fingerToMidi);
        state.coverage[h.hand] = planRangeCoverage(
          state.coverage[h.hand],
          {
            min: Math.min(...midis),
            max: Math.max(...midis),
            context,
            position: positionCenter(h),
            destinations: targets
              .get(h.hand)!
              .filter((to) => spacingSignature(to) === spacingSignature(h))
              .map(positionCenter),
          },
          state,
          coverage,
        );
      }
    }
    const { harmony, motif, shapes, chords } = planPhrase(c, state);
    const voiceShapes = new Map(
      specs.map(({ hand, id, profile }) => {
        const shape = shapes.get(hand)!;
        if (coverage.kind !== "guided") return [id, shape] as const;
        const h = state.hands.find((h) => h.hand === hand)!;
        const pitches = h.fingerToMidi.filter((m, i) =>
          voiceAllows(profile, m, i + 1),
        );
        const memory = state.coverage![hand]!;
        const target = Math.max(
          profile.minMidi ?? memory.min,
          Math.min(profile.maxMidi ?? memory.max, memory.target),
        );
        return [
          id,
          coveragePhraseShape(
            { ...memory, target },
            pitches.length
              ? (Math.min(...pitches) + Math.max(...pitches)) / 2
              : positionCenter(h),
            shape,
            state,
            coverage,
          ),
        ] as const;
      }),
    );
    const windows = planVoicePreparation(c, state, targets);
    const startTick = initial.bar * measure;
    const voiceWindow = wideEnabled
      ? (hand: Hand, landing: number) =>
          windows.find((w) => w.hand === hand && w.landingTick === landing)
      : undefined;
    for (let b = 0; b < c.notation.phraseBars; b++) {
      const bar = initial.bar + b,
        barTick = bar * measure;
      const baseEnd = measure - smallRestBeats(c, b) * TPQ;
      const restCues = (hand: Hand) =>
        windows
          .filter(
            (w) =>
              w.hand === hand &&
              w.landingTick > barTick &&
              w.cueTick < barTick + measure,
          )
          .map((w) => Math.max(0, w.cueTick - barTick));
      const endFor = (hand: Hand) => Math.min(baseEnd, ...restCues(hand));
      const mainDurations = (hand: Hand) =>
        specs
          .find((v) => v.hand === hand)!
          .durations.filter((d) => d.value <= endFor(hand));
      const overlapDraws = new Map<Hand, boolean>();
      const considersLandingDuringOverlap = (hand: Hand) => {
        if (
          policy.overlapProbability === 1 ||
          (!occupied.some(
            (key) => key.hand !== hand && key.release > barTick,
          ) &&
            !movements.some(
              (move) => move.hand !== hand && move.landingTick === barTick,
            ))
        )
          return true;
        if (!overlapDraws.has(hand))
          overlapDraws.set(hand, random(state) < policy.overlapProbability);
        return overlapDraws.get(hand)!;
      };
      const landingDurationAllowed = (hand: Hand, duration: number) =>
        occupied.every(
          (key) =>
            key.release <= barTick ||
            (key.hand !== hand &&
              policy.overlapProbability > 0 &&
              Math.min(key.release - barTick, duration) <=
                policy.maxOverlapTicks),
        ) &&
        movements.every(
          (move) =>
            move.hand === hand ||
            move.landingTick !== barTick ||
            (policy.overlapProbability > 0 &&
              Math.min(
                duration,
                ...mainDurations(move.hand).map((d) => d.value),
              ) <= policy.maxOverlapTicks),
        );
      const moves = planMovements(
        c,
        seed,
        state,
        targets,
        b,
        positions,
        movements,
        diagnostics,
        (from, to, pitch, technique, cue) => {
          const main = specs.find((v) => v.hand === from.hand)!;
          const voice = memories[main.id];
          const wide = technique === "lifted-wide-leap";
          const edge =
            wideEnabled && !wide
              ? oppositeSweepEdge(
                  from.hand,
                  initial.hands,
                  positions,
                  movements,
                  cue,
                  barTick,
                )
              : undefined;
          return (
            voice.active &&
            voiceAllows(
              main.profile,
              Note.midi(pitch)!,
              to.fingerToMidi.indexOf(Note.midi(pitch)!) + 1,
            ) &&
            mainDurations(from.hand).some(
              (d) => !wideEnabled || landingDurationAllowed(from.hand, d.value),
            ) &&
            (wide ||
              !voice.lastPitch ||
              Math.abs(diatonicIndex(pitch) - diatonicIndex(voice.lastPitch)) <=
                (main.profile.maxIntervalSteps ?? c.melody.maxIntervalSteps)) &&
            clearsOppositeEdge(from, edge) &&
            clearsOppositeEdge(to, edge) &&
            !occupied.some(
              (key) =>
                key.hand === from.hand &&
                key.onset < barTick &&
                key.release > cue,
            ) &&
            (!wideEnabled || considersLandingDuringOverlap(from.hand))
          );
        },
        voiceWindow,
      );
      for (const move of movements.filter(
        (m) => m.landingTick === barTick && m.technique === "lifted-wide-leap",
      )) {
        for (const { id } of specs.filter((v) => v.hand === move.hand)) {
          const { active, lastPitch } = memories[id];
          memories[id] = id.endsWith(":main")
            ? { active, lastPitch }
            : { active };
        }
      }
      const cursors = specs.map(() => 0);
      const priority = Math.floor(random(state) * specs.length);
      while (Math.min(...cursors) < measure) {
        // Earliest next event wins. Stable voice order resolves coincident attacks.
        const onset = Math.min(...cursors);
        const lane = cursors.findIndex(
          (_, index) => cursors[(index + priority) % specs.length] === onset,
        );
        const landingLane =
          wideEnabled && onset === 0
            ? specs.findIndex(
                ({ hand, id }, i) =>
                  cursors[i] === 0 && id.endsWith(":main") && moves.has(hand),
              )
            : -1;
        const selectedLane =
          landingLane >= 0 ? landingLane : (lane + priority) % specs.length;
        const { hand, id, profile, durations } = specs[selectedLane];
        const h = state.hands.find((position) => position.hand === hand)!;
        const memory = memories[id];
        const tick = barTick + onset;
        const carries = incoming.filter(
          (p) =>
            p.head.lifetime!.voiceId === id &&
            p.head.lifetime!.releaseTick > tick,
        );
        const carry = carries[0];
        const landing =
          id.endsWith(":main") && onset === 0 ? moves.get(hand) : undefined;
        const otherLanding =
          onset === 0 && moves.has(hand) && landing === undefined;
        const soundedEnd = endFor(hand);
        const options = durations.filter(
          (d) =>
            d.value <= soundedEnd - onset &&
            (landing === undefined ||
              !wideEnabled ||
              landingDurationAllowed(hand, d.value)),
        );
        const active = occupied.filter(
          (key) => key.release > tick && key.voice !== id,
        );
        const coincident = active.some((key) => key.onset === tick);
        const attackChance = Math.min(
          1,
          profile.activity * (coincident ? profile.coincidentAttackWeight : 1),
        );
        const canAttack =
          landing !== undefined ||
          (memory.active &&
            !otherLanding &&
            (!c.dynamicFingering ||
              !movements.some(
                (m) =>
                  m.hand === hand &&
                  m.landingTick === tick &&
                  isContinuousMovement(m),
              )) &&
            options.length > 0 &&
            random(state) < attackChance &&
            (!active.length ||
              (policy.maxOverlapTicks > 0 &&
                random(state) < policy.overlapProbability)));
        const duration =
          carry?.duration ??
          (options.length && memory.active && !otherLanding
            ? chooseWeighted(
                options.map(({ value, weight }) => ({
                  value,
                  weight:
                    weight *
                    ((onset + value) % TPQ ? profile.offbeatWeight : 1),
                })),
                state,
              )
            : [1920, 960, 480, 240].find(
                (d) =>
                  d <=
                  Math.min(
                    measure - onset,
                    onset < soundedEnd ? soundedEnd - onset : measure - onset,
                    ...(wideEnabled
                      ? restCues(hand)
                          .filter((cue) => cue > onset)
                          .map((cue) => cue - onset)
                      : []),
                    ...(wideEnabled && baseEnd > onset
                      ? [baseEnd - onset]
                      : []),
                    otherLanding
                      ? Math.min(...durations.map((d) => d.value))
                      : measure,
                  ),
              )!);
        const event: ScoreEvent = {
          id: voiceEventId(seed, bar, onset, id),
          voiceId: id,
          kind: "rest",
          bar,
          onset,
          duration,
          hand,
          positionId: h.id,
          midi: 0,
          pitch: "",
          finger: 0,
          notes: [],
          action: "REST",
        };
        const sameHand = occupied.filter(
          (key) => key.release > tick && key.hand === hand,
        );
        const safe = (heads: Notehead[], position = h) => {
          const newHeads = heads.filter(
            (n) =>
              !carries.some(
                (p) => p.head.finger === n.finger && p.head.midi === n.midi,
              ),
          );
          if (!heads.every((n) => voiceAllows(profile, n.midi, n.finger)))
            return false;
          if (
            c.dynamicFingering &&
            newHeads.length &&
            sameHand.some((n) => n.restedAlternate)
          )
            return false;
          if (
            newHeads.some((n) =>
              occupied.some(
                (key) =>
                  key.release > tick &&
                  (key.midi === n.midi ||
                    (key.hand === hand && key.finger === n.finger)),
              ),
            )
          )
            return false;
          if (
            newHeads.length &&
            active.some(
              (key) =>
                Math.min(tick + duration, key.release) - tick >
                policy.maxOverlapTicks,
            )
          )
            return false;
          const held: (Key & { restedAlternate?: boolean })[] = [
            ...sameHand,
            ...newHeads.map((n) =>
              n.fingering ? { ...n, restedAlternate: true } : n,
            ),
          ];
          if (held.length > policy[hand]!.maxPolyphony) return false;
          const map = [...position.fingerToMidi];
          held.forEach((key) => {
            if (!key.restedAlternate) map[key.finger - 1] = key.midi;
          });
          if (!comfortableMap(map, hand)) return false;
          const ordered = held.sort((a, b) => a.finger - b.finger);
          if (
            (held.some((key) => key.restedAlternate) &&
              ordered.some(
                (key, i) =>
                  i > 0 &&
                  (key.midi - ordered[i - 1].midi) *
                    (hand === "right" ? 1 : -1) <=
                    0,
              )) ||
            ordered.some(
              (key, i) =>
                i > 0 &&
                Math.abs(keyCenter(key.midi) - keyCenter(ordered[i - 1].midi)) >
                  Math.abs(key.finger - ordered[i - 1].finger) * 1.5 + 0.5,
            )
          )
            return false;
          if (
            held.some(
              (key) =>
                (key.finger === 1 || key.finger === 5) && isBlack(key.midi),
            ) &&
            held.some(
              (key) => key.finger > 1 && key.finger < 5 && !isBlack(key.midi),
            )
          )
            return false;
          const right = [
            ...held,
            ...active.filter((key) => key.hand !== hand),
          ].filter((key) => key.hand === "right");
          const left = [
            ...held,
            ...active.filter((key) => key.hand !== hand),
          ].filter((key) => key.hand === "left");
          return !right.some((r) => left.some((l) => r.midi <= l.midi));
        };
        const pos: HandState = {
          ...h,
          lastPitch: memory.lastPitch,
          lastFingering:
            memory.lastPositionId === h.id ? memory.lastFingering : undefined,
          resolutionPitch:
            memory.lastPositionId === h.id ? memory.resolutionPitch : undefined,
        };
        const head = (pitch: string, finger: number): Notehead => ({
          id: event.id,
          pitch,
          finger,
          hand,
          midi: Note.midi(pitch)!,
          written: writtenPitch(pitch, c.notation.key),
        });
        const goal = Math.max(
          0,
          Math.min(
            4,
            voiceShapes.get(id)![b] +
              motif[(onset / 240) % motif.length] +
              c.melody.motifOffset,
          ),
        );
        const attack =
          !carry && canAttack && landing === undefined
            ? chooseDynamicAttack(
                c,
                state,
                fingeringPlan,
                event,
                h,
                targets.get(hand)!,
                goal,
                chords[b],
                b === c.notation.phraseBars - 1 &&
                  onset + duration === soundedEnd,
                (n, position) => safe([n], position),
                profile.maxIntervalSteps ?? c.melody.maxIntervalSteps,
                pos.resolutionPitch,
              )
            : undefined;
        let heads: Notehead[] = [];
        if (carry) {
          heads = carries.map((p) => structuredClone(p.head));
        } else if (attack) {
          applyDynamicAttack(fingeringPlan, event, h, attack);
          heads = [attack.head];
          memory.resolutionPitch = undefined;
        } else if (canAttack) {
          const last =
            b === c.notation.phraseBars - 1 && onset + duration === soundedEnd;
          const interval =
            profile.maxIntervalSteps ?? c.melody.maxIntervalSteps;
          let startChoices = [0, 1, 2, 3, 4].filter((index) => {
            const midi = Note.midi(h.pitches[index])!;
            return voiceAllows(profile, midi, h.fingerToMidi.indexOf(midi) + 1);
          });
          if (!pos.lastPitch && c.melody.startRegion === "largest-connected") {
            const regions: number[][] = [[]];
            for (const i of startChoices) {
              const previous = regions.at(-1)!.at(-1);
              if (
                previous !== undefined &&
                diatonicIndex(h.pitches[i]) -
                  diatonicIndex(h.pitches[previous]) >
                  interval
              )
                regions.push([]);
              regions.at(-1)!.push(i);
            }
            const longest = Math.max(...regions.map((r) => r.length));
            startChoices = regions.filter((r) => r.length === longest).flat();
          }
          let choices =
            landing !== undefined
              ? [landing]
              : (pos.lastPitch
                  ? melodicChoices(c, pos, chords[b], false)
                  : startChoices
                ).filter((index) => {
                  const pitch = h.pitches[index];
                  return (
                    (!pos.resolutionPitch || pitch === pos.resolutionPitch) &&
                    (!pos.lastPitch ||
                      Math.abs(
                        diatonicIndex(pitch) - diatonicIndex(pos.lastPitch),
                      ) <= interval) &&
                    safe([
                      head(
                        pitch,
                        h.fingerToMidi.indexOf(Note.midi(pitch)!) + 1,
                      ),
                    ])
                  );
                });
          if (last && c.melody.preferHarmonicEnding) {
            const harmonic = choices.filter((index) =>
              chords[b].includes(Note.pitchClass(h.pitches[index])),
            );
            if (harmonic.length) choices = harmonic;
          }
          if (choices.length) {
            const index =
              landing ??
              chooseWeighted(
                melodicWeights(c, pos, choices, goal, chords[b], last),
                state,
              );
            const pitch = h.pitches[index];
            const natural = head(
              pitch,
              h.fingerToMidi.indexOf(Note.midi(pitch)!) + 1,
            );
            const chromatic = profile.chromatic
              ? planChromatic(
                  c,
                  pos,
                  index,
                  false,
                  landing !== undefined,
                  chords[b],
                  state,
                )
              : { pitch, finger: natural.finger, resolving: false };
            const altered = head(chromatic.pitch, chromatic.finger);
            const usable =
              safe([altered]) &&
              (!pos.lastPitch ||
                Math.abs(
                  diatonicIndex(altered.pitch) - diatonicIndex(pos.lastPitch),
                ) <= interval) &&
              (!pos.resolutionPitch ||
                (voiceAllows(
                  profile,
                  Note.midi(pos.resolutionPitch)!,
                  h.fingerToMidi.indexOf(Note.midi(pos.resolutionPitch)!) + 1,
                ) &&
                  Math.abs(
                    diatonicIndex(altered.pitch) -
                      diatonicIndex(pos.resolutionPitch),
                  ) <= interval));
            heads = [usable || landing !== undefined ? altered : natural];
            memory.resolutionPitch = usable ? pos.resolutionPitch : undefined;
          }
        }
        if (heads.length) {
          const anchor = heads[0];
          Object.assign(event, {
            kind: "note",
            midi: anchor.midi,
            pitch: anchor.pitch,
            finger: anchor.finger,
            notes: heads,
            action:
              Note.midi(memory.lastPitch ?? "") === anchor.midi
                ? "REPEAT_NOTE"
                : "PLAY_WITHIN_POSITION",
          });
          const ties = c.notation.ties;
          const addTones =
            !carry ||
            (ties !== false &&
              (ties.chordTones === "outer" || ties.chordTones === "any") &&
              canAttack);
          if (
            heads.length === 1 &&
            !attack &&
            addTones &&
            landing === undefined &&
            profile.chords &&
            !anchor.fingering &&
            c.chords.kind === "voicings" &&
            !memory.resolutionPitch &&
            !pos.resolutionPitch &&
            h.pitches.includes(anchor.pitch) &&
            random(state) < c.chords.probability
          ) {
            const chord = c.chords;
            const candidates = chordCandidatesForConfig(
              event,
              h,
              c,
              chords[b],
              pos.lastFingering?.map((n) => n.midi),
              carry ? [anchor] : [],
            ).filter(
              (tones) =>
                safe(tones) &&
                playableTransition(pos.lastFingering ?? [], tones) &&
                (!carry ||
                  ties === false ||
                  ties.chordTones !== "outer" ||
                  !tones.some((n) => n.midi < anchor.midi) ||
                  !tones.some((n) => n.midi > anchor.midi)),
            );
            if (candidates.length)
              event.notes = chooseWeighted(
                candidates.map((value) => ({
                  value,
                  weight: chord.shapes.find(
                    (s) =>
                      s.value ===
                      value
                        .map((n) => n.finger)
                        .sort()
                        .join(""),
                  )!.weight,
                })),
                state,
              );
          }
          event.notes!.forEach((n, i) => {
            const held = carries.find((p) => p.head.finger === n.finger);
            n.id = held
              ? carryHeadId(event.id, n.finger, i === 0)
              : i
                ? `${event.id}:${i}`
                : event.id;
            delete n.tie;
            delete n.lifetime;
            if (!held)
              occupied.push({
                ...n,
                voice: id,
                onset: tick,
                release: tick + duration,
                ...(n.fingering ? { restedAlternate: true } : {}),
              });
          });
          memory.lastPitch = anchor.pitch;
          memory.lastPositionId = h.id;
          memory.lastFingering = noteheads(event).map(({ midi, finger }) => ({
            midi,
            finger,
          }));
          if (id.endsWith(":main")) {
            h.lastPitch = anchor.pitch;
            h.lastIndex = attack
              ? h.pitches.indexOf(anchor.pitch)
              : h.hand === "right"
                ? anchor.finger - 1
                : 5 - anchor.finger;
            h.lastNoteEnd = tick + duration;
            h.lastFingering = memory.lastFingering;
            h.lastVoicing = h.lastFingering.map((n) => n.midi);
            h.resolutionPitch = memory.resolutionPitch;
          }
          if (!carry)
            recordFingeringAttack(
              state,
              event,
              attack?.movement?.technique ?? attack?.head.fingering?.technique,
            );
        }
        events.push(event);
        cursors[selectedLane] += duration;
      }
    }
    state.bar += c.notation.phraseBars;
    attachNoteLifetimes(events, c);
    planTies(events, c, initial, state, seed, movements);
    if (c.dynamicFingering) {
      finishFingering(fingeringPlan, state, c);
      planSubstitutions(fingeringPlan, state, c);
    }
    if (wideEnabled) {
      const endTick = state.bar * measure;
      const pending = Object.fromEntries(
        windows
          .filter((w) => w.landingTick >= endTick)
          .map(({ hand, cueTick, landingTick }) => {
            const oppositeEdge = oppositeSweepEdge(
              hand,
              initial.hands,
              positions,
              movements,
              cueTick,
              endTick,
            );
            return [
              hand,
              {
                cueTick,
                landingTick,
                ...(oppositeEdge === undefined ? {} : { oppositeEdge }),
              },
            ];
          }),
      );
      if (Object.keys(pending).length)
        state.independentVoices!.leapPreparations = pending;
      else delete state.independentVoices!.leapPreparations;
    }
    if (coverage.kind === "guided") {
      const lifetimes = [
        ...(initial.activeLifetimes ?? []),
        ...lifetimeNotes(events),
      ];
      for (const { hand } of state.hands) {
        const heard = lifetimes.filter((n) => n.hand === hand);
        recordRangeCoverage(
          state.coverage![hand]!,
          heard.map((n) => n.midi),
          coverage,
          heard.map(({ lifetime }) =>
            Math.max(
              0,
              Math.min(state.bar * measure, lifetime.releaseTick) -
                Math.max(startTick, lifetime.onsetTick),
            ),
          ),
        );
      }
    }
    state.hints = inferFingeringHints(
      events,
      positions,
      movements,
      "smart",
      false,
      initial.hints,
    ).state;
    return {
      config: c,
      configFingerprint: fingerprint,
      version: generatorConfigVersion(c),
      seed,
      initial,
      final: state,
      events,
      positions,
      movements,
      ...(c.wideLeaps.kind !== "disabled"
        ? { movementDiagnostics: diagnostics }
        : {}),
      harmonies: harmony.map(
        (degree, i) => `${degree}: ${chords[i].join(" · ")}`,
      ),
    };
  }
}
