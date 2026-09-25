import { describe, expect, it } from "vitest";

import {
  HASH_TOOL_DEFINITIONS,
  HASH_TOOL_SLUGS,
} from "@/features/tool-runtime/hash/definitions";
import { validateIdentifier } from "@/features/tool-runtime/identifier/identifier";
import { parseJwtJson } from "@/features/tool-runtime/jwt/inspection";

import {
  HASH_ALGORITHMS,
  base64Transform,
  cronExplain,
  decodeJwtToken,
  generateIdentifiersOp,
  hashSha256,
  hashText,
  timestampConvert,
  urlTransform,
  type HashAlgorithm,
} from "./core";

// Parity vectors are copied from the website runtime test suites so the CLI
// provably behaves like the live tools on toolars.com:
// - hash: src/features/tool-runtime/hash/executor.test.ts (ABC_DIGESTS)
// - base64: src/features/tool-runtime/base64/executor.test.ts
// - jwt: src/features/tool-runtime/jwt/inspection.test.ts
// - uuid/ulid: src/features/tool-runtime/identifier/identifier.test.ts
// - timestamp/cron: src/features/tool-runtime/time-tools/*.test.ts
// - url: src/features/tool-runtime/text/executor.test.ts

describe("hashSha256", () => {
  it("matches the site sha256-hash-checker vectors", () => {
    // Site executor.test.ts "abc" digest.
    expect(hashSha256("abc")).toEqual({
      ok: true,
      data: {
        algorithm: "sha256",
        digest:
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        inputByteLength: 3,
      },
    });
    // Site "hashes Unicode as UTF-8" test vector.
    expect(hashSha256("你好")).toMatchObject({
      ok: true,
      data: {
        digest:
          "670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e",
        inputByteLength: 6,
      },
    });
  });

  it("hashes the empty string, matching @toolars/local-tools sha256Text", () => {
    expect(hashSha256("")).toMatchObject({
      ok: true,
      data: {
        digest:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        inputByteLength: 0,
      },
    });
  });

  it("rejects unpaired surrogates like the site runtime", () => {
    expect(hashSha256("\ud800")).toEqual({
      ok: false,
      code: "INVALID_UNICODE_INPUT",
    });
  });
});

describe("hashText parity with the website hash tools", () => {
  // The site executor writes the same six digests for the input "abc"; see
  // src/features/tool-runtime/hash/executor.test.ts (ABC_DIGESTS).
  const ABC_DIGESTS: Record<HashAlgorithm, string> = {
    md5: "900150983cd24fb0d6963f7d28e17f72",
    sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
    sha224: "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7",
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    sha384:
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    sha512:
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
  };

  it("covers exactly the algorithms the website ships, with matching digests", () => {
    // Derived from the catalog rather than hardcoded, so adding or removing a
    // hash tool on the website fails here until the CLI follows.
    const siteAlgorithms = HASH_TOOL_SLUGS.map(
      (slug) => HASH_TOOL_DEFINITIONS[slug].algorithm,
    );
    expect([...HASH_ALGORITHMS].sort()).toEqual([...siteAlgorithms].sort());

    for (const slug of HASH_TOOL_SLUGS) {
      const definition = HASH_TOOL_DEFINITIONS[slug];
      expect(
        hashText(definition.sampleInput, definition.algorithm),
        `${slug} sample digest`,
      ).toEqual({
        ok: true,
        data: {
          algorithm: definition.algorithm,
          digest: definition.sampleDigest,
          inputByteLength: new TextEncoder().encode(definition.sampleInput)
            .byteLength,
        },
      });
    }
  });

  it("matches the site executor vectors for every algorithm", () => {
    for (const algorithm of HASH_ALGORITHMS) {
      expect(hashText("abc", algorithm), algorithm).toEqual({
        ok: true,
        data: {
          algorithm,
          digest: ABC_DIGESTS[algorithm],
          inputByteLength: 3,
        },
      });
    }
  });

  it("defaults to sha256 and shares its input validation", () => {
    expect(hashText("Toolars")).toEqual(hashText("Toolars", "sha256"));
    expect(hashText("\ud800", "sha512")).toEqual({
      ok: false,
      code: "INVALID_UNICODE_INPUT",
    });
  });
});

describe("base64Transform (reuses the site base64 executor core)", () => {
  it("encodes RFC 4648 vectors", () => {
    expect(base64Transform("", "encode", false)).toEqual({
      ok: true,
      data: { value: "" },
    });
    expect(base64Transform("f", "encode", false)).toEqual({
      ok: true,
      data: { value: "Zg==" },
    });
    expect(base64Transform("fo", "encode", false)).toEqual({
      ok: true,
      data: { value: "Zm8=" },
    });
    expect(base64Transform("foo", "encode", false)).toEqual({
      ok: true,
      data: { value: "Zm9v" },
    });
    expect(base64Transform("foob", "encode", false)).toEqual({
      ok: true,
      data: { value: "Zm9vYg==" },
    });
    expect(base64Transform("fooba", "encode", false)).toEqual({
      ok: true,
      data: { value: "Zm9vYmE=" },
    });
    expect(base64Transform("foobar", "encode", false)).toEqual({
      ok: true,
      data: { value: "Zm9vYmFy" },
    });
  });

  it("round-trips the site test string with BOM and combining marks", () => {
    const value = "\ufeff中文Cafe\u0301 🧪\0";
    const encoded = base64Transform(value, "encode", false);
    expect(encoded.ok).toBe(true);
    expect((encoded as { data: { value: string } }).data.value).toBe(
      Buffer.from(value, "utf8").toString("base64"),
    );
    expect(
      base64Transform(
        (encoded as { data: { value: string } }).data.value,
        "decode",
        false,
      ),
    ).toEqual({ ok: true, data: { value } });
  });

  it("normalizes line breaks to spaces, matching the site's default option", () => {
    expect(base64Transform("a\r\nb", "encode", false)).toEqual({
      ok: true,
      data: { value: Buffer.from("a b", "utf8").toString("base64") },
    });
  });

  it("uses the URL-safe alphabet and strips padding", () => {
    // U+FFFF encodes to UTF-8 bytes ef bf bf, whose standard Base64 is "77+/".
    expect(base64Transform("￿", "encode", false)).toEqual({
      ok: true,
      data: { value: "77+/" },
    });
    expect(base64Transform("￿", "encode", true)).toEqual({
      ok: true,
      data: { value: "77-_" },
    });
    expect(base64Transform("77-_", "decode", true)).toEqual({
      ok: true,
      data: { value: "￿" },
    });
  });

  it("rejects malformed input with the site's stable error codes", () => {
    expect(base64Transform("AB==", "decode", false)).toEqual({
      ok: false,
      code: "INVALID_BASE64_PADDING",
    });
    expect(base64Transform("Z g==", "decode", false)).toEqual({
      ok: false,
      code: "INVALID_BASE64_CHARACTERS",
    });
    expect(base64Transform("/w==", "decode", false)).toEqual({
      ok: false,
      code: "INVALID_UTF8_BASE64",
    });
    expect(base64Transform("\ud800", "encode", false)).toEqual({
      ok: false,
      code: "INVALID_UNICODE_INPUT",
    });
  });
});

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("decodeJwtToken (reuses the site jwt inspection core)", () => {
  const header = base64UrlJson({ alg: "none", typ: "JWT" });
  const payload = base64UrlJson({ sub: "user-1", exp: 2_000_000_000 });
  const token = `${header}.${payload}.`;

  it("parses header and payload without verifying the signature", () => {
    const result = decodeJwtToken(token, new Date("2024-01-01T00:00:00Z"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.header).toEqual({ alg: "none", typ: "JWT" });
    expect(result.data.payload).toEqual({ sub: "user-1", exp: 2_000_000_000 });
    expect(result.data.verified).toBe(false);
    expect(result.data.times.claims).toMatchObject([
      { claim: "exp", state: "active", seconds: 2_000_000_000 },
      { claim: "nbf", state: "missing" },
      { claim: "iat", state: "missing" },
    ]);
  });

  it("flags expired tokens", () => {
    const expired = `${header}.${base64UrlJson({ exp: 1_000_000_000 })}.sig`;
    const result = decodeJwtToken(expired, new Date("2024-01-01T00:00:00Z"));
    expect(result.ok && result.data.times.claims[0]).toMatchObject({
      claim: "exp",
      state: "expired",
    });
  });

  it("rejects malformed tokens with stable codes", () => {
    expect(decodeJwtToken("")).toEqual({ ok: false, code: "EMPTY_TOKEN" });
    expect(decodeJwtToken("not-a-jwt")).toEqual({
      ok: false,
      code: "INVALID_TOKEN",
    });
    expect(decodeJwtToken(`${header}.${payload}`)).toEqual({
      ok: false,
      code: "INVALID_TOKEN",
    });
    const garbage = `${header}.eyJnotbase64.sig`;
    expect(decodeJwtToken(garbage)).toEqual({
      ok: false,
      code: "INVALID_TOKEN",
    });
  });

  it("inherits the site's JSON number-safety guarantees", () => {
    expect(() => parseJwtJson('{"n":9007199254740993}')).toThrow(
      "JSON_NUMBER_UNSAFE",
    );
  });
});

describe("generateIdentifiersOp (reuses the site identifier core)", () => {
  const zeroRandom = (length: number) => new Uint8Array(length);

  it("produces deterministic RFC 9562 UUIDv4 with an injected random source", () => {
    expect(
      generateIdentifiersOp("uuid-v4", 1, { randomBytes: zeroRandom }),
    ).toEqual({
      ok: true,
      data: {
        format: "uuid-v4",
        values: ["00000000-0000-4000-8000-000000000000"],
      },
    });
  });

  it("produces deterministic UUIDv7 and ULID with injected clock and random", () => {
    const v7 = generateIdentifiersOp("uuid-v7", 2, {
      now: () => 0,
      randomBytes: zeroRandom,
    });
    expect(v7).toEqual({
      ok: true,
      data: {
        format: "uuid-v7",
        values: [
          "00000000-0000-7000-8000-000000000000",
          "00000000-0000-7000-8000-000000000001",
        ],
      },
    });
    expect(
      generateIdentifiersOp("ulid", 1, {
        now: () => 0,
        randomBytes: zeroRandom,
      }),
    ).toEqual({
      ok: true,
      data: { format: "ulid", values: ["00000000000000000000000000"] },
    });
  });

  it("generates identifiers the site validator accepts", () => {
    const v4 = generateIdentifiersOp("uuid-v4", 3);
    expect(v4.ok).toBe(true);
    if (!v4.ok) return;
    for (const value of v4.data.values) {
      expect(validateIdentifier(value)).toMatchObject({
        valid: true,
        kind: "uuid",
        version: 4,
      });
    }
    const ulid = generateIdentifiersOp("ulid", 1);
    expect(ulid.ok && validateIdentifier(ulid.data.values[0]!)).toMatchObject({
      valid: true,
      kind: "ulid",
    });
  });

  it("rejects invalid batch counts with the site error code", () => {
    expect(generateIdentifiersOp("uuid-v4", 0)).toEqual({
      ok: false,
      code: "INVALID_BATCH_COUNT",
    });
    expect(generateIdentifiersOp("ulid", 101)).toEqual({
      ok: false,
      code: "INVALID_BATCH_COUNT",
    });
  });
});

describe("timestampConvert (reuses the site timestamp core)", () => {
  it("converts Unix seconds with the site defaults (UTC)", () => {
    const result = timestampConvert("0", { outputTimeZone: "UTC" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      instantMs: 0,
      unixSeconds: "0",
      unixMilliseconds: 0,
      iso: "1970-01-01T00:00:00.000Z",
      detectedMode: "seconds",
      autoDetected: true,
    });
  });

  it("converts Unix milliseconds", () => {
    const result = timestampConvert("1000000000000", { outputTimeZone: "UTC" });
    expect(result.ok && result.data.iso).toBe("2001-09-09T01:46:40.000Z");
    expect(result.ok && result.data.detectedMode).toBe("milliseconds");
  });

  it("converts ISO 8601 input", () => {
    const result = timestampConvert("2024-01-02T03:04:05Z", {
      outputTimeZone: "UTC",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.unixSeconds).toBe("1704164645");
    expect(result.data.iso).toBe("2024-01-02T03:04:05.000Z");
  });

  it("surfaces the site's stable error codes", () => {
    expect(timestampConvert("not-a-time", { outputTimeZone: "UTC" })).toEqual({
      ok: false,
      code: "INVALID_TIMESTAMP",
    });
    expect(timestampConvert("", { outputTimeZone: "UTC" })).toEqual({
      ok: false,
      code: "EMPTY_TIMESTAMP",
    });
  });
});

describe("cronExplain (reuses the site cron core)", () => {
  const startMs = Date.parse("2024-01-01T00:00:00.000Z");

  it("explains */15 * * * * like the site cron-builder-explainer", () => {
    const result = cronExplain("*/15 * * * *", {
      count: 3,
      timeZone: "UTC",
      startMs,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.normalized).toBe("*/15 * * * *");
    expect(result.data.fields).toMatchObject([
      { field: "minute", source: "*/15", values: [0, 15, 30, 45] },
      {
        field: "hour",
        source: "*",
        values: [
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
          20, 21, 22, 23,
        ],
      },
      {
        field: "day",
        source: "*",
        values: [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
          21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
        ],
      },
      {
        field: "month",
        source: "*",
        values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      },
      { field: "weekday", source: "*", values: [0, 1, 2, 3, 4, 5, 6] },
    ]);
    expect(result.data.nextRuns.map((run) => run.iso)).toEqual([
      "2024-01-01T00:15:00.000Z",
      "2024-01-01T00:30:00.000Z",
      "2024-01-01T00:45:00.000Z",
    ]);
    expect(result.data.complete).toBe(true);
    expect(result.data.dayMode).toBe("and");
  });

  it("supports named months, weekdays, and ranges", () => {
    const result = cronExplain("30 9 * JAN MON-FRI", {
      count: 2,
      timeZone: "UTC",
      startMs,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fields).toMatchObject([
      { field: "minute", values: [30] },
      { field: "hour", values: [9] },
      {
        field: "day",
        values: [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
          21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
        ],
      },
      { field: "month", values: [1] },
      { field: "weekday", values: [1, 2, 3, 4, 5] },
    ]);
  });

  it("rejects invalid expressions with the site's stable error codes", () => {
    expect(
      cronExplain("61 * * * *", { count: 5, timeZone: "UTC", startMs }),
    ).toEqual({ ok: false, code: "INVALID_CRON_FIELD" });
    expect(
      cronExplain("* * * *", { count: 5, timeZone: "UTC", startMs }),
    ).toEqual({ ok: false, code: "INVALID_CRON_FIELD_COUNT" });
  });
});

describe("urlTransform (reuses the site url-encoder-decoder core)", () => {
  it("encodes components like encodeURIComponent", () => {
    expect(urlTransform("a b&c=1", "encode-component")).toEqual({
      ok: true,
      data: { value: "a%20b%26c%3D1" },
    });
    expect(urlTransform("https://x.com/a b?x=1&y=2", "encode-uri")).toEqual({
      ok: true,
      data: { value: "https://x.com/a%20b?x=1&y=2" },
    });
  });

  it("decodes percent-encoded UTF-8", () => {
    expect(urlTransform("%E4%BD%A0%E5%A5%BD", "decode-component")).toEqual({
      ok: true,
      data: { value: "你好" },
    });
  });

  it("rejects malformed escapes with the site error code", () => {
    expect(urlTransform("%ZZ", "decode-component")).toEqual({
      ok: false,
      code: "MALFORMED_URL_ENCODING",
    });
  });
});
