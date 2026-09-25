import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Pin the project root so the include globs resolve to this package's src
  // no matter which directory the test script is invoked from.
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
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
