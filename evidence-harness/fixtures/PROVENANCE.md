# Fixture provenance

## `heic/gradient-96x64.heic`

- **What it is:** a 635-byte HEIF image, 96×64, HEVC Main Still Picture profile,
  containing a synthetic gradient. It is used by the `image-tool-heic-convert`
  scenario to exercise the lazy libheif decoder path.
- **Where it came from:** **generated programmatically inside the Toolars
  repository.** The generation method is recorded in the two specs that consume
  the fixture: `tests/e2e/heic-convert.spec.ts` and
  `src/features/tool-runtime/image-local/heic/libheif-decode.test.ts` both state
  that the fixtures are "synthetic images produced programmatically … a 96×64
  gradient and the repo's own JPEG fixture with an injected EXIF orientation,
  both encoded to HEIC with the platform HEVC encoder — no third-party content".
- **Corroborating inspection** (performed when this file was published, because
  the provenance statement lives in the specs rather than next to the fixture):
  the file carries no camera maker note, no encoder or software signature, no
  copyright field, and no `Exif` box at all; its `mdat` is only 210 bytes, which
  is what a flat gradient compresses to; its `ispe` box reports 96×64. A
  third-party photograph could not look like this.
- **Rights status:** project-generated, no third-party content. Toolars
  contributors' own file.

## `heic/exif-orientation-6.heic`

- **What it is:** a 6,192-byte HEIF image carrying an `Exif` box with orientation
  value 6 plus a container-level `irot`, used to verify that decode applies
  rotation.
- **Where it came from:** the same programmatic path — **the repository's own
  JPEG fixture with an injected EXIF orientation**, re-encoded to HEIC with the
  platform HEVC encoder (see the two spec headers named above).
- **Corroborating inspection:** the embedded `Exif` box and `irot` are present
  and no encoder, camera, or copyright string accompanies them.
- **Rights status:** project-generated from the repo's own JPEG fixture.
- **Note:** this fixture is _not_ part of the public distribution. The published
  harness ships only `gradient-96x64.heic`, because only that one is used by the
  HEIC scenario. See `scripts/export-open-source.mjs`.

## Generated at run time (not fixtures, not committed)

- `lib/sized-image-files.mjs` builds exact-size synthetic PNG and SVG files in
  memory (PNG via `node:zlib` only). The canary marker used by the measured
  windows is embedded into a PNG `tEXt` chunk or an SVG comment by that module.
- The OCR scenario does not read an image file at all: it draws its English and
  Simplified Chinese samples onto a canvas inside the page under test.

## Third-party dependencies

- `@playwright/test` — Apache-2.0, installed from npm, not vendored here.
