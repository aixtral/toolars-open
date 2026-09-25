# Toolars open-source distribution

This directory is the source of truth for the code Toolars publishes publicly.
It is assembled into a distributable tree by `scripts/export-open-source.mjs`
in the private repository; nothing here is built or bundled into the website.

## What is published

| Path                    | What it is                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evidence-harness/`     | A runnable harness that drives the **public website** in headless Chromium and records every network request, including dedicated Web Worker fetches. It is the tool behind the claim that files never leave the browser. |
| `packages/cli/`         | `@toolars/cli` — a local stdio CLI and MCP server (hash, base64, JWT decode, UUID/ULID, timestamp, cron, URL encode/decode).                                                                                              |
| `packages/local-tools/` | `@toolars/local-tools` — a smaller local stdio CLI and MCP server (JSON formatting, SHA-256).                                                                                                                             |

All of it is MIT-licensed (see `LICENSE`). `THIRD-PARTY.md` states the exact
scope and lists third-party components.

## What is deliberately _not_ published

This is an **open-core** distribution, not the whole product. Not included:

- the website application (routing, SEO layer, catalog, editorial content, the
  13 localized content sets);
- the tool implementations and Web Workers that the website ships;
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

The run writes `privacy-proof-receipt.json` and exits non-zero if any request
left the site's origin, if any request carried the canary marker, or if any
request uploaded data.

## Running the CLI and MCP server

```bash
cd packages/cli
npm install && npm run build
node dist/cli.mjs hash --sha256 --text "hello"
node dist/mcp.mjs   # stdio MCP server
```

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
