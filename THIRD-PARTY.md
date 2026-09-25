# Scope and third-party components

## What this license covers

`LICENSE` (MIT) applies to the files in this repository: the evidence harness
under `evidence-harness/`, and the two Node packages `@toolars/cli` and
`@toolars/local-tools`.

That includes two things worth naming. `packages/cli/dist/` is a prebuilt
bundle that inlines compiled copies of the website runner cores the CLI reuses,
because it is the same artifact prepared for a future `@toolars/cli` npm release.
`packages/*/vendor/` holds the source form of those cores — the exact closure
each package needs to rebuild and re-test itself here. Both are covered.

It does **not** cover the Toolars website itself — its application code, tool
implementations, Web Workers, editorial content, localized content sets, or
runtime assets. Those remain separate, and apart from the `vendor/` closures
above are not part of this distribution.

## Third-party components

- The evidence harness depends on Playwright (`@playwright/test`, Apache-2.0).
  Playwright is installed from npm and is not vendored here.
- `evidence-harness/fixtures/heic/gradient-96x64.heic` is a 635-byte synthetic
  96×64 test image. Its provenance is documented, including what is _not_
  known, in `evidence-harness/fixtures/PROVENANCE.md`.
- The two Node packages have no runtime dependencies. Their `package.json`
  files declare `license: MIT`.

## No warranty

Everything in this repository is provided as-is, without warranty of any kind.
