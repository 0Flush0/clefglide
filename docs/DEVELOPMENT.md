# Development notes

Use the commands in the [README](../README.md) with Node.js 24. The Docker builder and GitHub Actions deployment also use Node.js 24. Keep dependency versions locked and use `npm ci` for fresh installs.

The Vitest configuration runs source tests without loading the Vite app’s build plugins. Playwright’s default configuration starts the development server on port 5173. The production license suite uses the built site on port 4173 and checks the notice dialog, downloads, localization, dismissal and retry on desktop and tablet viewports.

`npm run format` formats source, browser tests, scripts and root TypeScript/JavaScript configuration. The [repository instructions](../AGENTS.md) describe the generator and scoring invariants and the commit conventions.

The internal package name, IndexedDB database, `sightflow-language` preference key and `sightflow-1` backup format keep their original names for compatibility. The visible product and new export filenames use ClefGlide. The [hosting guide](HOSTING.md) documents the corresponding deployment identifier.

## Third-party notices

`npm run licenses` scans installed packages with `license-checker-rseidelsohn` and checks their versions and license declarations against the lockfile. Both `npm run dev` and `npm run build` prepare the license viewer and its plain-text download under `public/licenses/`. The production build serves the same files under `dist/licenses/`, including a copy of ClefGlide’s [MIT License](../LICENSE) at `LICENSE.txt`. The third-party inventory is in `dependencies.json` and `THIRD_PARTY_NOTICES.txt`. Use that inventory for supplemental notices that Vite’s bundled-code list in `dist/THIRD_PARTY_LICENSES.md` may omit.

The inventory covers installed production and development packages. Optional packages are included when installed on the build platform. Review notices on the release platform. The checker is pinned, and the manifest scopes a `glob` override to its `read-package-json` dependency.

[Notice checks](../scripts/license-notices.mjs) require review for new compound SPDX expressions and check the hashes of the three embedded VexFlow WOFF2 files. When updating VexFlow, review each font’s version, copyright, reserved names and full OFL text against the new binaries. Package tarballs that omit license files use [version-specific sources](../scripts/license-sources.mjs). An unreviewed missing notice fails generation. The inventory flags the unverified `jazz-midi@1.7.9` copyright and identifies the later upstream notice available for `@tybys/wasm-util@0.10.3`.

The app uses Lucide’s generic code icon to link to its GitHub repository. The Lucide entry preserves the release’s ISC text and Feather’s MIT notice. See [Lucide’s original icon metadata](https://github.com/lucide-icons/lucide/blob/0.511.0/icons/github.json) and [GitHub’s logo usage terms](https://brand.github.com/foundations/logo).

## Windows workspace fallback

On the maintainer’s restricted Windows workspace, a local Node and npm installation may already be available under ignored `.tools/`. A fresh clone uses the standard Node.js installation from the README.

```powershell
$env:PATH = "$PWD\.tools;$env:PATH"
.tools\node.exe .tools\package\bin\npm-cli.js run dev
```

The same npm entry point supports `ci`, `run test`, and the other README commands. [The tooling runner](../scripts/tooling.mjs) handles the optional Windows mapped-drive probe when the sandbox rejects it and uses a thread pool for Vitest.
