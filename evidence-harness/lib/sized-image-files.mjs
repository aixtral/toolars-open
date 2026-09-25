/**
 * Exact-size synthetic image file builders shared by the benchmark harness
 * (../benchmark-tools.mjs) and the privacy-proof capture script
 * (../capture-privacy-proof.mjs).
 *
 * Every builder returns a genuinely decodable file whose byte length is
 * exactly the requested target (or the format's minimum footprint when the
 * target is below it). A canary string can ride along in a PNG tEXt chunk or
 * an SVG comment so network listeners can prove the bytes never left the
 * device.
 */

import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** zlib stream length for store-level (level 0) deflate of `rawBytes`. */
function storedZlibBytes(rawBytes) {
  const blocks = Math.max(1, Math.ceil(rawBytes / 65535));
  return 2 + 5 * blocks + 4 + rawBytes;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Builds a decodable truecolor PNG whose byte length is exactly
 * `targetBytes`: random pixel rows at store-level deflate make the file
 * grow ~1:1 with pixel data, and a tEXt ancillary chunk pads (or carries
 * the canary marker) to the exact byte count. Filter bytes stay 0 so every
 * row decodes as raw RGB.
 */
export function makeSizedNoisePng(targetBytes, canary = "") {
  const width = 2048;
  const rowBytes = 1 + 3 * width; // filter byte + RGB8 pixel triplets
  const fixedBytes = 8 + 25 + 12 + 12; // signature + IHDR + IDAT framing + IEND
  const textChunkShell = 12 + 7 + 1; // chunk framing + "Comment" keyword + NUL

  // Height search: stored-deflate overhead depends on the raw row bytes.
  let height = Math.max(
    1,
    Math.floor((targetBytes - fixedBytes - 11 - textChunkShell - 1) / rowBytes),
  );
  for (let pass = 0; pass < 3; pass += 1) {
    const rawBytes = height * rowBytes;
    const overhead = storedZlibBytes(rawBytes) - rawBytes;
    const next = Math.max(
      1,
      Math.floor(
        (targetBytes - fixedBytes - overhead - textChunkShell - 1) / rowBytes,
      ),
    );
    if (next === height) break;
    height = next;
  }

  for (;;) {
    const rawBytes = height * rowBytes;
    const total = fixedBytes + storedZlibBytes(rawBytes) + textChunkShell + 1;
    if (total <= targetBytes || height === 1) break;
    height -= 1;
  }

  const rawBytes = height * rowBytes;
  const raw = Buffer.alloc(rawBytes);
  let state = (0x9e3779b9 ^ targetBytes) >>> 0;
  for (let row = 0; row < height; row += 1) {
    const start = row * rowBytes;
    raw[start] = 0; // filter: None
    for (let offset = start + 1; offset < start + rowBytes; offset += 4) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      raw.writeUInt32LE(state, offset);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  const idat = deflateSync(raw, { level: 0 });

  // The padding comment lands the file on exactly targetBytes; a canary run
  // swaps the padding for the marker itself (the file then shrinks by the
  // padding delta, which callers record as the attempt's actual size).
  const padLength = Math.max(
    1,
    targetBytes - fixedBytes - idat.length - textChunkShell,
  );
  const text = Buffer.concat([
    Buffer.from("Comment\0", "ascii"),
    Buffer.from(canary || "a".repeat(padLength), "utf8"),
  ]);

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("tEXt", text),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Builds a decodable SVG whose byte length is exactly `targetBytes`. */
export function makeSizedSvg(targetBytes, canary = "") {
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#3366cc"/></svg>';
  const marker = canary ? ` ${canary}` : "";
  const shell = 4 + marker.length + 3; // "<!--" + marker + "-->"
  const pad = Math.max(0, targetBytes - Buffer.byteLength(markup) - shell);
  return Buffer.from(`${markup}<!--${marker}${"a".repeat(pad)}-->`, "utf8");
}
