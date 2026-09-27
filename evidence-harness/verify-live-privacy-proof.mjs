import { readFileSync } from "node:fs";
import { verifyDeploymentProof } from "./lib/capture-release.mjs";

const pathIndex = process.argv.indexOf("--receipt");
if (pathIndex < 0 || !process.argv[pathIndex + 1]) {
  throw new Error(
    "Usage: node verify-live-privacy-proof.mjs --receipt <capture.json>",
  );
}
const capture = JSON.parse(readFileSync(process.argv[pathIndex + 1], "utf8"));
const response = await fetch(
  "https://toolars.com/privacy-proof/verification-receipt.json",
  {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  },
);
if (!response.ok)
  throw new Error(`Live identity request failed: ${response.status}`);
const verified = verifyDeploymentProof(
  capture,
  await response.json(),
  response.headers.get("x-toolars-release"),
  process.env.EXPECTED_SOURCE_COMMIT || undefined,
);
console.log(
  JSON.stringify(
    {
      ...verified,
      checkedAt: new Date().toISOString(),
      note: "Scoped live capture only; not full CI, all tools, or a perpetual guarantee.",
    },
    null,
    2,
  ),
);
