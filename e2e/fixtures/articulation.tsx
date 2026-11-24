import { createRoot } from "react-dom/client";
import { generateConfigured } from "../../src/generation";
import { articulatedStudy } from "../../src/generation/examples";
import { defaults } from "../../src/score/model";
import { Notation } from "../../src/score/Notation";

export function mountArticulation(root: Element, startBar: number) {
  const config = articulatedStudy({
    articulation: {
      touch: [{ value: "staccatissimo" }],
      emphasis: [{ value: "marcato" }],
      emphasisProbability: 1,
      slurs: {
        probability: 1,
        lengths: [{ value: 3 }],
        styles: [{ value: "legato" }],
      },
      evaluation: { kind: "disabled" },
    },
  });
  const first = generateConfigured(config, "browser-articulation");
  const next = generateConfigured(config, first.seed, first.final);
  createRoot(root).render(
    <Notation
      events={[...first.events, ...next.events]}
      hands={first.initial.hands}
      settings={{ ...defaults, bars: 2 }}
      startBar={startBar}
      reveal={false}
    />,
  );
}
