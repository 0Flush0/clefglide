# Generator configuration and architecture

The generator has two entry points. `generate(settings, seed, previous?)` in `src/generation/planner.ts` is the unchanged application compatibility API. It resolves saved settings through `config/presets.ts`, calls the parameter-driven engine, and returns the original `Phrase` shape. No UI control, preference schema, session schema, backup format or historical fingerprint changes in this refactor.

`generateConfigured(config, seed, previous?)` in `engine.ts` accepts only a branded, deeply readonly `ValidatedGeneratorConfig`. It returns `GeneratedPhrase`, which carries the resolved config and a separate parameter fingerprint (`5.2.0:parameters:...` with optional modules disabled, `6.0.0:parameters:...` for wide leaps, `7.0.0:parameters:...` for explicit lifetimes without ties, `8.1.0:parameters:...` for shared-rhythm ties, `9.0.0:parameters:...` for the original independent-voice combinations, and `10.0.0:parameters:...` for independent voices with wide leaps, guided coverage or explicit rested-alternate permission). It has no legacy `settings` field. Custom configurations require a separate history and comparison design before they can be saved as practice sessions.

The engine orchestrates small modules: `initialHands.ts`, `melody.ts`, `rhythm.ts`, `harmony.ts`, `chromatic.ts`, `movement.ts`, `wideLeaps.ts`, `ties.ts`, `voicings.ts`, `rangeCoverage.ts`, `positionMaps.ts` and `ergonomics.ts`. `sampling.ts` supplies ordered weighted selection. They consume resolved parameters, not difficulty labels. `planner.ts`, `positions.ts`, `chords.ts` and `validator.ts` retain the old signatures/range-preview behavior as compatibility facades; core modules do not import those facades. `difficulty.ts` and `config/presets.ts` are preset/UI policy, not algorithms. `generation/index.ts` provides the public composition API.

`phraseValidator.ts`, `independentValidator.ts`, `wideLeapValidation.ts` and `lifetimeValidator.ts` independently reconstruct approved maps/options, harmony, transitions, movements, exact ticks, rhythm vocabulary, chords and boundary state. The `validator.ts` facade resolves policy for legacy callers. Validation does not call planner candidate, movement, rhythm, harmony, ergonomics or selection algorithms. Its physical checks and approved pattern reconstruction remain independent.

## Resolution, validation and overrides

- `GeneratorConfig` describes complete supported parameter data. The Zod schemas in `config/schema.ts` reject unknown fields, unknown feature kinds, unsupported capabilities, invalid values and cross-module contradictions.
- `normalizeGeneratorConfig(unknown)` validates a complete object, clones it through Zod and deeply freezes it. The branded output is the only accepted engine input. Ordinary generation helpers can trust the normalized type rather than repeatedly parsing each note.
- `resolveGeneratorConfig(overrides, base = generatorDefaults)` applies canonical defaults or a supplied preset base, then explicit overrides. Objects merge recursively; arrays replace completely, preserving order. An omitted/undefined override retains the base value. A changed `kind` replaces the entire union branch: supply the complete new branch, using `repositionDefaults`, `chromaticDefaults`, `chordDefaults`, `coverageDefaults`, `wideLeapDefaults`, `noteLifetimeDefaults`, `durationEvaluationDefaults` or `tieDefaults`. Old branch properties never leak into a disabled branch.
- `resolveSettings(settings, overrides?)` is the one-way legacy adapter. It first enforces the existing UI's jump and movement caps, maps the labels to parameter presets, then applies explicit parameter overrides. A future practice mode can compose a config directly without adopting these UI caps or labels.
- Structural validation does not claim a particular keyboard range can realize every permitted shape. `inspectGeneratorFeasibility(config)` reports missing five-note positions, incompatible two-hand ranges and warnings for unavailable compatible variable positions, same-shape relocations or harmonic chord voicings. Its optional checks establish static possibilities, not a promise about sampled attacks/positions. Initialization rejects impossible positions with actionable errors. Optional chord, shift, spacing, coverage and tie choices are preferences applied to legal candidates. An unavailable opportunity keeps the prior position or uses another legal event. A structurally valid configuration can still have no playable position in the selected registers. `GeneratorSearchExhaustedError` identifies a separate outcome where the independent scheduler used its finite attempt budget, and includes the last validator rejection. It does not establish infeasibility.

```ts
import {
  resolveGeneratorConfig,
  repositionDefaults,
  coverageDefaults,
} from "./config";
import { generateConfigured } from "./engine";

const config = resolveGeneratorConfig({
  hands: { right: { min: 60, max: 84 } },
  melody: { stepBonus: 8, repetitionBonus: 2 },
  movement: { ...repositionDefaults, probability: 0.5 },
  coverage: coverageDefaults,
});
const first = generateConfigured(config, "example");
const next = generateConfigured(config, "example", first.final);
```

## Compatibility matrix

**Supported** combinations use the same resolved configuration and score validator. **Architectural** restrictions follow the current timeline, notation or scoring model. **Contradictory** settings demand mutually exclusive outcomes. **Context-dependent** combinations are structurally valid and depend on the pitches, timing or hand state available at a specific opportunity.

| Existing capability | Shared rhythm | Independent voices | Composition boundary |
| --- | --- | --- | --- |
| Keys, clefs, meters, four-bar phrases, one or both hands, exact tick grid | Supported | Supported | C, G, F and D major in 3/4 or 4/4. Clefs do not transpose pitches. Each active hand needs a playable map, and both hands need compatible noncrossing positions. |
| Rhythm weights, breathing rests, contours, motifs, cadence and harmony | Supported | Supported with per-voice duration, activity, register, finger and overlap policies | Shared rhythm tiles every sounded budget exactly. Independent lanes can fill unused slots with rests. Hard rhythm and activity limits take precedence over musical preferences. |
| Natural and approved variable spacing | Supported | Supported | A position retains its spacing shape through relocation. The configured register, permitted fingers and required polyphony can eliminate some shapes. |
| Fixed positions and small lifted repositioning | Supported | Supported | Small shifts require the configured preparation and an eligible main-voice landing. The existing small-shift schedule reserves the same tail in all lanes. |
| Wide lifted leaps and small shifts | Supported on compatible shared schedules | Supported with hand-local wide preparation | A simultaneous hold by the relocating hand or an intersecting travel envelope rules out that move. An opposite-hand hold is compatible with independent preparation and a legal landing. |
| Guided register coverage with small shifts | Supported | Supported | Guidance can defer an already legal move or bias a contour within the currently reachable map. |
| Guided register coverage with wide leaps only | Architectural restriction | Supported | Shared coverage retains its legacy small-shift policy. Independent coverage uses either active movement technique. Fixed-only guidance lacks relocation opportunities. |
| Chromatic neighbors and harmonic chord voicings | Supported | Supported with lane permissions | Chromatic neighbors resolve on the next untied attack unless the hand explicitly relocates. Existing harmonic voicings and neighbor figures use separate candidates for a given attack. Chords and chromatic notes can occur in different lanes if the combined map remains playable. |
| Chord shapes, voice leading and partial or full chord ties | Supported | Supported with lane permissions and peak polyphony requirements | Shape, harmony, available fingers and actual overlap can leave only an untied attack, a single tone, or a continuation with fewer new heads. |
| Explicit lifetimes and release evaluation | Supported | Supported and required for physical key holds, with evaluation optional | The score grades attack groups and release targets through MIDI. Required physical holds and pedal-extended sound have separate meaning. |
| Subdivision, connected notes and bounded carry chains | Supported | Supported per declared voice | Ties keep pitch, voice, position, finger and lifetime identity. Shared-rhythm carry needs a sounded boundary in the shared schedule. Independent carry can survive a relocation by the other hand. |
| Rested adjacent-finger exception | Supported for validated authored plans | Supported for validated authored plans | A tagged single head needs a whole beat of rest for that hand before its fresh attack in the current phrase. The nominal mapped finger, adjacency and two-semitone reach must agree. A tie can sustain a previously validated assignment. The generator emits mapped assignments and its existing chromatic options. |
| Smart hints, per-head notation, accidentals, ties and movement cues | Supported | Supported | Retain the earlier cue rest in the visible score data to show cross-phrase advance cues. Assistance changes do not change the generated score or MIDI grading. |
| Timed, wait and benchmark scoring with explicit lifetimes | Supported programmatically | Supported programmatically | Pitch, onset and duration results remain distinct. Wait and benchmark duration behavior depends on the existing evaluation policy. Same-pitch overlapping ownership is architecturally unsupported by MIDI attribution. |

| Classification | Example and outcome |
| --- | --- |
| Contradictory | Minimum displacement greater than maximum, preparation shorter than the configured minimum travel time, required overlap with insufficient available keys, ties without required physical holds, or a minimum activity count above its rhythm budget. Configuration rejects these combinations. |
| Architectural | Independent profiles require explicit physical lifetimes, fixed lane IDs and complete per-voice notation. Movement landings use one mapped main-voice note. Shared coverage uses small shifts. Overlapping ownership of one MIDI pitch, crossing hand envelopes, finger substitution, slurs and expressive articulation have no supported model here. |
| Context-dependent | A range can contain legal starting maps while particular registers, occupied fingers, chord harmonies, holds or travel envelopes leave no candidate for a sampled opportunity. A static failure such as no compatible position pair can be proven from the map space. A failed finite schedule search only establishes budget exhaustion. |
| Supported | A treble wide leap during a bass chord tie, asynchronous chromatic attacks over occupied voices, and per-hand guidance during independent small or wide relocations all use the canonical configuration and lifetime model. |

### Reusable configurations

`movingTrebleWithHeldBass()` combines hand-local wide leaps, two right-hand profiles, chromatic neighbors, cross-phrase bass chord ties, guided coverage and timed physical release evaluation. `guidedIndependentDuet()` uses two registers, different lane rhythms and guided small shifts in 3/4. Both return normalized configurations and can be used as bases for overrides. [Configuration examples](../src/generation/examples.ts)

```ts
import { generateConfigured } from "./generation";
import { movingTrebleWithHeldBass, guidedIndependentDuet } from "./generation/examples";

const config = movingTrebleWithHeldBass();
const first = generateConfigured(config, "held-bass");
const second = generateConfigured(config, first.seed, first.final);
const duet = generateConfigured(guidedIndependentDuet(), "guided-duet");
```

## Complete parameter inventory

Defaults below refer to `generatorDefaults`. For an inactive union module, its enabled-branch defaults are listed explicitly. Probabilities are inclusive **0–1**; weights are relative mass, not percentages. A weighted entry is `{ value, weight }`, with finite weight **0.000001–1000**. Distributions contain **1–64** ordered entries; rhythm values, spacing names and chord shapes must be unique (increase their weight instead of duplicating entries). All numeric values must be finite. MIDI uses C4 = 60. Scale-step distances are diatonic, not semitones. Bar numbers are zero-based within a four-bar phrase.

### Notation and hands

| Parameter | Default | Allowed values, units and dependencies |
| --- | --- | --- |
| `notation.key` | `C` | `C`, `G`, `F`, `D`, major only; controls spelling, maps and harmony. |
| `notation.beats` | `4` | `3` or `4` quarter-note beats per measure. Rhythm budgets must tile exactly after rests. |
| `notation.phraseBars` | `4` | Literal capability, not a free length knob. Contours and progressions have exactly four entries. |
| `notation.voices` | `shared-rhythm` | `shared-rhythm` uses the existing rhythm per hand. `independent` requires the `independentVoices` configuration below. |
| `notation.ties`                       | `false`          | `false` disables ties; a complete `{ kind: "enabled", ... }` branch enables the programmatic tie module below. Boolean `true` is rejected.         |
| `hands.active` | `right` | `right`, `left`, `both`; paired hands need non-overlapping playable positions, even if configured ranges overlap. |
| `hands.right.min`, `.max` | `60`, `67` | Integer MIDI 21–108, min ≤ max; active ranges require a five-note position in the chosen key. |
| `hands.left.min`, `.max` | `48`, `55` | Same bounds/dependencies, independently retained. Structural bounds apply to both configured ranges; contextual playability only to enabled hands. |
| `hands.right.clef`, `hands.left.clef` | `treble`, `bass` | Either `treble` or `bass`; position/engraving metadata, no pitch transposition. |

### Melody

| Parameter | Default | Allowed values, units and dependencies |
| --- | --- | --- |
| `melody.maxIntervalSteps` | `2` | Integer 1-7; applies within positions, at small relocations and through chromatic figures. Explicit wide landings use their own interval limit, then ordinary melody resumes. |
| `melody.stepBonus` | `4` | Integer 0–1000 extra weight for a one-scale-step transition. |
| `melody.repetitionBonus` | `0` | Integer 0–1000 extra weight for repeating the previous base pitch. Zero preserves the former implicit neutral preference. |
| `melody.startRegion` | `largest-connected` | `largest-connected` chooses initial notes from largest map components reachable under the jump limit; `any-connected` leaves all initial mapped notes eligible. Neither permits jumps across unreachable gaps. |
| `melody.contours` | `[0,2,4,0]`, `[2,4,2,0]`, each weight 1 | Weighted library of four mapped-note indices, each integer 0–4. Chosen once per phrase before per-hand coverage offsets. |
| `melody.motifs` | `[0,1,2,1]`, `[0,2,1,0]`, `[2,1,0,1]`, each weight 1 | Weighted library; each motif has 1–16 integer indices 0–4, cycled per bar's attack index. |
| `melody.motifOffset` | `-1` | Integer −4–4, added to contour + motif; resulting target clamps to mapped indices 0–4. |
| `melody.contourPeakWeight` | `6` | Integer 1–1000; weight at the target before distance penalty. |
| `melody.contourDistancePenalty` | `2` | Integer 0–1000 per mapped-index distance from target. |
| `melody.minimumNoteWeight` | `1` | Integer 1–1000; lower bound on the contour component, before bonuses. |
| `melody.harmonicToneBonus` | `2` | Integer 0–1000 for an anchor in the current triad. |
| `melody.finalHarmonicToneBonus` | `5` | Integer 0–1000 for a harmonic anchor at the last event of the last bar. As before, this bonus does not apply to the sounded event before a final rest. |
| `melody.preferHarmonicEnding` | `true` | Boolean; prefer reachable triad anchors at the final sounded event, falling back to already legal anchors when no triad tone is reachable. |

The contour component is `max(minimumNoteWeight, contourPeakWeight − distance × contourDistancePenalty)`. Step, repetition, harmonic and final-event bonuses are added. Hard candidate constraints precede all weighting. Pending resolutions and explicit move landings take precedence over sampled anchors, preserving the original PRNG schedule.

### Rhythm and harmony

| Parameter | Default | Allowed values, units and dependencies |
| --- | --- | --- |
| `rhythm.durations` | 480 ticks weight 2; 960 ticks weight 1 | Weighted eighth/quarter/half/whole durations: 240, 480, 960, 1920 ticks at 480 TPQ. Only durations fitting the remaining budget are eligible. Every possible per-bar sounded budget must be divisible by the smallest allowed duration; otherwise configuration is rejected before generation. |
| `rhythm.breathBars` | `[2]` | Unique bar indices 0–3, possibly empty; discretionary trailing breathing rests. |
| `rhythm.breathBeats` | `1` | 1 or 2 quarter-note beats; less than the meter and compatible with the sounded duration budget. Movement preparation takes precedence when both request a rest at the same boundary. |
| `harmony.progressions` | `[1,4,5,1]`, `[1,2,5,1]`, `[1,6,4,5]`, each weight 1 | Weighted four-bar libraries using degrees 1, 2, 4, 5, 6. Triad qualities are fixed by the supported diatonic-major vocabulary: ii/vi minor; I/IV/V major. |

### Fingering and movement

| Parameter | Default | Allowed values, units and dependencies |
| --- | --- | --- |
| `fingering.patterns` | `natural`, weight 1 | Unique weighted subset of approved `natural`, `thumbGap`, `indexGap`, `twoGaps` names. Natural is required as the conventional option; arbitrary offsets are rejected. Weights affect starting-position selection within the selected natural/variable group (product of per-hand weights for paired positions). |
| `fingering.variablePositionProbability` | `0` | Probability of preferring variable positions at initialization; positive values require a variable pattern in the library. If the preferred group has no compatible position, retain the available approved group, as before. |
| `fingering.chromaticFingers` | `[2,3,4]` | Unique nonempty subset of these inner fingers; controls available alternative assignments. Outer-finger chromatic reach remains disallowed by the model. |
| `fingering.allowRestedAlternates` | `false` | Boolean validator permission for the existing explicitly tagged rested-adjacent alternative. This does **not** make the planner emit such alternatives. Preparation, original expected finger, adjacency and two-semitone safety checks remain mandatory. |
| `movement.kind` | `fixed` | `fixed` has no extra fields, or `rested-reposition`. Unsupported techniques are rejected. |
| `movement.probability` | enabled branch: `0.25` | Probability per enabled boundary, independently per hand. Zero disables small-shift opportunities and their preparation. Guided coverage requires another active technique if small shifts are disabled. |
| `movement.maxDistanceSteps` | enabled branch: `1` | Integer 1–4 diatonic steps of the position's lowest pitch. Separate from the melodic jump limit. |
| `movement.eligibleBars` | enabled branch: `[2]` | Unique nonempty destination bars 1–3. Never chunk entry/bar zero. |
| `movement.preparationBeats` | enabled branch: `1` | 1 or 2 full quarter-note beats of rest; never below the full-beat safety minimum. The cue attaches to the exact rest start; its end is the landing tick. |
| `movement.distanceWeights` | enabled branch: `[4,3,2,1]` | Four positive weights for absolute distances 1, 2, 3, 4. Coverage scales acceptance of legal candidates; unused mass means no relocation. |

### Wide lifted leaps (programmatic API only)

`wideLeaps` is independent of `movement`, melody difficulty and UI presets. The default is `{ kind: "disabled" }`. An omitted field also normalizes to disabled for existing parameter objects. Enable it with the complete `wideLeapDefaults` branch, then override individual fields. No UI, saved settings, history schema or scoring change accompanies this capability.

| Parameter | Enabled default | Bounds, units and dependencies |
| --- | --- | --- |
| `wideLeaps.kind` | `lifted-wide` | `disabled` has no other fields; `lifted-wide` plans explicit `lifted-wide-leap` movements. The canonical generator default is disabled. |
| `wideLeaps.probability` | `0.25` | 0–1 per eligible bar, independently per hand. Zero bypasses leap sampling and preparation. An enabled branch still has its distinct version/fingerprint at zero. |
| `wideLeaps.minDistanceSteps` | `5` | Integer 5–51, inclusive minimum absolute displacement of the position's lowest scale note. Five distinguishes this technique from existing 1–4-step small shifts. Must not exceed maximum. |
| `wideLeaps.maxDistanceSteps` | `14` | Integer 5–51, inclusive maximum of that displacement, not a semitone or melodic distance. 51 is the total diatonic extent of A0–C8. Actual five-note maps permit at most 47 steps in C/G major, 46 in F/D; selected ranges and spacing may reduce this. No octave/two-octave implementation cap applies. |
| `wideLeaps.maxLandingIntervalSteps` | `18` | Integer 1–51, maximum absolute diatonic interval from the previous actual melody anchor to the landing. Applies only to the explicit leap landing; every subsequent attack retains `melody.maxIntervalSteps`. |
| `wideLeaps.targetSelection` | `anywhere` | `anywhere`, `higher`, `lower`, `range-edges`. Higher/lower constrain signed position displacement. Range edges select the lowest/highest destination anchors among the currently legal targets, after range, timing, finger, interval and collision checks. Neither direction nor keyboard bounds are relaxed. |
| `wideLeaps.landingSelection` | `uniform-positions` | `uniform-positions` divides each target's mass among its legal landing notes; `uniform-landings` gives each legal position/note pair its own mass. Both then apply distance weighting. |
| `wideLeaps.distanceWeightExponent` | `-1` | Finite −4–4. Relative mass is `abs(distanceSteps) ** exponent`: negative favors closer, zero neutral, positive favors farther. All legal distances keep positive mass. |
| `wideLeaps.preparationBeats` | `2` | Integer 1–11 quarter-note beats in 3/4 and 1–15 in 4/4. Shared rhythm reserves the window even on a probability failure and needs at least one beat between windows. Independent voices sample per hand and skip conflicting windows. Longer preparations can span measures and phrase boundaries. |
| `wideLeaps.minimumPreparationBeats` | `1` | Finite 1–15 quarter-note beats, the declared baseline minimum. Every move must fit `minimum + abs(distanceSteps) / 7 × additionalPerOctave` into reserved preparation. This is a software timing model, not calibrated human travel time. |
| `wideLeaps.additionalPreparationBeatsPerOctave` | `0.5` | Finite 0–15 extra quarter-note beats per seven diatonic steps of position displacement. Configurations unable to prepare even their minimum distance are rejected structurally. Larger distances requiring too much time remain ineligible. Zero explicitly selects a distance-independent timing model. |
| `wideLeaps.eligibleBars` | `[2]` | Unique nonempty subset of zero-based bars 0–3, within each four-bar phrase. Landings occur at the first attack of those measures. Bar zero requires a reserved rest carried from the preceding phrase; fresh generation never fabricates prior preparation. |
| `wideLeaps.landingFingers` | `[1,2,3,4,5]` | Unique nonempty subset of integer fingers 1–5, in anatomical finger order for each hand. Each landing is one natural mapped note, unavailable in the old position; no chord, chromatic alteration or alternate-finger exception at the landing. |

```ts
import {
  generateConfigured,
  resolveGeneratorConfig,
  wideLeapDefaults,
} from "./generation";

const config = resolveGeneratorConfig({
  hands: { right: { min: 21, max: 108 } },
  melody: { maxIntervalSteps: 1 },
  wideLeaps: {
    ...wideLeapDefaults,
    minDistanceSteps: 7,
    maxDistanceSteps: 47,
    maxLandingIntervalSteps: 51,
    preparationBeats: 8,
    minimumPreparationBeats: 1,
    additionalPreparationBeatsPerOctave: 1,
    eligibleBars: [0],
  },
});
const first = generateConfigured(config, "lifted-registers");
const second = generateConfigured(config, "lifted-registers", first.final);
// Inspect first/second.movementDiagnostics for sampled opportunities that could not move.
```

Preparation must be completely silent for the moving hand: every preceding note/chord ends by the cue, and contiguous rests extend to the landing. Multiple rests tile exact measures using quarter/half/whole durations; shorter cues inside an existing longer rest split it so VexFlow can annotate the exact rest. The current shared-rhythm topology reserves these rests for both hands. `StreamState.wideLeapPreparation` carries the configuration fingerprint, cue tick and landing tick when a preparation window crosses a phrase boundary, including a landing later than bar zero. The preceding phrase independently validates its reserved tail; the next validates the carried record and remaining rests. Continue with the same configuration and seed. Changing configuration during reserved preparation is rejected; start a new exercise for a changed configuration.

Movement plans preserve the spacing shape and carry exact source/destination IDs, hand, signed distance, cue/landing ticks, landing note ID, MIDI and finger. The validator reconstructs these from score/maps and does not call leap candidate helpers. A lifted hand can reuse a finger on a different key; fixed-position same-finger/chromatic/chord rules resume immediately after landing. Smart marks the landing finger and retains its existing map inference memory. VexFlow uses the shared `Leap RH/LH ↑/↓ · finger` annotation at the cue and its supported finger modifier on the exact landing note. Display modes do not change generation or scoring.

Both-hand planning conservatively forbids intersection of the full source-to-target keyboard envelope with the other hand's occupied or simultaneously traversed envelope. It does not model lifting over the other hand in three dimensions. The validator checks travel over the entire preparation interval as well as all landing positions. Overlapping configured ranges are allowed when actual occupied/traversed positions remain separated.

At a boundary shared with small repositioning, a successful wide leap takes precedence for that hand. The optional small-shift attempt can run if the wide leap is skipped. With shared rhythm, the earlier cue reserves enough rest for either technique and the configuration rejects a small-shift landing inside a wide preparation window. With independent voices, the scheduler skips the affected hand's conflicting opportunity and checks both techniques against actual holds. Shared-rhythm coverage retains its small-shift weighting. Independent coverage applies the same acceptance weighting to both techniques.

`inspectGeneratorFeasibility` returns errors if an active hand has no possible wide leap under its bounds, maps, direction, landing/finger/interval, separation and timing rules. Positive-probability wide generation checks these errors before sampling. This static test is existential: a sampled starting position, prior note or opposing hand can still block an individual opportunity. Such an attempted leap is explicitly reported in `GeneratedPhrase.movementDiagnostics` with hand, landing tick and `no-legal-target` or `no-preparation`; constraints are never widened. Probability failures are ordinary non-attempts. A first chunk's entry may report `no-preparation`. Callers should surface these diagnostics rather than present a leap-free phrase as successful leap practice. Optional small shifts/chords retain their earlier fallback behavior.

Enabled configurations use generator version **6.0.0** and include every new parameter in their fingerprint. Disabled configurations retain **5.2.0**, omit the disabled branch from the serialized fingerprint, and consume no extra random draws. Historical session records/fingerprints, persistence, exact UI replay and presets remain untouched. No custom configuration can be saved through the legacy session API merely by adding a settings object. This version is a programmatic capability identity, not a migration of old history.

Verification includes exact minimum/full-keyboard maximum displacements in both directions/hands, edge positions in all four keys, impossible inputs, preparation/cue corruption, long rests into every phrase-entry bar, overlapping two-hand ranges and travel collisions, small-shift coexistence, chromatic/chord/finger interactions, actual VexFlow SVG annotations, and seeded property tests with continuation/reproduction. The 96 captured legacy configurations still check 288 complete disabled phrase outputs byte for byte; this is regression evidence across representative configurations, not exhaustive enumeration of all numerical settings.

Physical piano/teacher testing is still required for comfortable speed and lift height at each distance/tempo, individual hand size, release and pedal behavior, extreme register reading, repeated leap fatigue, simultaneous hand coordination and visual cue lead time. Timing is expressed in score beats; this engine has no tempo or player travel calibration. There are no legato leaps, crossings, overpassing, finger substitutions at landings, chord landings, independent hand rhythms or universal playability guarantee. No new hardware test is implied by simulator/unit success, and MIDI cannot verify fingers.

### Explicit note lifetimes and optional duration scoring (programmatic API)

`noteLifetimes` is independent of difficulty, movement and rhythm selection. The canonical default is `{ kind: "disabled" }`; omitted fields in older parameter objects normalize to that branch. Disabled generation retains its original fields, PRNG consumption and fingerprints. `noteLifetimeDefaults` enables explicit metadata with evaluation disabled. Spread `durationEvaluationDefaults` to opt into evaluation. No UI preset enables either capability.

| Parameter | Enabled default | Bounds, units and dependencies |
| --- | --- | --- |
| `noteLifetimes.kind` | `explicit` | `disabled` accepts no other fields; `explicit` emits and validates each notehead's lifetime. The canonical default is disabled. |
| `noteLifetimes.keyHold` | `required` | `required` assigns a physical key-release target at the note's end; `attack-only` requires a fresh attack but permits early physical release. This is the generated-score policy. Authored core lifetime records explicitly declare each note's own hold requirement. |
| `noteLifetimes.evaluation.kind` | `disabled` | `disabled` accepts no scoring fields. `evaluate` enables separate duration outcomes without changing pitch/onset results, notes or sampling. |
| `noteLifetimes.evaluation.toleranceMs` | `120` | Finite 0–60000 milliseconds on each side of an evaluated release target, inclusive. This is separate from onset tolerance and chord capture width. |
| `noteLifetimes.evaluation.earlyRelease` | `penalize` | `penalize` or `ignore`; a penalized observed release earlier than target minus tolerance is `early`. Ignore removes the minimum-duration penalty. |
| `noteLifetimes.evaluation.lateRelease` | `penalize` | `penalize` or `ignore`; an observed release or still-open hold after target plus tolerance is `late`. Ignore credits a still-open phase once its intended target is reached, without fabricating a release observation. Both early and late cannot be ignored; disable evaluation instead. |
| `noteLifetimes.evaluation.pedalTreatment` | `physical` | `physical` evaluates the required physical release, regardless of pedal. `sounding` evaluates the MIDI/damper-derived logical sound release and also every declared physical release requirement. `forbid` evaluates physical release and fails a note if CC64 is down at its attack or becomes down during its active lifetime. Attack-only generated requirements require sounding evaluation or disabled evaluation. |
| `noteLifetimes.evaluation.waitMode` | `disabled` | `disabled` suppresses duration evaluation in wait and benchmark modes. `performed-duration` explicitly evaluates a hold from each accepted attack using the configured BPM and intended tick duration. It never blocks the attack cursor waiting for a note-off. Timed mode always uses score-clock release targets when evaluation is enabled. |

```ts
import {
  generateConfigured,
  resolveGeneratorConfig,
  noteLifetimeDefaults,
  durationEvaluationDefaults,
} from "./generation";
import { Scorer, durationMetrics, metrics } from "./scoring/engine";

const config = resolveGeneratorConfig({
  noteLifetimes: {
    ...noteLifetimeDefaults,
    evaluation: {
      ...durationEvaluationDefaults,
      waitMode: "performed-duration", // explicit real-time holds in wait practice
    },
  },
});
const phrase = generateConfigured(config, "held-notes");
// settings retains the existing runtime mode/BPM/offset/onset-tolerance contract.
const scorer = new Scorer(
  phrase.events.filter((event) => event.kind === "note"),
  settings,
  120,
  config,
);
scorer.start(now);
// Send normalized note-on, note-off and sustain events through scorer.input(event).
// Continue scorer.tick(now) through release deadlines after the last attack.
const pitchAndOnset = metrics(
  scorer.results,
  scorer.activeMs(now),
  settings.tolerance,
);
const durations = durationMetrics(scorer.durationResults);
```

The score model's optional `NoteLifetime` is on each `Notehead`, mirrored by the event's primary `lifetime` (including legacy-shaped single-head events when explicitly authored). Its fields are:

| Field | Meaning and validation |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voiceId` | Nonempty identity for a logical voice. Shared rhythm emits `right:main`/`left:main`. Independent timelines also emit their declared secondary IDs. |
| `onsetTick` | Absolute nonnegative safe integer at 480 TPQ. Each attack has one globally unique notehead ID, independent of its phrase. |
| `releaseTick` | Absolute intended logical sound-end tick, strictly after onset. |
| `durationTicks` | Positive safe integer, exactly `releaseTick - onsetTick`; no accumulated fractional ticks. |
| `keyHold` | `{ kind: "required", releaseTick }` declares a physical release target after onset and no later than logical sound end. `{ kind: "attack-only" }` imposes no continued physical hold. Core authored records can declare an earlier physical release than logical sound end for pedal takeover. |

`lifetimeNotes(events)` returns independent attack records containing ID, event ID, MIDI, hand, planned finger, position ID and the lifetime. `lifetimeOccupancy(records, tick)` projects intended sounding notes, physical holds and planned finger occupancy using half-open intervals: release at an attack tick frees that resource. It does not infer or verify the pianist's actual fingers. The independent `validateLifetimePlan` validates canonical records, rejects two overlapping uses of a required finger (including an attack while it is occupied), and rejects overlapping same-pitch logical lifetimes whose ownership cannot be distinguished through the current MIDI/scoring model. Chords can have distinct release targets per head; different pitches/voices can overlap.

A `LifetimePlan` can specify `startTick`, `endTick`, incoming `initial` attack records and outgoing `final` records. Incoming notes must actually cross the start boundary. Final state must exactly retain every still-sounding note, with its original ID and full record; it cannot reset an attack or invent a continuation. Notes can cross multiple phrase boundaries. Optional movement validation rejects any required physical hold or attack during that hand's relocation preparation, even when a logical sound tail alone is permitted to continue. This is occupancy validation, not a general polyphonic fingering optimizer or reach guarantee.

The lifetime projector attaches metadata after note and chord selection and consumes no random draws. Untied generated lifetimes end at their event's end. A tie chain extends the original lifetime and records it in `StreamState.activeLifetimes` while it crosses a boundary. `lifetimeValidator.ts` reconstructs the metadata and checks the canonical interval validator without calling the projector. It rejects missing or contradictory metadata, held movements and altered boundary state.

`Scorer` retains its existing three constructor arguments; the optional fourth accepts the validated configuration. Enabled construction checks meter, tempo, metadata, onset ordering and occupancy. Pass sounded events, as in the existing application; rests stay in the score timeline. `appendNotes` accepts complete, future onset groups, validates the complete plan and preserves open releases. Ordinary growth of `notes` is also checked on the next input/tick. Do not mutate already validated events or remove scored events. To change mode, tempo, offset, onset tolerance or chord capture width, construct a new scorer; enabled scoring rejects a changed runtime clock/policy instead of mixing comparison identities. Hint/display changes remain independent. With ties disabled, append each note only at its attack. With ties enabled, pass complete sounded notation, including continuation segments, to construction and `appendNotes`; the scorer validates links and projects attacks internally. The cursor can finish all attacks while releases are still pending; programmatic callers must continue forwarding note-offs/CC64 and ticking until duration outcomes are resolved or explicitly interrupt the attempt.

Release tracking associates accepted attacks with normalized source, channel and pitch. Duplicate ons, duplicate/stray offs and pedal messages never supply an attack or duplicate a note's outcome. Physical key release remains observable while pedal holds its sound. Sustain is binary CC64 ≥64, scoped to the source/channel. Pedal-up closes released logical voices but never keys still down. A fresh strike of a released, pedal-held pitch closes the preceding logical voice and opens a new attack identity; MIDI cannot measure separate acoustic tails on the same string. Sostenuto, half-pedal, acoustic decay, device identity beyond the normalized source/channel, and same-pitch polyphonic/unison attribution are not implemented. Events must have finite times and arrive in physical order; an off before its associated attack is rejected. MIDI adapters are unchanged.

Duration outcomes live in `scorer.durationResults`, separate from the unchanged pitch `Result[]`. Each evaluated note can have independent `physical` and `sound` observations with expected milliseconds, actual release/error milliseconds when observed, and `pending`/`correct`/`early`/`late` classification. Overall status can additionally be `pedal`, `interrupted`, `miss` or `skip`. A note needing both physical and sound evaluation succeeds only when both succeed; pedal violation takes precedence over timing failure. Chord heads are independent. The first accepted attack owns the duration result; capture-window retries cannot erase its early release. Pitch accuracy and onset accuracy retain the existing `metrics` definitions and never incorporate release results.

`durationMetrics` reports correct/early/late/pedal counts, pending/interrupted/missed/skipped counts, and a separate accuracy over evaluated releases only. Missing/skipped attacks have no observed duration and do not double-penalize duration accuracy. Pending and interrupted holds are excluded; accuracy is `null` when none is evaluated. Late detection does not fabricate a note-off and later records the real release/error when it arrives. Interim accuracy covers resolved evidence, so retain pending counts when displaying it.

Input offset applies to attacks, releases and pedal observations. Timed targets use the score origin plus absolute ticks converted at BPM. Wait/benchmark opt-in targets use each accepted attack plus its intended hold duration, so waiting before an attack does not cause a duration failure. External `tick(now)` permits the same input-offset compensation before declaring an overdue release; all event timestamps must share the scorer's monotonic clock. Pausing shifts future timed expectations as before. Because physical key state cannot safely be reconstructed after a pause/disconnect, open unresolved durations become `interrupted`, physical/pedal occupancy clears, and resume starts observing fresh attacks. Release keys/pedal before resuming, or provide their current normalized state; this API cannot query physical device state after an interruption. No synthetic note-off or correct duration is awarded. Already observed correct/failed durations remain recorded. `disconnect(now)` and `finish(now)` use this same explicit interruption policy; hardware integration can continue using the existing `pause(now)` path.

Enabled lifetime configurations without ties use version **7.0.0** with every lifetime/evaluation parameter in the generator fingerprint, even when evaluation is disabled. Both disabled modules retain **5.2.0**, and wide leaps with lifetimes disabled retain **6.0.0**, including their prior fingerprint serialization order. `scorer.scoringFingerprint` additionally identifies mode, BPM, meter, offset, onset tolerance and chord capture width for enabled programmatic scoring. It is not a complete persisted session identity: a future session integration must also retain assistance state. Historical settings, session/backup schemas, fingerprints, results and UI replay stay untouched. Duration records are not silently inserted into or discarded through the legacy session format; programmatic consumers must retain/export them separately until a versioned custom-session persistence design exists.

The lifetime API supports explicit attack and release data, overlapping distinct-pitch lifetimes, planned finger occupancy, boundary carry, optional physical and sounding release scoring, per-head chord releases, repeated attacks, binary sustain, calibrated timing, interruptions and streaming. The independent voice and tie modules below use those same records. Configuration rejects `notation.ties: true` and unknown capabilities. Release and pedal latency still need physical piano testing.

### Independent voices (programmatic API)

Set `notation.voices: "independent"`, provide `independentVoices`, and enable `noteLifetimes` with required physical holds. To resolve a shared-rhythm configuration from an independent base, set `notation.voices: "shared-rhythm"` and `independentVoices: false`. Each active hand gets its own set of voice profiles. Profiles have an ordered, stable identity for the stream. The first profile is `right:main` or `left:main`. Additional profiles use suffixes `:2` through `:5`. Every event has a `voiceId`, including rests. Chord heads and tied segments in that event have the same lifetime voice ID.

| Parameter | Default when enabled | Allowed values and behavior |
| --- | --- | --- |
| `independentVoices.right`, `.left` | Required for the corresponding active hand | Each active hand supplies a group. Inactive hands omit their group. |
| `group.voices` | Required | Ordered array of 1–5 profiles. Five lanes can use all five mapped fingers as distinct concurrent roles. Put the upper voice first for the conventional upward stem on a two-voice staff. |
| `group.minPolyphony` | `1` | Required peak number of simultaneous physical keys **at least once per phrase**, integer 0–5. Includes both chord tones and notes from different voices. Zero allows the entire hand to rest for a phrase. |
| `group.maxPolyphony` | `5` | Maximum simultaneous physical keys at any tick, integer 1–5. Must be at least the minimum. |
| `overlapProbability` | `1` | Probability in [0,1] of considering a new attack while a different voice is sounding, including an earlier attack at the same tick. Applies within and between hands. A committed continuation keeps its original hold. Zero disallows all cross-voice intersections. |
| `maxOverlapTicks` | `491520` | Integer 0–491520. Maximum intersection of any two lifetimes in different voices, including their tied segments. Zero disallows overlap. This limit neither shortens notes nor changes chord-internal holds. |
| `maxAttempts` | `24` | Integer 1–128. Deterministic retries of a phrase that fails the hard constraints. Exhaustion raises `GeneratorSearchExhaustedError` with the first failing constraint from the final attempt. |
| `profile.durations` | Inherits `rhythm.durations` | Unique weighted selection of 240, 480, 960 and 1920 ticks. Each profile samples separately. Slots that cannot fit the remaining sounded budget are omitted. The remainder is filled with rests. |
| `profile.activity` | `1` | Probability in [0,1] of attempting an attack at an eligible voice slot. A rest fills the slot when a legal attack is unavailable. |
| `profile.entryProbability`, `.exitProbability` | `1`, `0` | Independent [0,1] probabilities applied at phrase starts to an inactive or active voice respectively. A committed carry keeps that voice active at the boundary. |
| `profile.minAttacksPerPhrase` | `0` | Integer 0–32. Minimum sounded onsets for an active profile in a phrase. A chord onset counts once and a continuation-only onset does not count. |
| `profile.minSoundedTicks` | `240` | Integer 0–7680. Minimum sounded ticks for an active profile, counting a chord's time once and including tied continuations. Both minimums must fit its available rhythm slots. |
| `profile.offbeatWeight` | `1` | Multiplies the duration weight when a candidate ends off a quarter-beat boundary, encouraging or discouraging the next offbeat slot. A 240-tick duration is what makes this possible in the current vocabulary. |
| `profile.coincidentAttackWeight` | `1` | Multiplier on the attack probability if another voice already attacked at the current tick. Clamped to 1. Values below 1 discourage coincidence and values above 1 favor it when activity is below 1. Both weight fields use 0.000001–1000. |
| `profile.minMidi`, `.maxMidi` | Active hand bounds | Optional inclusive bounds 21–108 that intersect the configured hand range. Every played head in the voice must fit both ranges. |
| `profile.fingers` | `[1,2,3,4,5]` | Unique nonempty subset of mapped fingers 1–5. Assign disjoint sets to reserve fingers for long notes and a moving melody. Fingers outside the list may still be used by another voice. |
| `profile.maxIntervalSteps` | Inherits `melody.maxIntervalSteps` | Integer 1–7 at most the global melody cap. Measures the jump between successive melodic anchors of this voice, including phrase transitions. A wide landing uses its separate limit. A secondary voice begins a new local anchor after its hand's explicit wide move. |
| `profile.chords`, `.chromatic` | `true`, `true` | Boolean permission for the global chord and chromatic modules in this profile. Global settings still control actual voicing shapes, probability, neighbor resolution and spelling. |

For example, configure one left-hand bass voice with a whole-note rhythm and a separate left-hand inner voice restricted to upper mapped fingers. The right hand uses a different rhythm, with weighted offbeats.

```ts
import { generateConfigured, noteLifetimeDefaults, resolveGeneratorConfig, tieDefaults } from "./generation";

const config = resolveGeneratorConfig({
  notation: {
    voices: "independent",
    ties: {
      ...tieDefaults,
      crossPhrase: true,
      voices: ["left:2"],
      patterns: [{ value: "carry", weight: 1 }],
    },
  },
  hands: { active: "both" },
  rhythm: { breathBars: [] },
  noteLifetimes: noteLifetimeDefaults,
  independentVoices: {
    left: {
      minPolyphony: 2,
      maxPolyphony: 2,
      voices: [
        { fingers: [1, 2, 3], durations: [{ value: 480, weight: 1 }] },
        { fingers: [4, 5], durations: [{ value: 1920, weight: 1 }] },
      ],
    },
    right: {
      voices: [{
        durations: [{ value: 240, weight: 1 }, { value: 480, weight: 2 }],
        activity: 0.8,
        minAttacksPerPhrase: 4,
        offbeatWeight: 1.4,
      }],
    },
  },
});
const first = generateConfigured(config, "bass-and-melody");
const next = generateConfigured(config, first.seed, first.final);
```

The scheduler walks the next onset of each timeline in chronological order. A seeded priority per bar resolves simultaneous candidate selection. Each accepted attack reserves its keys and fingers until release. Rests and holds can alternate independently. The combined hand map, reach, distinct physical keys, hand separation and per-voice transitions still apply. The feasibility check rejects missing position assignments. Sampling can still run out of candidates under a binding register, rhythm, activity, movement or overlap constraint. Minimums remain binding and a failed phrase returns an error. At the current meter, phrase length and minimum duration, an attempt processes at most 32 slots per voice and 320 across both hands. The attempt setting bounds retries without introducing a separate cap on how many phrases a tie can cross.

The existing `subdivide`, `connect`, and multi-phrase `carry` patterns run per eligible voice. The carry unit is the shortest duration of that voice. Each chain retains its voice, original attack, position, planned finger and release tick. Partial chord carry can keep a selected tone while releasing and reattacking other tones when capacity, harmony and reach allow it. The validator checks the resulting intersections of whole lifetimes, including ties. A carry must fit that voice's sounded slots and leave room for its required attacks when partial reattacks are unavailable. The existing breathing and small-repositioning schedules reserve the same tail ticks in every timeline. An explicit move changes the position of the entire hand and lands on a new mapped pitch in its main voice.

Wide preparation is sampled separately for each hand at the configured opportunity probability. Rests are reserved only for that hand, and its main voice has a rest starting exactly at the cue. A prepared hand can skip an opportunity when its voices are inactive, an incoming hold blocks the window, the window conflicts with a previous reservation or would consume a required activity budget, or no legal landing remains. A small shift that falls inside a reserved wide window is skipped for that hand. An eligible small shift at the wide landing boundary can serve as a fallback. Both hands can move at one boundary if their travel and attacks satisfy the declared separation and overlap rules. Overlapping wide windows for one hand are considered in chronological order.

The existing wide-leap candidate planner applies direction, distance, landing-finger, interval, preparation and weighting parameters. It filters targets for the main voice's register, allowed fingers and supported attack durations. At the cue and landing, validation reconstructs the moving hand's silence and required holds across its voices. The opposite hand can attack, sustain independent notes or continue a tied chord during preparation or landing, subject to the configured cross-voice overlap rules. Travel envelopes must stay separated through the entire cue-to-landing interval, including the opposite hand's source and destination positions when it moves.

A window that starts in a preceding phrase carries its exact cue and landing ticks plus the closest edge of the opposite hand's elapsed travel envelope in `final.independentVoices.leapPreparations`. The preceding phrase validates its reserved rest and envelope before returning this state. A committed tie takes priority over any overlapping preparation for its hand. A new exercise cannot fabricate prior preparation. Keep the earlier phrase's events and movements in the notation buffer to display a cue that precedes the landing phrase.

Each staff renders a VexFlow voice for each configured timeline. Voices share a horizontal tick grid and the staff's measure accidental state. Same-staff voices use alternating stem directions and staggered rest positions. Accidental state is updated in tick order across voices. Tied continuations keep their spelling and do not establish an accidental for later untied attacks. Both visible and clipped tie curves use the linked head IDs.

Supply complete generated events to `Scorer` and `appendNotes` with the resolved config. The existing tracker grades each attack and physical release once, including when several voices sound together. For independent timed scores, adjacent attack groups divide their timing window at the midpoint, within the existing matching bounds. This prevents a missed dense onset from blocking the following attack. Pitch, onset and duration metrics stay separate. Wait mode and pause, pedal and interruption handling retain the lifetime module's rules.

Version **9.0.0** retains its existing seed schedule and fingerprint for previously supported independent configurations. An independent configuration with a wide-leap branch, guided coverage or rested-alternate permission uses **10.0.0**. Each fingerprint includes its resolved voice and capability settings. Stream continuation requires the original seed and fingerprint. The shared-rhythm presets and their historical session and backup identities retain their existing versions.

Independent generation stays programmatic. The notation vocabulary remains eighth, quarter, half and whole notes in 3/4 and 4/4. Ties extend holds across independently engraved measures or phrases. MIDI grades attack and release data. Finger plans and physical comfort require player review.

### Musical ties (programmatic API, version 8)

Ties are **off in every existing preset and in `generatorDefaults`**. No UI, preferences, MIDI adapters or historical-session schemas enable them. A tie is multiple notated heads sharing one attack and one continuous lifetime. Equal pitches without explicit links remain repeated attacks. VexFlow `StaveTie` curves distinguish these from slurs.

```ts
import {
  resolveGeneratorConfig,
  generateConfigured,
  tieDefaults,
  noteLifetimeDefaults,
  durationEvaluationDefaults,
} from "../src/generation";

const config = resolveGeneratorConfig({
  noteLifetimes: {
    ...noteLifetimeDefaults,
    evaluation: {
      ...durationEvaluationDefaults,
      waitMode: "performed-duration",
    },
  },
  notation: {
    ties: {
      ...tieDefaults,
      probability: 0.4,
      crossPhrase: true,
      patterns: [
        { value: "subdivide", weight: 2 },
        { value: "connect", weight: 1 },
        { value: "carry", weight: 1 },
      ],
    },
  },
});
const first = generateConfigured(config, "ties-example");
const next = generateConfigured(config, "ties-example", first.final);
// Supply sounded events, including continuation glyphs, to Scorer with config.
// Stream with scorer.appendNotes(next.events.filter(e => e.kind === "note")).
```

`notation.ties` accepts `false` or a complete enabled branch, exported as `tieDefaults`. Fields below are relative to `notation.ties`; defaults describe that helper. Ties require explicit note lifetimes with `keyHold: required`; attack-only lifetimes cannot describe this physical hold contract. Duration evaluation can remain disabled. Unknown fields/patterns, incomplete branches, duplicate entries, non-finite numbers and incompatible options are errors.

| Parameter          | Enabled helper default       | Supported values and meaning                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --- | --- |
| `kind`             | `enabled`                    | Literal enabled branch; use `false` to disable the entire module.                                                                                                                                                                                                                                                                                                                                                           |
| `probability`      | `0.25`                       | 0–1, once per eligible original source event, independently per eligible hand, after candidates exist. At most one pattern is selected there. Rests, claimed segments and missing common tones reduce opportunities, so this does not promise an exact observed percentage. Zero emits no new ties.                                                                                                                         |
| `segmentCounts` | `[2]` | Unique nonempty selection of integers **2–256**, counting the initial segment. Subdivision must tile a base duration with allowed subdivisions; connection must fit an actual contiguous matching run inside the phrase. Carry supports every count that fits its duration, rest and boundary policies, across as many phrases as needed. Compatible counts are sampled uniformly after pattern selection. |
| `subdivisions`     | `[240,480,960,1920]`         | Unique nonempty subset of eighth/quarter/half/whole note ticks at 480 TPQ. Every tied segment uses an allowed length. Subdivision can use shorter lengths than `rhythm.durations`; connection uses their intersection. Carry requires the shortest base rhythm duration. Dotted notes, tuplets, sixteenths and irregular ticks are unsupported.                                                                             |
| `withinMeasure`    | `true`                       | Permit adjacent tied segments within one measure. Required by subdivision. Connection checks every edge separately.                                                                                                                                                                                                                                                                                                         |
| `crossMeasure`     | `true`                       | Permit tie edges across barlines. Cross-measure-only connection works with `withinMeasure: false` and no subdivision pattern.                                                                                                                                                                                                                                                                                               |
| `crossPhrase` | `false` | Enable exactly when selecting `carry`; requires cross-measure permission and sounded ending/opening slots. Supports diatonic/chromatic notes and full/partial chords. Every selected carry count must fit the cyclic sounded timeline; a hold cannot overlap a shared-voice breath or movement-preparation rest. Multiple segments within a bar require `withinMeasure`; whole-bar continuation chains can use cross-measure-only policy. |
| `maxDurationTicks` | `3840` | Integer **480–491520** ticks (1–1024 quarter beats), bounding the **entire continuous lifetime**, including its initial segment and all future phrases. The 256-segment limit and selected rhythms can impose a lower achievable maximum. With whole-note segments in 4/4, the upper bounds allow a chain crossing 64 phrase boundaries. There is no separate chunk-count cap. |
| `voices` | `["right:main","left:main"]` | Unique nonempty list of eligible voice IDs. Shared rhythm supports the two main IDs. Independent configurations may also name their declared secondary voices. The main ID of an inactive hand may be present, and at least one listed voice must belong to an active hand. |
| `chordTones`       | `none`                       | `none`: single-note events only. `all`: every head, requiring the complete same set throughout a connection. `outer`: one uniformly selected lowest/highest head, outer in every participating chord. `any`: one uniformly selected eligible head. The latter two generate partial chord ties. Non-`none` choices require enabled, contextually feasible chord voicings in an eligible voice; single notes remain eligible. |
| `patterns`         | `subdivide:1, connect:1`     | Unique weighted subset of `subdivide`, `connect`, `carry`, using finite relative weights 0.000001–1000. Only feasible candidates compete at a source event. Unsupported patterns are rejected.                                                                                                                                                                                                                              |

Supported patterns:

- **`subdivide`** replaces one planned note/chord event with equal shorter segments, preserving its exact total duration, pitches, position and fingers. Initial IDs remain; later IDs append a deterministic segment suffix. Selected heads share one lifetime. Untied chord tones deliberately reattack at the added segments, each with a shorter lifetime. The original base duration must fit the sounded measure budget, segment count and maximum duration.
- **`connect`** joins a contiguous run of matching pitch/spelling/finger/position heads, within or across measures. It does not change pitches to manufacture matches. Other chord tones retain their attacks/releases. Rests, movement preparation, changed positions and already claimed segments break candidates. A configuration needs a feasible sounded run budget; actual occurrence depends on sampled matching heads.
- **`carry`** selects mapped single notes or chord tones at the sounded phrase ending, including chromatic neighbors. The outgoing phrase commits the complete segment count, release tick and next head IDs before returning. All continuation segments use the shortest `rhythm.durations` value, which must be in `subdivisions`; sampled shared-rhythm slots touched by a hold are tiled into this unit. The full lifetime is `source.duration + (count - 1) * unit`. Later phrases consume the original attack/voice identity, exact spelling, finger and position until that committed release, retaining pending state through every intervening boundary. Chromatic resolution waits until the hold ends. Carry requires the same seed/configuration fingerprint and never mutates an earlier phrase or extends its release target.

For partial carry (`any`/`outer`), one eligible chord tone remains held while other tones release at their own notated endpoints and can reattack or change using the existing approved voicing library. The retained tone becomes the continuation's melodic anchor, so it must fit the configured anchor jump limit; `outer` remains outer in every chord. New attacks must fit the current harmonic set; retained tones may form suspensions over changing harmony. Shape, span, finger transitions and voice-leading constraints remain mandatory. No legal added voicing means continue the held tone alone. `all` retains the complete source chord with the same release for every tone. Required physical holds exclude hand-movement preparation even when a destination position would otherwise fit.

The deterministic tie pass runs only when enabled and selects already playable mapped heads; it never retrofits fingers or invents shifts. Each phrase still receives independent validation. `TieSegment` records `lifetimeId` (original head/attack ID), `attackEventId`, zero-based `index`, total `count`, selected `pattern` and explicit `previousId`/`nextId` links. Every segment repeats the same complete `NoteLifetime`. Chord head IDs and segment IDs remain distinct; `ScoreEvent.tie` and `.lifetime` mirror its primary head. `pendingTies` carries the latest segment head, committed next ID, continuation duration, position and configuration fingerprint; `activeLifetimes` retains the original canonical attack. `lastNoteEnd` remains the notated timeline endpoint; lifetime occupancy tracks outstanding holds.

`lifetimeNotes(events)` emits initial attacks only. `attackEvents(events)` removes continuation-only events and continued heads of partial chords for scoring. With ties enabled, pass **complete sounded notation**, including continuations, to `Scorer` construction and `appendNotes`. The scorer validates links before projecting attacks internally. Append complete future onset groups; direct growth of `scorer.notes` is rejected for tied streams. Construction needs the original attack; orphan continuations are rejected. Do not pass projected attack lists as complete notation or mutate previously supplied objects. Open outgoing carry is valid before the next segment arrives because its release target is already committed. Continue forwarding releases/pedal events and ticking after all attacks complete.

The existing lifetime tracker expects one attack and continuous holding through the final target, applying configured tempo, offset and release tolerance. Tie boundaries require/reward no new attack. Retriggering cannot repair early release. Chord heads have separate outcomes. Binary sustain can prolong sound but does not excuse early **physical** release of a required key: `physical` evaluates the hold, `sounding` evaluates both physical hold and pedal-extended sound, and `forbid` records pedal violations. Pitch/onset metrics count attacks once and remain separate from duration metrics. Wait/benchmark stay pitch-only unless performed-duration evaluation is explicitly enabled. Pause/disconnect/finish retain the existing interruption policy.

Notation uses sorted per-head chord indexes, full curves across visible measures and partial curves at off-screen incoming/outgoing links, including missing/evicted neighboring phrases. Continuation IDs remain available for highlighting. Continuation accidentals are suppressed without establishing the next measure's accidental state, so later untied chromatic attacks receive their own signs. All/Smart/reveal omit duplicate continuation finger labels. Hints still do not affect notes or scoring.

Independent `score/ties.ts` validation reconstructs the segment graph, ownership, voice/pitch/finger/position equality, adjoining ticks, release coverage and permitted open endpoints. Its optional final `windowContext` argument validates a clipped notation window against the complete surrounding score; the context is independently validated and the window must match it exactly. Omitted glyphs alone never prove a valid incoming tie. `generation/lifetimeValidator.ts` separately checks configured patterns, vocabularies, chord-tone policies, boundary permissions and pending state, including spelling and exact predecessor/index continuity at each boundary. Canonical lifetime validation checks finger occupancy, same-pitch collisions, movement preparation and final carry, counting each lifetime once. None of these validators calls tie candidate-selection functions.

Enabled ties now use **8.1.0**, including every tie and lifetime/evaluation field in the parameter fingerprint. Expanded carry changes enabled generation and its PRNG schedule; 8.0.0 seeds are not relabelled or promised exact 8.1 replay. Previously generated two-segment scores remain valid score data and renderable. Disabled ties retain exact prior 5.2/6/7 fingerprints, PRNG schedules, presets and seeded output. Existing history, backup formats and persisted outcomes are unchanged. Both hands retain shared rhythm; tie subdivision and carry can add notation segments and partial-chord reattacks without enabling independent-voice generation.

Carry begins at a sounded phrase ending and uses a committed equal-unit continuation grid. `any` and `outer` retain one tone. `all` gives every chord tone the same release target. Overlapping tie groups can be generated in independent profiles. Carry lengths conflicting with mandatory breathing or shared preparation are rejected. The independent wide planner skips an optional relocation whose preparation would interrupt a committed hold on that hand. Tests use simulated MIDI and VexFlow SVG rendering. Physical piano and pedal testing remains outstanding.

### Chromatic figures and chords

| Parameter | Default | Allowed values, units and dependencies |
| --- | --- | --- |
| `chromatic.kind` | `diatonic` | `diatonic` has no extra fields, or `neighbors`. Only the existing semitone-neighbor algorithm is supported. |
| `chromatic.probability` | enabled branch: `0.12` | Per eligible sounded attack; not during a pending resolution or explicit landing. |
| `chromatic.passingResolutionProbability` | enabled branch: `0` | Probability of choosing another legal harmonic semitone resolution instead of the initially selected resolution. Zero bypasses the probability draw, preserving Easy's original schedule. |
| `chromatic.preferAppliedDominant` | enabled branch: `false` | Boolean preference for available tones in the current harmonic root's dominant seventh; never overrides a playable transition. |
| `chromatic.preferAnchorResolution` | enabled branch: `true` | Prefer returning to the sampled base anchor when that is a legal resolution; otherwise sample legal resolutions. |
| `chromatic.preferMappedFinger` | enabled branch: `true` | Prefer the anchor's mapped finger for a candidate when its incoming/outgoing transitions are legal; otherwise consider independently valid inner-finger alternatives. Disabling only changes preference, never reach/transition validity. |
| `chords.kind` | `single-notes` | `single-notes` has no extra fields, or `voicings`. |
| `chords.probability` | enabled branch: `0.22` | Per eligible anchor; suppressed during chromatic figures/resolution and explicit landings. No legal voicing means retain the legal single anchor. |
| `chords.shapes` | enabled branch: `13,14,15,24,25,35`, each weight 1 | Unique weighted subset of approved shapes below. Shape length determines allowed sizes and relative shape weights determine their distribution; no redundant contradictory size setting. |
| `chords.maxSpanSemitones` | enabled branch: `7` | Integer 3–9, further restricted by the complete physical map. Enabling triads requires ≥7; four-note shapes require ≥8 and an enabled harmonic extension available in the selected progression library. |
| `chords.dyadIntervals` | enabled branch: `[3,4,5,7,8,9]` | Unique nonempty subset of these approved semitone spans. If dyads are enabled, at least one allowed span must fit the configured maximum. |
| `chords.maxVoiceLeadingSteps` | enabled branch: `2` | Integer 1–7 and ≤ melody maximum. Consecutive chord voices must be near a preceding/following voice in both directions, including added/removed voices. |
| `chords.majorExtension` | enabled branch: `none` | `none` or existing `sixth` recipe for a major harmonic root. |
| `chords.minorExtension` | enabled branch: `none` | `none` or existing `seventh` recipe for a minor harmonic root. |

Approved dyads: **13, 14, 15, 24, 25, 35**. Triads: **135, 125, 145, 124, 245**. Four-note shapes: **1235, 1245, 1345**. The schema permits selection/weighting within this library, not invention of new ergonomic shapes. Complete triad/extension pitch-class content, distinct pitches/fingers, inner/outer black-key restrictions and horizontal reach remain mandatory. Exact size occurrence depends on the active map/range/harmony.

### Register coverage

With independent voices, each hand keeps one bounded histogram and one target. The target represents the centers of voice-compatible positions. Each voice projects that target into its own register for contour weighting. Usage measures actual notehead lifetimes clipped to the phrase, so sustained and carried notes contribute by duration, and tie glyphs do not duplicate use. A coverage preference cannot widen a register or bypass preparation, occupancy, collision or harmony constraints.

The default is `coverage.kind = disabled`. The following are the canonical `guided` branch defaults. Guidance requires positive movement probability. Shared rhythm uses rested repositioning. Independent voices can use rested repositioning, wide leaps or both. Memory is ephemeral and reflects the generated score.

| Parameter | Guided default | Allowed values, units and dependencies |
| --- | --- | --- |
| `coverage.kind` | `guided` when enabled | `disabled` has no extra fields; `guided` requires active movement supported by the voice model. |
| `coverage.regions` | `5` | Integer 2–16 histogram regions spanning each hand's inclusive MIDI range. A changed region count/context resets memory. |
| `coverage.decay` | `0.95` | 0–0.9999 per phrase. Histogram update is `old × decay + normalized actual use × (1 − decay)`. |
| `coverage.reachedToleranceSemitones` | `1` | 0–12 semitones between target and current position center. |
| `coverage.usageFloor` | `0.001` | 0.000001–1, positive denominator floor when normalizing region usage. |
| `coverage.explorationWeight` | `0.1` | Positive relative mass 0.000001–1000 keeps every region eligible. |
| `coverage.underuseExponent` | `2` | Positive finite exponent ≤10 in `explorationWeight + (1 − use/peak)^exponent`. |
| `coverage.minTargetPhrases` | `32` | Integer 1–256; initial number of continuation planning calls for which a new target can be retained. |
| `coverage.targetSpreadPhrases` | `32` | Integer 1–256; adds a uniform integer from 0 through spread−1. The default initial counter is 32–63. Each subsequent unreached-target call decrements it and keeps the target; the following call after zero retargets. Reaching the target can retarget earlier. |
| `coverage.progressScaleSemitones` | `2` | Positive finite value ≤24, scales clamped towards/away progress for relocation acceptance. |
| `coverage.minMoveAcceptance` | `0.1` | 0.000001–1; geometric acceptance ranges from this floor for away moves to 1 for sufficiently towards-target moves. Positive lower bounds prevent division/log overflow. |
| `coverage.contourProbability` | `0.75` | Per-hand probability once per phrase of offsetting its contour towards the target. |
| `coverage.contourOffsetSteps` | `1` | Integer 0–4 mapped-note indices; resulting indices clamp to 0–4. |

Targets are sampled by region mass, then mapped to the nearest approved same-shape position center. The `+0.5` region center, inclusive range `+1`, clamping to unit progress, division by two in the geometric interpolation, histogram normalization and nearest-center math are formulas, not hidden behavioral knobs.

## Existing UI preset resolution

| Control | Explicit defaults selected |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Note jumps Small/Easy/Medium/Large | Maximum steps **1/2/4/7**; step bonus **7/4/2/0**. Existing advanced interval may lower the cap. |
| Movements Off/Easy/Medium/Hard | Fixed, or frequencies **0.25/0.55/0.85**, default distance **1/2/4**, eligible bars **[2]/[1,3]/[1,2,3]**. UI distance safety caps remain **2/3/4**. Numeric overrides resolve before core generation. Rested-alternate permission is retained for Medium/Hard, even with zero movement frequency. |
| Spacing Off/Easy/Medium/Hard | Variable probability **0/0.3/0.6/0.85**; natural, then add thumb gap, index gap, two gaps cumulatively. All initial pattern weights 1. |
| Accidentals Off/Easy/Medium/Hard | Diatonic, or occurrence **0.12/0.28/0.45**, passing resolution **0/0.4/0.65**; applied-dominant preference only in Hard. |
| Chords Off/Easy/Medium/Hard | Single notes, or occurrence **0.22/0.45/0.7**; dyads, add triads, add four-note shapes. Max spans **7/9/9**; sixth/minor-seventh recipes enabled in Hard. Voice-leading cap follows the resolved melody cap. |
| Rhythm Gentle/Quarters/Mixed | **480:2,960:1** / **480:1** / **240:1,480:1,960:1,1920:1** duration weights. Gentle/Mixed breathe at bar 2; Quarters does not. Preparation rests remain independent. |

No tempo, scoring mode, input offset, timing tolerance, assistance display, visible bar count, practice duration, MIDI/device setting or appearance preference controls generation. Smart inference memory is still computed in the same mode regardless of display settings. Legacy coverage context retains the original opaque settings token so existing stream state also compares byte-for-byte; parameter-driven callers use the resolved config fingerprint as their context automatically. The fourth engine argument exists only for this compatibility token and is not a practice-mode parameter.

## Fixed invariants and remaining hardcoded behavior

- MIDI 60 = C4, twelve semitones per octave, seven diatonic letters, physical black-key classes/centers, 480 TPQ, bar/tick arithmetic, five fingers and their mirrored hand order are notation/anatomical definitions.
- The fixed approved offset library is natural **[0,1,2,3,4]**, thumb gap **[0,2,3,4,5]**, index gap **[0,1,3,4,5]**, two gaps **[0,2,4,5,6]**, in finger order away from the thumb. Total map span ≤10 semitones; adjacent thumb/index and index/middle ≤4, remaining adjacent fingers ≤2. Horizontal gaps are ≤2.5/1.5 white-key widths. These are safety ceilings, not user preferences.
- Same-finger changes permit the same physical key or black-to-immediately-adjacent-white slides. Spelling does not change physical key color. Chromatic options use single-semitone alterations, no double accidentals or outer-finger alterations. Fixed base maps never change mid-position.
- Relocation must preserve shape, separate hands, honor both distance/jump limits, have a novel landing unavailable in the prior map, and have an explicit full-beat-or-longer rest and advance cue. Small shifts cannot enter a chunk. Wide leaps may enter only with carried preparation evidence. Hand crossing, overpassing and thumb-under are unsupported. Arbitrary ergonomic bounds cannot be overridden.
- Chord distinctness, approved finger shapes, full harmonic sets, nine-semitone ceiling, conservative outer-black/inner-white exclusions and horizontal shape limits are safety rules. The factor 1.5 plus 0.5 key-width allowance is part of that physical restriction, not a distribution preference.
- Four-bar chunk topology, shared-hand rhythmic attacks, diatonic triad qualities, deterministic ID conventions, contour/motif indexing, base untied duration vocabulary and chromatic resolution precedence are supported algorithm/model contracts. Uniform selection among otherwise equally weighted compatible positions or chromatic options is the defined sampler, not an unexposed second weighting system. No arbitrary additional weighting is applied.
- FNV seed hashing and xorshift32 constants/state bounds are reproducibility machinery. Ordered candidate traversal and one-draw sampling (including singleton choices) are deliberately stable. The sampler does not add “helpful” rerolls or skip existing zero-probability draws where that would change seeded content.

These checks establish consistency with the declared conservative model, not universal physical comfort. MIDI cannot verify which fingers a person uses.

## Compatibility evidence and migration scope

Before editing generation algorithms, 96 representative legacy settings/seed cases were captured as SHA-256 checksums of **three complete consecutive phrases each**. They span both meters, all keys, both rhythm/rest families, all hand modes, all five difficulty dimensions, broad independent ranges and continuation state. `compatibility.test.ts` verifies all 288 complete phrase outputs, including event IDs/order, spelling, fingers, chords, harmonies, explicit movements, final RNG, hint memory and coverage memory. Canonical legacy settings retain generator **5.2.0**, existing difficulty fingerprints and exact replay eligibility because their behavior is preserved.

The former Gentle duplicate duration entries `[480,480,960]` become weights `[2,1]`, and uniform template/position/chord choices become ordered unit-weight distributions. Their selection intervals and number/order of PRNG calls remain identical. Existing session/import/preference tests remain applicable without schema changes.

There is one intentional boundary tightening: malformed internal configurations are now rejected before sampling, and the independent validator rejects unsupported durations or harmonic plans outside the resolved libraries. In particular, negative/non-finite movement values can no longer disappear into an inactive branch, and reversed min/max bounds are rejected structurally even for a disabled hand. An older malformed settings object may therefore fail replay earlier with an actionable error; import/history data remains unchanged. A merely narrow but correctly ordered unused range is still ignored for contextual feasibility. This does not alter valid generated exercises or stored history (historical records do not store generated phrases). No outcomes are migrated or reinterpreted. The behavior-preserving modular refactor retains 5.2.0. The opt-in wide-leap capability uses a separate 6.0.0 parameter identity; future changes to canonical preset semantics still require versioning.

New custom values can intentionally select different exercises. Their complete resolved parameter fingerprint differs from legacy-settings comparison identities; the application continues using only the compatibility path. Changing the key/range/shape context of a continuing hand cannot silently reset/reposition it: start a new exercise when that state no longer fits.

## Future capabilities that are not parameter switches

Slur evaluation remains outside the generator. General crossings, thumb-under, alternate ergonomic shapes, new meters, keys and durations, and non-major harmonic vocabularies require explicit model and validator work before their schemas can be widened.

Future modules can be added as new typed fields/unions with their own defaults, resolver composition and validators. Unsupported capabilities are rejected today; no placeholder configuration fields or plugin registry claim those algorithms exist.
