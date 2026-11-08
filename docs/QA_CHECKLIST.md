# ClefGlide QA

## Current evidence: ClefGlide rebrand

Verified on 2026-11-09 with the documented local Node 24.12.0 toolchain:

- `npm run typecheck`, `npm run lint`, and `npm run build`: PASS. Generated `dist/index.html` contains the ClefGlide title, new tagline, description, Open Graph/Twitter metadata and canonical URL `https://piano.rit.cl`; `dist/favicon.svg` contains the new musical icon. The theme color and existing score-first UI are preserved. There is no PWA manifest or structured data to migrate.
- `npm run test`: **PASS, 96 tests in 16 files**, including all generator/scoring/MIDI and historical import tests. A new regression closes/reopens the existing `sightflow` database, restores saved tempo/assistance in the real React UI, displays the saved session and checks that preferences, seed, results and fingerprint remain identical. A language test restores the original `sightflow-language` key.
- `npm run test:e2e`: **PASS, 18 tests** across desktop 1440×1000 and tablet 1024×768. New English/German scenarios check the wordmark, accessible home label, tagline, all three tabs for outdated branding, metadata, favicon, JSON/CSV filenames and page overflow. Screenshots are saved under ignored `test-results/` for light practice layouts and desktop dark mode. The existing responsive layout hides theme controls on tablet.
- The sandbox initially rejected Playwright worker creation (`spawn EPERM`); approved execution outside the sandbox ran the browser suite successfully. Earlier environment-blocked reports below are historical.
- Case-insensitive branding audit: remaining old-name occurrences are the intentional database/language/export/package identifiers, unchanged deployment workflow names/environment variable/server path, historical rename notes, and regression fixtures/assertions. No outdated visible branding remains in application strings or translations. The export schema stays `sightflow-1`; new download filenames use `clefglide-progress`.
- Git diff confirms `.github/workflows/deploy.yml`, Dockerfile, deployment configuration, package/lockfile, database schema, language key, generator, scoring and score model are unchanged. The workflow's local typecheck/lint/test/build gates pass. No live deployment, registry push, SSH/server validation or hardware MIDI verification was performed.

Remaining manual checks: after deployment through the existing workflow, open `https://piano.rit.cl` in a returning browser profile and confirm the new title/favicon, existing settings/history and an old JSON backup import. Verify physical USB MIDI and an actual Android tablet separately from simulator/browser viewport tests. The existing physical/teacher checklists below still apply.

## Previous evidence: generator v4 chromatic notes and chords

Verified on 2026-11-08 with the documented local Node 24.12.0 toolchain:

- `npm run typecheck`, `npm run lint`, and `npm run build`: PASS. Production output remains static/local-first, with no new dependencies.
- `npm run test`: **PASS, 89 tests in 15 files**, final full run 73.76 seconds.
- Unit/integration coverage includes the retained 10,000-seed phrase/continuation suite plus 600 deterministic combinations of all five difficulty dimensions, keys and hands. Tests check spelled MIDI pitches, actual generated chromatic notes and 2/3/4-note voicings, major/minor triads and inversions, independent ergonomic rejection, pending chromatic resolutions, continuous state and Smart Hint memory.
- Actual VexFlow SVG tests check three noteheads in one event, every planned finger, Smart minimization and Reveal. The rendered SMuFL sharp/flat/natural glyphs are checked for cancellation, repeated-note suppression and barline resets. Key signatures and tied-continuation accidental state are tested separately; generated ties remain outside the current rhythm vocabulary.
- Pure MIDI traces cover unordered chord onsets, the exact configurable 120 ms boundary, slow arpeggiation/retries, missing/extra pitches (including an extra immediately after completion), held/repeated keys, pause/skip, CC64 sustain, latency offset and both-hand chords. Finger changes do not affect MIDI results. A real React practice flow plays four bars of both-hand chromatic chords through the shared simulator and persists 100% note/chord accuracy from those actual inputs. This is simulator evidence, not physical MIDI verification.
- Progress tests roundtrip per-notehead/chord outcomes through IndexedDB/JSON/CSV, retain v1/v2/v3 fingerprints and keep new difficulty settings separate. UI tests verify five compact four-button groups and that changing Accidentals/Chords preserves the other settings/ranges.
- Preview HTTP check: **200** at `http://127.0.0.1:5174/`. `npm run test:e2e` discovers **10** desktop/tablet cases but cannot start workers (`spawn EPERM`, `WorkerHost.startRunner`). A direct in-process Playwright launch of installed Edge also fails with `spawn EPERM`. No actual browser screenshot, pixel-level overlap check or responsive browser pass is claimed. Existing port 5173 was preserved; the owned temporary 5174 preview is stopped after verification.

V4 manual checks still required:

- [ ] Physical USB MIDI: play all chord tones together, deliberately omit/add tones, roll beyond 120 ms, repeat common/held tones and retry. Confirm one outcome per notehead, complete-chord advancement and separate chord/note accuracy.
- [ ] Sustain: depress/release CC64 around chord boundaries, repeat physically released keys with pedal down, hold keys through pedal release and test both hands/channels. Pedal sound must never supply a fresh attack. Confirm input timestamps/latency against the actual piano.
- [ ] Player/teacher review with both hands and varied hand sizes: chromatic finger-2/3/4 alternatives, black/white geometry, all approved dyads/triads/inversions, four-note sixth/minor-seventh shapes, consecutive shapes and rested relocations. Algorithmic limits establish model consistency, not comfortable human fingering.
- [ ] Musical review: neighbor/passing-tone resolutions, dominant-color alterations, I/IV/V, ii and vi progression coherence, voice leading and whether each level has useful density under realistic ranges. Four-note shapes may be unavailable in narrow/fixed-natural positions.
- [ ] Desktop/Android Chrome: inspect sharp/flat/natural signs and numbers beside every relevant chord notehead, including bass/grand staff and extreme registers. Verify All/Smart/None, Reveal, fonts, light/dark, zoom, scrolling, settings height and touch targets without clipping or overlapping.
- [ ] Long hardware sessions: retain positions, resolutions, movement cues and hint memory through several evicted chunks; pause/disconnect/reconnect; export/reload outcomes and verify historical separation.

## Previous evidence: generator v3

Verified on 2026-11-08, Windows, Node 24.12.0, using the documented local toolchain:

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS; static `dist/` output.
- `npm run test`: **PASS, 65 tests in 11 files**, final run 51.86 seconds. Includes 10,000 deterministic phrases and 10,000 continuation boundaries across independently sampled jump/movement/spacing levels, hands, keys, meters, rhythms, ranges and numerical overrides. Phrases and their seed replays pass the independent position/movement validator; hint decisions and final memory match across concatenation and chunk splits.
- Targeted coverage: independent four-button groups; ranges preserved; conventional maps with spacing Off; unchanged maps across continuous Off-movement practice; actual generation and validation of C4/E4/F4/G4/A4; mirrored LH thumb-gap maps; index/two-gap patterns; only required Smart finger cues (1/2, 1/3, or 1/2/3 in finger order); returning to familiar positions; landing cues/read-ahead; range and declared ergonomic caps; unsupported/corrupted maps rejected. Distribution tests observe progressively more actual spacing and leaps, and retained movement-frequency tests observe more actual relocations.
- Actual VexFlow SVG checks show 1 on C4 and 2 on E4, no redundant 3/4/5, and no reintroduced cues after scrolling. Live practice UI switches All/Smart/None and Reveal after playing a note, retaining target/note IDs, running status, and accumulated results. Existing simulated MIDI, scoring, virtual piano, HTTP LAN and IndexedDB flows pass. V1/v2 imports roundtrip their original fingerprints; v3 dimensions/assistance remain distinct.
- `npm run test:e2e`: **ENVIRONMENT BLOCKED**, including a final rerun. Playwright discovers eight desktop/tablet cases, then Windows rejects worker creation with `spawn EPERM` in `WorkerHost.startRunner`. None of those browser cases executed successfully. No browser, pixel-level layout, real Android tablet, or physical MIDI verification is claimed.
- No new dependencies. Automated invariants establish consistency with the declared spacing limits, **not comfort for every pianist or teaching effectiveness**.

Additional manual v3 checks outstanding:

- [ ] On desktop Chrome and actual Android Chrome tablets, inspect the three four-button groups, touch targets, internal settings scroll, collapsed note-name ranges/Advanced settings, score readability and page overflow.
- [ ] Play at least 20 samples per hand for each new spacing shape in multiple keys/registers. Review thumb/index gaps, total spans and combinations with rested relocations with pianists/teachers of varied hand sizes.
- [ ] Read ahead in Smart mode, including first exceptions that occur in later bars, reordered finger visits, repeated positions and long streams with buffer eviction. Confirm all necessary numbers remain beside their notes and routine fingers stay unmarked.
- [ ] Repeat the existing physical MIDI/disconnect/timed-mode checklist below; simulator evidence is separate from hardware evidence.

## Earlier evidence (v2)

Verified on 2026-11-08, Windows, Node 24.12.0:

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS, static `dist/` output; notation/font/chart chunks split without size warnings.
- `npm run test`: **PASS, 52 tests in 10 files** after the Smart hints/UI refinement. The property suite retains 10,000 deterministic exercises across presets, ranges/registers, keys, meters, rhythms, both hands and movement limits, plus continuation boundaries and exact seed replays. Native-canvas/VexFlow checks exercise actual SVG finger modifiers and movement annotations. Pure scoring and simulated practice tests remain passing.
- `npm audit`: zero reported vulnerabilities after updating dependencies and overriding minimatch to patched 11.0.1.
- Dev server started and returned HTTP 200 at localhost:5173.
- HTTP LAN regression coverage remains passing: tests remove the entire crypto object or both crypto methods, exercise initialization/New Exercise/Restart/simulated play/local save, and verify HTTPS-required MIDI feedback without permission requests. ID tests cover unavailable/throwing crypto methods and 10,000 distinct IDs under a fixed clock/random source. These are simulated capability tests, not a verified browser visit to the physical LAN address.
- V2 integration: applying Hard preserves a selected range; playing through a four-bar exercise with real planned shifts streams onward and saves accurate outcomes with an assisted fingerprint after reveal. Preset frequency tests measure progressively more **actual** shifts over 300 seeds per level. Corruption tests reject absent/late cues, wrong fingers/distances, missing preparation, and unannounced final positions. SVG tests verify cue annotations against movement-plan data and removal/restoration for hidden/revealed hints. Legacy backup roundtrips preserve old fingerprints and remain distinct from v2.
- `npm run typecheck`, `npm run lint`, `npm run test` and `npm run build` were rerun for v2 and all passed. No new dependencies were needed.
- Smart/UI refinement checks: automatic initial fingers per hand; no redundant natural-mapping numbers; a validated C4/1 → rest → E4/2 action displays 2 on the exact E4 SVG group; movement landings match their plan and preparation-rest annotations. All/Smart/None and manual reveal preserve note IDs, generated pitches, cursor and scoring. UI tests cover note-name selectors, disabled invalid boundaries, one-position explanation, Apply & play, Pause while editing, and fresh independent sessions becoming assisted only after reveal.
- The preview was served successfully at `http://127.0.0.1:5174/` (HTTP 200; 5173 was already occupied). This verifies serving, not browser rendering. The existing port-5173 server was not stopped.
- `npm run test:e2e`: **ENVIRONMENT BLOCKED**, not passed, including the rerun for the UI refinement. Playwright detects six desktop/tablet tests but Windows rejects worker creation with `spawn EPERM` in `WorkerHost.startRunner`. Browser installation is also blocked by `spawn EPERM`; a workspace browser path avoids the separate read-only user-profile restriction but not process spawning. Test scenarios were updated for note selectors, immediate assistance changes and the expandable virtual piano.
- Installed Edge headless fallback also exits with `Access denied (0x5)` / `FATAL mojo platform_channel.cc`. Supplemental `scripts/browser-qa.mjs` cannot connect because the browser never opens its CDP endpoint. No browser screenshot, responsive visual QA or real-device verification is claimed.

Reproduce browser tests on an unrestricted machine: `npm ci`, `npx playwright install chromium`, `npm run test:e2e`. Tests cover desktop 1440×1000 and tablet 1024×768, SVG rendering, hidden hints/range/clef, four-bar virtual playing with continuation and persisted metrics, two-hand targets, and page overflow.

The sandbox lacked Node/npm on PATH. The installed Visual Studio Node runtime was copied to ignored `.tools/node.exe`; npm was downloaded locally. Dependency installation used `--ignore-scripts` because lifecycle spawning was denied. Vite's optional Windows `net use` probe is handled by `scripts/tooling.mjs` when that probe raises EPERM. Builds and Vitest run normally through the supplied scripts without bypassing blocked child processes.

Simulator and mocked adapter results never establish physical MIDI compatibility.

## Acceptance mapping

| Scenario | Evidence / remaining check |
|---|---|
| 1 | Complete four-bar simulated UI test saves real correct outcomes; continuing bars generated. |
| 2–3 | 10k seeded invariant/continuation suite; explicit placement and pitch/finger map checks. |
| 4 | Register/C4/clef unit tests and desktop/tablet browser range/clef scenario pass. |
| 5 | Adapter user-gesture path implemented, SysEx=false verified with mocked API; physical QA outstanding. |
| 6 | Pure trace tests demonstrate guided/timed differences, misses, early/late recovery and offsets. |
| 7 | Event-derived metrics, validated persistence and fingerprint-filtered charts; simulated UI save test passes. |
| 8 | Actual VexFlow SVG modifier removal test passes. |
| 9 | Grand-staff implementation, simultaneous pitch-set scorer tests and desktop/tablet browser scenarios pass; physical review remains outstanding. |
| 10 | Planned lift-and-reposition shifts implemented and validated independently; advance rest annotations, landing fingers, cue correspondence and continuation tested. Human comfort remains unverified. |
| 11 | Desktop/tablet viewport scenarios pass; actual Android device review remains outstanding. |
| 12 | Build/unit checks and all 18 Playwright tests pass for the rebrand. |

## Physical piano (outstanding)

- [ ] Desktop Chrome, localhost and HTTPS: user gesture permission; grant, deny, retry; verify no SysEx request.
- [ ] Choose input/channel; check pitch and velocity; switch devices; unplug while playing, reconnect and resume.
- [ ] Play repeated notes with releases, wrong notes, held notes, sustain and simultaneous two-hand targets; no doubles.
- [ ] RH C4–G4, LH C3–G3; verify MIDI 60 = written C4; other keys, clefs and registers.
- [ ] Play at least 20 four-bar phrases per hand; assess musical coherence and comfort with a piano teacher/player.
- [ ] Timed mode count-in, pauses, omissions and latency offset; compare a physical reference metronome.
- [ ] Chrome Android landscape tablet with actual OTG/data cable and power; touch controls, visible staff and USB compatibility.
- [ ] Hidden fingering and on-demand reveals; full session then reload, same-fingerprint trend, JSON backup/restore.
- [ ] Review keyboard navigation, screen reader controls, light/dark contrast and zoom at 200%.

## V2 movement and musical review (outstanding)

- [ ] Play at least 20 phrases per hand and shift size: Easy one-step relocations, advanced Easy two-step; Medium up to three-step; Hard up to four-step. Repeat at slow and high tempos, with different hand sizes and teacher/player review.
- [ ] Confirm that the reserved one-beat rest is sufficient preparation at each tempo; assess lifted, relaxed landing technique. Passing invariant tests does not establish ergonomic comfort.
- [ ] Inspect advance cues in all hint modes, light/dark and tablet layouts: cues should appear on the preparation rest and before the landing note, without overlapping notation.
- [ ] Play through several chunk boundaries with both hands; verify no unannounced position reset and that all relocation hints are available before landing.
- [ ] Listen for coherent motif, contour, I/IV/V or I/ii/V movement and final chord-tone resolution; assess whether larger leaps feel pedagogically useful. Model consistency is not proof of musical quality or teaching effectiveness.
- [ ] Confirm assistance comparisons in a real browser: hidden practice without reveal versus reveal use; imported legacy history remains accessible under Show all difficulties and is not mixed into v2 curves.

## Smart hints and compact interface review (outstanding)

- [ ] Desktop Chrome and real Android landscape tablet: verify initial placement is readable, the score remains dominant, main transport is reachable, settings scroll internally when needed, and the collapsed virtual piano can be opened without losing the current target.
- [ ] Inspect supported VexFlow finger numbers in treble, bass, both hands and extreme registers. Check noteheads/stems/accidentals, annotation spacing and viewport bounds at zoom and after web fonts load. SVG unit checks do not establish pixel-level non-overlap or legibility.
- [ ] Smart: first note numbers automatically visible, routine fingers omitted, exact landing notes marked and movement cues visible before execution. Confirm each hand's banner follows the actual current position across long streams.
- [ ] None: no initial position/finger disclosure; manual Reveal shows the current passage plus next movement and marks assistance. Changing modes must preserve the held-key/scoring clock state. Starting a fresh None exercise clears assistance only for that new exercise.
- [ ] Ask a teacher/player to review any deliberately authored rested-alternate finger plan before pedagogical use. The generator does not routinely emit these alternatives, and validation is not evidence of human comfort or teaching effectiveness.
