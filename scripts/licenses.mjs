import {
  copyFile,
  readFile,
  readdir,
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import * as checker from "license-checker-rseidelsohn";
import {
  licenseReportSchema,
  publicRepositoryUrl,
} from "../src/shared/licenseReport.ts";
import {
  bundledFontNotices,
  reviewPackageNotices,
} from "./license-notices.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

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
  return result.sort((a, b) => a.file.localeCompare(b.file, "en"));
}

export async function generateLicenses() {
  const lock = await readJson(path.join(root, "package-lock.json"));
  const modules = await new Promise((resolve, reject) =>
    checker.init(
      {
        start: root,
        excludePrivatePackages: true,
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
      locked.version !== metadata.version ||
      locked.license !== metadata.license
    )
      throw new Error(
        `License scan differs from package-lock.json: ${id}. Run npm ci.`,
      );
    if (metadata.private) continue;
    const notices = await noticeFiles(info.path);
    const { license, issues } = await reviewPackageNotices(
      id,
      metadata.license,
      info.path,
      notices,
    );
    packages.push({
      name: metadata.name,
      version: metadata.version,
      license,
      repository:
        typeof info.repository === "string"
          ? publicRepositoryUrl(
              info.repository.replace(/^git\+/, "").replace(/\.git$/, ""),
            )
          : undefined,
      notices,
      issues,
    });
  }
  packages.sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"),
  );
  // Check the scanner's coverage independently, including nested dependencies.
  const scanned = new Set(
    packages.map((entry) => `${entry.name}@${entry.version}`),
  );
  for (const [location, locked] of Object.entries(lock.packages)) {
    if (!location) continue;
    let metadata;
    try {
      metadata = await readJson(path.join(root, location, "package.json"));
    } catch (error) {
      if (error.code === "ENOENT" && locked.optional) continue;
      throw error;
    }
    if (
      metadata.version !== locked.version ||
      metadata.license !== locked.license
    )
      throw new Error(
        `License scan differs from package-lock.json: ${location}. Run npm ci.`,
      );
    if (
      !metadata.private &&
      !scanned.has(`${metadata.name}@${metadata.version}`)
    )
      throw new Error(
        `License scan omitted ${metadata.name}@${metadata.version}.`,
      );
  }
  const output = path.join(root, "public/licenses");
  const fonts = await bundledFontNotices(
    output,
    lock.packages["node_modules/vexflow"]?.version,
  );
  const report = licenseReportSchema.parse({
    schemaVersion: 1,
    packages: [...packages, ...fonts],
  });
  await mkdir(output, { recursive: true });
  await copyFile(path.join(root, "LICENSE"), path.join(output, "LICENSE.txt"));
  await writeFile(
    path.join(output, "dependencies.json"),
    JSON.stringify(report),
  );
  await writeFile(
    path.join(output, "THIRD_PARTY_NOTICES.txt"),
    [
      "ClefGlide third-party notices",
      "ClefGlide’s own MIT License is provided separately in LICENSE.txt.",
      "Installed production and development/build dependencies; absent optional platform packages are not included.",
      ...report.packages.map((entry) =>
        [
          `\n${entry.name}@${entry.version} — ${entry.license}`,
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
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await generateLicenses();
