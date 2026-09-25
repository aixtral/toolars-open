import { build } from "esbuild";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { format } from "prettier";

// esbuild prints a `// <path>` comment per bundled module relative to its
// working directory, so the generated file used to depend on where the build
// was invoked from: `pnpm test` (cwd = repo root) rewrote this tracked file.
// Pinning absWorkingDir to the package makes the output cwd-independent.
const absWorkingDir = fileURLToPath(new URL(".", import.meta.url));

// The workspace keeps the site core two levels up. The exported tree has no
// site sources, so it ships the one file this build regenerates from under
// vendor/ instead. Prefer the vendored copy when present so an exported
// checkout builds unmodified.
const coreRelativePath = "features/tool-runtime/native-coding/json-tree.ts";
const vendoredCore = fileURLToPath(
  new URL(`vendor/${coreRelativePath}`, import.meta.url),
);
const coreEntryPoint = existsSync(vendoredCore)
  ? vendoredCore
  : fileURLToPath(new URL(`../../src/${coreRelativePath}`, import.meta.url));

const built = await build({
  absWorkingDir,
  write: false,
  entryPoints: [coreEntryPoint],
  outfile: fileURLToPath(new URL("./src/json-core.mjs", import.meta.url)),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  banner: {
    js: "// Generated from Toolars native-coding/json-tree.ts by build.mjs; do not edit.",
  },
});

await writeFile(
  new URL("./src/json-core.mjs", import.meta.url),
  await format(built.outputFiles[0].text, { parser: "babel" }),
);
