import {
  Articulation,
  Curve,
  Modifier,
  Stem,
  type RenderContext,
  type Stave,
  type StaveNote,
} from "vexflow/bravura";
import type { SlurMember } from "./articulationModel";
import type { ScoreEvent } from "./model";

const glyphs = {
  staccato: "a.",
  staccatissimo: "av",
  tenuto: "a-",
  accent: "a>",
  marcato: "a^",
} as const;

function direction(event: ScoreEvent) {
  const placement = event.slur?.placement;
  if (placement === "above") return -1;
  if (placement === "below") return 1;
  const voice = event.voiceId?.split(":")[1];
  if (voice) return voice === "main" || Number(voice) % 2 === 1 ? -1 : 1;
  return event.hand === "right" ? -1 : 1;
}

export function addArticulation(
  note: StaveNote,
  event: ScoreEvent,
  polyphonic: boolean,
) {
  const touch =
    event.slur?.style === "portato" ? "tenuto" : event.articulation?.touch;
  const emphasis = event.articulation?.emphasis;
  const above = event.slur
    ? direction(event) < 0
    : (note.getStemDirection() === Stem.UP) === polyphonic;
  const index = above ? note.getKeys().length - 1 : 0;
  const modifiers: Articulation[] = [];
  for (const mark of [touch, emphasis]) {
    if (
      !mark ||
      mark === "natural" ||
      mark === "legato" ||
      mark === "non-legato"
    )
      continue;
    const modifier = new Articulation(glyphs[mark]).setPosition(
      above ? Modifier.Position.ABOVE : Modifier.Position.BELOW,
    );
    note.addModifier(modifier, index);
    modifiers.push(modifier);
  }
  return modifiers;
}

export type DrawnSlurMember = {
  event: ScoreEvent & { slur: SlurMember };
  note: StaveNote;
  continuation?: boolean;
};

export function drawSlurs(
  context: RenderContext,
  members: DrawnSlurMember[],
  edges: Map<ScoreEvent["hand"], { first: Stave; last: Stave }>,
) {
  const groups = new Map<string, DrawnSlurMember[]>();
  for (const member of members) {
    const group = groups.get(member.event.slur.id) ?? [];
    group.push(member);
    groups.set(member.event.slur.id, group);
  }
  const bounds: number[] = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        a.event.slur.index - b.event.slur.index ||
        a.event.bar - b.event.bar ||
        a.event.onset - b.event.onset,
    );
    const first = group[0];
    const last = group.at(-1)!;
    const side = direction(first.event);
    const staves = edges.get(first.event.hand)!;
    const clipStart = first.event.slur.index > 0 || !!first.continuation;
    const clipEnd = last.event.slur.index < last.event.slur.length - 1;
    const firstX = clipStart
      ? staves.first.getTieStartX()
      : first.note.getAbsoluteX();
    const lastX = clipEnd ? staves.last.getTieEndX() : last.note.getAbsoluteX();
    if (lastX <= firstX) continue;
    const outer = (member: DrawnSlurMember) => {
      const ys = [...member.note.getYs()];
      if (member.note.hasStem()) {
        const { topY, baseY } = member.note.getStemExtents();
        ys.push(topY, baseY);
      }
      for (const modifier of member.note.getModifiers()) {
        if (
          !(modifier instanceof Articulation) &&
          modifier.getCategory() !== "Annotation" &&
          modifier.getCategory() !== "FretHandFinger"
        )
          continue;
        const box = modifier.getBoundingBox();
        if (box) ys.push(box.getY(), box.getY() + box.getH());
      }
      return Math.max(...ys.map((y) => side * y)) + 5;
    };
    const y1 = outer(first);
    const y2 = outer(last);
    const crown =
      Math.max(...group.map(outer), y1, y2) +
      Math.min(22, 10 + (lastX - firstX) / 45);
    // Curve's native partial endpoints stop at the endpoint's own stave. Use
    // its renderer with the rolling window's stave edges for clipped groups.
    const curve = new Curve(first.note, last.note, {
      yShift: 0,
      thickness: 1.2,
      cps: [
        { x: 0, y: crown - y1 },
        { x: 0, y: crown - y2 },
      ],
    }).setContext(context);
    const element = context.openGroup("articulation-slur") as SVGGElement;
    element.setAttribute("data-slur-id", first.event.slur.id);
    element.setAttribute("data-slur-style", first.event.slur.style);
    element.setAttribute("data-clipped-start", String(clipStart));
    element.setAttribute("data-clipped-end", String(clipEnd));
    curve.renderCurve({
      firstX,
      lastX,
      firstY: side * y1,
      lastY: side * y2,
      direction: side,
    });
    context.closeGroup();
    bounds.push(side * (crown + 3));
  }
  return bounds;
}
