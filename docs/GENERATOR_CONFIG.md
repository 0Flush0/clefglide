# Generator configuration and architecture

The generator has two entry points. `generate(settings, seed, previous?)` in `src/generation/planner.ts` is the unchanged application compatibility API. It resolves saved settings through `config/presets.ts`, calls the parameter-driven engine, and returns the original `Phrase` shape. No UI control, preference schema, session schema, backup format or historical fingerprint changes in this refactor.

`generateConfigured(config, seed, previous?)` in `engine.ts` accepts only a branded, deeply readonly `ValidatedGeneratorConfig`. It returns `GeneratedPhrase`, which carries the resolved config and a separate parameter fingerprint (`5.2.0:parameters:...` with wide leaps disabled, `6.0.0:parameters:...` for the enabled capability) and deliberately has no legacy `settings` field. Custom parameters must not be recorded as an ordinary legacy-settings session: integrating such a future practice mode into history will require an explicit persistence/comparison design.

The engine orchestrates small modules: `initialHands.ts`, `melody.ts`, `rhythm.ts`, `harmony.ts`, `chromatic.ts`, `movement.ts`, `wideLeaps.ts`, `voicings.ts`, `rangeCoverage.ts`, `positionMaps.ts` and `ergonomics.ts`. `sampling.ts` supplies ordered weighted selection. They consume resolved parameters, not difficulty labels. `planner.ts`, `positions.ts`, `chords.ts` and `validator.ts` retain the old signatures/range-preview behavior as compatibility facades; core modules do not import those facades. `difficulty.ts` and `config/presets.ts` are preset/UI policy, not algorithms. `generation/index.ts` provides the public composition API.

`phraseValidator.ts` and `wideLeapValidation.ts` independently reconstruct approved maps/options, harmony, transitions, movements, exact ticks, rhythm vocabulary, chords and boundary state. The `validator.ts` facade resolves policy for legacy callers. Validation does not call planner candidate, movement, rhythm, harmony, ergonomics or selection algorithms. Its physical checks and approved pattern reconstruction remain independent.

## Resolution, validation and overrides

- `GeneratorConfig` describes complete supported parameter data. The Zod schemas in `config/schema.ts` reject unknown fields, unknown feature kinds, unsupported capabilities, invalid values and cross-module contradictions.
- `normalizeGeneratorConfig(unknown)` validates a complete object, clones it through Zod and deeply freezes it. The branded output is the only accepted engine input. Ordinary generation helpers can trust the normalized type rather than repeatedly parsing each note.
- `resolveGeneratorConfig(overrides, base = generatorDefaults)` applies canonical defaults or a supplied preset base, then explicit overrides. Objects merge recursively; arrays replace completely, preserving order. An omitted/undefined override retains the base value. A changed `kind` replaces the entire union branch: supply the complete new branch, using `repositionDefaults`, `chromaticDefaults`, `chordDefaults`, `coverageDefaults` or `wideLeapDefaults`. Old branch properties never leak into a disabled branch.
- `resolveSettings(settings, overrides?)` is the one-way legacy adapter. It first enforces the existing UI's jump and movement caps, maps the labels to parameter presets, then applies explicit parameter overrides. A future practice mode can compose a config directly without adopting these UI caps or labels.
- Structural validation does not claim a particular keyboard range can realize every permitted shape. `inspectGeneratorFeasibility(config)` reports missing five-note positions, incompatible two-hand ranges and warnings for unavailable compatible variable positions, same-shape relocations or harmonic chord voicings. Its optional checks establish static possibilities, not a promise about sampled attacks/positions. Initialization rejects impossible positions with actionable errors. Optional chord/shift/spacing occurrence is a soft opportunity, just as before; infeasible optional candidates are omitted without widening ranges or weakening ergonomics, jumps or preparation.

```ts
import { resolveGeneratorConfig, repositionDefaults, coverageDefaults } from "./config";
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

## Complete parameter inventory

Defaults below refer to `generatorDefaults`. For an inactive union module, its enabled-branch defaults are listed explicitly. Probabilities are inclusive **0–1**; weights are relative mass, not percentages. A weighted entry is `{ value, weight }`, with finite weight **0.000001–1000**. Distributions contain **1–64** ordered entries; rhythm values, spacing names and chord shapes must be unique (increase their weight instead of duplicating entries). All numeric values must be finite. MIDI uses C4 = 60. Scale-step distances are diatonic, not semitones. Bar numbers are zero-based within a four-bar phrase.

### Notation and hands

| Parameter | Default | Allowed values, units and dependencies |
| --- | --- | --- |
| `notation.key` | `C` | `C`, `G`, `F`, `D`, major only; controls spelling, maps and harmony. |
| `notation.beats` | `4` | `3` or `4` quarter-note beats per measure. Rhythm budgets must tile exactly after rests. |
| `notation.phraseBars` | `4` | Literal capability, not a free length knob. Contours and progressions have exactly four entries. |
| `notation.voices` | `shared-rhythm` | Literal supported topology. Both hands share attacks/durations. |
| `notation.ties` | `false` | Literal capability; tied/sustained voice modeling is unsupported. |
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
| `movement.probability` | enabled branch: `0.25` | Probability per enabled boundary, independently per hand. Zero disables opportunities, preparation and coverage. |
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
| `wideLeaps.preparationBeats` | `2` | Integer 1–15 quarter-note beats of reserved silence before each eligible landing, including probability failures. The cyclic distance between eligible landings must exceed this by at least one beat. Thus 3/4 permits at most 11 beats, 4/4 at most 15, with one landing per phrase. Longer rests span measures and may cross a phrase boundary. |
| `wideLeaps.minimumPreparationBeats` | `1` | Finite 1–15 quarter-note beats, the declared baseline minimum. Every move must fit `minimum + abs(distanceSteps) / 7 × additionalPerOctave` into reserved preparation. This is a software timing model, not calibrated human travel time. |
| `wideLeaps.additionalPreparationBeatsPerOctave` | `0.5` | Finite 0–15 extra quarter-note beats per seven diatonic steps of position displacement. Configurations unable to prepare even their minimum distance are rejected structurally. Larger distances requiring too much time remain ineligible. Zero explicitly selects a distance-independent timing model. |
| `wideLeaps.eligibleBars` | `[2]` | Unique nonempty subset of zero-based bars 0–3, within each four-bar phrase. Landings occur at the first attack of those measures. Bar zero requires a reserved rest carried from the preceding phrase; fresh generation never fabricates prior preparation. |
| `wideLeaps.landingFingers` | `[1,2,3,4,5]` | Unique nonempty subset of integer fingers 1–5, in anatomical finger order for each hand. Each landing is one natural mapped note, unavailable in the old position; no chord, chromatic alteration or alternate-finger exception at the landing. |

```ts
import { generateConfigured, resolveGeneratorConfig, wideLeapDefaults } from "./generation";

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

At a boundary shared with small repositioning, a successful wide leap takes precedence for that hand; otherwise the existing optional small-shift attempt may run. The earlier cue reserves enough rest for either technique. A small-shift landing inside a wide preparation window is rejected as a contradictory schedule. Coverage guidance continues to require independently active small repositioning and biases those small moves only; it does not change wide-leap target weighting.

`inspectGeneratorFeasibility` returns errors if an active hand has no possible wide leap under its bounds, maps, direction, landing/finger/interval, separation and timing rules. Positive-probability wide generation checks these errors before sampling. This static test is existential: a sampled starting position, prior note or opposing hand can still block an individual opportunity. Such an attempted leap is explicitly reported in `GeneratedPhrase.movementDiagnostics` with hand, landing tick and `no-legal-target` or `no-preparation`; constraints are never widened. Probability failures are ordinary non-attempts. A first chunk's entry may report `no-preparation`. Callers should surface these diagnostics rather than present a leap-free phrase as successful leap practice. Optional small shifts/chords retain their earlier fallback behavior.

Enabled configurations use generator version **6.0.0** and include every new parameter in their fingerprint. Disabled configurations retain **5.2.0**, omit the disabled branch from the serialized fingerprint, and consume no extra random draws. Historical session records/fingerprints, persistence, exact UI replay and presets remain untouched. No custom configuration can be saved through the legacy session API merely by adding a settings object. This version is a programmatic capability identity, not a migration of old history.

Verification includes exact minimum/full-keyboard maximum displacements in both directions/hands, edge positions in all four keys, impossible inputs, preparation/cue corruption, long rests into every phrase-entry bar, overlapping two-hand ranges and travel collisions, small-shift coexistence, chromatic/chord/finger interactions, actual VexFlow SVG annotations, and seeded property tests with continuation/reproduction. The 96 captured legacy configurations still check 288 complete disabled phrase outputs byte for byte; this is regression evidence across representative configurations, not exhaustive enumeration of all numerical settings.

Physical piano/teacher testing is still required for comfortable speed and lift height at each distance/tempo, individual hand size, release and pedal behavior, extreme register reading, repeated leap fatigue, simultaneous hand coordination and visual cue lead time. Timing is expressed in score beats; this engine has no tempo or player travel calibration. There are no legato leaps, crossings, overpassing, finger substitutions at landings, chord landings, independent hand rhythms or universal playability guarantee. No new hardware test is implied by simulator/unit success, and MIDI cannot verify fingers.

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

The default is `coverage.kind = disabled`. The following are the canonical `guided` branch defaults. Guidance requires rested repositioning with positive probability. Memory is ephemeral and records actual noteheads per phrase, never fabricated outcomes.

| Parameter | Guided default | Allowed values, units and dependencies |
| --- | --- | --- |
| `coverage.kind` | `guided` when enabled | `disabled` has no extra fields; `guided` requires active rested movement. |
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
| --- | --- |
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
- Four-bar chunk topology, shared-hand rhythmic attacks, diatonic triad qualities, deterministic ID conventions, contour/motif indexing, tie-free duration vocabulary and chromatic resolution precedence are supported algorithm/model contracts. Uniform selection among otherwise equally weighted compatible positions or chromatic options is the defined sampler, not an unexposed second weighting system. No arbitrary additional weighting is applied.
- FNV seed hashing and xorshift32 constants/state bounds are reproducibility machinery. Ordered candidate traversal and one-draw sampling (including singleton choices) are deliberately stable. The sampler does not add “helpful” rerolls or skip existing zero-probability draws where that would change seeded content.

These checks establish consistency with the declared conservative model, not universal physical comfort. MIDI cannot verify which fingers a person uses.

## Compatibility evidence and migration scope

Before editing generation algorithms, 96 representative legacy settings/seed cases were captured as SHA-256 checksums of **three complete consecutive phrases each**. They span both meters, all keys, both rhythm/rest families, all hand modes, all five difficulty dimensions, broad independent ranges and continuation state. `compatibility.test.ts` verifies all 288 complete phrase outputs, including event IDs/order, spelling, fingers, chords, harmonies, explicit movements, final RNG, hint memory and coverage memory. Canonical legacy settings retain generator **5.2.0**, existing difficulty fingerprints and exact replay eligibility because their behavior is preserved.

The former Gentle duplicate duration entries `[480,480,960]` become weights `[2,1]`, and uniform template/position/chord choices become ordered unit-weight distributions. Their selection intervals and number/order of PRNG calls remain identical. Existing session/import/preference tests remain applicable without schema changes.

There is one intentional boundary tightening: malformed internal configurations are now rejected before sampling, and the independent validator rejects unsupported durations or harmonic plans outside the resolved libraries. In particular, negative/non-finite movement values can no longer disappear into an inactive branch, and reversed min/max bounds are rejected structurally even for a disabled hand. An older malformed settings object may therefore fail replay earlier with an actionable error; import/history data remains unchanged. A merely narrow but correctly ordered unused range is still ignored for contextual feasibility. This does not alter valid generated exercises or stored history (historical records do not store generated phrases). No outcomes are migrated or reinterpreted. The behavior-preserving modular refactor retains 5.2.0. The opt-in wide-leap capability uses a separate 6.0.0 parameter identity; future changes to canonical preset semantics still require versioning.

New custom values can intentionally select different exercises. Their complete resolved parameter fingerprint differs from legacy-settings comparison identities; the application continues using only the compatibility path. Changing the key/range/shape context of a continuing hand cannot silently reset/reposition it: start a new exercise when that state no longer fits.

## Future capabilities that are not parameter switches

Wide lifted leaps are implemented through the separate module documented above. Sustained notes and ties require note lifetime/tie identity in the score model plus attack/release/sustain-aware scoring and rendering. Independent voices require separate timelines/voice IDs, overlap validation, coordinated hand-state scheduling and scorer/engraver support. General crossings, thumb-under, alternate ergonomic shapes, new meters/keys/durations and non-major harmonic vocabularies require explicit model/algorithm/validator work before their schemas can be widened.

Future modules can be added as new typed fields/unions with their own defaults, resolver composition and validators. Unsupported capabilities are rejected today; no placeholder configuration fields or plugin registry claim those algorithms exist.
