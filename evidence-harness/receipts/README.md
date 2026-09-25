# Run receipts

Each file here is the verbatim JSON output of one harness run, named
`<date>-<target>.json`. Nothing in a receipt is edited; if a field is wrong,
the fix is a new run, not a modified file.

A receipt records request **metadata only** — method, host, path, resource
type, and whether a body was present. It never records file contents, request
bodies, or response bodies.

## How to read a receipt

`outcome` is the headline and it has exactly four values:

| `outcome`                | Meaning                                                                                                                                | Exit code |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `verified`               | Every scenario completed and nothing left the device.                                                                                  | `0`       |
| `violation`              | A scenario completed and something crossed the boundary: an upload, a canary leak, or a request to an undisclosed host.                | non-zero  |
| `inconclusive`           | One or more scenarios **could not be completed** (transport failure, timeout). This run proves nothing about them in either direction. | non-zero  |
| `violation+inconclusive` | Both of the above.                                                                                                                     | non-zero  |

`inconclusive` is deliberately not folded into `violation`. A network failure
is not evidence that data left your browser, and reporting it as such would be
the most damaging mistake this tool could make. Both still exit non-zero: a run
that did not verify the claim has not passed.

`violations` and `unavailable` are the structured lists behind that outcome, so
a receipt says exactly what happened without you having to read terminal
scrollback.

## `2026-09-25-live.json`

- **Target:** `https://toolars.com`, live production, release `f3319aba22ef976e`.
- **Produced by:** the operator, 2026-09-25, running **this distribution's own
  `capture-privacy-proof.mjs`** — not an internal variant.
- **`outcome`:** `verified`. Four scenarios; every measured window showed
  **0 upload requests, 0 canary leaks, 0 cross-origin requests**. The only
  requests recorded were three same-origin ones in the OCR window: the engine
  worker, the WASM core, and the English language pack.
- **Provenance is checkable.** The receipt's `harness.trace` is the SHA-256 of
  the script that produced it:
  `94dfaeabaf0ccf0ce211add8cd08bf41839fbe2693f4395d4ea6af69f9fa9cec`.
  Receipt SHA-256:
  `3a9e6d991afac3362e9b6da53cb16a8242f79b625bcb25996971cf4288b98b62`.
  Recompute the script hash before trusting the receipt; if the script has
  changed since, the receipt describes the older code.
- **Stability is NOT established.** Seven runs were attempted from the
  publishing machine while the harness was being hardened; four failed with
  `net::ERR_CONNECTION_CLOSED`, a transport-level failure on that local network
  path — not a boundary violation and not a fault of the site. The same
  transient TLS/connection noise is documented in the project's own earlier
  HTTP audit. Treat this file as one successful observation, not as a
  reliability claim.
- **What it is not:** independent verification. It is the same party that runs
  the site measuring its own site. It is published because a receipt showing
  exactly what the tool measures, and what it found, is more useful than a
  claim.

**The first _independent_ receipt is the one that matters**, and it has to come
from someone who is not us. If your run produces a different outcome — a
cross-origin host we have not disclosed, an upload, or a canary leak — that is
the finding. Open an issue with the receipt attached.
