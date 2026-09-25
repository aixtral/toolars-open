import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { format } from "prettier";

// esbuild prints a `// <path>` comment per bundled module relative to its
// working directory, so the generated file used to depend on where the build
// was invoked from: `pnpm test` (cwd = repo root) rewrote this tracked file.
// Pinning absWorkingDir to the package makes the output cwd-independent.
const absWorkingDir = fileURLToPath(new URL(".", import.meta.url));
const built = await build({
  absWorkingDir,
  write: false,
  entryPoints: [
    fileURLToPath(
      new URL(
        "../../src/features/tool-runtime/native-coding/json-tree.ts",
        import.meta.url,
      ),
    ),
  ],
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
