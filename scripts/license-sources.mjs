import { readFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";

const sources = {
  "@humanfs/types@0.15.0": [
    "../node_modules/@humanfs/core/LICENSE",
    "https://github.com/humanwhocodes/humanfs/blob/85069f193cbacc371c3beb649ce746f8c5a493be/packages/core/LICENSE",
  ],
  "@tonaljs/progression@4.9.1": [
    "../node_modules/tonal/LICENSE",
    "https://github.com/tonaljs/tonal/blob/04eb532e0148df59a8c852db51678e28c94f6f32/docs/LICENSE",
  ],
  "@tonaljs/rhythm-pattern@1.0.0": [
    "../node_modules/tonal/LICENSE",
    "https://github.com/tonaljs/tonal/blob/4dd40aa77877da36cf913af3269e3c66fdc5e831/docs/LICENSE",
  ],
  "@napi-rs/wasm-runtime@1.2.2": [
    "license-overrides/napi-rs-wasm-runtime-1.2.2.txt",
    "https://github.com/napi-rs/napi-rs/blob/5b344c367eeed81d1917f7c4d8e65b1adc16de12/LICENSE",
  ],
  "@tybys/wasm-util@0.10.3": [
    "license-overrides/tybys-wasm-util-MIT.txt",
    "https://github.com/toyobayashi/wasm-util/blob/a16b188d44ae43cc91edb71996ba2b43ff0996d9/LICENSE",
  ],
  "saxes@6.0.0": [
    "license-overrides/saxes-6.0.0.txt",
    "https://github.com/lddubeau/saxes/blob/211fa0ebec9b628affc09219199639887174bfc3/LICENSE",
  ],
  "natural-compare@1.4.0": [
    "license-overrides/natural-compare-1.4.0.txt",
    "https://github.com/litejs/natural-compare-lite/blob/eec83eee67cfac84d6db30cdd65363f155673770/README.md#licence",
  ],
};

for (const id of [
  "primitive@1.1.2",
  "react-compose-refs@1.1.2",
  "react-context@1.1.2",
  "react-direction@1.1.1",
  "react-id@1.1.1",
  "react-use-callback-ref@1.1.1",
  "react-use-layout-effect@1.1.1",
]) {
  sources[`@radix-ui/${id}`] = [
    "license-overrides/radix-primitives-fcef066.txt",
    "https://github.com/radix-ui/primitives/blob/fcef0668a5c827e5a4baac405474d75680f9a4eb/LICENSE",
  ];
}

// Native packages without a LICENSE use their parent package's release notice.
const nativeSources = [
  [
    /^@napi-rs\/canvas-[\w-]+@1\.1\.0$/,
    "../node_modules/@napi-rs/canvas/LICENSE",
    "https://github.com/Brooooooklyn/canvas/blob/v1.1.0/LICENSE",
  ],
  [
    /^@rolldown\/binding-[\w-]+@1\.2\.16$/,
    "../node_modules/rolldown/LICENSE",
    "https://github.com/rolldown/rolldown/blob/v1.2.16/LICENSE",
  ],
  [
    /^@tailwindcss\/oxide-[\w-]+@4\.3\.5$/,
    "../node_modules/@tailwindcss/oxide/LICENSE",
    "https://github.com/tailwindlabs/tailwindcss/blob/v4.3.5/LICENSE",
  ],
];

export async function missingPackageNotice(id, directory) {
  if (id === "imurmurhash@0.1.4" || id === "esrecurse@4.3.0") {
    const readme = await readFile(path.join(directory, "README.md"), "utf8");
    const text = readme
      .match(/^(?:License \(MIT\)\r?$|### License\r?$)[\s\S]*/m)?.[0]
      .trim();
    if (
      !text?.includes("Copyright") ||
      !/\b(?:THE|THIS) SOFTWARE IS PROVIDED/.test(text)
    ) {
      throw new Error(`${id}: the README license section is incomplete.`);
    }
    return { file: "README.md (license section)", text };
  }
  if (id === "jazz-midi@1.7.9") {
    return {
      file: "npm package license declaration",
      text: "MIT, as declared in the npm package metadata.\nhttps://www.npmjs.com/package/jazz-midi/v/1.7.9\nhttps://opensource.org/license/mit\n",
      issue:
        "The npm package declares MIT. The copyright notice for this release could not be verified.",
    };
  }

  const source =
    sources[id] ??
    nativeSources.find(([matches]) => matches.test(id))?.slice(1);
  if (!source) return undefined;
  const [file, url] = source;
  const text = await readFile(new URL(file, import.meta.url), "utf8");
  if (!text.trim())
    throw new Error(`${id}: the upstream license file is empty.`);
  return {
    file:
      id === "natural-compare@1.4.0"
        ? "MIT terms with upstream README attribution"
        : "Upstream LICENSE",
    text: `${url}\n\n${text}`,
    issue:
      id === "@tybys/wasm-util@0.10.3"
        ? "The npm package declares MIT. The upstream repository published this copyright notice after this release."
        : undefined,
  };
}
