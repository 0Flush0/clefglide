import { Chord, Note } from "tonal";
import {
  TPQ,
  isContinuousMovement,
  noteheads,
  type LifetimeNote,
  type Phrase,
} from "../score/model";
import { configuredAlternate } from "./fingeringValidator";
import { lifetimeNoteSchema } from "../score/lifetimeValidation";
import {
  generatorConfigFingerprint,
  type ValidatedGeneratorConfig,
} from "./config";
import { voiceSpecs } from "./voiceConfig";
import { isRestedAlternateAssignment } from "./alternateFingering";
import {
  hasMovementPreparation,
  validateVoiceLeapReservations,
  validateWideLanding,
  validateWideSweeps,
  voiceRests,
} from "./wideLeapValidation";
import { matchesCoverageUsage, validCoverageMemory } from "./rangeCoverage";

/** Reconstruct voice schedules and physical occupancy from score data, without sampling. */
export function validateIndependentVoices(
  p: Omit<Phrase, "settings">,
  c: ValidatedGeneratorConfig,
) {
  const policy = c.independentVoices!;
  const errors: string[] = [];
  const specs = voiceSpecs(c);
  const measure = c.notation.beats * TPQ;
  const start = p.initial.bar * measure,
    end = p.final.bar * measure;
  const tick = (e: { bar: number; onset: number }) => e.bar * measure + e.onset;
  const context = JSON.stringify([p.seed, generatorConfigFingerprint(c)]);
  const alternateHolds = new Set<string>();
  if (c.fingering.allowRestedAlternates)
    for (const t of p.initial.pendingTies ?? []) {
      const position = p.initial.hands.find((h) => h.hand === t.head.hand);
      if (
        position &&
        t.head.tie &&
        isRestedAlternateAssignment(position, t.head, t.head.fingering)
      )
        alternateHolds.add(t.head.tie.lifetimeId);
    }
  const black = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
  const center = (m: number) =>
    Math.floor(m / 12) * 7 +
    [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6][m % 12];
  const degree = (pitch: string) => {
    const n = Note.get(pitch);
    return (n.oct ?? -100) * 7 + "CDEFGAB".indexOf(n.letter);
  };
  const transition = (
    from: { midi: number; finger: number },
    to: { midi: number; finger: number },
  ) =>
    from.finger !== to.finger ||
    from.midi === to.midi ||
    (black(from.midi) &&
      !black(to.midi) &&
      Math.abs(from.midi - to.midi) === 1);
  const moveByHand = (hand: string) =>
    p.movements
      .filter((m) => m.hand === hand)
      .sort((a, b) => a.landingTick - b.landingTick);
  const positionAt = (hand: string, at: number) => {
    const id = moveByHand(hand)
      .filter((m) => m.landingTick <= at)
      .at(-1)?.toPositionId;
    return id === undefined
      ? p.initial.hands.find((h) => h.hand === hand)
      : p.positions.find((h) => h.hand === hand && h.id === id);
  };
  for (const state of [p.initial, p.final]) {
    if (
      state.independentVoices?.context !== context ||
      JSON.stringify(
        Object.keys(state.independentVoices?.voices ?? {}).sort(),
      ) !== JSON.stringify(specs.map((v) => v.id).sort()) ||
      state.wideLeapPreparation !== undefined
    )
      errors.push("Invalid independent voice boundary context.");
  }
  const eventIds = new Set<string>(),
    headIds = new Set<string>();
  let lastTick = -1;
  for (const e of p.events) {
    if (
      eventIds.has(e.id) ||
      tick(e) < lastTick ||
      e.bar < p.initial.bar ||
      e.bar >= p.final.bar ||
      !Number.isSafeInteger(e.bar) ||
      !specs.some((v) => v.id === e.voiceId && v.hand === e.hand)
    )
      errors.push("Invalid or unordered independent voice event.");
    eventIds.add(e.id);
    lastTick = tick(e);
    for (const n of noteheads(e)) {
      if (headIds.has(n.id)) errors.push("Duplicate independent notehead.");
      headIds.add(n.id);
    }
  }
  for (const spec of specs) {
    const { id, hand, profile, durations } = spec;
    const before = p.initial.independentVoices?.voices[id],
      after = p.final.independentVoices?.voices[id];
    if (
      !before ||
      !after ||
      typeof before.active !== "boolean" ||
      typeof after.active !== "boolean"
    ) {
      errors.push("Missing typed voice boundary state.");
      continue;
    }
    const carried = (p.initial.activeLifetimes ?? []).some(
      (n) => n.lifetime.voiceId === id,
    );
    const change = before.active
      ? after.active
        ? 1 - profile.exitProbability
        : profile.exitProbability
      : after.active
        ? profile.entryProbability
        : 1 - profile.entryProbability;
    if (
      (carried && (!before.active || !after.active)) ||
      (!carried && change === 0)
    )
      errors.push("Voice entry or exit violates its boundary policy.");
    if (
      p.initial.bar === 0 &&
      (before.active || before.lastPitch !== undefined)
    )
      errors.push("A fresh exercise cannot have prior voice activity.");
    let lastPitch = before.lastPitch,
      lastPosition = before.lastPositionId,
      lastFingering = before.lastFingering;
    let resolution = before.resolutionPitch;
    let chromaticPending = !!resolution;
    let attacks = 0,
      soundedTicks = 0;
    const limit = profile.maxIntervalSteps ?? c.melody.maxIntervalSteps;
    const allowed = (midi: number, finger: number) =>
      midi >= (profile.minMidi ?? 21) &&
      midi <= (profile.maxMidi ?? 108) &&
      profile.fingers.includes(finger);
    const timeline = p.events.filter((e) => e.voiceId === id);
    if (
      (lastPitch === undefined) !== (lastPosition === undefined) ||
      (lastPitch === undefined) !== (lastFingering === undefined) ||
      (lastPitch &&
        (!lastFingering?.length ||
          lastFingering[0].midi !== Note.midi(lastPitch) ||
          lastFingering.some((n) => !allowed(n.midi, n.finger))))
    )
      errors.push("Invalid incoming voice pitch or fingering memory.");
    for (let bar = p.initial.bar; bar < p.final.bar; bar++) {
      let cursor = 0;
      const b = bar - p.initial.bar;
      const movement = c.movement;
      const wideMove = moveByHand(hand).some(
        (m) =>
          m.technique === "lifted-wide-leap" && m.landingTick === bar * measure,
      );
      if (wideMove && !id.endsWith(":main")) {
        lastPitch = lastPosition = resolution = undefined;
        lastFingering = undefined;
        chromaticPending = false;
      }
      const restBeats =
        movement.kind === "rested-reposition" &&
        movement.probability > 0 &&
        movement.eligibleBars.includes(b + 1)
          ? movement.preparationBeats
          : c.rhythm.breathBars.includes(b)
            ? c.rhythm.breathBeats
            : 0;
      for (const e of timeline.filter((event) => event.bar === bar)) {
        const pos = positionAt(hand, tick(e));
        if (!pos || e.positionId !== pos.id)
          errors.push(
            "Independent voice changes hand position without a movement.",
          );
        if (e.onset !== cursor || ![240, 480, 960, 1920].includes(e.duration))
          errors.push(
            "Independent voice has a rhythmic gap, overlap or unsupported duration.",
          );
        cursor = e.onset + e.duration;
        if (e.kind === "rest") {
          if (
            e.action !== "REST" ||
            e.notes?.length ||
            e.tie ||
            e.lifetime ||
            e.fingering
          )
            errors.push("Independent voice rest contains attack data.");
          continue;
        }
        if (e.kind !== "note" || !pos) {
          errors.push("Invalid independent note.");
          continue;
        }
        const heads = noteheads(e);
        soundedTicks += e.duration;
        const attack = heads.filter((n) => !n.tie || n.tie.index === 0);
        const continued = heads.filter((n) => (n.tie?.index ?? 0) > 0);
        if (
          c.notation.ties !== false &&
          (c.notation.ties.chordTones === "any" ||
            c.notation.ties.chordTones === "outer") &&
          heads.filter((n) => n.tie !== undefined).length > 1
        )
          errors.push("A partial chord may carry only one selected tone.");
        if (attack.length) attacks++;
        if (
          !after.active ||
          cursor > measure - restBeats * TPQ ||
          (profile.activity === 0 &&
            attack.length &&
            !moveByHand(hand).some((m) => m.landingNoteId === e.id)) ||
          (!durations.some((d) => d.value === e.duration) &&
            !heads.some((n) => n.tie?.pattern === "subdivide"))
        )
          errors.push("Voice activity or sounded rhythm violates its profile.");
        const primary = heads[0];
        const move = moveByHand(hand).find((m) => m.landingNoteId === e.id);
        const tag = e.fingering ?? primary?.fingering;
        const hold = primary?.tie?.lifetimeId ?? primary?.id;
        const alternate =
          !!primary &&
          hold !== undefined &&
          (configuredAlternate(c, e) ||
            (c.fingering.allowRestedAlternates &&
              !move &&
              heads.length === 1 &&
              (!e.fingering ||
                !primary.fingering ||
                e.fingering.expectedFinger ===
                  primary.fingering.expectedFinger) &&
              isRestedAlternateAssignment(pos, primary, tag) &&
              ((primary.tie?.index ?? 0) > 0
                ? alternateHolds.has(hold)
                : tick(e) - TPQ >= start &&
                  voiceRests(p, c, hand, tick(e) - TPQ, tick(e), false))));
        if (alternate) alternateHolds.add(hold);
        else if (tag) errors.push("Invalid rested alternate fingering.");
        if (
          !primary ||
          primary.id !== e.id ||
          primary.midi !== e.midi ||
          primary.pitch !== e.pitch ||
          primary.finger !== e.finger ||
          e.action !==
            (Note.midi(lastPitch ?? "") === e.midi
              ? "REPEAT_NOTE"
              : "PLAY_WITHIN_POSITION")
        )
          errors.push("Invalid independent event anchor or hand action.");
        if (
          move?.technique !== "lifted-wide-leap" &&
          lastPitch &&
          Math.abs(degree(e.pitch) - degree(lastPitch)) > limit
        )
          errors.push("Independent voice exceeds its melodic interval limit.");
        if (lastPosition !== pos.id) {
          resolution = undefined;
          chromaticPending = false;
        }
        const isChromatic = !pos.pitches.includes(e.pitch);
        if (
          chromaticPending &&
          !continued.some((n) => n.id === e.id) &&
          (isChromatic ||
            Math.abs((Note.midi(lastPitch ?? "") ?? -100) - e.midi) !== 1 ||
            (resolution && resolution !== e.pitch))
        )
          errors.push(
            "A chromatic voice did not resolve at its next untied attack.",
          );
        chromaticPending = isChromatic;
        if (!isChromatic) resolution = undefined;
        for (const n of heads) {
          const written = Note.get(n.pitch);
          if (
            n.hand !== hand ||
            (n.fingering && (n !== primary || !alternate)) ||
            !Number.isInteger(n.finger) ||
            !allowed(n.midi, n.finger) ||
            written.midi !== n.midi ||
            !n.written ||
            n.written.key !== c.notation.key ||
            n.written.letter !== written.letter ||
            n.written.octave !== written.oct ||
            n.written.accidental !== written.acc ||
            (!pos.pitches.includes(n.pitch) &&
              (!profile.chromatic || c.chromatic.kind !== "neighbors")) ||
            (pos.fingerToMidi[n.finger - 1] !== n.midi &&
              !pos.pitchOptions?.[n.finger - 1]?.includes(n.pitch) &&
              !(n === primary && alternate)) ||
            (lastPosition === pos.id &&
              lastFingering?.some((previous) => !transition(previous, n)))
          )
            errors.push(
              "Independent voice violates pitch, finger, spelling or transition rules.",
            );
        }
        if (heads.length > 1) {
          const chord = c.chords;
          const shape = heads
            .map((n) => n.finger)
            .sort()
            .join("");
          const span =
            Math.max(...heads.map((n) => n.midi)) -
            Math.min(...heads.map((n) => n.midi));
          if (
            !profile.chords ||
            chord.kind !== "voicings" ||
            chord.probability === 0 ||
            !chord.shapes.some((s) => s.value === shape) ||
            span > chord.maxSpanSemitones ||
            (heads.length === 2 && !chord.dyadIntervals.some((d) => d === span))
          ) {
            errors.push(
              "Independent voice chord violates the approved voicing configuration.",
            );
          } else {
            const harmony = p.harmonies[b]?.split(": ")[1]?.split(" · ") ?? [];
            const root = Chord.get(Chord.detect(harmony)[0] ?? "").tonic;
            const extension = Chord.detect(harmony)[0]?.includes("m")
              ? chord.minorExtension
              : chord.majorExtension;
            const sets = [harmony];
            if (root && extension !== "none")
              sets.push(
                Chord.get(`${root}${extension === "seventh" ? "m7" : "6"}`)
                  .notes,
              );
            if (
              attack.length &&
              !sets.some(
                (set, i) =>
                  (heads.length === 2
                    ? i === 0
                    : set.length === heads.length) &&
                  attack.every((n) => set.includes(Note.pitchClass(n.pitch))),
              )
            )
              errors.push(
                "Independent chord attacks violate the harmonic plan.",
              );
            if (
              lastPosition === pos.id &&
              lastFingering &&
              lastFingering.length > 1
            ) {
              const from = lastFingering.map((n) =>
                degree(Note.fromMidi(n.midi)),
              );
              const to = heads.map((n) => degree(n.pitch));
              if (
                [from, to].some((a, i) =>
                  a.some((x) =>
                    [to, from][i].every(
                      (y) => Math.abs(x - y) > chord.maxVoiceLeadingSteps,
                    ),
                  ),
                )
              )
                errors.push(
                  "Independent chord voice leading exceeds its limit.",
                );
            }
          }
        }
        lastPitch = e.pitch;
        lastPosition = pos.id;
        lastFingering = heads.map(({ midi, finger }) => ({ midi, finger }));
      }
      if (cursor !== measure)
        errors.push("Independent voice does not fill its measure.");
    }
    if (
      (after.active && attacks < profile.minAttacksPerPhrase) ||
      (after.active && soundedTicks < profile.minSoundedTicks)
    )
      errors.push(`${id} did not meet its required phrase activity.`);
    if (
      after.lastPitch !== lastPitch ||
      after.lastPositionId !== lastPosition ||
      JSON.stringify(after.lastFingering) !== JSON.stringify(lastFingering) ||
      !!after.resolutionPitch !== chromaticPending ||
      (after.resolutionPitch &&
        ((resolution && resolution !== after.resolutionPitch) ||
          !p.positions
            .find((h) => h.id === lastPosition && h.hand === hand)
            ?.pitches.includes(after.resolutionPitch) ||
          Math.abs(
            (Note.midi(lastPitch ?? "") ?? -100) -
              (Note.midi(after.resolutionPitch) ?? 100),
          ) !== 1 ||
          Math.abs(degree(lastPitch ?? "") - degree(after.resolutionPitch)) >
            limit))
    )
      errors.push("Final voice memory differs from its timeline.");
  }

  const notes: LifetimeNote[] = [];
  const record = (data: unknown) => {
    const parsed = lifetimeNoteSchema.safeParse(data);
    if (parsed.success) notes.push(parsed.data);
  };
  for (const n of p.initial.activeLifetimes ?? []) record(n);
  for (const e of p.events)
    for (const n of noteheads(e)) {
      if (!n.tie || n.tie.index === 0)
        record({
          id: n.id,
          eventId: e.id,
          midi: n.midi,
          finger: n.finger,
          hand: n.hand,
          positionId: e.positionId,
          lifetime: n.lifetime,
        });
    }
  const coverage = c.coverage;
  if (coverage.kind === "guided") {
    if (
      (start
        ? !validCoverageMemory(p.initial, context, coverage)
        : p.initial.coverage !== undefined) ||
      !validCoverageMemory(p.final, context, coverage) ||
      p.initial.hands.some((hand) => {
        const before = p.initial.coverage?.[hand.hand];
        const after = p.final.coverage![hand.hand]!;
        const center =
          (Math.min(...hand.fingerToMidi) + Math.max(...hand.fingerToMidi)) / 2;
        return (
          (before &&
            (before.min !== after.min ||
              before.max !== after.max ||
              (before.remaining > 0 &&
                Math.abs(before.target - center) >
                  coverage.reachedToleranceSemitones &&
                (before.target !== after.target ||
                  before.remaining - 1 !== after.remaining)))) ||
          !matchesCoverageUsage(
            notes,
            hand,
            before,
            after,
            start,
            end,
            coverage,
          )
        );
      })
    )
      errors.push(
        "Independent coverage state differs from the sounding score.",
      );
  } else if (p.initial.coverage || p.final.coverage) {
    errors.push("Coverage state requires guided coverage.");
  }
  const boundaries = [
    ...new Set([
      start,
      ...notes.flatMap((n) => [n.lifetime.onsetTick, n.lifetime.releaseTick]),
    ]),
  ].sort((a, b) => a - b);
  const peak = { right: 0, left: 0 };
  let held: LifetimeNote[] = [];
  const orderedNotes = [...notes].sort(
    (a, b) => a.lifetime.onsetTick - b.lifetime.onsetTick,
  );
  let next = 0;
  for (const at of boundaries) {
    held = held.filter((n) => n.lifetime.releaseTick > at);
    while (orderedNotes[next]?.lifetime.onsetTick === at) {
      const n = orderedNotes[next++];
      for (const other of held) {
        const overlap =
          Math.min(n.lifetime.releaseTick, other.lifetime.releaseTick) - at;
        if (
          n.lifetime.voiceId !== other.lifetime.voiceId &&
          (overlap > policy.maxOverlapTicks || policy.overlapProbability === 0)
        )
          errors.push("Different voices exceed the permitted overlap.");
      }
      held.push(n);
    }
    if (at < start || at >= end) continue;
    const right = held.filter((n) => n.hand === "right"),
      left = held.filter((n) => n.hand === "left");
    if (right.some((r) => left.some((l) => r.midi <= l.midi)))
      errors.push("Sounded hand positions cross.");
    for (const [hand, sounding] of [
      ["right", right],
      ["left", left],
    ] as const) {
      if (!sounding.length) continue;
      peak[hand] = Math.max(peak[hand], sounding.length);
      const position = positionAt(hand, at);
      if (!position || sounding.some((n) => n.positionId !== position.id)) {
        errors.push(
          "A sounding voice changed position during a physical hold.",
        );
        continue;
      }
      const map = [...position.fingerToMidi];
      sounding.forEach((n) => {
        if (!alternateHolds.has(n.id)) map[n.finger - 1] = n.midi;
      });
      if (
        Math.max(...map) - Math.min(...map) > 10 ||
        map.some(
          (m, i) =>
            i > 0 &&
            ((m - map[i - 1]) * (hand === "right" ? 1 : -1) <= 0 ||
              Math.abs(m - map[i - 1]) > (i <= 2 ? 4 : 2) ||
              Math.abs(center(m) - center(map[i - 1])) > (i <= 2 ? 2.5 : 1.5)),
        )
      )
        errors.push("Combined voices exceed the playable hand map.");
      const sorted = [...sounding].sort((a, b) => a.finger - b.finger);
      if (
        (sounding.some((n) => alternateHolds.has(n.id)) &&
          sorted.some(
            (n, i) =>
              i > 0 &&
              (n.midi - sorted[i - 1].midi) * (hand === "right" ? 1 : -1) <= 0,
          )) ||
        sorted.some(
          (n, i) =>
            i > 0 &&
            Math.abs(center(n.midi) - center(sorted[i - 1].midi)) >
              Math.abs(n.finger - sorted[i - 1].finger) * 1.5 + 0.5,
        ) ||
        (sorted.some(
          (n) => (n.finger === 1 || n.finger === 5) && black(n.midi),
        ) &&
          sorted.some((n) => n.finger > 1 && n.finger < 5 && !black(n.midi)))
      )
        errors.push("Combined voices exceed simultaneous finger reach.");
    }
  }
  for (const hand of ["right", "left"] as const) {
    const group = policy[hand];
    if (!group) continue;
    if (peak[hand] < group.minPolyphony || peak[hand] > group.maxPolyphony)
      errors.push(`${hand} hand did not meet the requested polyphony range.`);
    const lastMain = p.events
      .filter((e) => e.voiceId === `${hand}:main` && e.kind === "note")
      .at(-1);
    const initial = p.initial.hands.find((h) => h.hand === hand),
      final = p.final.hands.find((h) => h.hand === hand);
    if (
      !initial ||
      !final ||
      final.id !== positionAt(hand, end - 1)?.id ||
      final.lastPitch !== (lastMain?.pitch ?? initial.lastPitch) ||
      final.lastNoteEnd !==
        (lastMain ? tick(lastMain) + lastMain.duration : initial.lastNoteEnd) ||
      (lastMain &&
        (final.lastIndex !==
          (hand === "right"
            ? (configuredAlternate(c, lastMain)
                ? lastMain.fingering!.expectedFinger
                : lastMain.finger) - 1
            : 5 -
              (configuredAlternate(c, lastMain)
                ? lastMain.fingering!.expectedFinger
                : lastMain.finger)) ||
          JSON.stringify(final.lastFingering) !==
            JSON.stringify(
              noteheads(lastMain).map(({ midi, finger }) => ({ midi, finger })),
            )))
    )
      errors.push(
        "Independent hand boundary differs from its main voice and movements.",
      );
  }
  for (const m of p.movements) {
    const movement = c.movement;
    const from = positionAt(m.hand, m.landingTick - 1),
      to = positionAt(m.hand, m.landingTick);
    const landing = p.events.find((e) => e.id === m.landingNoteId);
    const b = (m.landingTick - start) / measure;
    const delta =
      from && to ? degree(to.pitches[0]) - degree(from.pitches[0]) : 0;
    const opposite = positionAt(
      m.hand === "right" ? "left" : "right",
      m.landingTick,
    );
    const wide = m.technique === "lifted-wide-leap";
    if (isContinuousMovement(m)) continue;
    const lastPitch =
      p.events
        .filter(
          (e) =>
            e.voiceId === `${m.hand}:main` &&
            e.kind === "note" &&
            tick(e) < m.landingTick,
        )
        .at(-1)?.pitch ??
      p.initial.hands.find((h) => h.hand === m.hand)?.lastPitch;
    if (
      !from ||
      !to ||
      from.id !== m.fromPositionId ||
      to.id !== m.toPositionId ||
      !delta ||
      delta !== m.distance ||
      from.pitches.some(
        (pitch, i) => degree(to.pitches[i]) - degree(pitch) !== delta,
      ) ||
      !landing ||
      landing.kind !== "note" ||
      landing.voiceId !== `${m.hand}:main` ||
      tick(landing) !== m.landingTick ||
      noteheads(landing).length !== 1 ||
      landing.midi !== m.landingMidi ||
      landing.finger !== m.landingFinger ||
      noteheads(landing).some((n) => (n.tie?.index ?? 0) > 0 || n.fingering) ||
      landing.fingering ||
      from.pitches.includes(landing.pitch) ||
      notes.some(
        (n) =>
          n.hand === m.hand &&
          n.lifetime.onsetTick < m.landingTick &&
          n.lifetime.releaseTick > m.cueTick,
      ) ||
      (wide
        ? !validateWideLanding(p, c, m, from, landing, lastPitch)
        : movement.kind !== "rested-reposition" ||
          movement.probability === 0 ||
          m.technique !== "lift-and-reposition" ||
          !movement.eligibleBars.some((bar) => bar === b) ||
          m.cueTick !== m.landingTick - movement.preparationBeats * TPQ ||
          Math.abs(delta) > movement.maxDistanceSteps ||
          !hasMovementPreparation(p, c, m)) ||
      (opposite &&
        (m.hand === "right"
          ? Math.min(...to.fingerToMidi) <= Math.max(...opposite.fingerToMidi)
          : Math.max(...to.fingerToMidi) >= Math.min(...opposite.fingerToMidi)))
    )
      errors.push(
        "Invalid independent hand relocation, preparation or landing.",
      );
  }
  errors.push(
    ...validateWideSweeps(p, c),
    ...validateVoiceLeapReservations(p, c),
  );
  if (
    new Set(p.movements.map((m) => `${m.hand}:${m.landingTick}`)).size !==
      p.movements.length ||
    new Set(p.movements.map((m) => m.id)).size !== p.movements.length
  )
    errors.push("Duplicate independent movement.");
  const right = p.initial.hands.find((h) => h.hand === "right"),
    left = p.initial.hands.find((h) => h.hand === "left");
  if (
    right &&
    left &&
    Math.min(...right.fingerToMidi) <= Math.max(...left.fingerToMidi)
  )
    errors.push("Initial hand positions overlap.");
  return [...new Set(errors)];
}
