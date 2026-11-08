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
} from "vexflow/bravura";
import {
  TPQ,
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
    for (let b = 0; b < settings.bars; b++) {
      const staves: Stave[] = [];
      const voices: Voice[] = [];
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
        const notes = events
          .filter((e) => e.bar === startBar + b && e.hand === hand.hand)
          .map((e) => {
            const heads = [...noteheads(e)].sort((a, b) => a.midi - b.midi);
            const duration =
              String((TPQ * 4) / e.duration) + (e.kind === "rest" ? "r" : "");
            const note = new StaveNote({
              clef: hand.clef,
              keys:
                e.kind === "rest"
                  ? [hand.clef === "bass" ? "d/3" : "b/4"]
                  : heads.map((n) =>
                      n.pitch.replace(/(\d+)$/, "/$1").toLowerCase(),
                    ),
              duration,
            });
            note.setAttribute("id", e.id);
            heads.forEach((head, index) => {
              const sign = accidentalState.attack(head.pitch);
              if (sign) note.addModifier(new Accidental(sign), index);
              const show = selected.get(head.id)?.show;
              if (show)
                note.addModifier(
                  new FretHandFinger(String(head.finger))
                    .setFont("Arial", 12, "bold")
                    .setPosition(
                      heads.length > 1
                        ? Modifier.Position.RIGHT
                        : Modifier.Position.ABOVE,
                    ),
                  index,
                );
            });
            if (showPlacement(settings.hints, reveal)) {
              const move = movements?.find(
                (m) =>
                  m.hand === e.hand &&
                  m.cueTick === e.bar * settings.beats * TPQ + e.onset,
              );
              if (move)
                note.addModifier(
                  new Annotation(movementAnnotation(move))
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
        beams.push(...Beam.generateBeams(notes));
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
      const format = new Formatter().joinVoices(voices);
      format.format(voices, barW - (b === 0 ? 115 : 30));
      voices.forEach((v, i) => v.draw(ctx, staves[i]));
      beams.forEach((beam) => beam.setContext(ctx).draw());
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
        "Generated sheet music with suggested fingering",
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
