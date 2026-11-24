import { useContext } from "react";
import { LanguageContext, translate } from "../shared/i18n";
import { useEffect, useRef, useState } from "react";
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  FretHandFinger,
  Modifier,
  Accidental,
  Beam,
  StaveConnector,
  Annotation,
  StaveTie,
  Stem,
} from "vexflow/bravura";
import {
  TPQ,
  isContinuousMovement,
  noteheads,
  type ScoreEvent,
  type HandState,
  type Settings,
  type MovementPlan,
  type HintMemory,
} from "./model";
import {
  selectFingeringHints,
  showPlacement,
  movementAnnotation,
} from "./hints";
import { AccidentalState } from "./pitch";
export function Notation({
  events,
  hands,
  settings,
  startBar,
  currentId,
  reveal,
  movements,
  positions = hands,
  hintEvents = events,
  hintMemory,
}: {
  events: ScoreEvent[];
  hands: HandState[];
  settings: Settings;
  startBar: number;
  currentId?: string;
  reveal: boolean;
  movements?: MovementPlan[];
  positions?: HandState[];
  hintEvents?: ScoreEvent[];
  hintMemory?: HintMemory;
}) {
  const language = useContext(LanguageContext);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    document.fonts?.ready.then(() => {
      if (mounted) setFontsLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (host.current?.parentElement) host.current.parentElement.scrollLeft = 0;
  }, [startBar]);
  useEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.max(320, e.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = host.current!;
    el.replaceChildren();
    const density = Math.max(
      0,
      ...hands.flatMap((hand) =>
        Array.from(
          { length: settings.bars },
          (_, bar) =>
            events.filter(
              (e) => e.hand === hand.hand && e.bar === startBar + bar,
            ).length,
        ),
      ),
    );
    const w = Math.max(
        width,
        settings.bars * Math.max(220, 120 + density * 20) + 24,
      ),
      height = hands.length === 2 ? 330 : 180;
    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(w, height);
    const ctx = renderer.getContext();
    const selected = new Map(
      selectFingeringHints(
        hintEvents,
        positions,
        movements ?? [],
        settings.hints,
        reveal,
        hintMemory,
      ).map((h) => [h.noteId, h]),
    );
    ctx.setFont("Arial", 12);
    const barW = (w - 24) / settings.bars;
    const drawn: StaveNote[] = [];
    const independent = events.some((e) => e.voiceId !== undefined);
    const segments = new Map<
      string,
      {
        note: StaveNote;
        index: number;
        head: ReturnType<typeof noteheads>[number];
      }
    >();
    for (let b = 0; b < settings.bars; b++) {
      const staves: Stave[] = [];
      const voices: Voice[] = [];
      const voiceStaves: Stave[] = [];
      const staffVoices: Voice[][] = [];
      const beams: Beam[] = [];
      hands.forEach((hand, hi) => {
        const stave = new Stave(12 + b * barW, hi * 145 + 38, barW);
        if (b === 0)
          stave
            .addClef(hand.clef)
            .addKeySignature(settings.key)
            .addTimeSignature(`${settings.beats}/4`);
        stave.setContext(ctx).draw();
        staves.push(stave);
        const accidentalState = new AccidentalState(settings.key);
        const measureEvents = events.filter(
          (e) => e.bar === startBar + b && e.hand === hand.hand,
        );
        const lanes = [...new Set(measureEvents.map((e) => e.voiceId))].sort(
          (a, b) =>
            (a?.endsWith(":main") ? 0 : Number(a?.split(":")[1] ?? 0)) -
            (b?.endsWith(":main") ? 0 : Number(b?.split(":")[1] ?? 0)),
        );
        const signs = new Map<string, ReturnType<AccidentalState["attack"]>>();
        if (independent) {
          const onsets = [...new Set(measureEvents.map((e) => e.onset))].sort(
            (a, b) => a - b,
          );
          for (const onset of onsets) {
            const heads = measureEvents
              .filter((e) => e.onset === onset)
              .flatMap(noteheads);
            const simultaneous = accidentalState.simultaneous(
              heads.map((head) => ({
                pitch: head.pitch,
                tied: (head.tie?.index ?? 0) > 0,
              })),
            );
            heads.forEach((head, i) => signs.set(head.id, simultaneous[i]));
          }
        }
        const staffGroup: Voice[] = [];
        staffVoices.push(staffGroup);
        for (const [lane, id] of (lanes.length
          ? lanes
          : [undefined]
        ).entries()) {
          const polyphonic = lanes.length > 1;
          const stem = lane % 2 === 0 ? Stem.UP : Stem.DOWN;
          const restKeys =
            hand.clef === "bass"
              ? ["f/3", "b/2", "a/3", "g/2", "c/4"]
              : ["d/5", "g/4", "f/5", "e/4", "a/5"];
          const notes = measureEvents
            .filter((e) => e.voiceId === id)
            .map((e) => {
              const heads = [...noteheads(e)].sort((a, b) => a.midi - b.midi);
              const duration =
                String((TPQ * 4) / e.duration) + (e.kind === "rest" ? "r" : "");
              const note = new StaveNote({
                clef: hand.clef,
                keys:
                  e.kind === "rest"
                    ? [
                        polyphonic
                          ? restKeys[lane]
                          : hand.clef === "bass"
                            ? "d/3"
                            : "b/4",
                      ]
                    : heads.map((n) =>
                        n.pitch.replace(/(\d+)$/, "/$1").toLowerCase(),
                      ),
                duration,
                ...(polyphonic ? { stemDirection: stem } : {}),
              });
              note.setAttribute("id", e.id);
              heads.forEach((head, index) => {
                segments.set(head.id, { note, index, head });
                const sign = independent
                  ? signs.get(head.id)
                  : accidentalState.attack(
                      head.pitch,
                      (head.tie?.index ?? 0) > 0,
                    );
                if (sign) note.addModifier(new Accidental(sign), index);
                const hint = selected.get(head.id);
                const substitution = hint?.substitution;
                if (hint?.show)
                  note.addModifier(
                    new FretHandFinger(
                      substitution
                        ? `${substitution.fromFinger}–${substitution.toFinger}`
                        : String(head.finger),
                    )
                      .setFont("Arial", 12, "bold")
                      .setPosition(
                        heads.length > 1
                          ? Modifier.Position.RIGHT
                          : Modifier.Position.ABOVE,
                      ),
                    index,
                  );
              });
              if (
                (!independent || lane === 0) &&
                showPlacement(settings.hints, reveal)
              ) {
                const cues = movements?.filter(
                  (m) =>
                    m.hand === e.hand &&
                    (isContinuousMovement(m)
                      ? m.source.eventId === e.id ||
                        (m.cueTick < startBar * settings.beats * TPQ &&
                          m.landingNoteId === e.id)
                      : m.cueTick === e.bar * settings.beats * TPQ + e.onset),
                );
                for (const move of cues ?? [])
                  note.addModifier(
                    new Annotation(
                      translate(movementAnnotation(move), language),
                    )
                      .setFont("Arial", 9)
                      .setVerticalJustification(Annotation.VerticalJustify.TOP),
                    0,
                  );
              }
              drawn.push(note);
              return note;
            });
          const voice = new Voice({
            numBeats: settings.beats,
            beatValue: 4,
          }).addTickables(notes);
          voices.push(voice);
          staffGroup.push(voice);
          voiceStaves.push(stave);
          beams.push(
            ...Beam.generateBeams(
              notes,
              polyphonic
                ? { stemDirection: stem, maintainStemDirections: true }
                : {},
            ),
          );
        }
      });
      if (staves.length === 2) {
        new StaveConnector(staves[0], staves[1])
          .setType(
            b === 0
              ? StaveConnector.type.BRACE
              : StaveConnector.type.SINGLE_LEFT,
          )
          .setContext(ctx)
          .draw();
        const left = Math.max(...staves.map((s) => s.getNoteStartX()));
        staves.forEach((s) => s.setNoteStartX(left));
      }
      const format = new Formatter();
      if (independent) staffVoices.forEach((group) => format.joinVoices(group));
      else format.joinVoices(voices);
      format.format(voices, barW - (b === 0 ? 115 : 30));
      voices.forEach((v, i) => v.draw(ctx, voiceStaves[i]));
      beams.forEach((beam) => beam.setContext(ctx).draw());
    }
    // Draw once after every stave is formatted so curves can cross barlines.
    // Missing endpoints deliberately produce VexFlow's partial ties at viewport edges.
    for (const { note, index, head } of segments.values()) {
      const t = head.tie;
      if (!t) continue;
      if (t.nextId) {
        const next = segments.get(t.nextId);
        new StaveTie({
          firstNote: note,
          lastNote: next?.note,
          firstIndexes: [index],
          lastIndexes: [next?.index ?? index],
        })
          .setContext(ctx)
          .draw();
      }
      if (t.previousId && !segments.has(t.previousId))
        new StaveTie({
          lastNote: note,
          firstIndexes: [index],
          lastIndexes: [index],
        })
          .setContext(ctx)
          .draw();
    }
    const svg = el.querySelector("svg");
    if (svg) {
      const boxes = drawn.map((note) => note.getBoundingBox());
      const top = Math.min(0, ...boxes.map((box) => box.getY() - 12));
      const bottom = Math.max(
        height,
        ...boxes.map((box) => box.getY() + box.getH() + 12),
      );
      renderer.resize(w, bottom - top);
      svg.setAttribute("viewBox", `0 ${top} ${w} ${bottom - top}`);
      svg.setAttribute("role", "img");
      svg.setAttribute(
        "aria-label",
        translate("Generated sheet music with suggested fingering", language),
      );
      svg.setAttribute("data-staff-count", String(hands.length));
    }
  }, [
    events,
    hands,
    settings,
    startBar,
    width,
    reveal,
    language,
    fontsLoaded,
    movements,
    positions,
    hintEvents,
    hintMemory,
  ]);
  useEffect(() => {
    host.current
      ?.querySelectorAll(".current-note")
      .forEach((n) => n.classList.remove("current-note"));
    if (currentId) {
      const node = host.current?.querySelector(
        `[id="vf-${CSS.escape(currentId)}"]`,
      );
      node?.classList.add("current-note");
    }
  }, [
    currentId,
    events,
    settings,
    reveal,
    startBar,
    width,
    fontsLoaded,
    movements,
    positions,
  ]);
  return (
    <div className="notation-scroll">
      <div ref={host} className="notation" data-testid="notation" />
    </div>
  );
}
