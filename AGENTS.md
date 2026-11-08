# ClefGlide

Static Vite + React + TypeScript piano sight-reading trainer. REQUIREMENTS.md is authoritative; read it before substantial changes.

Commands: `npm ci`, `npm run dev`, `npm run typecheck`, `npm run lint`, `npm run test`, `npx playwright install chromium`, `npm run test:e2e`, `npm run build`.

Architecture: `src/generation` seeded hand-state planner and independent validator; `src/score` canonical model and VexFlow SVG adapter; `src/midi` shared normalized event bus and WEBMIDI.js adapter; `src/scoring` pure state machine; `src/practice` React session controller/UI; `src/progress` validated Dexie persistence and exports.

Non-negotiables: no random fingering retrofits; never silently shift hands; preserve exact ticks and chunk state; validate every phrase; C4 = MIDI 60; no SysEx or permission prompt before a user gesture; do not claim MIDI verifies fingers; distinguish wait throughput from timed accuracy; never mix incomparable fingerprints by default; use actual recorded outcomes, no sample metrics. Hardware verification must be reported separately from simulator tests. Preserve local-first, no-server operation.

Generator v2 movement rules are in docs/DECISIONS.md. Very Easy never shifts, including across chunks. Higher presets use only explicit lift-and-reposition actions after a full beat of rest. Validate every movement and advance cue independently; retain the final hand state. Preserve ranges when applying presets. Hint usage changes the assistance comparison series. Legacy history must remain distinct from v2 results. Do not claim that algorithmic invariants prove comfortable human fingering.

Smart hints live in `src/score/hints.ts`: derive from validated position maps and explicit movements, never interval heuristics. All/Smart/None are UI modes; legacy reveal is retained only for history compatibility and migrated to Smart for active practice. Hint changes must not regenerate notes or reset scoring. A rested alternate finger requires an explicit, independently validated plan tag; do not weaken fixed-position mapping for unexplained finger mismatches. The generator still emits natural mappings only. Keep note-name range controls and technical settings collapsed by default.

Toolchain fallback for this Windows workspace: `.tools/node.exe .tools/package/bin/npm-cli.js <command>` with `.tools` on PATH. `.tools` is ignored. Prefer a normal Node 24 installation for clean setups.
