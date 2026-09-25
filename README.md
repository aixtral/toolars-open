# Toolars open-source distribution

[![Privacy proof](https://github.com/aixtral/toolars-open/actions/workflows/privacy-proof.yml/badge.svg)](https://github.com/aixtral/toolars-open/actions/workflows/privacy-proof.yml)

This directory is the source of truth for the code Toolars publishes publicly.
It is assembled into a distributable tree by `scripts/export-open-source.mjs`
in the private repository; nothing here is built or bundled into the website.

## Continuous verification

Every push and every day at 03:17 UTC, the
[Privacy proof workflow](https://github.com/aixtral/toolars-open/actions/workflows/privacy-proof.yml)
rebuilds both packages from this tree alone, re-runs their test vectors, and
re-captures the privacy-proof receipt against the live site. The badge is
green only when the latest receipt's outcome is `verified`.

A failed run is not automatically a privacy finding. The harness distinguishes
two outcomes: `violation` means a measured request crossed the
local-processing boundary (the workflow fails on the first attempt, without
retrying); `inconclusive` means the run could not be completed — usually a
network problem between the runner and the site — and says nothing about the
site in either direction. Inconclusive runs are retried; a persistent one
fails the job with an explicit notice. Read the run log before reading
anything into a red badge.

## What is published

| Path                    | What it is                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evidence-harness/`     | A runnable harness that drives the **public website** in headless Chromium and records every network request, including dedicated Web Worker fetches. It is the tool behind the claim that files never leave the browser. |
| `packages/cli/`         | `@toolars/cli` — a local stdio CLI and MCP server (hash, base64, JWT decode, UUID/ULID, timestamp, cron, URL encode/decode), shipped as a prebuilt bundle in `dist/`.                                                     |
| `packages/local-tools/` | `@toolars/local-tools` — a smaller local stdio CLI and MCP server (JSON formatting, SHA-256), shipped as runnable source.                                                                                                 |

All of it is MIT-licensed (see `LICENSE`). `THIRD-PARTY.md` states the exact
scope and lists third-party components.

## What is deliberately _not_ published

This is an **open-core** distribution, not the whole product. Not included:

- the website application (routing, SEO layer, catalog, editorial content, the
  13 localized content sets);
- the tool implementations and Web Workers that the website ships, **in source
  form** — with one deliberate exception: `packages/*/vendor/` carries the site
  runner cores these two packages import (15 files for the CLI, 2 for
  local-tools), because without them the packages could not be rebuilt or
  re-tested here. The `packages/cli` bundle also inlines compiled copies of the
  same cores, since it is the artifact prepared for a future `@toolars/cli` npm release. Both are
  covered by this repository's MIT license;
- runtime assets (WASM engines, OCR language packs, fonts, PDF.js);
- internal engineering, product, and audit documentation;
- any deployment configuration, credentials, or analytics configuration.

That boundary is the point: the harness verifies **the deployed site**, so
independent verification does not require the site's source. See
`evidence-harness/README.md` for exactly what the harness does and does not
prove.

## Verifying the local-processing claim yourself

```bash
cd evidence-harness
npm install
npx playwright install chromium
npm run verify -- --base-url https://toolars.com
```

The run writes `privacy-proof-receipt.json` and exits non-zero if an unexpected request leaves the site's origin, if any request carries the
canary marker, or if any request uploads data. Disclosed shell requests are counted
separately. A missing or changing release identity also prevents a verified result.

Both packages remain private and unpublished on npm.

## Running the CLI and MCP server

```bash
cd packages/cli
node dist/cli.mjs hash --sha256 "hello"
node dist/mcp.mjs   # stdio MCP server
```

`dist/` is committed and copied from the private build output, so
running it needs no install and no build. Review that bundle if you want to see
the code you would actually execute: it is unminified, and its section comments
name the source file each part came from.

You can also rebuild it here and re-run the same test vectors the private
workspace runs. Each package carries the exact site core closure it depends on
under `vendor/`, so neither needs the private repository:

```bash
cd packages/cli
npm install          # esbuild + vitest, declared as devDependencies
npm run build        # writes dist/ from src/ plus vendor/
npm test             # shared digest vectors and CLI/MCP boundary tests
```

```bash
cd packages/local-tools
npm install          # esbuild + prettier
node build.mjs       # regenerates src/json-core.mjs from vendor/
node --test test/*.test.mjs
```

`vendor/` holds copies of the site runner cores these packages import, produced
by the exporter and byte-identical to the private ones. They are published as
source on purpose: a reader who can rebuild the package and re-run its vectors
can check the results instead of trusting them. Rebuilding in the exported layout changes source-path comments in the CLI
bundles and local-tools generated core. Compare executable content separately
from these comments; a rebuild is not claimed to reproduce the original
manifest byte for byte.

Both packages are local-stdio only. Their inputs and results enter the calling
client's context and may reach that client's model provider; the website's
privacy promise does not extend to the client. Each package's README states
this scope.

## Reporting a problem with this code

Open an issue on the public repository. Security reports follow the process in
that repository's `SECURITY.md`.

## License

MIT — see `LICENSE`. Scope and third-party components: `THIRD-PARTY.md` and
`evidence-harness/fixtures/PROVENANCE.md`.
