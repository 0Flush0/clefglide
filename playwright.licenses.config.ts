import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig({
  ...config,
  testMatch: "licenses.spec.ts",
  use: { ...config.use, baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "node scripts/tooling.mjs preview",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
