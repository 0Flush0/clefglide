# ClefGlide

**Read ahead. Play naturally.**

An endless, local-first piano sight-reading trainer. Real VexFlow notation, playable five-finger plans, Chrome MIDI and a virtual piano. No account or backend.

Available at [piano.rit.cl](https://piano.rit.cl). ClefGlide was previously called SightFlow. Existing practice history, settings and JSON backups remain compatible; no data migration or reset is needed. New downloads use `clefglide-progress.json` and `clefglide-progress.csv`, while the JSON format remains `sightflow-1`.

## Run

Install Node 24 LTS (22.12+ also supported), then:

```sh
npm ci
npm run dev
```

Open the printed localhost URL. Choose difficulty, a note-name keyboard range, hand/clef and assistance. Press **Start practice**, then play the highlighted note. Expand **Virtual piano** to use touch keys without hardware; computer keys `A W S E D F T G Y H U J K O L P ;` use the same scorer. Virtual input is clearly labeled and does not synthesize audio.

Practice and session IDs also work on HTTP LAN addresses such as `http://192.168.188.24:5173`, without `crypto.randomUUID` or `crypto.getRandomValues`. Hardware MIDI still requires HTTPS or localhost; on an insecure LAN page the app explains this and keeps the virtual piano available.

Exercise settings are staged until **Apply & generate**, **New exercise**, or **Apply & play**. One action applies the settings and generates fresh music; Apply & play also starts it. Assistance changes immediately without replacing the exercise or resetting grading. Technical settings and seed replay controls stay under **Advanced settings**. Use **Restart** to reproduce a seed and **Save & finish** for analytics. A pause saves too. Progress defaults to the exact difficulty and assistance fingerprint.

**Exercise difficulty** has five independent four-button rows. **Note jumps** (Small/Easy/Medium/Large) limits consecutive melodic intervals to a second/third/fifth/octave. **Hand movements** (Off/Easy/Medium/Hard) controls explicit rested relocations; Off keeps one position throughout the stream. **Finger spacing** chooses conventional positions or approved gaps near the thumb/index, mirrored for the left hand. **Accidentals** adds chromatic neighbors, passing notes and dominant colors; Off still includes the selected key's signature accidentals. **Chords** adds approved dyads, major/minor triads and inversions, then selected four-note voicings. Hard always retains ergonomic validation. These controls preserve the other selected dimensions and keyboard ranges. Advanced numerical limits can lower the selected level's caps. Restricted ranges/spacing may prevent advanced shapes; the generator uses a simpler validated event.

Spacing selection is sampled at exercise initialization (30%/60%/85% for Easy/Medium/Hard when compatible positions exist). Off uses consecutive scale notes only. Approved patterns span at most ten semitones, with no extra gaps between fingers 3–5. Narrow ranges fall back to conventional spacing with an explanation; no feasible five-note position produces an actionable error. Relocations without a legal landing remain in place. Small jumps may stay inside one connected portion of a spaced map. Read the exact constraints in `docs/DECISIONS.md`.

Assistance is **All / Smart / None**. Smart is the default: numbers beside the score's notes establish each hand's first finger, then only necessary spacing exceptions and planned landing fingers. For RH C4–E4–F4–G4–A4 mapped to fingers 1–5, Smart shows **1 on C4 and 2 on E4**, with no redundant 3/4/5. Its explicit inference convention assumes adjacent scale notes from an established finger until a new annotated offset; it remembers established positions separately for both hands across scrolling and generation boundaries. Advance movement cues appear on preparation rests. **Reveal hint** temporarily shows full passage fingering and the next planned move. None hides automatic guidance; using Reveal marks it assisted. Switching to None after seeing hints cannot erase assistance already used—generate a fresh None exercise for independent practice. Benchmarks forbid reveal.

## MIDI

Chrome on HTTPS or localhost is required. Connect a USB MIDI piano, click **Connect MIDI**, grant permission and select the device. SysEx is disabled. Select all channels unless you need filtering. Input diagnostics show actual pitch, velocity and source. A disconnect pauses practice; reconnect and resume manually.

If there are no inputs, check the data cable, OS device detection, piano USB MIDI mode, Chrome permissions, other MIDI applications, and USB power. Android additionally requires compatible hardware/Chrome and OTG. Safari/iPadOS MIDI is not supported. No automated test establishes physical device compatibility.

## Checks

```sh
npm run typecheck
npm run lint
npm run test
npx playwright install chromium
npm run test:e2e
npm run build
```

Vitest includes the existing 10,000-seed invariant/continuation suite plus 600 seeded combinations of all five difficulty dimensions, pure chord scoring traces, actual VexFlow glyph/notehead tests, a complete both-hand chromatic-chord practice flow and IndexedDB roundtrips. Playwright includes desktop and 1024×768 tablet scenarios for complete phrases, streaming, hints, ranges, grand staff and chromatic chords. See `docs/QA_CHECKLIST.md` for physical QA and actual run evidence.

## Architecture and scope

- `src/generation/planner.ts`, `positions.ts`: Tonal major-scale positions, seeded motifs/harmonic contour, explicit movement plans and continuing hand/RNG state.
- `src/generation/validator.ts`: independent hard-rule checks; infeasible settings produce actionable errors.
- `src/score/model.ts`, `Notation.tsx`: integer ticks, spelled pitches, plan and VexFlow 5 SVG.
- `src/midi/adapter.ts`: user-gesture WEBMIDI.js connection, hotplug and simulator bus.
- `src/scoring/engine.ts`: pitch edges, simultaneous targets, wait/timed state, pause and statistics.
- `src/progress/store.ts`: Dexie, Zod, JSON import/export and CSV; Recharts shows only recorded sessions.
- `src/practice/App.tsx`: practice controller, rolling look-ahead, controls and help.

Both hands can play synchronized chords, with one rhythmic event per hand at each onset. Only rested lift-and-reposition shifts and the declared spacing/chord libraries are supported; no arbitrary stretches, crossings or adaptation. Keys C/G/F/D and meters 3/4, 4/4. Double accidentals, generated ties, independent hand rhythms, full German translation, adaptive scheduling, MusicXML, PWA and hand-size calibration remain outside the current scope. Fingering is a suggestion consistent with the independently validated model, not proof of comfort for every pianist; MIDI cannot observe fingers. Legacy v1/v2/v3 history retains its original settings and fingerprints, stays separate from v4 comparisons, and cannot be falsely replayed with the new generator. Active preferences default Accidentals and Chords to Off.

Chord attacks must fit within 120 ms (an internal configurable capture window). Missing or extra pitches prevent first-attempt chord success; slow arpeggiation can be retried but earns no simultaneous first-attempt credit. Every notehead retains separate pitch credit. Release before repeated notes; pedal-held sound never supplies a fresh attack, while a released/restruck key remains playable with sustain down. Chord-event accuracy is stored and displayed separately from note accuracy. Smart minimizes finger annotations per notehead, while All shows every planned finger.

Timed mode: one-bar count-in, ±450 ms pitch-match window, separately configurable timing tolerance and input offset. Guided mode has no timing accuracy. First-attempt accuracy counts eligible targets including omissions/skips; correct notes/min uses active elapsed time. Clearing browser data removes history; export JSON backups.

## Deploy

The production URL remains `https://piano.rit.cl`. The rebrand preserves the existing GitHub deployment workflow, GHCR image naming, Docker services and server paths. Internal `sightflow` names (including the IndexedDB database, `sightflow-language` preference key and package name) intentionally remain unchanged for compatibility.

`npm run build` produces `dist/`. Serve it from any static HTTPS host (Cloudflare Pages, Netlify, etc.). No secrets, API keys or runtime server needed. Use a top-level page; embedded hosts must allow MIDI in their permissions policy. No runtime network calls are used to generate music.

Third-party libraries keep their licenses in `node_modules`; VexFlow/Tonal/React/Dexie are MIT, WEBMIDI.js is Apache-2.0. No PianoPlayer source is imported. Lockfile pins the dependency graph.

Builds include `THIRD_PARTY_LICENSES.md`; bundled font licenses are retained under `public/licenses/` and copied to `dist/licenses/`.

In this restricted Windows workspace, a local toolchain is available without system installation:

```powershell
$env:PATH = "$PWD\.tools;$env:PATH"
.tools\node.exe .tools\package\bin\npm-cli.js run dev
```

Typecheck, lint, production build, all 96 unit/integration tests and all 18 desktop/tablet Playwright tests pass for the ClefGlide rebrand. Browser tests required approved execution outside the Windows sandbox to start workers. See `docs/QA_CHECKLIST.md` for evidence and the remaining physical MIDI, real-device and production checks.
