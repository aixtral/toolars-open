import { createHash } from "node:crypto";

import { transformBase64Value } from "@/features/tool-runtime/base64/executor";
import {
  decodeJwtSegment,
  inspectJwtTimes,
  type JwtTimeReport,
} from "@/features/tool-runtime/jwt/inspection";
import {
  IdentifierError,
  generateIdentifiers,
  type IdentifierGenerationDependencies,
} from "@/features/tool-runtime/identifier/identifier";
import { calculateCron } from "@/features/tool-runtime/time-tools/cron";
import type {
  CronOutput,
  TimeZoneOption,
  TimestampOutput,
} from "@/features/tool-runtime/time-tools/definitions";
import { isTimeToolRuntimeError } from "@/features/tool-runtime/time-tools/errors";
import { convertTimestamp } from "@/features/tool-runtime/time-tools/timestamp";
import { transformTextValue } from "@/features/tool-runtime/text/executor";

/**
 * Core operations for the Toolars CLI and MCP server.
 *
 * Everything here reuses the pure function cores of the browser runtimes in
 * `src/features/tool-runtime/` so CLI, MCP server, and website stay behavior
 * identical. The only intentionally local implementation is the hash family:
 * the site runtime is coupled to hash-wasm workers and File blobs, so the CLI
 * uses `node:crypto` and pins the site's published test vectors in
 * core.test.ts. Those vectors live beside the browser tools in
 * `src/features/tool-runtime/hash/definitions.ts`; adding an algorithm there
 * without adding it here fails the parity test.
 */

export type CoreResult<TData> = Readonly<
  { ok: true; data: TData } | { ok: false; code: string }
>;

/**
 * Every digest algorithm the website ships as a tool. Kept in the same order as
 * `HASH_TOOL_SLUGS` so the CLI, the MCP `algorithm` enum, and the site catalog
 * read identically. MD5 and SHA-1 are integrity-only legacy algorithms; the
 * website labels them the same way and neither is a signature.
 */
export const HASH_ALGORITHMS = [
  "md5",
  "sha1",
  "sha224",
  "sha256",
  "sha384",
  "sha512",
] as const;

export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

export type HashOutput = Readonly<{
  algorithm: HashAlgorithm;
  digest: string;
  inputByteLength: number;
}>;

export type Base64Output = Readonly<{ value: string }>;

export type JwtDecodeOutput = Readonly<{
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** Raw base64url signature segment. Never verified here. */
  signature: string;
  times: JwtTimeReport;
  verified: false;
}>;

export type IdentifiersOutput = Readonly<{
  format: "uuid-v4" | "uuid-v7" | "ulid";
  values: readonly string[];
}>;

export type UrlOperation =
  "encode-component" | "decode-component" | "encode-uri" | "decode-uri";

function ok<TData>(data: TData): CoreResult<TData> {
  return { ok: true, data };
}

function err(code: string): CoreResult<never> {
  return { ok: false, code };
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function isHashAlgorithm(value: string): value is HashAlgorithm {
  return (HASH_ALGORITHMS as readonly string[]).includes(value);
}

/**
 * Hex digest of UTF-8 text for any algorithm the website ships. Byte-for-byte
 * the same input handling as the browser runtime: the input is encoded as
 * UTF-8 exactly once, a lone surrogate is rejected rather than replaced, and
 * one trailing stdin line break has already been stripped by the caller.
 */
export function hashText(
  text: string,
  algorithm: HashAlgorithm = "sha256",
): CoreResult<HashOutput> {
  if (!text.isWellFormed()) return err("INVALID_UNICODE_INPUT");
  const bytes = utf8Bytes(text);
  const digest = createHash(algorithm).update(bytes).digest("hex");
  return ok({ algorithm, digest, inputByteLength: bytes.byteLength });
}

/** SHA-256 shorthand kept for callers that only need the default algorithm. */
export function hashSha256(text: string): CoreResult<HashOutput> {
  return hashText(text, "sha256");
}

export function base64Transform(
  text: string,
  operation: "encode" | "decode",
  urlSafe: boolean,
): CoreResult<Base64Output> {
  const result = transformBase64Value({
    value: text,
    operation,
    options: { utf8: true, urlSafe, preserveLineBreaks: false },
  });
  return result.ok ? ok({ value: result.value }) : err(result.code);
}

const JWT_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/u;
const JWT_MAX_TOKEN_BYTES = 64 * 1024;

export function decodeJwtToken(
  token: string,
  now: Date = new Date(),
): CoreResult<JwtDecodeOutput> {
  const compact = token.trim();
  if (!compact) return err("EMPTY_TOKEN");
  if (utf8Bytes(token).byteLength > JWT_MAX_TOKEN_BYTES) {
    return err("TOKEN_TOO_LARGE");
  }
  if (
    !JWT_TOKEN_PATTERN.test(compact) ||
    compact.split(".").some((part) => part.length % 4 === 1)
  ) {
    return err("INVALID_TOKEN");
  }
  const segments = compact.split(".");
  try {
    const header = decodeJwtSegment(segments[0]!);
    const payload = decodeJwtSegment(segments[1]!);
    return ok({
      header,
      payload,
      signature: segments[2] ?? "",
      times: inspectJwtTimes(payload, now),
      verified: false,
    });
  } catch {
    return err("INVALID_TOKEN");
  }
}

export const MAX_IDENTIFIER_BATCH_COUNT = 100;

export function generateIdentifiersOp(
  format: "uuid-v4" | "uuid-v7" | "ulid",
  count: number,
  dependencies?: IdentifierGenerationDependencies,
): CoreResult<IdentifiersOutput> {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_IDENTIFIER_BATCH_COUNT
  ) {
    return err("INVALID_BATCH_COUNT");
  }
  try {
    const identifiers = generateIdentifiers(
      format,
      count,
      "canonical",
      dependencies,
    );
    return ok({ format, values: identifiers.map((item) => item.value) });
  } catch (error) {
    if (error instanceof IdentifierError) return err(error.code);
    return err("INTERNAL_ERROR");
  }
}

export function timestampConvert(
  source: string,
  options: Readonly<{
    outputTimeZone: TimeZoneOption;
  }>,
): CoreResult<TimestampOutput> {
  try {
    return ok(
      convertTimestamp({
        source,
        mode: "auto",
        sourceTimeZone: "UTC",
        outputTimeZone: options.outputTimeZone,
        ambiguousPreference: "earlier",
      }),
    );
  } catch (error) {
    if (isTimeToolRuntimeError(error)) return err(error.code);
    return err("INTERNAL_ERROR");
  }
}

export function cronExplain(
  expression: string,
  options: Readonly<{
    count: number;
    timeZone: TimeZoneOption;
    startMs: number;
  }>,
): CoreResult<CronOutput> {
  try {
    return ok(
      calculateCron({
        expression,
        timeZone: options.timeZone,
        startMs: options.startMs,
        count: options.count,
      }),
    );
  } catch (error) {
    if (isTimeToolRuntimeError(error)) return err(error.code);
    return err("INTERNAL_ERROR");
  }
}

export function urlTransform(
  text: string,
  operation: UrlOperation,
): CoreResult<Base64Output> {
  const result = transformTextValue(
    "url-encoder-decoder",
    { value: text, operation },
    "en",
  );
  return result.ok ? ok({ value: result.value }) : err(result.error.code);
}
