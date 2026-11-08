import { Chord, Note, Scale } from "tonal";
import { TPQ, VERSION, noteheads, type Phrase } from "../score/model";
// Independent reconstruction: never calls the planner or its candidate graph.
export function validatePhrase(p: Phrase): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const s = p.settings;
  const black = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
  const center = (m: number) =>
    Math.floor(m / 12) * 7 +
    [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6][m % 12];
  const physical = (map: number[], hand: string) =>
    map.length === 5 &&
    Math.max(...map) - Math.min(...map) <= 10 &&
    map.every(
      (m, i) =>
        i === 0 ||
        ((m - map[i - 1]) * (hand === "right" ? 1 : -1) > 0 &&
          Math.abs(m - map[i - 1]) <= (i <= 2 ? 4 : 2) &&
          Math.abs(center(m) - center(map[i - 1])) <= (i <= 2 ? 2.5 : 1.5)),
    );
  const headIds = new Set<string>();
  const allowedBars: readonly number[] = {
    off: [],
    easy: [2],
    medium: [1, 3],
    hard: [1, 2, 3],
  }[s.handMovements];
  const distanceCap = { off: 0, easy: 2, medium: 3, hard: 4 }[s.handMovements];
  const degree = (pitch: string) => {
    const n = Note.get(pitch);
    return (n.oct ?? -100) * 7 + "CDEFGAB".indexOf(n.letter);
  };
  const tick = (e: { bar: number; onset: number }) =>
    e.bar * s.beats * TPQ + e.onset;
  if (p.version !== VERSION || p.final.bar !== p.initial.bar + 4)
    errors.push("Invalid generator version or chunk boundary.");
  if (
    !Number.isInteger(p.initial.bar) ||
    p.initial.bar < 0 ||
    [p.initial, p.final].some(
      (state) =>
        !Number.isInteger(state.rng) ||
        state.rng <= 0 ||
        state.rng > 4294967295,
    )
  )
    errors.push("Invalid stream state.");
  if (
    s.maxShift > distanceCap ||
    (s.handMovements === "off" && (s.shiftFrequency !== 0 || s.maxShift !== 0))
  )
    errors.push("Movement settings violate level constraints.");
  if (s.interval > { small: 1, easy: 2, medium: 4, large: 7 }[s.noteJumps])
    errors.push("Melodic interval settings violate Note jumps.");
  const expected = s.hand === "both" ? ["right", "left"] : [s.hand];
  if (
    JSON.stringify(p.initial.hands.map((h) => h.hand)) !==
      JSON.stringify(expected) ||
    p.final.hands.length !== expected.length
  )
    errors.push("Missing or unexpected hand state.");
  for (const pos of [...p.positions, ...p.initial.hands, ...p.final.hands]) {
    const min = pos.hand === "left" && s.hand === "both" ? s.leftMin : s.min,
      max = pos.hand === "left" && s.hand === "both" ? s.leftMax : s.max;
    const midis = pos.pitches.map((x) => Note.midi(x) ?? -1),
      scale = Scale.get(`${s.key} major`).notes;
    // Independently reconstruct allowed finger-order patterns and safety caps.
    const ordered =
      pos.hand === "right" ? pos.pitches : [...pos.pitches].reverse();
    const offsets = ordered
      .map((pitch) => Math.abs(degree(pitch) - degree(ordered[0])))
      .join(",");
    const patterns: Record<string, string> = {
      "0,1,2,3,4": "",
      "0,2,3,4,5": "-thumbGap",
      "0,1,3,4,5": "-indexGap",
      "0,2,4,5,6": "-twoGaps",
    };
    const permitted = ["0,1,2,3,4"];
    if (s.fingerSpacing !== "off") permitted.push("0,2,3,4,5");
    if (s.fingerSpacing === "medium" || s.fingerSpacing === "hard")
      permitted.push("0,1,3,4,5");
    if (s.fingerSpacing === "hard") permitted.push("0,2,4,5,6");
    if (
      !permitted.includes(offsets) ||
      Math.max(...midis) - Math.min(...midis) > 10 ||
      pos.fingerToMidi.some(
        (n, i, mapped) =>
          i > 0 && Math.abs(n - mapped[i - 1]) > (i <= 2 ? 4 : 2),
      )
    )
      errors.push("Unapproved or excessive finger spacing.");
    if (
      pos.min !== min ||
      pos.max !== max ||
      pos.clef !== (pos.hand === "right" ? s.rhClef : s.lhClef) ||
      pos.id !==
        `${pos.hand}-${pos.pitches[0]}${patterns[offsets] ?? "-invalid"}`
    )
      errors.push("Position metadata differs from settings.");
    if (
      midis.length !== 5 ||
      pos.pitches.some(
        (pitch, i) =>
          !scale.includes(Note.pitchClass(pitch)) ||
          midis[i] < min ||
          midis[i] > max ||
          (i > 0 &&
            (degree(pitch) - degree(pos.pitches[i - 1]) < 1 ||
              midis[i] <= midis[i - 1] ||
              midis[i] - midis[i - 1] > 4)),
      )
    )
      errors.push("Invalid diatonic position, spelling or range.");
    if (
      JSON.stringify(pos.fingerToMidi) !==
      JSON.stringify(pos.hand === "right" ? midis : [...midis].reverse())
    )
      errors.push("Position finger map does not match hand direction.");
    if (pos.pitchOptions) {
      const reconstructed = pos.fingerToMidi.map((m, i) => {
        const base = pos.pitches.find((pitch) => Note.midi(pitch) === m)!;
        const n = Note.get(base);
        return [
          base,
          ...[-1, 1].flatMap((delta) => {
            if (
              s.accidentals === "off" ||
              i === 0 ||
              i === 4 ||
              Math.abs(n.alt + delta) > 1
            )
              return [];
            const alt = n.alt + delta,
              pitch = `${n.letter}${alt === -1 ? "b" : alt === 1 ? "#" : ""}${n.oct}`;
            const midi = Note.midi(pitch) ?? -1,
              map = [...pos.fingerToMidi];
            map[i] = midi;
            return midi >= min && midi <= max && physical(map, pos.hand)
              ? [pitch]
              : [];
          }),
        ];
      });
      if (JSON.stringify(reconstructed) !== JSON.stringify(pos.pitchOptions))
        errors.push("Unvalidated chromatic position options.");
    }
  }
  for (const state of [p.initial, p.final])
    for (const h of state.hands) {
      if (!Number.isInteger(h.lastIndex) || h.lastIndex < 0 || h.lastIndex > 4)
        errors.push("Invalid boundary finger index.");
      if (
        h.lastPitch !== undefined &&
        (degree(h.pitches[h.lastIndex]) !== degree(h.lastPitch) ||
          (!h.pitches.includes(h.lastPitch) &&
            !h.pitchOptions?.flat().includes(h.lastPitch)) ||
          !Number.isInteger(h.lastNoteEnd) ||
          h.lastNoteEnd! > state.bar * s.beats * TPQ)
      )
        errors.push("Inconsistent boundary hand context.");
      if (
        h.resolutionPitch !== undefined &&
        (!h.lastPitch ||
          !h.pitches.includes(h.resolutionPitch) ||
          Math.abs(
            (Note.midi(h.lastPitch) ?? -100) -
              (Note.midi(h.resolutionPitch) ?? 100),
          ) !== 1 ||
          s.accidentals === "off")
      )
        errors.push("Invalid pending chromatic resolution.");
    }
  for (const hand of expected) {
    let active = p.initial.hands.find((h) => h.hand === hand);
    if (!active) continue;
    let lastPitch = active.lastPitch,
      lastEnd = active.lastNoteEnd,
      lastIndex = active.lastIndex;
    let lastVoicing = active.lastVoicing;
    let unresolved = active.resolutionPitch ? active.lastPitch : undefined;
    const used = new Set<string>();
    for (let bar = p.initial.bar; bar < p.final.bar; bar++) {
      const events = p.events
        .filter((e) => e.hand === hand && e.bar === bar)
        .sort((a, b) => a.onset - b.onset);
      let end = 0;
      for (const e of events) {
        if (ids.has(e.id)) errors.push("Duplicate note ID.");
        ids.add(e.id);
        if (
          !Number.isInteger(e.onset) ||
          e.onset !== end ||
          !Number.isInteger(e.duration) ||
          e.duration <= 0
        )
          errors.push("Gap, overlap or invalid duration.");
        end += e.duration;
        const moves = p.movements.filter(
          (m) => m.hand === hand && m.landingTick === tick(e),
        );
        if (moves.length > 1) errors.push("Duplicate movement.");
        const move = moves[0];
        if (move) {
          used.add(move.id);
          const to = p.positions.find(
            (pos) => pos.hand === hand && pos.id === move.toPositionId,
          );
          const prep = p.events.find(
            (rest) =>
              rest.hand === hand &&
              rest.kind === "rest" &&
              tick(rest) === move.cueTick &&
              tick(rest) + rest.duration === move.landingTick,
          );
          if (
            !to ||
            move.fromPositionId !== active.id ||
            move.toPositionId === active.id ||
            move.technique !== "lift-and-reposition" ||
            !allowedBars.includes(bar - p.initial.bar) ||
            e.onset !== 0 ||
            s.shiftFrequency === 0 ||
            s.maxShift === 0 ||
            e.kind !== "note" ||
            move.landingNoteId !== e.id ||
            move.landingMidi !== e.midi ||
            move.landingFinger !== e.finger ||
            move.cueTick !== move.landingTick - TPQ ||
            !prep ||
            prep.duration < TPQ ||
            (lastEnd !== undefined && lastEnd > move.cueTick)
          )
            errors.push(
              "Invalid movement, landing or advance preparation cue.",
            );
          if (to) {
            const distance = degree(to.pitches[0]) - degree(active.pitches[0]);
            const shape = (pitches: string[]) =>
              pitches
                .map((pitch) => degree(pitch) - degree(pitches[0]))
                .join(",");
            if (shape(to.pitches) !== shape(active.pitches))
              errors.push(
                "A repositioning must preserve the finger-spacing pattern.",
              );
            if (
              move.distance !== distance ||
              !distance ||
              Math.abs(distance) > s.maxShift ||
              Math.abs(distance) > distanceCap ||
              active.pitches.includes(e.pitch)
            )
              errors.push("Unnecessary or excessive repositioning.");
            active = to;
            unresolved = undefined;
          }
        }
        if (e.positionId !== active.id) errors.push("Unannounced shift.");
        if (e.kind === "note") {
          if (
            unresolved &&
            (!active.pitches.includes(e.pitch) ||
              Math.abs((Note.midi(unresolved) ?? -100) - e.midi) !== 1)
          )
            errors.push(
              "Chromatic figure does not resolve by semitone within its position.",
            );
          unresolved = active.pitches.includes(e.pitch) ? undefined : e.pitch;
          const expectedFinger =
            active.fingerToMidi.findIndex(
              (m, i) =>
                m === e.midi || active!.pitchOptions?.[i]?.includes(e.pitch),
            ) + 1;
          const preparation = p.events.find(
            (rest) =>
              rest.hand === hand &&
              rest.kind === "rest" &&
              rest.duration >= TPQ &&
              tick(rest) + rest.duration === tick(e),
          );
          const alternate =
            e.fingering?.technique === "rested-alternate" &&
            (s.handMovements === "medium" || s.handMovements === "hard") &&
            !move &&
            e.fingering.expectedFinger === expectedFinger &&
            expectedFinger > 0 &&
            Math.abs(e.finger - expectedFinger) === 1 &&
            Math.abs(active.fingerToMidi[e.finger - 1] - e.midi) <= 2 &&
            !!preparation &&
            (lastEnd === undefined || lastEnd <= tick(preparation));
          if (e.fingering && !alternate)
            errors.push("Invalid rested alternate fingering.");
          if (
            !Number.isInteger(e.finger) ||
            e.finger < 1 ||
            e.finger > 5 ||
            (!alternate &&
              active.fingerToMidi[e.finger - 1] !== e.midi &&
              !active.pitchOptions?.[e.finger - 1]?.includes(e.pitch)) ||
            Note.midi(e.pitch) !== e.midi ||
            (!active.pitches.includes(e.pitch) &&
              !active.pitchOptions?.[e.finger - 1]?.includes(e.pitch)) ||
            e.midi < active.min ||
            e.midi > active.max
          )
            errors.push("Pitch, spelling or finger violates hand plan.");
          const heads = noteheads(e);
          if (
            !heads.length ||
            (e.notes &&
              (heads[0].id !== e.id ||
                heads[0].pitch !== e.pitch ||
                heads[0].midi !== e.midi ||
                heads[0].finger !== e.finger))
          )
            errors.push("Invalid event primary notehead.");
          for (const n of heads) {
            if (headIds.has(n.id)) errors.push("Duplicate notehead ID.");
            headIds.add(n.id);
            const w = Note.get(n.pitch);
            if (
              n.hand !== e.hand ||
              !Number.isInteger(n.finger) ||
              n.finger < 1 ||
              n.finger > 5 ||
              !Number.isInteger(n.midi) ||
              n.midi < active.min ||
              n.midi > active.max ||
              Note.midi(n.pitch) !== n.midi ||
              (n.midi !== active.fingerToMidi[n.finger - 1] &&
                !active.pitchOptions?.[n.finger - 1]?.includes(n.pitch) &&
                !(heads.length === 1 && alternate)) ||
              (n.written &&
                (n.written.key !== s.key ||
                  n.written.letter !== w.letter ||
                  n.written.octave !== w.oct ||
                  n.written.accidental !== w.acc))
            )
              errors.push("Invalid notehead spelling or planned finger.");
            if (
              s.accidentals === "off" &&
              !Scale.get(`${s.key} major`).notes.includes(
                Note.pitchClass(n.pitch),
              )
            )
              errors.push("Chromatic note with accidentals Off.");
          }
          if (heads.length > 1) {
            if (e.fingering || heads.some((n) => n.fingering))
              errors.push(
                "Alternate fingers cannot be used in simultaneous chords.",
              );
            const sorted = [...heads].sort((a, b) => a.finger - b.finger),
              shape = sorted.map((n) => n.finger).join("");
            const allowed = [
              "13",
              "14",
              "15",
              "24",
              "25",
              "35",
              ...(s.chords === "medium" || s.chords === "hard"
                ? ["135", "125", "145", "124", "245"]
                : []),
              ...(s.chords === "hard" ? ["1235", "1245", "1345"] : []),
            ];
            const map = [...active.fingerToMidi];
            heads.forEach((n) => (map[n.finger - 1] = n.midi));
            const span =
              Math.max(...heads.map((n) => n.midi)) -
              Math.min(...heads.map((n) => n.midi));
            const harmony =
              p.harmonies[bar - p.initial.bar]?.split(": ")[1]?.split(" · ") ??
              [];
            const pcs = heads.map((n) => Note.pitchClass(n.pitch));
            const detected = Chord.detect(harmony)[0],
              root = detected ? Chord.get(detected).tonic : undefined;
            const sets = [
              harmony,
              ...(s.chords === "hard" && root
                ? [
                    Chord.get(`${root}${detected.includes("m") ? "m7" : "6"}`)
                      .notes,
                  ]
                : []),
            ];
            if (
              s.chords === "off" ||
              !allowed.includes(shape) ||
              !physical(map, hand) ||
              new Set(heads.map((n) => n.midi)).size !== heads.length ||
              new Set(heads.map((n) => n.finger)).size !== heads.length ||
              span > (s.chords === "easy" ? 7 : 9) ||
              heads.some(
                (n) =>
                  (n.finger === 1 || n.finger === 5) &&
                  black(n.midi) &&
                  heads.some(
                    (o) => o.finger > 1 && o.finger < 5 && !black(o.midi),
                  ),
              ) ||
              sorted.some(
                (n, i) =>
                  i > 0 &&
                  Math.abs(center(n.midi) - center(sorted[i - 1].midi)) >
                    Math.abs(n.finger - sorted[i - 1].finger) * 1.5 + 0.5,
              )
            )
              errors.push("Unapproved or unplayable simultaneous chord.");
            if (
              heads.length === 2
                ? ![3, 4, 5, 7, 8, 9].includes(span) ||
                  !pcs.every((pc) => harmony.includes(pc))
                : !sets.some(
                    (set) =>
                      set.length === heads.length &&
                      set.every((pc) => pcs.includes(pc)),
                  )
            )
              errors.push("Chord violates harmonic plan.");
            if (
              lastVoicing &&
              lastVoicing.length > 1 &&
              heads.some(
                (n) =>
                  Math.min(
                    ...lastVoicing!.map((m) =>
                      Math.abs(degree(Note.fromMidi(m)) - degree(n.pitch)),
                    ),
                  ) > s.interval,
              )
            )
              errors.push("Chord voice leading exceeds Note jumps.");
            if (
              lastVoicing &&
              lastVoicing.length > 1 &&
              lastVoicing.some(
                (m) =>
                  Math.min(
                    ...heads.map((n) =>
                      Math.abs(degree(Note.fromMidi(m)) - degree(n.pitch)),
                    ),
                  ) > s.interval,
              )
            )
              errors.push("Chord voice leading exceeds Note jumps.");
          }
          lastVoicing = heads.map((n) => n.midi);
          if (
            lastPitch &&
            Math.abs(degree(e.pitch) - degree(lastPitch)) > s.interval
          )
            errors.push("Maximum diatonic interval exceeded.");
          if (
            e.action !==
            (lastPitch === e.pitch ? "REPEAT_NOTE" : "PLAY_WITHIN_POSITION")
          )
            errors.push("Incorrect hand action.");
          lastPitch = e.pitch;
          lastEnd = tick(e) + e.duration;
          lastIndex = active.pitches.findIndex(
            (pitch) => degree(pitch) === degree(e.pitch),
          );
        } else if (e.action !== "REST" || (e.notes && e.notes.length > 0))
          errors.push("Incorrect rest action.");
      }
      if (end !== s.beats * TPQ)
        errors.push("Measure length differs from meter.");
    }
    const final = p.final.hands.find((h) => h.hand === hand);
    if (
      !final ||
      final.id !== active.id ||
      JSON.stringify(final.fingerToMidi) !==
        JSON.stringify(active.fingerToMidi) ||
      final.lastIndex !== lastIndex ||
      final.lastPitch !== lastPitch ||
      final.lastNoteEnd !== lastEnd
    )
      errors.push("Final hand state differs from score.");
    if (
      final?.lastVoicing &&
      JSON.stringify(final.lastVoicing) !== JSON.stringify(lastVoicing)
    )
      errors.push("Final chord state differs from score.");
    if (!!final?.resolutionPitch !== !!unresolved)
      errors.push("Final chromatic resolution state differs from score.");
    if (p.movements.filter((m) => m.hand === hand).some((m) => !used.has(m.id)))
      errors.push("Orphan movement cue.");
  }
  if (p.events.length !== ids.size)
    errors.push("Out-of-chunk or unknown-hand events.");
  if (
    new Set(p.movements.map((m) => m.id)).size !== p.movements.length ||
    p.movements.some((m) => !expected.includes(m.hand))
  )
    errors.push("Invalid movement identities.");
  // Reconstruct both positions at every movement tick, including initial state.
  if (s.hand === "both") {
    const active = new Map(p.initial.hands.map((h) => [h.hand, h]));
    const collision = () => {
      const r = active.get("right"),
        l = active.get("left");
      if (!r || !l) return true;
      return Math.min(...r.fingerToMidi) <= Math.max(...l.fingerToMidi);
    };
    if (collision()) errors.push("Hand positions overlap.");
    for (const m of [...p.movements].sort(
      (a, b) => a.landingTick - b.landingTick,
    )) {
      const pos = p.positions.find(
        (x) => x.hand === m.hand && x.id === m.toPositionId,
      );
      if (pos) active.set(m.hand, pos);
      if (collision()) errors.push("Hand positions overlap.");
    }
  }
  return [...new Set(errors)];
}
