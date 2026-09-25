# Toolars evidence harness

A runnable check for one specific claim: **when you use a Toolars tool, your
file is processed in your own browser and is not uploaded.** It drives the
public site in headless Chromium, records every network request, and fails if
anything crosses the site's origin or carries a marker that was embedded in the
input file.

You do not need Toolars' source code to run this. It verifies the deployed
site, which is the thing the claim is about.

## Requirements

- Node.js `>=24.15.0 <25`
- Chromium (installed by Playwright, ~150 MB)

## Run it

```bash
npm install
npx playwright install chromium

# Against the public site (default):
npm run verify

# Against a local or preview build:
npm run verify -- --base-url http://127.0.0.1:9608
```

Options:

| Flag               | Default                      | Meaning                                       |
| ------------------ | ---------------------------- | --------------------------------------------- |
| `--base-url <url>` | `https://toolars.com`        | Target origin. `BASE_URL` env var also works. |
| `--out <path>`     | `privacy-proof-receipt.json` | Where the run receipt is written.             |

Exit code is `0` only when every scenario passed. The receipt is written even
on failure so you can inspect what crossed the boundary.

## What it actually does

Four scenarios, each in a fresh browser context with **service workers
blocked**:

| Scenario id               | Tool                                | What is driven                                                                                                                              |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `image-tool-convert`      | Image Format Converter              | PNG → JPEG conversion **plus download**, twice: a warm-up run, then a measured run on a file whose bytes contain a random canary string     |
| `image-tool-heic-convert` | Image Format Converter (HEIC input) | HEIC → JPEG twice: the first run fetches the lazy ~3.3 MB libheif decoder, the measured run must issue **zero** requests                    |
| `ocr-language-pack`       | Image to Text (OCR)                 | English OCR, then English + Simplified Chinese; language packs must arrive only from the site's origin, and the recognized text is asserted |
| `pdf-tool-rotate`         | PDF Rotator                         | Load the bundled sample, rotate, download                                                                                                   |

Then it asserts that across every measured window:

1. `uploadRequests === 0` — no request carried a body and no non-`GET`/`HEAD`/`OPTIONS` method was used;
2. `canaryLeaks === 0` — the canary string never appeared in any URL or request body;
3. `unexpectedCrossOriginRequests === 0` — no request went to a host outside the
   target origin, **except** the site's own disclosed analytics proxy (see
   below);
4. the HEIC decoder assets were same-origin only, and the OCR text matched.

Uploads and canary leaks are fatal **regardless of host** — the disclosed
exception below applies only to the cross-origin count.

The canary is the strongest of these. The input file's bytes literally contain
a random string; if the file were uploaded, that string would appear in a
request. It appearing nowhere is direct evidence that the bytes stayed put.

## Reading the receipt

```jsonc
{
  "schemaVersion": 1,
  "capturedAt": "2026-09-25",
  "environment": { "browser": "Chromium <version> (headless)", "baseUrl": "https://toolars.com", ... },
  "harness": { "script": "...", "trace": "<sha256 of this script>" },
  "scenarios": [
    {
      "id": "image-tool-convert",
      "window": "…what was measured, in words…",
      "totalRequests": 0, "sameOriginRequests": 0, "crossOriginRequests": 0,
      "disclosedShellRequests": 0, "unexpectedCrossOriginRequests": 0,
      "unexpectedHosts": [],
      "uploadRequests": 0, "canaryLeaks": 0, "thirdPartyHosts": [],
      "requests": []          // method/host/path/resourceType only — never bodies
    }
  ]
}
```

The receipt contains request **metadata only**: method, host, path, resource
type, and whether a body was present. It never records file contents, request
bodies, or response bodies.

## One disclosed exception: the site's own analytics proxy

The live site loads a cookieless page-view analytics script from
`track.toolars.com`, its own first-party proxy. The site publishes that host —
with every other external host the shell can reach — on
<https://toolars.com/privacy-proof>. Because a measured window is about what a
**tool** does with your file, a request to that host is:

- **counted** (`disclosedShellRequests`) and shown in the receipt;
- **named** in `thirdPartyHosts`;
- but **not** treated as a failure by itself.

Everything else still fails: any request to an undisclosed host
(`unexpectedCrossOriginRequests`), any request with a body, and any request
carrying the canary. If a run reports a host that is not on the site's
published list, that is a real finding — please open an issue.

Recognition that this exception exists is honest bookkeeping, not a loophole:
the site already tells you the host is there.

## Failure behaviour, and the one distinction that matters

A run has exactly one of four outcomes, and all but the first exit non-zero:

| `outcome`                | Meaning                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `verified`               | Every scenario completed and nothing left the device. Exit `0`.                                                               |
| `violation`              | A scenario completed and data crossed the boundary — an upload, a canary leak, or a request to an undisclosed host.           |
| `inconclusive`           | One or more scenarios could not be completed (transport failure, timeout). **This run proves nothing about them either way.** |
| `violation+inconclusive` | Both.                                                                                                                         |

`inconclusive` is never folded into `violation`. A dropped connection is not
evidence that your file was uploaded, and a tool that says otherwise is worse
than useless: it would hand you a false alarm about the one thing it exists to
measure. Both outcomes still exit non-zero, because a run that did not verify
the claim has not passed.

The receipt carries the structured `violations` and `unavailable` lists, so you
can see which happened without reading terminal scrollback. A failing run also
exits promptly and closes the browser — it never hangs.

## Receipts

`receipts/` holds verbatim run outputs, newest first, with a README explaining
each one. The included receipt is the operator's own run and is labelled as
such; it is not independent verification.

## What this does **not** prove

Stated plainly, because a verification tool that oversells itself is worse than
none:

- **Only four scenarios, not 102 tools.** Absence of evidence for the other 98
  tools is not a result about them. Extend `--scenarios` only by adding code.
- **Not every input type or edge case** within these four tools (unusual
  encodings, corrupt files, very large files, cancellation paths).
- **Not a statement about the site shell.** It measures tool workspaces. The
  header search, the newsletter form, account sync, and the page-view analytics
  request are outside these windows; the site's own `/privacy-proof` page lists
  every external host the shell can reach.
- **Not a check of Content-Security-Policy or SRI**, because the site does not
  send a site-wide CSP. The harness measures requests; it does not enforce
  policy.
- **Not a security audit or certification.** It is one behavioural observation,
  on one browser build, on one date.
- **Service workers are blocked**, so repeat asset loads are served from the
  browser's HTTP cache and therefore produce zero recorded requests. This is
  what isolates "did this action talk to the network" from background caching
  behaviour — but it is a deliberate experimental condition, so a run with
  service workers enabled would look different.

## Why it runs against the live site

A harness pointed at the deployed origin cannot silently diverge from what
users actually receive. Pointing it at a local build, as the project's internal
capture does, is easier to run in CI but proves less. If you get a different
result than a previous receipt, that is the finding — please open an issue with
the receipt attached.

## Layout

```
capture-privacy-proof.mjs   the harness
lib/sized-image-files.mjs   builds exact-size synthetic PNGs (zlib only)
fixtures/PROVENANCE.md      provenance of the bundled HEIC test image
fixtures/heic/gradient-96x64.heic
```

## License

MIT — see `../LICENSE`.

## Release identity

Every run records the response's `X-Toolars-Release` before and after capture and
on each measured tool navigation. Missing identity or different revisions makes
the result inconclusive. `release.revision` identifies the tested deployment;
it is never taken from the local checkout. This four-scenario network capture
does not validate all tools or offline operation.
