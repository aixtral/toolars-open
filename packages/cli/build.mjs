import { chmod, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

// Reuses the workspace-root esbuild devDependency, the same resolution
// pattern as packages/local-tools/build.mjs. The package itself ships zero
// runtime dependencies: every site core it uses is bundled into dist/.
const packageRoot = new URL("./", import.meta.url);
// The workspace resolves "@" to the site sources two levels up. The exported
// tree has no site sources, so it ships the exact closure this package needs
// under vendor/ instead; both layouts resolve the same specifiers. Prefer the
// vendored copy when present so an exported checkout builds unmodified.
const vendoredRoot = fileURLToPath(new URL("vendor", packageRoot));
const srcRoot = existsSync(vendoredRoot)
  ? vendoredRoot
  : fileURLToPath(new URL("../../src", import.meta.url));
const { version } = JSON.parse(
  await readFile(new URL("./package.json", packageRoot), "utf8"),
);

const entries = [
  { entry: "src/cli.ts", out: "dist/cli.mjs", entryName: "cli" },
  { entry: "src/mcp.ts", out: "dist/mcp.mjs", entryName: "mcp" },
];

for (const { entry, out, entryName } of entries) {
  await build({
    entryPoints: [fileURLToPath(new URL(entry, packageRoot))],
    outfile: fileURLToPath(new URL(out, packageRoot)),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    alias: { "@": srcRoot },
    define: {
      __TOOLARS_CLI_VERSION__: JSON.stringify(version),
      // Both modules end up in both bundles; only the matching entry may
      // self-execute, because import.meta.url alone cannot distinguish them.
      __TOOLARS_CLI_ENTRY__: JSON.stringify(entryName),
    },
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "warning",
  });
  await chmod(new URL(out, packageRoot), 0o755);
}
