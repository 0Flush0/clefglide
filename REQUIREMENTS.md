# Adaptive Piano Sight-Reading Trainer — Product & Engineering Requirements

**Project codename:** SightFlow  
**Document version:** 1.0 · **Prepared:** 2026-11-08  
**Primary platform:** Google Chrome desktop and Chrome on compatible Android tablets, with Web MIDI input  
**Status:** Implementation specification for Codex  
**Priority notation:** **P0** = essential for first usable release; **P1** = required for a complete v1; **P2** = later enhancement.

---

## 1. Vision and reason to build

Build a polished, tablet-friendly, **endless, procedurally generated piano sight-reading tutor** that connects to a real digital piano through Chrome's Web MIDI API. The intended learner can already play piano with reasonable technique but **still stops to identify notes**, even when printed fingerings are present. Existing random-note generators are unsatisfying because they often fail to establish a starting hand position, offer unexplained fingering, or leave the learner uncertain whether a phrase is physically comfortable to play.

**Central product contract:** The generator constructs *musically plausible, ergonomically constrained exercises with an explicit, coherent fingering plan*, not arbitrary notes with finger numbers pasted on afterward. At any chosen difficulty it must either produce a phrase that passes the declared constraints or admit that the configuration is infeasible and ask the user to relax a constraint. It must never silently violate the rules or fake its validation.

**Primary learning outcome:** Improve the speed and accuracy with which the learner translates **unseen standard staff notation** into keyboard movements, first with guidance and later without guidance. Repetition of a fixed piece is **not** the primary teaching mechanism.

**What success feels like:** Open the website, connect the piano, select *Right hand · Treble clef · C major · Fixed five-finger position · Wait for correct notes*, see the starting position and a few bars of notation, and play continuously. Notes and rhythms remain new; the movements are sensible; performance is captured; later exercises introduce controlled repositioning; a progress screen shows measurable, comparable improvement.

### 1.1 Design principles

1. **Playable first, musical second, random third.** Musical variety never overrides an ergonomic constraint.
2. **Read staff notation, not a falling-notes game.** The score is the main interface; no dependence on piano-roll instructions or letter names.
3. **Assistance is scaffolding.** Explain initial finger placement, introduce position changes deliberately, then reduce hints to avoid dependency.
4. **Teach separate skills.** Note recognition, interval recognition, rhythmic continuity, hand movement, and two-hand coordination must be independently adjustable and measured.
5. **Honest statistics.** Waiting for the right pitch is different from playing accurately to a metronome; never mix them into one misleading score.
6. **Reproducible and testable.** Generated exercises carry a seed, settings, fingering/movement plan, and validation results.
7. **Chrome MIDI is a first-class interaction.** Hardware failure must have a clear, useful fallback.
8. **No server needed for the first release.** The core training loop works locally in-browser; optional deployment should be trivial.

### 1.2 Non-goals

- Teaching initial piano technique or judging wrist posture, hand shape, or exact finger use through MIDI.
- Claiming one perfect fingering works for every hand size or pianist.
- Fully general algorithmic composition, flawless accompaniment, or conservatory-quality automatic fingering on arbitrary imported repertoire.
- Recording microphone audio or interpreting acoustic-piano sound.
- A conventional repertoire library as the primary experience.
- Native iPad Safari MIDI compatibility in v1.
- Accounts, payments, LLM-driven music generation, backend AI API calls, or cloud synchronization.

---

## 2. Scope and release criteria

### P0 — Usable prototype (must actually work end-to-end)

- Chrome MIDI detection, permission request, device selection, reconnect/error states; a keyboard-based simulator for testing.
- Single-hand treble **or** bass notation, fixed five-finger position, selectable starting MIDI pitch/range.
- Endless phrases generated with musical structure and **validated, explicit fingering**; starting hand + thumb/key placement shown.
- Selectable fingering visibility (all / starting + changes / on request / none), with no accidental reliance on note-name labels.
- **Wait-for-correct-pitch** mode, reliable MIDI note-on matching, current note highlighting, correct/mistake counters, replay/skip.
- **Timed mode** with count-in, tempo, note timing assessment and a clearly separate score.
- Continuous generation with 2–4 bars visible ahead, no unexplained reset of hand position at chunk boundaries.
- Save sessions and show pitch accuracy, correct notes per minute, and a time-series graph using local storage.
- Responsive interface that is practical on a tablet in landscape orientation.
- Unit, property-based, integration, and browser UI tests; clear setup and run instructions.

### P1 — Complete v1

- Both hands on grand staff, and per-hand treble/bass clef selection where valid.
- Controlled, **planned** hand-position changes and their fingering cues (initially only simple shift patterns).
- Graduated rhythm vocabulary, eighth/quarter/half/whole notes and rests; supported time signatures and key signatures.
- Difficulty controls for interval size, notes per measure, register, accidentals, allowed movements, number of shifts, coordination, and tempo.
- A configurable gradual hint-fading path and an independent benchmark mode without hints.
- Adaptive exercise selection based on performance by skill category.
- Export/import progress JSON and CSV summaries; session replay/seed reproducibility; optional MusicXML export if robust.
- Localized German and English UI.

### P2 — Later, not a reason to leave v1 incomplete

- Safe thumb-under passages, independently validated passing and crossing patterns; simple playable triads and broken chords.
- Hand-size calibration (small/medium/large) and custom ergonomic preferences.
- Adaptive phrase-level scoring calibrated with real piano teachers/players; music style presets.
- Optional offline/PWA installation and richer audio playback / metronome sounds.
- Optional server-based analysis of imported MusicXML scores, possibly using the Python `pianoplayer` project as a reference/optional engine.
- Longer musical forms, expressive markings, more sophisticated sight-reading-ahead exercises.

**Definition of delivered v1:** P0 flows are complete and demonstrably usable; P1 features can be implemented incrementally. Do **not** represent a stubbed or disabled control as fully implemented. If advanced features are left unfinished, clearly label them experimental and document exact limitations.

---

## 3. User stories & acceptance tests

| ID | Priority | User story / acceptance criterion |
|---|---|---|
| U01 | P0 | As a learner, I click **Connect MIDI**, grant access in Chrome, select my piano, and immediately see a live indication of pressed keys. |
| U02 | P0 | If MIDI is unavailable, permission is denied, or the device disconnects, I see a distinct message and can retry or use the virtual keyboard. |
| U03 | P0 | I select RH treble or LH bass, choose a note range, and the displayed notation matches the intended notes/octaves exactly. |
| U04 | P0 | Before playing, I see the hand, starting position, which key finger 1 is on, and the initial note's finger. There are no unexplained fingering numbers. |
| U05 | P0 | At *fixed-position* difficulty, **every** generated pitch has an assigned finger within the chosen five-note diatonic hand position; no hand shift, crossover, or unannounced stretch occurs. |
| U06 | P0 | I can play at my own pace; a correct key advances, a wrong key produces understandable feedback, and the session doesn't lock permanently on an error. |
| U07 | P0 | I can start timed playing with a count-in; the software compares onset times to score times and separately records pitch and timing. |
| U08 | P0 | While playing, new bars appear ahead, and my current bar remains stable and visible (no disruptive redraw/jump on every note). |
| U09 | P0 | I can hide all finger numbers, display all, show starting/position-change hints, or reveal a hint temporarily. |
| U10 | P0 | My performance is stored locally, can be reviewed, and can be compared against earlier exercises **with the same difficulty settings**. |
| U11 | P1 | I choose both hands; a conventional grand staff appears with correct synchronization and reasonable hand ranges. |
| U12 | P1 | A planned shift creates a clear advance hint, specifies which finger lands on the new note, and the generator remains valid across the shift and into the next generated bar. |
| U13 | P1 | The system isolates one weakness (e.g. descending thirds) without simultaneously raising unrelated dimensions. |
| U14 | P1 | I can train with assistance but take an **unassisted, first-attempt** benchmark to verify transfer to real sight-reading. |
| U15 | P1 | I can reproduce an exercise using its seed and settings or download my progress without signing up. |
| U16 | P0 | On a ~10–12-inch landscape Android tablet in Chrome, the score and primary controls fit comfortably, the notation is readable, and touch controls work. |

---

## 4. Training model

### 4.1 Modes (must distinguish them)

**A. Guided pitch reading — P0**
- No metronome pressure. Wait for the correct note or chord; count recognition/response latency, wrong pitches, skips, and active session time.
- No timing-accuracy percentage in this mode. The app may show *correct first-attempt pitches*, *correct notes/min while practicing*, and *median latency*.
- Wrong notes flash an unobtrusive marker; they do not silently count as correct. A configurable *wrong notes: ignore / mark and stay / optionally auto-advance* setting may be added.
- For chords, maintain a set of required pitches and advance when the target set is played within a configurable capture window; avoid double-counting repeated key presses.

**B. Continuous timed sight-reading — P0**
- Count-in and metronome; notes have intended onset times relative to the score. Continue the timeline even if the player misses a note.
- Score pitch, onsets and omissions using a defined tolerance; show timing errors separately. Do not silently snap played notes to expected pitch or beat.
- Make playback tempo adjustable. Provide optional metronome sound through Web Audio/Tone.js, but do not require speakers to use the app.
- Clarify MIDI/device and audio output latency; allow user-calibrated timing offset.

**C. Independent benchmark — P1**
- First attempt only; hints hidden; fixed public difficulty preset and tempo/rhythm profile, plus fresh seeded exercises.
- Track performance on a repeatable *difficulty family* with new content each time; optionally maintain fixed canonical benchmark seeds for additional comparisons.
- Save the exact preset fingerprint; changing the task's difficulty restarts the comparable series.

### 4.2 Learning stages

1. **Fixed hand position:** note reading only; explicit hand placement and starting finger. Melodic phrases fit without shifts.
2. **Guided position change:** include only one clearly designated small repositioning, typically following sufficient preparatory time/rest or a phrase boundary.
3. **Less assistance:** position changes persist, but numbers appear only on first note and relocation notes, with reveal-on-demand.
4. **Independent reading:** both hands, unfamiliar notation, minimal or no hints, gradually more complex motion.

**Critical anti-crutch feature:** Rotate starting positions and registers even at fixed-position levels. Do not keep mapping staff locations to the same finger on every session. A separate exercise mode may intentionally teach interval patterns; avoid indiscriminate letter-name annotations under notes.

### 4.3 Default session

- Initial preset: one hand, C major, 4/4, 60 BPM, treble clef, quarter and half notes, maximum melodic step of a third, single five-finger position, no accidentals, no shifts, 4 bars in view, *wait for correct pitch*, starting/change-only fingering hints.
- Provide presets like **Note Recognition**, **Intervals**, **Basic Rhythm**, **Hand Repositioning**, **Both Hands** as they become supported.
- Exercise length: continuous by default, or a finite 4/8/16-bar session. Allow pausing, restarting, generating a new seed, and skipping a passage.

---

## 5. Music-generation engine — central technical requirement

### 5.1 Generate from playable states, not arbitrary note sequences

Represent each hand using a `HandState`, including:
- `hand` (`left` or `right`), `clef`, hand-size/comfort profile (optional v1), `positionId`;
- map `finger -> MIDI note`, at minimum five contiguous diatonic notes at beginner level;
- `anchorPitch` / thumb placement, permitted finger/hand transitions, last finger/pitch, and whether a repositioning event is planned;
- physical limits (`minMidi`, `maxMidi`, maximum reachable simultaneous span, and allowed movement types).

Represent transitions using typed actions rather than unstructured arithmetic:
- `PLAY_WITHIN_POSITION`, `REPEAT_NOTE`, `REST`, and (P1) `REPOSITION_HAND`; later `THUMB_UNDER`, `FINGER_OVER`, `PLAY_CHORD`.
- Every note has an intended `hand`, `finger` (1–5), and corresponding pitch. A transition must be valid for the configured level and not conflict with timing/other notes.
- At a beginner fixed-position level, assign the fingers directly from position mapping: e.g., RH C4–G4 => 1–5, LH C3–G3 => 5–1. Always use **diatonic** five-note mapping; five distinct piano keys need not equal five adjacent semitones.
- A hand-position shift is an explicit event with source position, target position, landing note/finger, earliest allowed beat, and a visible change cue. It must not occur invisibly between independent generated chunks.
- State transitions across bar/phrase boundaries are preserved in the rolling stream.

**Important:** A valid plan is an *ergonomic hypothesis*, not proof of universal comfort. Avoid saying the app verified physical fingering on the player's actual hand; standard MIDI cannot observe fingers.

### 5.2 Musical plausibility rules

- Use Tonal.js for reliable spelled notes, key signatures, scale-degree and chord information; use deterministic **seeded PRNG** for variety.
- Generation is hierarchical: select key/meter, harmonic outline or scale-degree goals, phrase shape (rise/fall/arch), rhythm template, cadence/ending intention, then choose playable notes/transitions; validate, reject, or repair candidates.
- At easy levels: prefer stepwise motion, allow controlled thirds, repeated notes and gentle contours, avoid pathological oscillations and leaps, and make 2–4 bar phrases that resolve or lead naturally into the next.
- Different seeds should yield appreciably different sequences without creating unmusical independent random draws.
- Generation must honor actual note spelling (e.g., key-signature accidentals) as well as MIDI pitch; no incorrect enharmonic display.
- Do not make silence-free streams by default: rests and longer notes can be pedagogically useful, and give safe opportunities to reposition.
- Time signatures and durations must add up **exactly** in each bar. Represent time as integer ticks or rational beat values, never floating-point cumulative approximation.
- For both hands: build related parts over a shared harmonic/rhythm plan, avoid unintended hand collisions or impossible overlaps, and begin with monophonic voices in each hand and slow independent rhythms.
- Explicitly reject/repair any candidate violating the allowed pitch range, difficulty constraints, clef readability, hand movement, fingering, temporal alignment, or chord reach.

### 5.3 Fingering planning for P1 and later

- For introductory repositioning, prefer a *library of pedagogically checked transition templates* and/or a constrained state-graph search. Candidate passage generation and validation both use the same explicit movement model.
- Dynamic programming / shortest-path can minimize a cost composed of finger independence, movement size, time available for shift, weak-finger penalties, crossings, repeated-finger transitions, and awkward spans. **These costs must be exposed and tunable, not presented as objective truth.**
- A second, independent validator must re-check hard constraints after optimization: fingers 1–5, hand assignment, playable pitch set per position, allowed shifts, maximal ranges, any simultaneity rules, and a required hint whenever the plan changes.
- Do **not** import a Python fingering package directly into the browser. The open-source `pianoplayer` project is useful for research/comparison or a future optional backend, but the v1 web trainer must generate and validate locally.
- If an unfamiliar or overly complicated fingering is needed, choose a simpler candidate rather than claiming it is comfortable.
- Provide an optional **Show planned hand positions** debug view useful during manual validation.

### 5.4 Difficulty is a vector, not one scalar

Store separately, at least:

| Dimension | Examples of settings |
|---|---|
| Reading/register | clef, pitch range, ledger-line allowance |
| Pitch intervals | repeated note, step, thirds, fourths/fifths, max leap |
| Rhythm | allowed note/rest durations, syncopation, tempo |
| Tonality | key signature, accidental frequency, harmonic complexity |
| Fingering/movement | fixed position, number/size of planned shifts, crossing patterns |
| Hands | left/right/both, rhythmic independence, notes sounding simultaneously |
| Assistance | starting notes, all fingerings, transitions only, hints on request, none |
| Presentation | visible bars ahead, scrolling behavior |

Create user-facing beginner/intermediate presets **and** an expandable advanced settings panel. Each difficulty configuration yields a stable serialized `difficultyFingerprint` for fair comparisons. A shift from 0 to 1 allowed position changes is explicitly different from merely raising the BPM.

### 5.5 Endless rolling generation

- Generate in chunks, with a look-ahead buffer of at least 2–4 measures; display the forthcoming music **before** it is due.
- The generator receives the final `HandState` from the previous chunk and a deterministic random-state continuation. Do not reset fingers/positions because an internal chunk ended.
- Layout should maintain a stable viewport: keep the current bar steady, then scroll at bar/phrase boundaries without flashing or suddenly moving the active note.
- Keep enough future measures for the user to plan movement; render no more than needed for tablet performance.
- Prevent accidental duplicate passages: use seeded variety and a recent-motif cache where feasible, while recognizing that some short conventional motifs will naturally recur.
- If generation cannot satisfy restrictive parameters within a bounded retry budget, show a helpful configuration error rather than blocking the interface.

---

## 6. Score representation, engraving and fingering hints

### 6.1 Typed score model (library-agnostic)

Use an internal JSON-serializable score model independent of VexFlow:

```ts
type Hand = 'left' | 'right';
type Clef = 'treble' | 'bass';
type Movement = 'none' | 'reposition' | 'thumbUnder' | 'fingerOver';

interface NoteEvent {
  id: string;
  measureIndex: number;
  onsetTicks: number;           // exact within measure
  durationTicks: number;
  midi: number;                 // 0..127, 60 = C4
  spelledPitch: string;         // e.g. 'F#4', not derived naïvely from MIDI
  hand: Hand;
  finger: 1 | 2 | 3 | 4 | 5;
  positionId: string;
  movementBefore: Movement;
  hint?: string;
}
interface RestEvent { id: string; measureIndex: number; onsetTicks: number; durationTicks: number; hand: Hand; }
type ScoreEvent = NoteEvent | RestEvent; // Implement as discriminated union in code
interface HandPosition { id: string; hand: Hand; fingerToMidi: Record<1|2|3|4|5, number>; }
interface Exercise {
  id: string; seed: string; generatorVersion: string; difficultyFingerprint: string;
  key: string; meter: { numerator: number; denominator: number }; ticksPerQuarter: number;
  handPositions: HandPosition[]; events: ScoreEvent[];
  // include movement-plan events and generation validation metadata in final model
}
```

The above is a **conceptual starting interface**; Codex should refine the discriminated unions and extend this schema for two-hand simultaneous notes, accents, ties and generator state. Do not bind music-generation logic to SVG DOM positions or widget instances.

### 6.2 Engraving

- Render traditional five-line notation with treble or bass clef and correct time/key signatures; both hands use aligned grand staff.
- VexFlow should handle staff positioning, stems, beams, rests, accidentals, ledger lines, bar lines and SVG output. **Do not hand-draw the actual musical engraving using canvas or CSS.**
- Fingering: show (a) a concise position banner before start, (b) optional small 1–5 numbers near notes with adequate spacing, (c) clear icon/text for reposition cue, and (d) a one-tap **Reveal fingering** control.
- Finger numbers are not note labels. By default show **start/change-only**, even if the underlying plan assigns every note a finger.
- Persist unique note IDs so feedback/highlighting can update without rebuilding the entire score after every MIDI event.
- Provide responsive SVG layout and adequate touch targets; note focus/highlight must not obscure the notehead or accidental.

### 6.3 Clefs and pitch ranges

- Mode choices: RH treble; LH bass; optional RH bass or LH treble if constraints support it; both hands (grand staff).
- Real MIDI notes are pitch numbers; **C4 = MIDI 60** convention regardless of MIDI library naming configuration.
- Set and enforce min/max range per hand; allow note names in settings/diagnostics but not always under score notes.
- Avoid ledger-line-heavy reading at the easiest level unless explicitly selected.

---

## 7. MIDI and timing

### 7.1 Chrome MIDI functionality

- Use **WEBMIDI.js** as a typed adapter over the native Web MIDI API. Request access only when the user clicks **Connect**, with **SysEx disabled**.
- Require `https://` in production; `http://localhost` works for development as a secure context. Show an explicit secure-origin diagnostic otherwise.
- Detect inputs, let the user select one, show input status, note number + velocity diagnostic, and handle disconnection/reconnection cleanly.
- Subscribe to MIDI note-on/note-off, including proper handling of MIDI note-on with velocity zero as note-off if using raw messages. Unsubscribe listeners when switching devices and on component unmount.
- Ignore control-change messages for pitch matching, or explicitly handle sustain pedal (CC64) where relevant; do not treat held sustain as a newly played note.
- Allow selecting preferred MIDI channel or `all channels` when the keyboard emits unexpectedly.
- Support both USB-MIDI and other MIDI connections exposed to the browser by Chrome/OS; hardware/OTG/driver support depends on device.
- Provide **Virtual Piano / Test MIDI** mode that injects note events through the *same scoring interface* as physical MIDI, so automated tests can exercise the real logic.
- Do not promise MIDI in Safari/iPadOS. Chrome on Android is targeted only **where device, Chrome version, and hardware connectivity support Web MIDI**; publish a compatibility notice.

### 7.2 Audio/metronome

- Tone.js is a good choice for optional count-in/metronome playback. Initialize/resume browser audio in a user gesture.
- Score timing uses an appropriate monotonic clock; separate source MIDI timestamp from rendering schedule and apply user-calibrated input offset.
- The website need not synthesize piano sound: the learner hears their digital piano directly.

### 7.3 Scoring engine requirements

Implement a standalone, deterministic state machine whose input is expected note/chord events plus timestamped normalized MIDI events. It must not depend on DOM/React state timing.

- In **wait mode**, the cursor advances when the correct target pitch (or complete chord pitch set) arrives; wrong-note attempts count once per attempt; repeated notes require fresh note-on edges. Include skip/hint actions so a learner is never trapped.
- In **timed mode**, derive absolute expected onset times from exact score ticks and BPM after count-in; classify correct, wrong, missed, extra, and early/late onsets with a configurable tolerance. For simultaneous notes, match unordered pitch sets within a realistic capture window.
- Correctly handle same pitch repeated after note-off, held notes, simultaneous pitches, duplicate note-on events, and events near a bar boundary. Do not double-score a note.
- Pause/resume must preserve correct state; disconnect should pause the session with an explanation. Changing configuration must not mutate an active graded attempt.
- Store raw normalized note-on/off samples only if the user enables detailed diagnostics; store compact derived session metrics by default.
- Hardware MIDI does **not** reveal which human finger was used. Grade the pitches and timing, **never claim verified physical fingering**.

---

## 8. Progress, analytics and adaptive training

### 8.1 Definitions (avoid misleading numbers)

- **Target note events:** written pitched noteheads to be attempted (count simultaneous chord tones separately when applicable).
- **First-attempt pitch accuracy:** `correct-first-attempt target notes / attempted target notes`; report misses/skips separately; define chord matching semantics explicitly.
- **Pitch completion rate:** `correctly matched target notes / all eligible target notes`.
- **Wrong-input count:** extra/incorrect key presses, not a fraction of expected notes; show alongside correct/missed counts.
- **Correct notes/min:** `correctly matched target note events / active elapsed minutes`. In wait mode this includes thinking/hesitation time but not pauses, and **must be labelled wait-mode throughput**, not equated with metronome fluency.
- **Timing accuracy:** in timed mode only, e.g. percentage of matched onsets within a specified window and median absolute onset error (ms); keep tolerance visible.
- **Response latency:** in wait mode, optional median time from target activation to correct note-on; flag that this is not directly a visual reaction-time measurement.
- **Difficulty:** multi-dimensional config + versioned fingerprint. Never combine results from differing fingerprints in a single unqualified improvement curve.
- **Reading fluency:** display accuracy + correct notes/min + timing measures *together*; an optional composite index must be transparent and versioned, not marketed as scientific without validation.

### 8.2 Dashboard

- Session recap: duration, mode, hand(s), clef, range, tempo, hints, first-attempt accuracy, correct/missed/wrong notes, notes/min, timing error (if applicable).
- History: line charts of accuracy and throughput over date for **same difficulty/mode**, with an option to switch between skills and show a benchmark trend.
- Skill breakdown: pitch register, ascending vs descending intervals, leaps, rests/rhythm, shift-introduced passages, hand coordination. Store enough aggregates to make these meaningful; don't infer finger-specific errors from raw MIDI.
- Preset and seed replay, session exclusion/reset, and download in machine-readable JSON and CSV. Store locally with **Dexie/IndexedDB**.

### 8.3 Adaptive scheduler — P1

- First maintain a per-skill rolling estimate with a confidence/sample-count threshold; require enough data before marking a weakness.
- Example: many misses on descending thirds -> generate extra unfamiliar descending-third phrases while keeping tempo, register and movement burden consistent.
- Promote complexity only after stable accuracy/fluency at a given setting. Permit manual override; never trap learner in one category.
- Use a conservative **target success band** configurable per training mode (for example 85–95% first-attempt pitch accuracy), but do not assert this range has been scientifically validated for all learners.
- Benchmark outcomes should be reported separately from assisted practice to test **transfer** rather than dependency on finger hints.

---

## 9. Website UX and accessibility

### Layout

- Tablet-first landscape screen with a large central sheet-music card, clearly visible current-note/highlight and following 2–4 bars.
- Minimal top bar: session mode, selected exercise preset, MIDI status, pause/start.
- Collapsible side controls: hand(s), clef(s), key, meter, range, tempo, difficulty, finger hints, scrolling, metronome.
- Bottom bar: Connect MIDI, Start/Pause/Restart, Skip, Reveal Hint, Next Exercise, optional virtual keyboard toggle.
- Dashboard/tab navigation for **Practice**, **Progress**, **Settings/Help**; never bury the practice area under graphs.
- Provide light/dark theme, keyboard accessibility, focus states, UI language English/German, high-contrast labels and responsive font sizes.
- Prevent browser zoom gestures/scrolling from breaking note placement, but don't disable standard accessibility zoom.

### Onboarding

1. Show 3-step explanation: connect keyboard -> place hand -> read and play.
2. Offer **Connect MIDI** with device picker and permission help.
3. Offer immediate virtual keyboard if no hardware is available.
4. Show a worked fixed-position sample and visually identify the starting key + finger.
5. Start the guided exercise; explain timed mode and unassisted benchmarking later.

### States and errors

- Empty/no device; permission denied; unsupported browser; insecure origin; reconnecting/disconnected; invalid generator settings; generation failed; no scores yet; paused.
- Never show a blank score or a never-ending spinner if constraints conflict.

---

## 10. Recommended technical stack & what each library does

| Concern | Preferred library / stack | Outsourced work vs. custom work |
|---|---|---|
| Web app | **Vite + React + TypeScript** | Modern build, UI composition, type safety. No Next.js server required. |
| Styles / controls | **Tailwind CSS** + accessible **Radix UI / shadcn/ui** components (optional) | Polished responsive controls; custom score/practice UI remains yours. |
| Musical notation | **VexFlow 5** (verify installed public API) | Engraving, ledger lines, stems, beams, staffs, accidentals, SVG. Build an adapter from internal score model and layer finger/hint overlays. |
| Music theory | **Tonal.js** (or smaller `@tonaljs/*` modules) | Correct notes, intervals, scales, keys and chord analysis. It does **not** generate playable pieces. |
| MIDI | **WEBMIDI.js** (`webmidi`) | Typed input enumeration, note events, hotplug. Chrome/Web MIDI native support still required. |
| Metronome | **Tone.js** | Browser audio clock / optional count-in and click. Keep scoring independent of sound playback. |
| Local DB | **Dexie** + `dexie-react-hooks` | IndexedDB persistence, React reactive queries. |
| Graphs | **Recharts** | Time-series progress visualizations. |
| Validation | **Zod** | Validate settings, stored records, and import/export structures at boundaries. |
| Tests | **Vitest**, **Testing Library**, **fast-check**, **Playwright** | Unit, component, generative invariant and browser/mobile-viewport tests. |
| Auto-fingering reference | **PianoPlayer** (Python, optional future backend/reference) | Existing low-effort fingering search on MusicXML/MIDI; *not* suitable as a drop-in browser dependency. |
| Export | Optional **musicxml** serializer developed on top of internal score model | Only if deterministic and tested; do not let export block training. |

**Stack decision:** Use VexFlow directly rather than OSMD for frequently regenerated short snippets and lightweight per-note highlighting. **OSMD** is excellent for rendering existing MusicXML, but adds a MusicXML construction/parser layer and describes itself as not a real-time editor. It remains a strong future option if importing external scores becomes a priority.

**Why VexFlow 5:** The upstream project published a stable 5.0.0 release (verified in November 2026). Codex must check the exact installed package version and current API; do not copy legacy VexFlow 4 examples blindly.

**Why not a general fingering package in the critical path?** Music engraving, theory, MIDI, storage, and testing have good mature libraries. Ergonomic *pedagogical* generation is product-specific; force it into a small, testable rule/state model in v1 instead of pretending a general music-analysis dependency guarantees teachable fingering.

### Source documentation (checked 2026-11-08)

- VexFlow: https://github.com/vexflow/vexflow and https://github.com/vexflow/vexflow/releases
- Tonal.js: https://tonaljs.github.io/tonal/docs and https://github.com/tonaljs/tonal
- WEBMIDI.js: https://webmidijs.org/docs/getting-started/ and https://webmidijs.org/api/classes/Input/
- Web MIDI security/browsers: https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API
- Tone.js: https://tonejs.github.io/
- Dexie + React: https://dexie.org/docs/Tutorial/React
- OSMD tradeoffs: https://github.com/opensheetmusicdisplay/opensheetmusicdisplay
- PianoPlayer Python reference and MIT license: https://github.com/marcomusy/pianoplayer and https://github.com/marcomusy/pianoplayer/blob/master/LICENSE
- fast-check: https://fast-check.dev/docs/introduction
- Vite: https://vite.dev/guide/
- Codex project guidance: https://learn.chatgpt.com/docs/learn/best-practices

**Licensing:** At implementation time, check each installed release's license, transitive dependencies, and required notices (e.g. VexFlow MIT, Tonal MIT, WEBMIDI.js Apache-2.0, PianoPlayer MIT). Do not blindly copy third-party algorithm source without preserving license notices.

---

## 11. Software architecture

```
React Practice UI / Settings / Progress
          |
          v
PracticeSessionController (state machine)
  |       |             |
  |       |             +--> ProgressRepository (Dexie)
  |       +--> Timing & Scoring Engine <-- MidiInputAdapter / VirtualKeyboard
  |
  +--> RollingExerciseService
           |-- Preset & Difficulty Model
           |-- Seeded Musical Phrase Planner (Tonal.js)
           |-- Hand Position / Fingering Planner
           |-- Independent Hard-Constraint Validator
           +-- Score Events + Transition State
                         |
                         v
                 VexFlow Renderer
                   (staff + hints)
```

Suggested code organization:

```
src/
  app/                 routes, layout, localization, theme
  features/practice/   controller, controls, session view, state
  features/progress/   dashboard and analytics
  features/midi/       interface, WebMidi adapter, virtual adapter
  features/score/      score types, VexFlow rendering and highlighting
  features/generation/ seeded RNG, theory, hand state, templates, validator
  features/scoring/    pitch/time alignment, mode state machines
  shared/              UI, tests and schema helpers
  db/                  Dexie schema, migrations, exports
```

**Separation contracts:** Every module above must have narrow, typed interfaces. Generator, validator and scoring logic should be executable in headless tests with no browser, audio hardware, React, or canvas. No mutable global exercise state. Keep **library versions pinned in lockfile** and store a `generatorVersion` in each exercise.

---

## 12. Testing and objective acceptance gates

### Unit and invariant tests (automated)

1. **Fixed-hand invariant:** For at least **10,000 seeded generated phrases** across RH/LH, common keys, allowed ranges, meters and beginner settings, assert that the planned note/finger mapping matches the active hand position, fingers are 1–5, zero unannounced shifts occur, and all pitches are in range.
2. **Rhythmic invariant:** Every bar sums to its exact meter length; no negative/zero durations for notes/rests; no unintended overlaps per monophonic hand.
3. **Clef/pitch invariant:** MIDI 60 corresponds to C4 in notation; key spelling/accidentals are consistent; RH/LH positions are correctly mapped even when range changes.
4. **Continuity invariant:** Concatenating chunks preserves RNG sequence, hand position, meter, and first-beat timing; no unexplained jumps at boundaries.
5. **Fingering invariant:** Each movement cue corresponds to a real movement transition, and every P1 shift has a visible advance cue.
6. **Scoring tests:** Correct, wrong, repeated, held, chords, misses, pausing, disconnect/reconnect, clock offset, and simultaneous two-hand note arrivals do not double-count.
7. **Seed determinism:** Same settings + same seed + same generator version produce identical score/movement output.
8. **Settings safety:** Impossible constrained settings fail in bounded time with actionable feedback instead of hanging.
9. **Property tests:** Use fast-check to explore ranges, meters, seeds, and boundary cases; retain failing seeds as regression tests.
10. **Data tests:** Persist/reload settings, sessions and recent generator state; export and re-import valid JSON while rejecting malformed input safely.

### UI and integration tests

- With a **simulated MIDI adapter**, play an entire guided exercise; advance notes, record stats, load the progress dashboard. This test cannot be satisfied by clicking a fake ‘complete’ button.
- Verify timed mode with a deterministic clock, and test wrong/missed note classification independently of graphical rendering.
- Playwright: desktop Chrome and a representative Android tablet-sized viewport; no horizontal page overflow and readable staff, functional main controls.
- If tests cannot access real USB MIDI, document that **manual hardware verification is still required**; do not claim it was tested in CI.
- Manual QA with an actual piano: multiple RH/LH fixed positions, at least 20 short samples per new movement technique, hand-size/comfort review, and audible musical coherence review.

### Minimum deployment acceptance

- `npm install`, `npm run dev`, `npm run build`, `npm run test`, `npm run test:e2e` documented and working in a clean setup.
- No backend, account, or API key required for practice and local progress.
- Deployment guidance for a static HTTPS host (e.g., Cloudflare Pages, Netlify, or Vercel static output), including MIDI permissions caveats.
- Clear README with supported browsers, Chrome permission steps, MIDI hardware setup, no-Safari caveat, and known limitations.
- No placeholder/fake MIDI statistics, inaccessible buttons, broken downloads, or claims of detecting human finger movements.

---

## 13. Implementation order and decision points

1. Scaffold React/TS/Vite, visual layout, basic score model, VexFlow rendering of a hard-coded 4-bar phrase with visible fingers.
2. Integrate WEBMIDI.js and a shared virtual MIDI adapter; reliable note-on/off state machine.
3. Build fixed-position generator from `HandState` + Tonal.js and exact-rhythm templates; hard validator + 10k-seed tests.
4. Connect generator -> score -> MIDI scorer -> immediate feedback -> rolling 2–4 bar buffer.
5. Implement wait/timed modes, pause/count-in/metronome, session stats, persistence and dashboard.
6. Add both hands with independent fixed positions and a shared musical plan.
7. Add **one** explicitly modeled small-shift technique and its hint; then only add more movement types as tests and player QA pass.
8. Add adaptability, independent benchmark, localization, export/import and deployment polish.

**Trade-off if schedule is constrained:** Prioritize one-hand **correctness, continuous notation, MIDI accuracy, and genuine fingering validity** over superficially checking every feature box. Do not make up “validated fingering” if only generic note generation was implemented.

---

## 14. Risks, limitations, and unresolved items

- **Fingering quality:** Hard rules can prove consistency with a chosen ergonomic model, not real-world comfort for all players. Include player testing, configurable hand size later, and visible confidence/limitations.
- **Skill transfer:** Assisted scores can improve performance without improving unassisted sight-reading. Separate independent benchmarks and keep new music unseen on the first attempt.
- **MIDI realism:** Hardware sends pitch/velocity/timing, not actual finger identity. USB device compatibility varies; Safari is not a Chrome equivalent.
- **Rhythmic scoring:** Input latency, expressive timing and simultaneous note grouping require configurable tolerances and careful validation.
- **Two-hand scores:** Harmonic coherence and finger choices become more complex; start with easy constrained voices and explicit synchronized timeline.
- **Terminology:** English UI should use *bar/measure*, *fingering*, *treble clef*, *bass clef*; German equivalents *Takt*, *Fingersatz*, *Violinschlüssel*, *Bassschlüssel*.

**Open decisions, with recommended defaults:**
- Android vs desktop Chrome: support both where Web MIDI is available; validate physical hardware separately.
- “Wait for note” versus timed: include both; default to wait mode for the stated learner.
- Default finger hints: initial position and changes only; offer every-note/none/on-demand.
- Data privacy: all local initially, no analytics tracking, export on demand.
- Default engine: rules and constraint validation, **not** AI-generated MIDI sequences.

---

## 15. Compact definition of done

A successful build lets a learner with a connected MIDI piano:

1. Open a static HTTPS page in supported Chrome, connect the piano, verify the input is working.
2. Choose right/left hand, treble/bass clef, range, fixed hand position, tempo and fingering assistance.
3. Read genuinely unfamiliar engraved measures with a clear initial finger placement and **no accidental awkward moves** under fixed-position rules.
4. Play continuously and receive correct pitch feedback and, when timed, genuine timing feedback.
5. See a second phrase **before** finishing the first, with finger-position continuity across the boundary.
6. Return later and review accurate metrics segmented by mode and difficulty.
7. Switch to fewer hints and run an independent reading benchmark.
8. Trust that the website never silently labels an exercise “validated” when its own constraints were violated.

**Bottom line:** A believable, tested five-finger trainer is more valuable than a feature-rich but physically nonsensical generator. Preserve this principle in every implementation decision.
