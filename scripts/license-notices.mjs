import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { missingPackageNotice } from "./license-sources.mjs";

const standaloneLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
]);

const noticeOverride = (file) =>
  readFile(new URL(`./license-overrides/${file}`, import.meta.url), "utf8");

function requireNotice(id, text, ...markers) {
  const normalized = text.replace(/\s+/g, " ");
  for (const marker of markers) {
    if (!normalized.includes(marker))
      throw new Error(`${id}: missing notice text for "${marker}".`);
  }
}

export async function reviewPackageNotices(id, license, directory, notices) {
  const issues = [];
  const expected = {
    "spdx-ranges@2.1.1": "(MIT AND CC-BY-3.0)",
    "spdx-exceptions@2.5.0": "CC-BY-3.0",
    "spdx-license-ids@3.0.24": "CC0-1.0",
    "victory-vendor@37.4.1": "MIT AND ISC AND BSD-3-Clause",
    "lucide-react@0.511.0": "ISC",
  }[id];
  if (
    (expected && license !== expected) ||
    (!expected &&
      (!standaloneLicenses.has(license) || id.startsWith("lucide-react@")))
  ) {
    throw new Error(
      `${id}: review the license declaration "${license}" and its notices.`,
    );
  }

  const installedNotices = notices.map((notice) => notice.text).join("\n");
  if (id === "spdx-ranges@2.1.1" || id === "spdx-exceptions@2.5.0") {
    const readme = (
      await readFile(path.join(directory, "README.md"), "utf8")
    ).replace(/\r\n/g, "\n");
    const section =
      id === "spdx-ranges@2.1.1"
        ? readme.split("## Licensing\n").at(1)
        : readme.split("### SPDX\n").at(1)?.split("\n### This Package")[0];
    const attribution = section?.trim() ?? "";
    if (id === "spdx-ranges@2.1.1") {
      requireNotice(
        id,
        installedNotices,
        "Copyright (c) 2015 Kyle E. Mitchell",
        "Permission is hereby granted",
        "THE SOFTWARE IS PROVIDED",
      );
      requireNotice(
        id,
        attribution,
        "The Linux Foundation and its contributors",
        "Creative Commons Attribution License 3.0 Unported",
      );
    } else {
      requireNotice(
        id,
        attribution,
        "Copyright © 2010-2015 Linux Foundation and its Contributors.",
        "Creative Commons Attribution License 3.0 Unported",
      );
    }
    notices.push({
      file: "README.md (SPDX attribution)",
      text: `${attribution}\n\nSPDX source: https://spdx.dev/\nLicense: https://creativecommons.org/licenses/by/3.0/legalcode\n`,
    });
    const terms = await noticeOverride("CC-BY-3.0.txt");
    requireNotice(
      id,
      terms,
      "Attribution 3.0 Unported",
      "Restrictions.",
      "Creative Commons Notice",
    );
    notices.push({ file: "CC-BY-3.0.txt", text: terms });
  }

  if (id === "spdx-license-ids@3.0.24") {
    const readme = await readFile(path.join(directory, "README.md"), "utf8");
    const terms = await noticeOverride("CC0-1.0.txt");
    requireNotice(
      id,
      readme,
      "Creative Commons Zero v1.0 Universal",
      "https://creativecommons.org/publicdomain/zero/1.0/deed",
    );
    requireNotice(
      id,
      terms,
      "CC0 1.0 Universal",
      "Waiver.",
      "Public License Fallback.",
    );
    notices.push({
      file: "CC0-1.0.txt (license linked from the package README)",
      text: `https://creativecommons.org/publicdomain/zero/1.0/legalcode\n\n${terms}`,
    });
  }

  if (id === "victory-vendor@37.4.1") {
    requireNotice(
      id,
      installedNotices,
      "Copyright (c) 2015-2026 Nearform.",
      "Permission is hereby granted",
      "internmap (ISC)",
      "Permission to use, copy, modify",
      "d3-ease (BSD-3-Clause)",
      "Copyright 2001 Robert Penner",
      "d3-voronoi (BSD-3-Clause)",
      "Copyright (C) 2010-2013 Raymond Hill",
      "Redistribution and use in source and binary forms",
    );
  }

  if (id === "lucide-react@0.511.0") {
    requireNotice(
      id,
      installedNotices,
      "Lucide Contributors 2022",
      "Cole Bemis 2013-2022 as part of Feather (MIT)",
      "Permission to use, copy, modify",
    );
    const feather = await noticeOverride("feather-LICENSE.txt");
    requireNotice(
      id,
      feather,
      "Copyright (c) 2013-2023 Cole Bemis",
      "The above copyright notice",
      "THE SOFTWARE IS PROVIDED",
    );
    notices.push({
      file: "Feather LICENSE (MIT)",
      text: `https://github.com/feathericons/feather/blob/v4.29.2/LICENSE\n\n${feather}`,
    });
    license = "ISC AND MIT";
  }

  if (!notices.length) {
    const supplement = await missingPackageNotice(id, directory);
    if (supplement) {
      const { file, text, issue } = supplement;
      notices.push({ file, text });
      if (issue) issues.push(issue);
    }
  }

  if (!notices.length || notices.some((notice) => !notice.text.trim())) {
    throw new Error(`${id}: missing or empty license notice.`);
  }
  return { license, issues };
}

// The hashes are for the WOFF2 bytes in the published VexFlow 5.0.0 Bravura entry.
// Review the copyright, license and version fields of any changed font.
const fonts = [
  {
    name: "Academico",
    version: "0.902",
    repository: "https://github.com/vexflow/vexflow-fonts/tree/main/academico",
    file: "academico.txt",
    copyrightYears: [2020, 2022],
    assets: {
      academico:
        "363caf009818b9cebc7a2644d96b5dc10a20d3b5e557afdb4fb1a9a53d57e329",
      academicobold:
        "575c2e30fcf7dd9363e49890644b2ed23b6b518c9866aadb5370d470473297b6",
    },
  },
  {
    name: "Bravura",
    version: "1.392",
    repository: "https://github.com/steinbergmedia/bravura",
    file: "bravura.txt",
    copyrightYears: [2021],
    assets: {
      bravura:
        "5c25278c208ca455dc7c3c0c95d833e134aca6d740a023767af50d0dfa06ef82",
    },
  },
];

export async function bundledFontNotices(directory, vexflowVersion) {
  const entryUrl = import.meta.resolve("vexflow/bravura");
  const entry = await readFile(new URL(entryUrl), "utf8");
  const imports = [
    ...entry.matchAll(/from ['"]\.\.\/src\/fonts\/(\w+)\.js['"]/g),
  ]
    .map(([, asset]) => asset)
    .sort();
  const reviewed = fonts.flatMap(({ assets }) => Object.keys(assets)).sort();
  if (vexflowVersion !== "5.0.0" || imports.join(",") !== reviewed.join(",")) {
    throw new Error("Review the font notices for this VexFlow Bravura entry.");
  }

  return Promise.all(
    fonts.map(
      async ({ name, version, repository, file, copyrightYears, assets }) => {
        for (const [asset, expectedHash] of Object.entries(assets)) {
          const source = await readFile(
            new URL(`../src/fonts/${asset}.js`, entryUrl),
            "utf8",
          );
          const encoded = source.match(
            /data:font\/woff2[^,]*;base64,([\w+/=]+)/,
          )?.[1];
          const hash =
            encoded &&
            createHash("sha256").update(encoded, "base64").digest("hex");
          if (hash !== expectedHash) {
            throw new Error(
              `Review ${name}'s font notice. The embedded ${asset} WOFF2 changed.`,
            );
          }
        }
        const text = await readFile(path.join(directory, file), "utf8");
        requireNotice(
          name,
          text,
          `version ${version}`,
          `with Reserved Font Name "${name}"`,
          "SIL OPEN FONT LICENSE Version 1.1",
          "TERMINATION",
          "DISCLAIMER",
          ...copyrightYears.map(
            (year) => `Copyright © ${year}, Steinberg Media Technologies GmbH`,
          ),
        );
        return {
          name,
          version,
          license: "OFL-1.1",
          repository,
          notices: [{ file, text }],
          issues: [],
        };
      },
    ),
  );
}
