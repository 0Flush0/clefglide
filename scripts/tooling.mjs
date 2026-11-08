// Vite probes mapped Windows drives with `net use`. Restricted runners may
// reject that optional process synchronously; treat it as an unavailable probe.
import childProcess from "node:child_process";
import process from "node:process";
import { syncBuiltinESMExports } from "node:module";
const original = childProcess.exec;
childProcess.exec = function (command, ...args) {
  try {
    return original.call(this, command, ...args);
  } catch (error) {
    if (command !== "net use" || error.code !== "EPERM") throw error;
    const callback = args.at(-1);
    if (typeof callback === "function")
      globalThis.queueMicrotask(() => callback(error, "", ""));
  }
};
syncBuiltinESMExports();
const task = process.argv[2];
if (task === "build") {
  const { build } = await import("vite");
  await build({ configLoader: "native" });
} else if (task === "dev") {
  const { createServer } = await import("vite");
  const server = await createServer({
    configLoader: "native",
    server: { host: "127.0.0.1" },
  });
  await server.listen();
  server.printUrls();
} else if (task === "test") {
  const { startVitest } = await import("vitest/node");
  const ctx = await startVitest("test", [], {
    run: true,
    config: "vitest.config.ts",
    configLoader: "native",
    pool: "threads",
    maxWorkers: 1,
  });
  if (!ctx) process.exitCode = 1;
}
