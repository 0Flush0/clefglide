import { Note } from "tonal";
import {
  TPQ,
  noteheads,
  type HandState,
  type MovementPlan,
  type Notehead,
  type ScoreEvent,
  type StreamState,
} from "../score/model";
import { attachNoteLifetimes } from "../score/lifetimes";
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
import { diatonicIndex, positionsForConfig } from "./positionMaps";
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
import { validateGeneratedPhrase } from "./phraseValidator";
import { inspectGeneratorFeasibility } from "./feasibility";
import type { GeneratedPhrase } from "./model";

type Key = Pick<Notehead, "midi" | "finger" | "hand">;
type Occupied = Key & { voice: string; onset: number; release: number };

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
  if (feasibility.errors.length) throw new Error(feasibility.errors.join(" "));
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
    const initial = structuredClone(previous ?? state);
    // Retries start with the same musical state and take another deterministic draw.
    const phrase = plan(state, initial);
    const errors = validateGeneratedPhrase(phrase);
    if (!errors.length) return phrase;
    reason = errors[0];
    rng = state.rng;
  }
  throw new Error(
    `Independent voices could not satisfy the requested constraints in ${policy.maxAttempts} attempts. ${reason} Adjust voice registers, fingers, activity, overlap or polyphony.`,
  );

  function plan(state: StreamState, initial: StreamState): GeneratedPhrase {
    const memories = state.independentVoices!.voices;
    const incoming = initial.pendingTies ?? [];
    const events: ScoreEvent[] = [];
    const positions = structuredClone(state.hands);
    const movements: MovementPlan[] = [];
    const occupied: Occupied[] = (initial.activeLifetimes ?? []).map((n) => ({
      ...n,
      voice: n.lifetime.voiceId,
      onset: n.lifetime.onsetTick,
      release: n.lifetime.releaseTick,
    }));
    for (const { id, profile } of specs) {
      const memory = memories[id];
      memory.active =
        incoming.some((p) => p.head.lifetime!.voiceId === id) ||
        (memory.active
          ? random(state) >= profile.exitProbability
          : random(state) < profile.entryProbability);
    }
    const { harmony, motif, shapes, chords } = planPhrase(c, state);
    const measure = c.notation.beats * TPQ;
    const targets = previous
      ? available
      : new Map(
          state.hands.map((h) => [
            h.hand,
            positionsForConfig(c, h.hand).filter(accepts),
          ]),
        );
    for (let b = 0; b < c.notation.phraseBars; b++) {
      const bar = initial.bar + b,
        barTick = bar * measure;
      const moves = planMovements(
        c,
        seed,
        state,
        targets,
        b,
        positions,
        movements,
        [],
        (from, to, pitch) => {
          const main = specs.find((v) => v.hand === from.hand)!;
          const voice = memories[main.id];
          const movement = c.movement;
          return (
            voice.active &&
            voiceAllows(
              main.profile,
              Note.midi(pitch)!,
              to.fingerToMidi.indexOf(Note.midi(pitch)!) + 1,
            ) &&
            main.durations.some(
              (d) => d.value <= measure - smallRestBeats(c, b) * TPQ,
            ) &&
            (!voice.lastPitch ||
              Math.abs(diatonicIndex(pitch) - diatonicIndex(voice.lastPitch)) <=
                (main.profile.maxIntervalSteps ?? c.melody.maxIntervalSteps)) &&
            movement.kind === "rested-reposition" &&
            !occupied.some(
              (key) =>
                key.hand === from.hand &&
                key.release > barTick - movement.preparationBeats * TPQ,
            )
          );
        },
      );
      const soundedEnd = measure - smallRestBeats(c, b) * TPQ;
      const cursors = specs.map(() => 0);
      const priority = Math.floor(random(state) * specs.length);
      while (Math.min(...cursors) < measure) {
        // Earliest next event wins. Stable voice order resolves coincident attacks.
        const onset = Math.min(...cursors);
        const lane = cursors.findIndex(
          (_, index) => cursors[(index + priority) % specs.length] === onset,
        );
        const selectedLane = (lane + priority) % specs.length;
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
        const options = durations.filter((d) => d.value <= soundedEnd - onset);
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
        const safe = (heads: Notehead[]) => {
          const newHeads = heads.filter(
            (n) =>
              !carries.some(
                (p) => p.head.finger === n.finger && p.head.midi === n.midi,
              ),
          );
          if (!heads.every((n) => voiceAllows(profile, n.midi, n.finger)))
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
          const held = [...sameHand, ...newHeads];
          if (held.length > policy[hand]!.maxPolyphony) return false;
          const map = [...h.fingerToMidi];
          held.forEach((key) => {
            map[key.finger - 1] = key.midi;
          });
          if (!comfortableMap(map, hand)) return false;
          const ordered = held.sort((a, b) => a.finger - b.finger);
          if (
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
        let heads: Notehead[] = [];
        if (carry) {
          heads = carries.map((p) => structuredClone(p.head));
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
            const goal = Math.max(
              0,
              Math.min(
                4,
                shapes.get(hand)![b] +
                  motif[(onset / 240) % motif.length] +
                  c.melody.motifOffset,
              ),
            );
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
            addTones &&
            landing === undefined &&
            profile.chords &&
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
            h.lastIndex =
              h.hand === "right" ? anchor.finger - 1 : 5 - anchor.finger;
            h.lastNoteEnd = tick + duration;
            h.lastFingering = memory.lastFingering;
            h.lastVoicing = h.lastFingering.map((n) => n.midi);
            h.resolutionPitch = memory.resolutionPitch;
          }
        }
        events.push(event);
        cursors[selectedLane] += duration;
      }
    }
    state.bar += c.notation.phraseBars;
    attachNoteLifetimes(events, c);
    planTies(events, c, initial, state, seed);
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
      harmonies: harmony.map(
        (degree, i) => `${degree}: ${chords[i].join(" · ")}`,
      ),
    };
  }
}
