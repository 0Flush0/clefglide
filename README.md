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

**Settings & help** has separate USB and Bluetooth MIDI walkthroughs, an input picker and feedback from received hardware MIDI events. For USB, use a data cable and the keyboard's USB TO HOST / USB MIDI port; Android may need a USB-C/OTG adapter and external power. A keyboard with only DIN MIDI sockets needs a USB MIDI interface (keyboard MIDI OUT to interface MIDI IN).

For Bluetooth, enable BLE-MIDI on the keyboard or its adapter and connect it in a compatible app on the same computer/tablet before clicking **Connect MIDI** in ClefGlide. Bluetooth audio and ordinary pairing alone do not necessarily expose MIDI notes to Chrome. The guide links to [Bluetooth MIDI Connect for Android](https://play.google.com/store/apps/details?id=bluetooth.midi.connect), Apple's Audio MIDI Setup instructions for macOS, and MIDIberry/loopMIDI for compatible Windows setups. Keep any routing/bridge apps running and select their exposed MIDI input in ClefGlide. Compatibility depends on the device, operating system and connector; these instructions do not establish hardware verification.

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

The footer links to the GitHub repository and opens a searchable, keyboard-accessible **Open-source licenses** dialog. Full copyright, license and NOTICE texts are bundled as static files, with a plain-text download. No server API or external request is needed to read them. No PianoPlayer source is imported.

`npm run licenses` uses `license-checker-rseidelsohn` to scan actual installed packages and checks their versions against `package-lock.json`. Both `npm run dev` and `npm run build` regenerate `public/licenses/dependencies.json` and `THIRD_PARTY_NOTICES.txt`; these generated files are ignored by Git and copied into `dist/licenses/`. Production and development/build dependencies are included conservatively, with only public package names, versions, license identifiers, repository URLs and notices published. Private packages, machine paths, registry credentials and publisher metadata are excluded. Optional packages absent on the build platform are omitted. Vite's existing bundled-code `THIRD_PARTY_LICENSES.md` is retained as an additional report.

Missing license text or unknown/unlicensed metadata fails generation; missing or inferred metadata is reported explicitly. Preserve any additional license and NOTICE files supplied by packages. The one current exception is `@napi-rs/wasm-runtime@1.2.2`, whose npm package omits LICENSE. Its version-specific notice in `scripts/license-overrides/` comes from [the exact upstream revision recorded by npm](https://github.com/napi-rs/napi-rs/blob/5b344c367eeed81d1917f7c4d8e65b1adc16de12/LICENSE). A version update requires a fresh review if the license remains absent. Academico and Bravura retain their complete SIL OFL 1.1 notices; their bundled notice files do not specify font versions, which the viewer states explicitly. No license text is fetched during builds.

The checker is pinned to 4.4.2 for compatibility with the workspace's Node/npm fallback. Its newer successor requires newer tooling. A scoped `read-package-json`/`glob` override keeps the build-only scan dependency patched. `npm run test:licenses` builds and tests the production site on desktop and tablet, including English/German notices, link behavior, search, themes, dismissal and load retry.

## Search visibility and Google Search Console

The title, description, canonical URL, robots directive and Open Graph/Twitter metadata live in `index.html` and are included in the initial production HTML without running React. `public/robots.txt` permits all crawlers, including access to JavaScript, CSS and fonts, and points to `public/sitemap.xml`. The sitemap lists only `https://piano.rit.cl/`; Practice, Progress and Settings are views of the same page, not separate URLs. Vite copies these files into `dist/`, and the existing Docker image serves them through Nginx without deployment changes.

After the normal GitHub-to-STRATO deployment:

1. Open **View page source** at `https://piano.rit.cl/` and confirm the new title, description and canonical URL. Check that the page and `/assets/` resources return HTTP 200, and that neither the HTML nor response headers contain a restrictive `noindex` directive (`X-Robots-Tag` can also be set by an upstream proxy).
2. Open `https://piano.rit.cl/robots.txt` and `https://piano.rit.cl/sitemap.xml`. They must return the text/XML files with HTTP 200, rather than the application's fallback HTML. JavaScript, CSS and fonts must remain crawlable. The repository's Nginx configuration sets no `X-Robots-Tag` or authentication restrictions; live DNS, TLS and any upstream proxy must be checked separately.
3. In [Google Search Console](https://search.google.com/search-console/), add the URL-prefix property `https://piano.rit.cl/`. Choose **HTML tag**, copy Google's exact `google-site-verification` meta tag into the `<head>` of `index.html`, deploy through the existing workflow, and click **Verify**. Alternatively, choose **HTML file**, put Google's downloaded file unchanged in `public/`, deploy, check its public URL, and verify. Keep the tag/file permanently. For DNS verification without an application change, add a Domain property for `piano.rit.cl` and publish Google's TXT record at the DNS provider for that name. See [Google's ownership verification instructions](https://support.google.com/webmasters/answer/9008080?hl=en).
4. In **Sitemaps**, submit `https://piano.rit.cl/sitemap.xml`. In **URL inspection**, inspect `https://piano.rit.cl/`, select **Test live URL**, check that crawling and indexing are allowed and that the rendered page loads its resources, then click **Request indexing**. Later, review the indexed result's Google-selected canonical. See [Google's URL inspection guide](https://support.google.com/webmasters/answer/9012289?hl=en).

Verification requires the owner's Google token or DNS access; no placeholder token or analytics integration is included. Indexing and ranking are Google's decisions, and [a crawl request does not guarantee indexing](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl).

Builds include `THIRD_PARTY_LICENSES.md`; bundled font licenses are retained under `public/licenses/` and copied to `dist/licenses/`.

In this restricted Windows workspace, a local toolchain is available without system installation:

```powershell
$env:PATH = "$PWD\.tools;$env:PATH"
.tools\node.exe .tools\package\bin\npm-cli.js run dev
```

Typecheck, lint, production build, all 96 unit/integration tests and all 18 desktop/tablet Playwright tests pass for the ClefGlide rebrand. Browser tests required approved execution outside the Windows sandbox to start workers. See `docs/QA_CHECKLIST.md` for evidence and the remaining physical MIDI, real-device and production checks.
