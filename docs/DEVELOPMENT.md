# Development notes

Use the commands in the [README](../README.md) with Node.js 24. The Docker builder and GitHub Actions deployment also use Node.js 24. Keep dependency versions locked and use `npm ci` for fresh installs.

The Vitest configuration runs source tests without loading the Vite app’s build plugins. Playwright’s default configuration starts the development server on port 5173. The production license suite uses the built site on port 4173 and checks the notice dialog, downloads, localization, dismissal and retry on desktop and tablet viewports.

`npm run format` formats source, browser tests, scripts and root TypeScript/JavaScript configuration. The [repository instructions](../AGENTS.md) describe the generator and scoring invariants and the commit conventions.

The internal package name, IndexedDB database, `sightflow-language` preference key and `sightflow-1` backup format keep their original names for compatibility. The visible product and new export filenames use ClefGlide. The [hosting guide](HOSTING.md) documents the corresponding deployment identifier.

## Third-party notices

`npm run licenses` scans installed packages with `license-checker-rseidelsohn` and checks their versions against the lockfile. Both `npm run dev` and `npm run build` generate the ignored files `public/licenses/dependencies.json` and `public/licenses/THIRD_PARTY_NOTICES.txt`. A build copies them, along with the Academico and Bravura font notices, to `dist/licenses/`. Vite also emits `dist/THIRD_PARTY_LICENSES.md` for bundled code.

The generated inventory includes installed production and development packages. Optional packages absent on the build platform are omitted. Missing notice text or unknown license metadata fails generation. The checker is pinned, and the manifest scopes a `glob` override to its `read-package-json` dependency.

The package for `@napi-rs/wasm-runtime@1.2.2` omits its license text. The [version-specific override](../scripts/license-overrides/napi-rs-wasm-runtime-1.2.2.txt) preserves the notice from the [upstream revision recorded by npm](https://github.com/napi-rs/napi-rs/blob/5b344c367eeed81d1917f7c4d8e65b1adc16de12/LICENSE). Review the override when updating that package.

## Windows workspace fallback

On the maintainer’s restricted Windows workspace, a local Node and npm installation may already be available under ignored `.tools/`. A fresh clone uses the standard Node.js installation from the README.

```powershell
$env:PATH = "$PWD\.tools;$env:PATH"
.tools\node.exe .tools\package\bin\npm-cli.js run dev
```

The same npm entry point supports `ci`, `run test`, and the other README commands. [The tooling runner](../scripts/tooling.mjs) handles the optional Windows mapped-drive probe when the sandbox rejects it and uses a thread pool for Vitest.
