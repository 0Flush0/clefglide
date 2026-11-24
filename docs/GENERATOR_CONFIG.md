# Generator configuration and architecture

`generateConfigured(config, seed, previous?)` in `src/generation` is the production entry point for Guided and Advanced practice. Both profiles use the same `GeneratedPhrase` and pass its full `final` state into the next call. The `planner.ts` and `config/presets.ts` adapters are specific to 5.2.0 replay and its regression fixtures.

The engine accepts a branded, deeply readonly `ValidatedGeneratorConfig`. Each phrase carries the resolved config and its parameter fingerprint. Versions are 5.2.0 for the original core, 6.0.0 for wide leaps, 7.0.0 for explicit lifetimes, 8.1.0 for shared-rhythm ties, 9.0.0 for the original independent scheduler, and 10.0.0 for independent voices with wide leaps, guided coverage or authored rested-alternate permission. Enabling `dynamicFingering` selects 11.0.0. Opting into `articulation` selects 12.0.1 and includes the resolved articulation policy in the fingerprint. Selected older profiles use a patch identity when they exercise a corrected planner path. See the verification report below.

The engine orchestrates small modules for initial hands, melody, rhythm, harmony, chromatic neighbors, movement, ties, voicing, range coverage and ergonomics. `sampling.ts` supplies ordered weighted selection. Each module consumes resolved parameters. The practice settings check range and other contextual constraints through `inspectGeneratorFeasibility`.

`phraseValidator.ts`, `independentValidator.ts`, `wideLeapValidation.ts`, `lifetimeValidator.ts` and `fingeringValidator.ts` independently reconstruct approved maps/options, harmony, transitions, movements, exact ticks, rhythm vocabulary, chords and boundary state. Dynamic validation checks the supplied plan against deterministic contact and timeline rules independently of candidate enumeration, sequence sampling and the probabilistic substitution planner.

## Resolution, validation and overrides

- `GeneratorConfig` describes complete supported parameter data. The Zod schemas in `config/schema.ts` reject unknown fields, unknown feature kinds, unsupported capabilities, invalid values and cross-module contradictions.
- `normalizeGeneratorConfig(unknown)` validates a complete object, clones it through Zod and deeply freezes it. The branded output is the only accepted engine input. Ordinary generation helpers can trust the normalized type rather than repeatedly parsing each note.
- `resolveGeneratorConfig(overrides, base = generatorDefaults)` applies canonical defaults or a supplied preset base, then explicit overrides. Objects merge recursively; arrays replace completely, preserving order. An omitted/undefined override retains the base value. A changed `kind` replaces the entire union branch: supply the complete new branch, using `repositionDefaults`, `chromaticDefaults`, `chordDefaults`, `coverageDefaults`, `wideLeapDefaults`, `noteLifetimeDefaults`, `durationEvaluationDefaults` or `tieDefaults`. Old branch properties never leak into a disabled branch.
- `resolveSettings(settings, overrides?)` is the legacy replay adapter. It enforces the original jump and movement caps and maps the historical labels to their exact parameters.
- Structural validation does not claim a particular keyboard range can realize every permitted shape. `inspectGeneratorFeasibility(config)` reports missing five-note positions, incompatible two-hand ranges and warnings for unavailable compatible variable positions, same-shape relocations or harmonic chord voicings. Its optional checks establish static possibilities, not a promise about sampled attacks/positions. Generation rejects impossible positions with `GeneratorContextInfeasibleError`. Repeated use of the same immutable configuration reuses the static verdict. Optional chord, shift, spacing, coverage and tie choices are preferences applied to legal candidates. An unavailable opportunity keeps the prior position or uses another legal event. A structurally valid configuration can still have no playable position in the selected registers. `GeneratorSearchExhaustedError` identifies a separate outcome where the independent scheduler used its finite attempt budget, and includes the last validator rejection. It does not establish infeasibility.

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
| Dynamic attack techniques and held-finger substitution | Advanced opt-in | Programmatic opt-in with per-voice constraints | The moving hand needs an isolated contact window for continuous movement and local alternates. Substitution can use an isolated hold or a supported stationary dyad. |
| Fixed positions and small lifted repositioning | Supported | Supported | Small shifts require preparation and an eligible, sounding main-voice landing. Independent landings respect overlap limits. The small-shift schedule reserves the same tail in all lanes. |
| Wide lifted leaps and small shifts | Supported on compatible shared schedules | Supported with hand-local wide preparation | A simultaneous hold by the relocating hand or an intersecting travel envelope rules out that move. An opposite-hand hold is compatible with independent preparation and a legal landing. |
| Guided register coverage with small shifts, wide leaps or both | Supported | Supported | Guidance can defer an already legal move or bias a contour within the currently reachable map. Fixed-only guidance lacks relocation opportunities. |
| Chromatic neighbors and harmonic chord voicings | Supported | Supported with lane permissions | Chromatic neighbors resolve on the next untied attack unless the hand explicitly relocates. Existing harmonic voicings and neighbor figures use separate candidates for a given attack. Chords and chromatic notes can occur in different lanes if the combined map remains playable. |
| Chord shapes, voice leading and partial or full chord ties | Supported | Supported with lane permissions and peak polyphony requirements | Shape, harmony, available fingers and actual overlap can leave only an untied attack, a single tone, or a continuation with fewer new heads. |
| Articulation and slurs | Programmatic opt-in | Programmatic opt-in per lane | Detached marks need a free release window. Ties, substitution, adjacent-reach preparation and continuous movement protect their required contacts. Slurs can cross two chunks when the preview and its continuation agree. |
| Explicit lifetimes and release evaluation | Supported | Supported and required for physical key holds, with evaluation optional | The score grades attack groups and release targets through MIDI. Required physical holds and pedal-extended sound have separate meaning. |
| Subdivision, connected notes and bounded carry chains | Supported | Supported per declared voice | Ties keep pitch, voice, position, finger and lifetime identity. Shared-rhythm carry needs a sounded boundary in the shared schedule. Independent carry can survive a relocation by the other hand. |
| Rested adjacent-finger exception | Supported for validated authored plans | Supported for validated authored plans | A tagged single head needs a whole beat of rest for that hand before its fresh attack in the current phrase. The nominal mapped finger, adjacency and two-semitone reach must agree. A tie can sustain a previously validated assignment. The generator emits mapped assignments and its existing chromatic options. |
| Smart hints, per-head notation, accidentals, ties and movement cues | Supported | Supported | Retain the earlier cue rest in the visible score data to show cross-phrase advance cues. Assistance changes do not change the generated score or MIDI grading. |
| Timed, wait and benchmark scoring with explicit lifetimes | Supported programmatically | Supported programmatically | Pitch, onset and duration results remain distinct. Wait and benchmark duration behavior depends on the existing evaluation policy. Same-pitch overlapping ownership is architecturally unsupported by MIDI attribution. |

| Classification | Example and outcome |
| --- | --- |
| Contradictory | Minimum displacement greater than maximum, preparation shorter than the configured minimum travel time, required overlap with insufficient available keys, ties without required physical holds, or a minimum activity count above its rhythm budget. Configuration rejects these combinations. |
| Architectural | Independent profiles require explicit physical lifetimes, fixed lane IDs and complete per-voice notation. Movement landings use one mapped main-voice note. Each MIDI pitch has at most one physical owner, and hand envelopes stay separated. See the dynamic fingering and articulation sections for their additional contact rules. |
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

To run an example in the app, serialize its resolved config with `JSON.stringify(config, null, 2)`. Paste the document into **Advanced → Generator parameters**, select **Use parameters** and then **Apply & generate**. Wait, timed and benchmark scoring apply to either practice profile. The custom profile, resolved configuration and applied seed persist locally. Launching a replay uses the session's seed and config without replacing saved practice preferences. [Practice guide](PRACTICE.md)

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
| `fingering.variablePositionProbability` | `0` | Zero permits only natural spacing. A positive value requires a variable pattern in the library and gives the initial variable group preference on that fraction of draws. When either preferred group has no compatible position, use the other approved group. |
| `fingering.chromaticFingers` | `[2,3,4]` | Unique nonempty subset of these inner fingers; controls available alternative assignments. Outer-finger chromatic reach remains disallowed by the model. |
| `fingering.allowRestedAlternates` | `false` | Boolean validator permission for the existing explicitly tagged rested-adjacent alternative. Automatic generation also requires the `dynamicFingering` technique rule. |
| `movement.kind` | `fixed` | `fixed` has no extra fields, or `rested-reposition`. Unsupported techniques are rejected. |
| `movement.probability` | enabled branch: `0.25` | Probability per enabled boundary, independently per hand. Zero disables small-shift opportunities and their preparation. Guided coverage requires another active technique if small shifts are disabled. |
| `movement.maxDistanceSteps` | enabled branch: `1` | Integer 1–4 diatonic steps of the position's lowest pitch. Separate from the melodic jump limit. |
| `movement.eligibleBars` | enabled branch: `[2]` | Unique nonempty destination bars 1–3. Never chunk entry/bar zero. |
| `movement.preparationBeats` | enabled branch: `1` | 1 or 2 full quarter-note beats of rest; never below the full-beat safety minimum. The cue attaches to the exact rest start; its end is the landing tick. |
| `movement.distanceWeights` | enabled branch: `[4,3,2,1]` | Four positive weights for absolute distances 1, 2, 3, 4. Coverage scales acceptance of legal candidates; unused mass means no relocation. |

### Dynamic fingering and continuous movement (programmatic API, version 11)

Version 10 generated fixed and approved variable position maps, chromatic finger options, repeated keys, same-finger black-to-white slides and lifted relocations. It also represented ties and independent voices with physical holds. Authored scores could validate an explicitly tagged rested alternate. A tie used the same planned finger through its segments, so there was no held-finger substitution. Version 11 adds explicit actions to both existing planners.

`dynamicFingering` defaults to omission. Supply the complete object to opt in. Omission preserves the earlier generators, preset settings, PRNG sequence and fingerprint bytes. `movement.kind` and `wideLeaps` continue to govern lifted actions. A fixed lifted-movement policy can be composed with a continuous technique.

| Parameter | Bounds and behavior |
| --- | --- |
| `tempoBpm` | Integer 10–180. Each duration threshold in milliseconds rounds up to ticks using `ceil(ms × BPM × 480 / 60000)`. Use the same tempo when performing/scoring a programmatically generated exercise. |
| `techniques` | One to six unique technique rules. Omit a technique to disable it. Arrays replace on resolution; list order participates in deterministic sampling and fingerprinting. |
| `fingerWeights` | Five destination-finger weights in finger order, each 0.001–1000. Weight 1 is neutral. Applies to alternate assignments, continuous landings and the receiving finger of a substitution. |
| `attacks.maxConsecutive`, `attacks.maxRepeated` | Integers 1–32, with repeated ≤ consecutive. Require `attacks` when any attack technique is listed. Each hand carries its run across rests, tied continuations and chunks. An ordinary main-voice attack resets the run. Switching techniques restarts the same-technique count. |
| `attacks.distanceCost` | Number 0–100. Divide attack mass by `1 + distanceCost × distance`. Continuous moves use position distance in scale steps. Local alternate assignments use reach in semitones. |
| All rules `probability` | In (0, 1]. Attack rules draw independently per eligible main-voice opportunity. Substitution draws once per hand and displayed segment onset with one or more legal transfers. |
| Attack rules `weight` | 0.001–1000. Multiplies each passed, legal candidate's melodic weight, finger preference and distance factor. Substitution has its own opportunities and chooses among legal handoffs with `fingerWeights`. |
| All rules `fingerPairs` | Nonempty unique ordered pairs of integers 1–5. The allowed pairs and interpretation are in the table below. The effective interval and any independent-voice range/finger restrictions still apply. |
| Attack rules `directions` | Nonempty unique subset of `up` and `down` in physical pitch order. For an alternate, direction is from the alternate finger's home to the played key. |
| Attack rules `maxSemitones` | Positive integer. Maximum change in attack pitch for movement, or maximum reach from home for an alternate. Crossings and alternates cap at 2. The noncrossing shift caps at 3. |
| All rules `minimumPreparationMs` | Integer 0–2000. Continuous movement and substitution apply an 80 ms preparation floor. Adjacent reach applies a 100 ms floor. Rested alternate takes the greater of the configured milliseconds and its rest threshold. |
| Continuous rules `minimumTransitionMs` | Integer 0–2000. Floors are 120 ms for crossings and 90 ms for a noncrossing shift. This is a separate interval at the end of the source hold, after preparation. |
| Continuous rules `maxPositionSteps` | Integer 1–3 and large enough to admit at least one configured crossing pair. Use exactly 1 for the noncrossing shift. Position distance measures movement of the lowest mapped pitch in diatonic steps. |
| Continuous rules `allowBlackKeys`, `allowTiedSource` | Booleans. Allow mapped black-key contacts on inner fingers and allow the last segment of a tie as the source, respectively. The thumb always crosses on a white key. |
| Rested alternate `minimumRestTicks` | Integer 480–960. The whole hand must remain silent for this interval, including any independent lanes. Also requires `fingering.allowRestedAlternates`. |
| Substitution `transferMs`, `minimumRecoveryMs` | Integers 80–2000. The transfer completes strictly inside the physical hold. Recovery starts at key release, precedes new same-hand attacks or hand movement, and fits entirely within the output phrase. |
| Substitution `allowTies`, `heldNotes` | Boolean allowing handoff on a final tie segment and either `isolated` or `stable-dyad`. The second mode also admits one compatible stationary supporting tone. |

| Technique | Fixed ergonomic envelope |
| --- | --- |
| `thumb-under` | 2→1 or 3→1, RH ascending or LH descending. One diatonic step between mapped source and landing, at most one white-key width between centers. The conventional scale template translates the five-finger position by the long finger number in steps. |
| `finger-over` | 1→2 or 1→3, RH descending or LH ascending. The inverse crossing uses the same white-thumb and adjacent-key envelope. |
| `continuous-shift` | Adjacent fingers follow normal hand order across up to two diatonic steps and two white-key widths, with a one-step translation of the position. |
| `adjacent-reach` | Adjacent inner fingers 2–4. A free finger reaches from its mapped white key to an adjacent mapped white key while the departing contact preserves hand order and the combined reach envelope. |
| `rested-alternate` | Any adjacent pair, interpreted as mapped finger → alternate finger. Both mapped keys must be white and one white-key width apart. The earlier v10 authored exception remains available under its original policy. |
| `substitution` | Adjacent inner fingers 2–4 on a continuously held white key, with the receiving finger normally mapped one white-key width away. A supporting white key must remain down through target release and clear both finger contacts with an ordered, bounded span. One transfer per lifetime. |

Continuous movement requires one main-voice physical source contact through the landing tick, a single landing attack and no additional same-hand contact during the gesture. The explicit movement records source event/key/finger, cue, transfer start, landing and both approved maps. The travel envelope includes both shaped positions and their chromatic options. It is tested against the opposite hand's positions and travel envelopes. Across chunks the preceding contact can serve as the cue source. A recent opposite-hand movement whose prior sweep cannot be reconstructed conservatively rules out that opportunity. Physical occupancy uses notated durations when explicit lifetimes are disabled. Explicit attack-only lifetimes are incompatible with techniques that need a preceding hold.

Continuous landings and local alternates are diatonic relative to the active key, including allowed key-signature black keys for movement. Chromatic neighbors and their resolution remain available at ordinary attacks. Both hands, chord attacks, independent lanes and lifted relocations can coexist in the same stream. An overlapping same-hand chord or independent hold blocks a continuous gesture. A local alternate uses a single isolated attack and holds the same position. Ties can end at a permitted crossing source. The tie planner preserves the source cue and leaves continuous landings and alternate attacks untied. A substitution can use a final segment of a local or incoming tie if the hold and recovery fit. Its notehead metadata changes neither the lifetime ID nor its attack/release ticks. A stable dyad is supported during a substitution. Moving several held tones, general polyphonic crossings, pedal-only substitution and arbitrary re-fingerings are outside this model.

The independent validator rechecks contacts, timing, occupied keys, hand clearance, technique runs and the retained boundary. Smart Hints show alternate fingers and show the continuous gesture at its cue and the landing finger at the attack. A visible landing can carry the gesture label if its cue is outside the notation window. Substitutions appear as a finger pair on the glyph where the transfer takes place, including a tied continuation. MIDI scores the same attack and release regardless of the planned transfer. These templates are conservative software models. Player comfort and pedagogical effectiveness require physical review.

`GeneratorConfigurationError` reports contradictory or unrecognized parameters. `inspectGeneratorFeasibility` checks necessary range, rhythm, voice and contact-template conditions. Generation reports a failing context with `GeneratorContextInfeasibleError`. An eligible stochastic phrase can still contain zero technique occurrences when its realized sequence has no free window or passes no occurrence draw. The independent scheduler retains its configured retry limit and reports `GeneratorSearchExhaustedError` if that budget runs out.

Each technique has a reusable rule in `src/generation/examples.ts`.

```ts
import { generateConfigured } from "./src/generation";
import { dynamicFingeringExample } from "./src/generation/examples";

const techniques = [
  "thumb-under", "finger-over", "continuous-shift",
  "adjacent-reach", "rested-alternate", "substitution",
] as const;
const exercises = techniques.map((technique) =>
  generateConfigured(dynamicFingeringExample([technique]), `practice-${technique}`),
);
const duet = dynamicFingeringExample(["thumb-under", "finger-over"], {
  hands: { active: "both" },
  notation: { key: "G" },
});
const first = generateConfigured(duet, "crossing-duet");
const next = generateConfigured(duet, first.seed, first.final);
```

### Wide lifted leaps (programmatic API only)

`wideLeaps` is independent of `movement` and the ordinary melody interval limit. The default is `{ kind: "disabled" }`. An omitted field normalizes to disabled. Enable it in Advanced with the complete `wideLeapDefaults` branch, then set its distance, preparation and landing parameters for the selected range.

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

At a boundary shared with small repositioning, a successful wide leap takes precedence for that hand. The optional small-shift attempt can run if the wide leap is skipped. With shared rhythm, the earlier cue reserves enough rest for either technique and the configuration rejects a small-shift landing inside a wide preparation window. With independent voices, the scheduler skips the affected hand's conflicting opportunity and checks both techniques against actual holds. Both voice models apply coverage acceptance weighting to either technique.

`inspectGeneratorFeasibility` reports a contextual error if no active hand has a possible wide leap under its bounds, maps, direction, landing fingers, interval, separation and timing rules. A stationary opposite hand is supported. Positive-probability wide generation checks these errors before sampling. This static test is existential: a sampled starting position, prior note or opposing hand can still block an individual opportunity. Such an attempted leap is explicitly reported in `GeneratedPhrase.movementDiagnostics` with hand, landing tick and `no-legal-target` or `no-preparation`; constraints are never widened. Probability failures are ordinary non-attempts. A first chunk's entry may report `no-preparation`. Callers should surface these diagnostics rather than present a leap-free phrase as successful leap practice. Optional small shifts/chords retain their earlier fallback behavior.

Enabled configurations use generator version **6.0.0** and include every new parameter in their fingerprint. Disabled configurations retain **5.2.0**, omit the disabled branch from the serialized fingerprint, and consume no extra random draws. Configured practice records use the wide-leap parameter identity and preserve previous historical outcomes.

Verification includes exact minimum/full-keyboard maximum displacements in both directions/hands, edge positions in all four keys, impossible inputs, preparation/cue corruption, long rests into every phrase-entry bar, overlapping two-hand ranges and travel collisions, small-shift coexistence, chromatic/chord/finger interactions, actual VexFlow SVG annotations, and seeded property tests with continuation/reproduction. The 96 captured legacy configurations still check 288 complete disabled phrase outputs byte for byte; this is regression evidence across representative configurations, not exhaustive enumeration of all numerical settings.

Physical piano/teacher testing is still required for comfortable speed and lift height at each distance/tempo, individual hand size, release and pedal behavior, extreme register reading, repeated leap fatigue, simultaneous hand coordination and visual cue lead time. Lifted leap timing is expressed in score beats. Continuous crossings and substitutions use the separate dynamic policy's tempo. Lifted landings are single notes and the travel model keeps each hand on its own side. No new hardware test is implied by simulator/unit success, and MIDI cannot verify fingers.

### Explicit note lifetimes and optional duration scoring (programmatic API)

`noteLifetimes` is independent of difficulty, movement and rhythm selection. The canonical default is `{ kind: "disabled" }`; omitted fields in older parameter objects normalize to that branch. Disabled generation retains its original fields, PRNG consumption and fingerprints. `noteLifetimeDefaults` enables explicit metadata with evaluation disabled. Spread `durationEvaluationDefaults` to opt into evaluation. Enable these capabilities in the Advanced profile.

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

Enabled lifetime configurations without ties use version **7.0.0** with every lifetime/evaluation parameter in the generator fingerprint, even when evaluation is disabled. Both disabled modules retain **5.2.0**, and wide leaps with lifetimes disabled retain **6.0.0**, including their prior fingerprint serialization order. `scorer.scoringFingerprint` additionally identifies mode, BPM, meter, offset, onset tolerance and chord capture width for enabled programmatic scoring. Configured practice sessions save duration results alongside pitch outcomes and include playback and assistance in their comparison fingerprint. Legacy sessions retain their original schema, fingerprint, outcomes and replay eligibility.

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
| `maxOverlapTicks` | `491520` | Integer 0–491520. Maximum intersection of any two lifetimes in different voices, including their tied segments. Zero disallows overlap. The shortest structural overlap is 240 ticks, so smaller positive limits also exclude overlapping structural attacks. The cap applies to proposed articulation extensions. It leaves chord-internal holds unchanged. |
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

The original independent configurations use **9.0.0**. An independent configuration with a wide-leap branch, guided coverage or rested-alternate permission uses **10.0.0**. Corrected profiles use the patch identities described below. Each fingerprint includes its resolved voice and capability settings. Stream continuation requires the original seed and fingerprint. The shared-rhythm presets and their historical session and backup identities retain their existing versions.

The Advanced profile accepts independent-voice configurations. The notation vocabulary remains eighth, quarter, half and whole notes in 3/4 and 4/4. Ties extend holds across independently engraved measures or phrases. MIDI grades attack and release data. Finger plans and physical comfort require player review.

### Musical ties (programmatic API, version 8)

Ties are **off in every existing preset and in `generatorDefaults`**. The Advanced profile can enable ties with a compatible lifetime policy. A tie is multiple notated heads sharing one attack and one continuous lifetime. Equal pitches without explicit links remain repeated attacks. VexFlow `StaveTie` curves distinguish these from slurs.

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
| `chords.maxVoiceLeadingSteps` | enabled branch: `2` | Integer 1–7, independent of the melodic anchor cap. Legacy presets derive both from the jump setting. Consecutive chord voices must be near a preceding or following voice in both directions, including added or removed voices. |
| `chords.majorExtension` | enabled branch: `none` | `none` or existing `sixth` recipe for a major harmonic root. |
| `chords.minorExtension` | enabled branch: `none` | `none` or existing `seventh` recipe for a minor harmonic root. |

Approved dyads: **13, 14, 15, 24, 25, 35**. Triads: **135, 125, 145, 124, 245**. Four-note shapes: **1235, 1245, 1345**. The schema permits selection/weighting within this library, not invention of new ergonomic shapes. Complete triad/extension pitch-class content, distinct pitches/fingers, inner/outer black-key restrictions and horizontal reach remain mandatory. Exact size occurrence depends on the active map/range/harmony.

### Register coverage

With independent voices, each hand keeps one bounded histogram and one target. The target represents the centers of voice-compatible positions. Each voice projects that target into its own register for contour weighting. Usage measures actual notehead lifetimes clipped to the phrase, so sustained and carried notes contribute by duration, and tie glyphs do not duplicate use. A coverage preference cannot widen a register or bypass preparation, occupancy, collision or harmony constraints.

The default is `coverage.kind = disabled`. The following are the canonical `guided` branch defaults. Guidance requires positive probability for rested repositioning, wide leaps or both, in either voice model. Memory is ephemeral and reflects the generated score.

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

## Historical 5.2 preset resolution

| Control | Explicit defaults selected |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Note jumps Small/Easy/Medium/Large | Maximum steps **1/2/4/7**; step bonus **7/4/2/0**. Existing advanced interval may lower the cap. |
| Movements Off/Easy/Medium/Hard | Fixed, or frequencies **0.25/0.55/0.85**, default distance **1/2/4**, eligible bars **[2]/[1,3]/[1,2,3]**. UI distance safety caps remain **2/3/4**. Numeric overrides resolve before core generation. Rested-alternate permission is retained for Medium/Hard, even with zero movement frequency. |
| Spacing Off/Easy/Medium/Hard | Variable probability **0/0.3/0.6/0.85**; natural, then add thumb gap, index gap, two gaps cumulatively. All initial pattern weights 1. |
| Accidentals Off/Easy/Medium/Hard | Diatonic, or occurrence **0.12/0.28/0.45**, passing resolution **0/0.4/0.65**; applied-dominant preference only in Hard. |
| Chords Off/Easy/Medium/Hard | Single notes, or occurrence **0.22/0.45/0.7**; dyads, add triads, add four-note shapes. Max spans **7/9/9**; sixth/minor-seventh recipes enabled in Hard. Voice-leading cap follows the resolved melody cap. |
| Rhythm Gentle/Quarters/Mixed | **480:2,960:1** / **480:1** / **240:1,480:1,960:1,1920:1** duration weights. Gentle/Mixed breathe at bar 2; Quarters does not. Preparation rests remain independent. |

Legacy replay uses the original coverage settings token so the complete continuation state remains byte-for-byte reproducible. Configured streams use the resolved generator fingerprint for coverage. Playback options are separate from generation. When dynamic fingering is enabled, the practice UI synchronizes playback tempo with the planner's `tempoBpm`. Smart inference memory is computed independently of the visible assistance mode.

## Fixed invariants and remaining hardcoded behavior

- MIDI 60 = C4, twelve semitones per octave, seven diatonic letters, physical black-key classes/centers, 480 TPQ, bar/tick arithmetic, five fingers and their mirrored hand order are notation/anatomical definitions.
- The fixed approved offset library is natural **[0,1,2,3,4]**, thumb gap **[0,2,3,4,5]**, index gap **[0,1,3,4,5]**, two gaps **[0,2,4,5,6]**, in finger order away from the thumb. Total map span ≤10 semitones; adjacent thumb/index and index/middle ≤4, remaining adjacent fingers ≤2. Horizontal gaps are ≤2.5/1.5 white-key widths. These are safety ceilings, not user preferences.
- Same-finger changes permit the same physical key or black-to-immediately-adjacent-white slides. Spelling does not change physical key color. Chromatic options use single-semitone alterations, no double accidentals or outer-finger alterations. Fixed base maps never change mid-position.
- Lifted relocation must preserve shape, separate hands, honor both distance/jump limits, have a novel landing unavailable in the prior map, and have an explicit full-beat-or-longer rest and advance cue. Small lifted shifts cannot enter a chunk. Wide leaps may enter only with carried preparation evidence. Continuous techniques use the contact templates above. Crossing one hand over the other and arbitrary ergonomic overrides are outside the model.
- Chord distinctness, approved finger shapes, full harmonic sets, nine-semitone ceiling, conservative outer-black/inner-white exclusions and horizontal shape limits are safety rules. The factor 1.5 plus 0.5 key-width allowance is part of that physical restriction, not a distribution preference.
- Four-bar chunk topology, shared-hand rhythmic attacks, diatonic triad qualities, deterministic ID conventions, contour/motif indexing, base untied duration vocabulary and chromatic resolution precedence are supported algorithm/model contracts. Uniform selection among otherwise equally weighted compatible positions or chromatic options is the defined sampler, not an unexposed second weighting system. No arbitrary additional weighting is applied.
- FNV seed hashing and xorshift32 constants/state bounds are reproducibility machinery. Ordered candidate traversal and one-draw sampling (including singleton choices) are deliberately stable. The sampler does not add “helpful” rerolls or skip existing zero-probability draws where that would change seeded content.

These checks establish consistency with the declared conservative model, not universal physical comfort. MIDI cannot verify which fingers a person uses.

## Compatibility evidence and migration scope

Before editing generation algorithms, 96 representative legacy settings/seed cases were captured as SHA-256 checksums of **three complete consecutive phrases each**. They span both meters, all keys, both rhythm/rest families, all hand modes, all five difficulty dimensions, broad independent ranges and continuation state. `compatibility.test.ts` verifies all 288 complete phrase outputs, including event IDs/order, spelling, fingers, chords, harmonies, explicit movements, final RNG, hint memory and coverage memory. Canonical legacy settings retain generator **5.2.0**, existing difficulty fingerprints and exact replay eligibility because their behavior is preserved.

The same test checks complete three-phrase v9 and v10 streams, including v10 guided movement and a wide-leap duet with cross-phrase chord ties. The v10 hashes were captured from the source before dynamic fingering was enabled.

The former Gentle duplicate duration entries `[480,480,960]` become weights `[2,1]`, and uniform template/position/chord choices become ordered unit-weight distributions. Their selection intervals and number/order of PRNG calls remain identical. Existing session/import/preference tests remain applicable without schema changes.

There is one intentional boundary tightening: malformed internal configurations are now rejected before sampling, and the independent validator rejects unsupported durations or harmonic plans outside the resolved libraries. In particular, negative/non-finite movement values can no longer disappear into an inactive branch, and reversed min/max bounds are rejected structurally even for a disabled hand. An older malformed settings object may therefore fail replay earlier with an actionable error; import/history data remains unchanged. A merely narrow but correctly ordered unused range is still ignored for contextual feasibility. This does not alter valid generated exercises or stored history (historical records do not store generated phrases). No outcomes are migrated or reinterpreted. The behavior-preserving modular refactor retains 5.2.0. The opt-in wide-leap capability uses a separate 6.0.0 parameter identity; future changes to canonical preset semantics still require versioning.

New custom values can intentionally select different exercises. Their complete resolved parameter fingerprint differs from legacy-settings comparison identities; the application continues using only the compatibility path. Changing the key/range/shape context of a continuing hand cannot silently reset/reposition it: start a new exercise when that state no longer fits.

## Articulation and slurs (12.0.1)

Enable `articulation: { kind: "enabled", ... }` with `noteLifetimes: noteLifetimeDefaults` or another explicit policy with `keyHold: "required"`. Omission or `articulation: false` preserves versions, seeded output and fingerprints from 5.2 through 11. Configure articulation in the Advanced profile. Sessions record the resolved config, seed, and articulation outcomes. Changes to seed or resolved config require a new stream.

`ScoreEvent.duration` is the engraved duration in ticks. `NoteLifetime` describes baseline attack identity and lifetime, including any tie chain and its physical occupancy plan. The event's optional `articulation` holds semantic touch, emphasis and a performed timing target. Its independent `slur` field identifies a position in a voice-level group. `performedLifetime(head.lifetime, event.articulation?.timing)` in `src/score/lifetimes.ts` projects intended duration and nominal physical release onto a head. The release tracker observes actual attack, key release and logical pedal-held sound release separately. Measure budgets, ties, movement cues, pitch spelling and fingering remain governed by the original score. A slur connects distinct attacks, including legitimate reattacks on the same key.

### Selection and grouping

| Field | Values, defaults and effect |
| --- | --- |
| `voices` | Required nonempty list of unique active voice IDs. Use `right:main` and `left:main` for shared rhythm. Independently scheduled voices also accept suffixes `:2` through `:5` when configured with nonzero activity and entry probability. Applies to individual touch and emphasis and is the fallback for slurs. |
| `touch` | Rules for `natural`, `legato`, `non-legato`, `staccato`, `staccatissimo` and `tenuto`. One rule at most per type and one chosen touch at most per attack. Default `[]`. Natural has no glyph or individual timing target. Bare legato and non-legato are unmarked touch exercises that model connection or separation to a contiguous successor in the same chunk. Staccato, staccatissimo and tenuto print their standard marks. |
| `emphasis` | Rules for `accent` and `marcato`. Default `[]`. One emphasis may combine with a touch or either slur style. It applies to the complete attack, including any chord. |
| Rule `value`, `probability`, `weight` | `value` selects the unique supported entry. On a fresh draw, each eligible rule passes its independent probability gate (0–1, default 1). Choose among passing rules by positive weight (up to 1000, default 1). A zero-probability rule is disabled. The same fields apply to the slur style rules. |
| `touchProbability`, `emphasisProbability` | Overall fresh-draw opportunities per eligible event, 0–1, default 1 for each layer. Only layers with rules participate and require a positive chance with at least one positive-probability rule. A draw with no passing candidate leaves the layer empty. |
| `persistence` | 0–1, default 0. Each layer first attempts to retain the preceding explicit mark with this probability, if it remains eligible and the two attacks are contiguous. Otherwise it takes a fresh draw. Rests and ineligible/differently styled attacks can break persistence. A boundary snapshot can carry a terminal mark into the next phrase opening. |
| `slurs` | `false` by default. Pass an object to choose groups first, then choose compatible touch and emphasis for each attack. Slurs are contiguous, non-overlapping groups per voice. No nesting, overlapping groups within a voice, cross-voice slurs, or slurs over a rest. Independent voices can have concurrent groups. |
| `slurs.voices` | Optional unique active lane IDs. Inherits `voices` when omitted. Independent of the eligibility list for individual marks when explicitly set. |
| `slurs.probability` | Greater than 0 and at most 1, default 0.35. Chance to try a group at an unused starting attack. A successful draw still needs a feasible style and length. |
| `slurs.lengths` | Unique `{ value, weight }` entries. Lengths are 2–16 attacks, default 2 and 3 with equal weights. Chords count as one attack and tie continuations consume no slots. After selecting a feasible style, sample among its feasible lengths by weight. |
| `slurs.styles` | Weighted `legato` and/or `portato` rules, default legato with probability and weight 1. A legato slur supplies connection targets on internal edges unless the source has an explicit short or tenuto mark. These printed combinations use the individual duration target and retain the arc for phrasing. Explicit bare legato and non-legato touch choices apply outside slurs. Portato combines a slur with tenuto dashes and uses its own detached ratio on every member. Its touch slots are reserved for portato. |
| `slurs.placement` | `auto` (default), `above` or `below`. Auto uses above for shared RH and below for shared LH. Independent lanes alternate above and below, starting above for the main lane. This stays stable when scrolling. |
| `slurs.crossMeasure`, `slurs.crossPhrase` | Defaults true and false respectively. Cross-phrase groups require cross-measure permission and continuity after any carried tie. At most two adjacent generated chunks participate in one group. The overlay previews one core chunk on cloned state and commits the full crossing group when feasible. It verifies local membership on both sides. Keep the original `final` to continue and pass the previous phrase to `validateGeneratedPhrase(current, previous)` to compare the boundary commitment. |

The articulation draw is independent of the core RNG. Unknown options, duplicate rules, inactive voices, impossible grouping lengths given the rhythm budget, and incompatible policies raise `GeneratorConfigurationError`. Registered contact and range constraints can make a structurally valid context infeasible, reported by `GeneratorContextInfeasibleError`. `GeneratorSearchExhaustedError` still reports the independent core's bounded search budget. A failed optional preview leaves the current phrase usable and does not commit its future slurs. A subsequent request for that core phrase reports any failure normally. Lack of a sampled safe articulation opportunity can produce unmarked notes or a phrase with no slur.

### Timing and contact policy

| Field | Values, defaults and effect |
| --- | --- |
| `timing.staccatissimo` | `{ min: 0.15, target: 0.25, max: 0.35 }`. Ratios of the attack's baseline lifetime. |
| `timing.staccato` | `{ min: 0.35, target: 0.5, max: 0.65 }`. |
| `timing.portato` | `{ min: 0.55, target: 0.7, max: 0.85 }`. |
| `timing.tenuto` | `{ min: 0.9, target: 1, max: 1 }`. Protected holds accept this marking only with target 1 and an exact baseline tick range before scoring tolerance. |
| Ratio constraints | `1/240 ≤ min ≤ target ≤ max ≤ 1`. The three detached maxima stay below 1. Nominal targets increase from staccatissimo through staccato and portato to tenuto. Choose the nearest whole target tick, and round the acceptable interval inward while including the target. The detached target leaves at least one tick between its release and baseline end. |
| `timing.overlapTicks` | 1–239 integer ticks, default 24. Nominal physical overlap for an eligible legato edge at 480 ticks per quarter. |
| `timing.separationTicks` | 1–239 integer ticks, default 48. Non-legato releases this many ticks before the next attack. |
| `timing.connectedGapTicks` | 0–239 integer ticks, default 24. Maximum absolute release-to-next-attack difference before adding timing tolerance for a connected edge. It targets zero offset and does not promise literal overlap. |
| `interactions.chords` | `allow` (default) or `exclude`. A mark applies to all heads in an eligible chord. Literal overlap checks every key and finger against the simultaneous contact set. |
| `interactions.ties` | `exclude` (default) or `preserve-hold`. The latter permits emphasis, full-value tenuto or a connected slur involving an attack with uniform lifetime ends. Partial reattacks with held chord heads, unequal head releases and tie-only glyphs receive no articulation. The complete tie stays held through its intermediate glyphs. |
| `interactions.sustained` | `allow` (default) or `exclude`. Exclusion removes opportunities whose baseline span intersects another voice of the same hand. With allowance, other voices and carries still constrain literal overlap and any protected hold. |
| `interactions.continuous` | `connected` (default) or `exclude`. When allowed, thumb-under, finger-over and continuous-shift landings can use a connected edge through the transfer. The source remains held through its planned transfer. Portato and non-legato edges require a release before the next attack, so they cannot cross a continuous hand transfer. Lifted movements and required preparation rests break groups. |
| `interactions.legatoFallback` | `connected` (default) or `omit`. Controls legato opportunities with repeated pitches, reused fingers, occupied contacts, register/position restrictions or across generated phrase boundaries. Connected continuous transfers use their separate policy above. |

Literal overlap is confined to the same validated position within a chunk. The extended source uses mapped contacts. The check includes every concurrent key, finger, modeled reach and the maximum physical polyphony and inter-voice overlap caps. It reserves competing extensions in the same hand conservatively. Rested alternates, adjacent reaches, substitutions and their stabilizing holds remain subject to the core fingering plan. Substituted contacts, stabilizing holds and the source of an adjacent reach keep their baseline release. An isolated main-voice attack at the chunk boundary also retains its hold when it can serve as a programmed reach or continuous movement source. Cross-chunk legato connections use a zero-offset model so they require no physical extension across the boundary.

VexFlow engraves individual modifiers once per chord and draws a separate curve per slur. A rolling window with only part of a group gets a partial curve at the appropriate stave edge. If the window contains only tied continuation glyphs, include the original attack in `hintEvents` (or supply the full retained score as `events`) so notation can project that slur through the window. The tie engraver, accidental state, beam grouping and fingering annotations retain their own data. Very dense or high-register combinations still need player review for readability.

### MIDI evaluation

| Field | Values, defaults and effect |
| --- | --- |
| `evaluation.kind` | `disabled` by default. `evaluate` enables explicit observation-based results from `Scorer.articulationResults`. |
| `evaluation.timingWeight`, `evaluation.velocityWeight` | 0–1000, defaults 1 and 0 respectively. A zero weight disables that dimension. At least one positive weight is required, with corresponding enabled markings. `articulationMetrics` reports timing and velocity separately and a per-observation weighted accuracy. |
| `evaluation.waitMode` | `disabled` (default) or `velocity-only` with positive velocity weight. Wait and benchmark practice impose no articulation timing target. An independently enabled legacy wait-mode duration assessment still follows its own policy. |
| `evaluation.tolerance.beatFraction`, `minMs`, `maxMs` | Fraction 0–0.5 and bounds 0–250 ms, defaults 0.035, 8 and 40. Convert the beat fraction at the scorer's tempo and clamp it to the ordered millisecond bounds. Expand duration ranges and connection thresholds by this tolerance. Overlap still requires a positive difference and separation a negative one. |
| `evaluation.velocity.precedingAttacks` | Look back 1–64 score attacks in the same voice, default 8. Use the nearest earlier accepted unaccented attack of the same chord size, MIDI source/channel and uninterrupted transport epoch. Include unaccented attacks with other touch markings. |
| `evaluation.velocity.accent`, `marcato` | Inclusive `{ min, max }` ratios of current to baseline MIDI velocity, both greater than 1 and at most 4. Default accent 1.08–1.45 and marcato 1.15–1.8. Velocity for a chord is its mean across accepted heads. A baseline requiring more than MIDI velocity 127 to reach the minimum is unobserved. |

Timed duration uses each accepted attack's actual MIDI onset and physical release. Connection timing compares each source head release to the earliest accepted onset of the next complete event, including across appended chunks. Each chord must have its accepted heads within the configured capture window, from one source/channel and transport epoch. A late chord retry cannot retroactively rewrite the first accepted key edges. A repeated key needs a fresh physical off/on pair. Pedal-held sound neither substitutes for key release nor creates an attack. Pause, disconnect and finish interrupt live evidence, and comparisons across interrupted epochs are unobserved. A continuously held key can establish a late release once its threshold has passed. Undefined, unresolved or unobserved evidence contributes no accuracy denominator. Reports expose pending and unobserved counts separately. A missing pitch stays in pitch statistics.

Pitch, onset and chord accuracy keep their existing rules and metrics. On styled events with timing targets, timed articulation owns the release comparison and the duration evaluator leaves that comparison out. A legacy pedal prohibition still records pedal evidence. With articulation timing evaluation disabled, the legacy duration evaluator uses the projected release target under its existing physical/sounding and timing policy. Unstyled events keep their legacy duration expectations. The scorer's fingerprint includes the generator config and runtime clock and capture settings. Practice history fingerprints include the exact generator parameters, playback and assistance.

Velocity ratios are comparisons of observed MIDI data on a single device/channel, and logical sound release is inferred from note edges and CC64. Verify USB/BLE event order, retriggers under the sustain pedal, pedal release behavior, calibration and velocity response on physical keyboards. Player and teacher trials are required to assess phrasing, comfort and legibility at the configured tempo. The software model and simulator do not determine actual finger choice, acoustic loudness, tone quality, or expressive intention.

### Programmatic examples

`articulatedStudy(overrides?)` in [examples.ts](../src/generation/examples.ts) combines weighted touch, accents, legato, portato, cross-phrase grouping and optional evaluation. `articulatedDuet()` places slurred treble over a separately scheduled bass with carried ties and optional wide moves. Add `articulation` and `noteLifetimes: noteLifetimeDefaults` to `dynamicFingeringExample(techniques, overrides)` to study crossings with compatible contact targets.

```ts
import { generateConfigured, validateGeneratedPhrase } from "./generation";
import { articulatedStudy } from "./generation/examples";
import { Scorer, articulationMetrics } from "./scoring/engine";
import { defaults } from "./score/model";

const config = articulatedStudy();
const first = generateConfigured(config, "articulated-study");
const second = generateConfigured(config, first.seed, first.final);
const errors = validateGeneratedPhrase(second, first);
if (errors.length) throw new Error(errors.join(" "));

const scorer = new Scorer(first.events, { ...defaults, mode: "timed" }, 120, config);
scorer.appendNotes(second.events);
// Drive start/tick/input/finish with the normal transport and MIDI event bus.
const readMetrics = () => articulationMetrics(scorer.articulationResults);
```

## Generator v12 verification

### Corrections and compatibility

| Finding | Change |
| --- | --- |
| Detached articulation could release the source of an adjacent reach during its required preparation. | The articulation timeline protects the source's full contact. A supplied mark with an incompatible target fails validation. An isolated main-voice source at a phrase boundary is protected when the next chunk may use it for a reach or continuous transfer. |
| Shared coverage excluded a wide-only configuration and shared wide leaps could reject a stationary partner. | Both voice models guide legal small and wide moves. A pair can use wide leaps when either hand has a legal target. Shared carry checks use the actual cue for each proposed move. |
| Lifted movements could be considered against different subsets of the opposite hand's travel. | The planner considers known swept positions throughout preparation. The validator reconstructs all opposing windows, including later landings whose travel has already started. |
| The independent scheduler could force a small landing before checking inter-voice overlap. Silent lanes could also narrow the set of legal positions. | Restricted schedules reserve the landing first and check its overlap. Zero-activity lanes remain silent. Peak polyphony feasibility considers available finger assignments across lanes and chord shapes. A sub-eighth overlap cap cannot satisfy a structural overlap requirement. |
| Shared validation accepted authored chords and accidentals with zero occurrence probability. It could accept corrupted coverage or unrelated continuation state. | Zero occurrence is enforced on the generated score. Zero variable spacing permits natural positions only. The validator recomputes shared coverage usage and checks the complete stream state when a preceding phrase is supplied. |
| The schema tied chord voice leading to the melodic anchor cap and could assume extra partial chord attacks with zero tie probability. | The two interval caps are independently configurable. The rhythm capacity check counts tie subdivision only when ties can occur. |

Articulation uses **12.0.1**. The earlier programmatic versions use their next patch identity for corrected combinations involving shared wide-leap guidance, shared ties with both lifted movement types, or independent position and landing selection affected by these fixes. The **5.2.0** exercise and history paths retain their byte-level compatibility checks. The verification suite also checks the existing complete v9 and v10 reference streams. The v12 articulation overlay retains the independent core RNG for profiles whose core policy is unchanged.

### Automated evidence

The focused run prints timing distributions and observed parameter counts. It runs as part of the regular test suite. [Verification suite](../src/generation/verification.test.ts)

```sh
npx vitest run src/generation/verification.test.ts src/score/articulation-notation.test.tsx --configLoader native --pool threads --maxWorkers 1 --disableConsoleIntercept
```

- Four composed configurations used five seeds each for 64 consecutive phrases per seed, totaling **1,280 phrases**. They combine shared and independent voices, both meters, spacing and accidentals, chords, lifted and continuous moves, substitutions, explicit holds, ties, guided coverage and articulation. Split, adjacent and carried lifetimes pass through multiple phrase boundaries.
- The fixed fast-check seed `178290` sampled **120** configuration/seed pairs and six phrases per pair, totaling **720 phrases**. Profiles vary key, meter, hand, register, lane count, interval, chromatic probability and overlap. Separate streams covered wide-only guidance, zero-overlap small shifts, and ten simultaneous lanes split across the outer registers.
- The stream harness independently checks intended physical key intervals and articulation targets, including substitution windows, finger collisions, black-key depth, hand order, reach and lift clearance. Mutation tests reject corrupt fingers, lifetimes, cue timing, boundary state and impossible travel despite disjoint landing positions. A tempo boundary test checks insufficient preparation for a crossing.
- The notation and MIDI integration engraves the carried bass chord while the independently scheduled treble moves. It streams both chunks through the simulated MIDI bus and checks pitch, onset, releases and articulation. Legacy tests include **10,000 seeded initial phrases and 10,000 continuations**, plus **288** byte-checked legacy phrases.
- Across **2,052 streamed phrases**, the corpus returned **zero validation failures and zero externally visible search exhaustions**. This counts delivered phrases and terminal errors, while an internally rejected candidate can still be retried. Intentional negative fixtures independently exercise schema rejection, contextual infeasibility and one- and 128-attempt exhaustion. Failures in the sampled streams identify the seed, chunk and complete resolved configuration.
- Typecheck, lint and production build passed. Vitest passed **354** unit and integration tests. Playwright passed **44** browser tests across desktop and tablet viewports. The build emitted a Vite size warning for its 623 kB minified entry chunk.

### Performance and bounds

| Stream workload | Phrases | Median | P95 | Slowest |
| --- | ---: | ---: | ---: | ---: |
| Four composed profiles with rolling previews | 1,280 | 23.35 ms | 33.20 ms | 79.33 ms |
| Randomized independent profiles | 720 | 4.00 ms | 9.91 ms | 17.47 ms |
| Ten lanes with 320 events per phrase | 16 | 44.42 ms | 48.52 ms | 48.52 ms |

These local Windows and Node 24 timings measured `generateConfigured`, including core validation and any articulation lookahead. The test's second validation and contact assertions run after the timer. Reused frozen configurations share a static feasibility verdict. The bounds remain 1–128 independent planning attempts and at most one future core chunk per slur preview. These are local measurements for the tested workloads.

### Parameter effects

Thirty setting variants were each evaluated on the same 96 seeds, for 2,880 generated phrases. The table reports counts pooled across phrases. It compares realized effects for these controlled profiles. A probability governs a draw at an eligible opportunity. Movements still require a legal target and preparation, chromatic figures use a resolution slot, and chord or tie opportunities can be constrained by harmony, occupied fingers and the remaining rhythm.

| Isolated change | Realized outcomes at the tested settings |
| --- | --- |
| Melodic cap 1 → 4 steps | Jumps larger than one step **0 → 519** |
| Repetition bonus 0 → 32 | Repeats **261 → 840** |
| Eighth-note weight 1 → 12, quarter-note weight 4 | Eighth-note attacks **538 → 1,986** |
| Variable spacing probability 0 → 0.25 → 0.85 | Variable starts **0 → 28 → 85** |
| Chromatic probability 0 → 0.25 → 0.85 | Chromatic attacks **0 → 238 → 600** |
| Chord probability 0 → 0.25 → 0.85 | Chord attacks **0 → 220 → 710** |
| Small-shift probability 0 → 0.25 → 0.85 | Completed shifts **0 → 24 → 68** |
| Wide-leap probability 0 → 0.25 → 0.85 | Completed leaps **0 → 21 → 85** |
| Tie probability 0 → 0.25 → 0.85 | Subdivision tie attacks **0 → 364 → 1,309** |
| Accent rule probability 0 → 0.25 → 0.85 | Accents competing with marcato **0 → 170 → 657** |
| Overlap probability 0 → 0.25 → 0.85 | Coincident independent attacks **0 → 359 → 1,325** |

The controlled sample has 96 initial-map and scheduled relocation trials per setting and 1,536 quarter-note slots for the probability experiments with fixed rhythm. The number of locally legal candidates can vary within those slots. A larger repetition weight, longer breath or a more persistent register target can reduce some kinds of reading difficulty. Velocity, tolerance and duration evaluation controls affect scoring only. Direction, register, shape and technique selections define eligible candidates. Contextual availability and coupled weights can change realized frequencies without a monotonic change in overall difficulty.

### Ergonomic model and player review

- The model uses white-key widths, black-key offsets, finger order and conservative contact templates. It covers required simultaneous holds, selected transitions and bounded preparation. Feasible settings can still yield sparse technique opportunities. Finger size, key depth and resistance, wrist motion, fatigue and absolute lifted travel time are outside the model.
- A lifted move lands on one mapped main-voice note after hand-local or shared silence. Crossed hands, same-key overlapping owners, mid-lifetime relocations, arbitrary chord crossings and arbitrary subdivisions remain unsupported. A continuous gesture needs an isolated source and landing. A substitution permits an isolated hold or a stable dyad.
- Repeated or tightly connected notes require a physical release before the new MIDI attack. A zero-offset connection is a nominal score target with a scoring tolerance. Physical key rebound time, especially at high speed, depends on the instrument and player.
- Player and teacher review on physical pianos remains required for at least 20 short samples per movement technique, varied hand sizes and tempos, awkward chord-to-note and black-key transitions, repeated-key recovery, sustained voices, overlapping hand travel, cue lead time and readable notation. USB/BLE, pedal and velocity checks require actual devices. MIDI reports key edges and velocity. Actual fingering and comfort require observation of the pianist.

## Future capabilities

General finger and hand crossings, additional ergonomic shapes, other meters, keys and durations, and non-major harmonic vocabularies require explicit model and validator work before their schemas can be widened.

Future modules can be added as new typed fields/unions with their own defaults, resolver composition and validators. Unsupported capabilities are rejected today; no placeholder configuration fields or plugin registry claim those algorithms exist.
