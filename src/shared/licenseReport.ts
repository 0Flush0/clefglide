import { z } from "zod";

export function publicRepositoryUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) ||
    /\.(?:example|internal|invalid|lan|local|localhost|test)$/i.test(
      url.hostname,
    ) ||
    url.port ||
    url.username ||
    url.password ||
    url.href.includes("?") ||
    url.href.includes("#")
  ) {
    return undefined;
  }
  return url.href;
}

const nonempty = z.string().refine((value) => value.trim().length > 0);

export const licenseReportSchema = z.object({
  schemaVersion: z.literal(1),
  packages: z
    .array(
      z.object({
        name: nonempty,
        version: nonempty,
        license: nonempty,
        repository: z
          .string()
          .refine((value) => publicRepositoryUrl(value) !== undefined)
          .optional(),
        notices: z.array(z.object({ file: nonempty, text: nonempty })).min(1),
        issues: z.array(nonempty),
      }),
    )
    .min(1),
});

export type LicenseEntry = z.infer<
  typeof licenseReportSchema
>["packages"][number];
