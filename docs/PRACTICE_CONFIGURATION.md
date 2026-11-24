# Practice configuration

Guided and Advanced use the same validated `GeneratorConfig` API, four-bar streams, score renderer and scorer. The current exercise stays on screen while edits are staged. **Apply & generate** or **New exercise** starts a stream with the staged setup. Fingering visibility still takes effect immediately and is reflected in the assistance comparison series. Tempo, MIDI, session duration, and wait, timed and benchmark scoring use the existing practice controls.

## Guided curriculum

The [Guided curriculum guide](GUIDED_CURRICULUM.md) describes all three tracks, versioned selection migration, stage goals, measured progression and representative scores. Choose a stage and level to stage its recommended range and tempo.

## Advanced controls

Select **Edit music settings** in the practice sidebar to open the full-width panel below the score, statistics and virtual piano. Each section can be collapsed. **Apply changes** stays visible while you scroll the panel and starts a new exercise with the staged setup.

Chance sliders show the probability at an eligible opportunity and accept an exact percentage. Relative-weight bars compare preferences within a list. For example, a quarter-note weight of 2 has twice the selection weight of a half-note weight of 1 when both fit. Silence, legal landings and available fingers still determine which choices are eligible.

| Section | Controls | Generator fields |
| --- | --- | --- |
| Shared music and coordination | Key, meter, shared or independent rhythm, overlap probability and duration between hands | `notation.key`, `notation.beats`, `notation.voices`, `independentVoices.overlapProbability`, `independentVoices.maxOverlapTicks` |
| Melody | Named melodic interval limit, stepwise and repetition weights, chord-tone endings | `melody.maxIntervalSteps`, `stepBonus`, `repetitionBonus`, `preferHarmonicEnding` |
| Rhythm and rests | Weighted eighth, quarter, half and whole notes, rest bars and length | `rhythm.durations`, `breathBars`, `breathBeats` |
| Hand movement and register | Small shifts and wide leaps, their chances, interval limits, landing bars and preparation. Wide leaps also have direction and landing-finger controls. Underused register exploration. | `movement`, `wideLeaps`, `coverage.kind` |
| Finger spacing | Weighted position patterns, variable-spacing chance, permission for tagged rested alternate plans | `fingering.patterns`, `variablePositionProbability`, `allowRestedAlternates` |
| Fingering techniques | Enable thumb-under, finger-over, continuous shifts, reaches, rested alternates or substitution and set their probabilities | `dynamicFingering.techniques`, using the shared `tempoBpm` |
| Accidentals | Neighbor and passing probabilities, permitted fingers, and preferences for resolution, dominant tones and mapped fingers | `chromatic`, `fingering.chromaticFingers` |
| Chords and voicing | Weighted finger shapes of two to four heads, permitted dyad intervals, span, voice-leading cap and diatonic extensions | `chords.shapes`, `probability`, `dyadIntervals`, `maxSpanSemitones`, `maxVoiceLeadingSteps`, `majorExtension`, `minorExtension` |
| Voices and polyphony | Voice count, per-voice duration weights, activity, entry/exit, offbeat and coincidence weights, fingers, chord and accidental permissions, peak keys and local overlap limits | `independentVoices.left` / `.right` |
| Note holds and duration | Shared physical holds and duration assessment | `noteLifetimes` |
| Ties | Tie probability, voices, duration cap and chord-tone policy | `notation.ties` or scoped `ties` |
| Articulation | Touch and emphasis vocabularies, probabilities, slurs, eligible voices and evaluation | `articulation` |
| Keyboard and clef | Note-name range picker and clef selector | `hands.left` / `.right` |
| Expert settings | Optional JSON editor for the full model, including technical weights, tie and sequencing rules, finger pairs, articulation tolerances, search attempts and harmony progressions | Full `GeneratorConfig` |

Custom profiles store named configurations in IndexedDB. They support loading, replacement, removal, versioned JSON export, and import of an exported profile or raw config. A full Advanced reset restores the generator defaults. Profiles carry the planning tempo when dynamic fingering requires it. The playback and MIDI controls remain part of the practice setup. The JSON editor shows the current staged configuration and **Use parameters** validates and stages an edit. If settings change while you have a JSON draft, you can keep your draft or reload the latest staged settings. Progress backups and profile transfers have separate formats.

### Hand and shared settings

Enable independent rhythm to edit left and right separately. This uses the existing independent scheduler, whose occupancy rules require physical key holds. Both hands share meter, key, the harmonic plan, playback tempo, the physical lifetime contract, duration assessment policy and cross-hand coordination. The independent voice groups can override within-hand overlap separately. They inherit the coordination limits until a local override is set. Ranges and clefs have always been per hand. Shared rhythm, which uses one timeline, retains the common-policy editor.

Version 13 configurations use optional `handParameters.left` and `handParameters.right` module overrides. Omitted modules inherit the corresponding top-level settings. Scoped ties, articulation and dynamic fingering accept `false` to turn off an inherited policy. A scoped tie or articulation voice ID belongs to that hand. Explicit voice settings can be retained while a hand is inactive. Linked edits update compatible fields on both sides. Copying replaces the destination’s effective music modules and voice group after confirmation. Voice IDs move to the destination hand, which keeps its range and clef.

The planner retains a joint view of simultaneous keys, hand order, movement windows and overlapping lifetimes. The validator checks each hand against its effective modules and independently reconstructs the joint score. For separated ranges and permissive coordination, the same seed produces the same partner line when the other hand's rhythm and melodic cap change. Coincidence preferences, overlap bounds, contact, movement and retries can couple the outcomes. Switching settings starts a new stream with a new fingerprint. Existing configurations retain their original version and deterministic replay, including the 5.2 historical path. Legacy Guided setups remain available with saved settings until a curriculum level is selected.

### Validity and feedback

- **Invalid configuration** means the schema rejected input with a field path and reason. For example, the minimum leap cannot exceed the maximum.
- **Unsupported combination** means the current model cannot represent the request. Per-hand module overrides, for example, require independent rhythm.
- **Contextually infeasible** means the request is structurally valid but fails range, voice, preparation or contact checks. Expand or separate ranges, select compatible fingers, or adjust the relevant movement setting.
- **Search exhaustion** means bounded generation attempts failed to find a valid score for the supplied seed and constraints. The generator reports the last rejection. An active exercise survives a failed Apply.

A setting can have no effect when its module or voice is disabled, a per-voice rhythm overrides the hand rhythm, a chance is zero, or a score offers no eligible opportunity. Controls show dependencies and the feasibility check reports selected settings with no available positions or shapes. The ergonomic bounds apply to all modes.

## Verification and remaining review

The [Guided audit and score examples](GUIDED_CURRICULUM.md#what-the-calibration-measured) describe the measured curriculum and the review still needed on physical pianos. The [hand-parameter suite](../src/generation/handParameters.test.ts) separately checks the independent generator policies for Advanced practice.
