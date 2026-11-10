import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import * as checker from "license-checker-rseidelsohn";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

// Publish only public URLs, never credentials, local paths or package metadata.
export function publicUrl(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.replace(/^git\+/, "").replace(/\.git$/, ""));
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

async function noticeFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (
      entry.isFile() &&
      (prefix ||
        /^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(entry.name))
    ) {
      result.push({
        file: name,
        text: await readFile(path.join(directory, entry.name), "utf8"),
      });
    } else if (
      entry.isDirectory() &&
      /^(licenses?|notices?)$/i.test(entry.name)
    ) {
      result.push(
        ...(await noticeFiles(path.join(directory, entry.name), `${name}/`)),
      );
    }
  }
  return result;
}

export async function generateLicenses() {
  const lock = await readJson(path.join(root, "package-lock.json"));
  const modules = await new Promise((resolve, reject) =>
    checker.init(
      {
        start: root,
        excludePrivatePackages: true,
        customFormat: { name: "", version: "", licenseText: "" },
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    ),
  );
  const packages = [];
  for (const [id, info] of Object.entries(modules)) {
    const relative = path.relative(root, info.path).split(path.sep).join("/");
    const locked = lock.packages[relative];
    const metadata = await readJson(path.join(info.path, "package.json"));
    if (
      !relative.startsWith("node_modules/") ||
      !locked ||
      locked.version !== metadata.version
    )
      throw new Error(
        `License scan differs from package-lock.json: ${id}. Run npm ci.`,
      );
    if (metadata.private) continue;
    const notices = await noticeFiles(info.path);
    const issues = [];
    // This release omits LICENSE from its npm tarball. Source revision comes
    // from npm's gitHead for exactly 1.2.2; never apply this to another version.
    if (id === "@napi-rs/wasm-runtime@1.2.2" && !notices.length) {
      notices.push({
        file: "Upstream LICENSE (5b344c367eeed81d1917f7c4d8e65b1adc16de12)",
        text: await readFile(
          path.join(
            root,
            "scripts/license-overrides/napi-rs-wasm-runtime-1.2.2.txt",
          ),
          "utf8",
        ),
      });
      issues.push(
        "The installed package omits its license text; the notice is preserved from its exact upstream source revision.",
      );
    }
    // A README license section is a documented fallback used by the checker.
    if (!notices.length && info.licenseText)
      notices.push({
        file: "License text detected by license-checker",
        text: info.licenseText,
      });
    const declared =
      typeof metadata.license === "string" ? metadata.license : undefined;
    const license =
      declared ||
      (Array.isArray(info.licenses)
        ? info.licenses.join(" OR ")
        : info.licenses) ||
      "UNKNOWN";
    if (!declared)
      issues.push(
        "License metadata is missing; the reported license was detected from package files.",
      );
    if (/UNKNOWN|UNLICENSED|\*/.test(license))
      issues.push("License metadata needs review.");
    if (!notices.length)
      issues.push("No license text was found in the installed package.");
    packages.push({
      name: metadata.name,
      version: metadata.version,
      license,
      repository: publicUrl(info.repository),
      notices,
      issues,
    });
  }
  packages.sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"),
  );
  // Check the scanner's coverage independently, including nested dependencies.
  const scanned = new Set(packages.map((entry) => `${entry.name}@${entry.version}`));
  for (const [location, locked] of Object.entries(lock.packages)) {
    if (!location) continue;
    let metadata;
    try {
      metadata = await readJson(path.join(root, location, "package.json"));
    } catch (error) {
      if (error.code === "ENOENT" && locked.optional) continue;
      throw error;
    }
    if (!metadata.private && !scanned.has(`${metadata.name}@${metadata.version}`))
      throw new Error(`License scan omitted ${metadata.name}@${metadata.version}.`);
  }
  const fonts = await Promise.all(
    ["academico", "bravura"].map(async (name) => ({
      name: name === "academico" ? "Academico" : "Bravura",
      version: null,
      license: "OFL-1.1",
      repository: `https://github.com/steinbergmedia/${name}`,
      notices: [
        {
          file: `${name}.txt`,
          text: await readFile(
            path.join(root, `public/licenses/${name}.txt`),
            "utf8",
          ),
        },
      ],
      issues: ["The bundled font notice does not specify a version."],
    })),
  );
  const entries = [...packages, ...fonts];
  const report = { schemaVersion: 1, packages: entries };
  const output = path.join(root, "public/licenses");
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "dependencies.json"),
    JSON.stringify(report),
  );
  await writeFile(
    path.join(output, "THIRD_PARTY_NOTICES.txt"),
    [
      "ClefGlide third-party notices",
      "Installed production and development/build dependencies; absent optional platform packages are not included.",
      ...entries.map((entry) =>
        [
          `\n${entry.name}${entry.version ? `@${entry.version}` : ""} — ${entry.license}`,
          entry.repository || "",
          ...entry.issues,
          ...entry.notices.map(
            (notice) => `\n--- ${notice.file} ---\n${notice.text}`,
          ),
        ].join("\n"),
      ),
    ].join("\n"),
  );
  const issues = packages.filter((entry) => entry.issues.length);
  for (const entry of issues)
    globalThis.console.warn(
      `${entry.name}@${entry.version}: ${entry.issues.join(" ")}`,
    );
  globalThis.console.log(
    `Generated notices for ${packages.length} installed packages and ${fonts.length} fonts.`,
  );
  // Do not ship a release with silently incomplete notices.
  if (
    packages.some(
      (entry) =>
        !entry.notices.length || /UNKNOWN|UNLICENSED/.test(entry.license),
    )
  )
    throw new Error(
      "Incomplete dependency notices. Review the packages listed above before building.",
    );
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await generateLicenses();
