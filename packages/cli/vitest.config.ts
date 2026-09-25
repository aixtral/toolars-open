import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Same dual layout as build.mjs: the workspace resolves "@" to the site sources
// two levels up, while the exported tree ships the closure under vendor/.
const vendoredRoot = fileURLToPath(new URL("vendor", import.meta.url));
const srcRoot = existsSync(vendoredRoot)
  ? vendoredRoot
  : fileURLToPath(new URL("../../src", import.meta.url));

export default defineConfig({
  // Pin the project root so the include globs resolve to this package's src
  // no matter which directory the test script is invoked from.
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@": srcRoot,
    },
  },
  define: {
    __TOOLARS_CLI_VERSION__: JSON.stringify("0.0.0-test"),
    __TOOLARS_CLI_ENTRY__: JSON.stringify("test"),
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    testTimeout: 30000,
  },
});
