import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { format } from "prettier";
const built = await build({
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
