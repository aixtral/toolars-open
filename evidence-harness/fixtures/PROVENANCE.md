# Fixture provenance

## `heic/gradient-96x64.heic`

- **What it is:** a 635-byte HEIF image, 96×64, HEVC Main Still Picture profile,
  containing a synthetic gradient. It is used by the `image-tool-heic-convert`
  scenario to exercise the lazy libheif decoder path.
- **Where it came from:** committed to the private Toolars repository on
  2026-09-20 as a test fixture. The repository does not record how it was
  produced.
- **Rights status:** believed to be project-generated (synthetic gradient,
  no identifiable subject, no metadata). **This has not been documented, and
  documenting it is a release gate** — see `docs/operations/open-source-release-runbook-2026-09-25.md`,
  gate G3.
- **If provenance cannot be confirmed:** delete this file and make the HEIC
  scenario opt-in, taking the file from the operator instead. Publishing a
  binary whose rights you cannot account for is a small mistake with
  disproportionate consequences for a project whose whole pitch is verifiable
  honesty.

## Generated at run time (not fixtures, not committed)

- `lib/sized-image-files.mjs` builds exact-size synthetic PNG and SVG files in
  memory (PNG via `node:zlib` only). The canary marker used by the measured
  windows is embedded into a PNG `tEXt` chunk or an SVG comment by that module.
- The OCR scenario does not read an image file at all: it draws its English and
  Simplified Chinese samples onto a canvas inside the page under test.

## Third-party dependencies

- `@playwright/test` — Apache-2.0, installed from npm, not vendored here.
