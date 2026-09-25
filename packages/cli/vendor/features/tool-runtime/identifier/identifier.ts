import {
  MAX_IDENTIFIER_BATCH_COUNT,
  MAX_IDENTIFIER_EXPORT_BYTES,
  MAX_IDENTIFIER_INPUT_LENGTH,
  type IdentifierCase,
  type IdentifierFormat,
} from "./definitions";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/iu;
const MAX_TIMESTAMP = (1n << 48n) - 1n;
const MAX_UUID_V7_RANDOM = (1n << 74n) - 1n;
const MAX_ULID_RANDOM = (1n << 80n) - 1n;
const UUID_NIL = "00000000-0000-0000-0000-000000000000";
const UUID_MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff";

export type IdentifierErrorCode =
  | "ABORTED"
  | "INVALID_FORMAT"
  | "INVALID_CASE"
  | "INVALID_BATCH_COUNT"
  | "INVALID_CLOCK"
  | "RANDOMNESS_UNAVAILABLE"
  | "RANDOM_SOURCE_INVALID"
  | "RANDOM_SEQUENCE_OVERFLOW"
  | "EXPORT_TOO_LARGE";

export class IdentifierError extends Error {
  readonly code: IdentifierErrorCode;
  readonly values: Readonly<Record<string, string | number>> | undefined;

  constructor(
    code: IdentifierErrorCode,
    message: string,
    values?: Readonly<Record<string, string | number>>,
  ) {
    super(message);
    this.name = "IdentifierError";
    this.code = code;
    this.values = values;
  }
}

export type RandomByteSource = (length: number) => Uint8Array;

export type IdentifierGenerationDependencies = Readonly<{
  now?: () => number;
  randomBytes?: RandomByteSource;
}>;

export type GeneratedIdentifier = Readonly<{
  value: string;
  canonicalValue: string;
  format: IdentifierFormat;
  timestampMs: number | null;
}>;

export type ValidIdentifier = Readonly<{
  valid: true;
  kind: "uuid" | "ulid";
  normalized: string;
  version: number | null;
  variant: "rfc9562" | "special" | null;
  special: "nil" | "max" | null;
  timestampMs: number | null;
}>;

export type InvalidIdentifier = Readonly<{
  valid: false;
  code:
    | "EMPTY_IDENTIFIER"
    | "IDENTIFIER_TOO_LONG"
    | "INVALID_IDENTIFIER_LENGTH"
    | "INVALID_UUID_FORMAT"
    | "INVALID_UUID_VARIANT"
    | "INVALID_UUID_VERSION"
    | "INVALID_ULID_ALPHABET"
    | "ULID_OVERFLOW";
  values?: Readonly<Record<string, string | number>>;
}>;

export type IdentifierValidation = ValidIdentifier | InvalidIdentifier;

export type IdentifierExports = Readonly<{
  text: string;
  csv: string;
}>;

function secureRandomBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new IdentifierError(
      "RANDOMNESS_UNAVAILABLE",
      "Secure browser randomness is unavailable.",
    );
  }

  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function readRandomBytes(length: number, source: RandomByteSource): Uint8Array {
  const bytes = source(length);

  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new IdentifierError(
      "RANDOM_SOURCE_INVALID",
      `Random source must return exactly ${length} bytes.`,
      { length },
    );
  }

  return bytes;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  return value;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let remaining = value;

  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseUuid(value: string): Uint8Array {
  const compact = value.replaceAll("-", "");
  return Uint8Array.from(compact.match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

function applyCase(canonicalValue: string, outputCase: IdentifierCase): string {
  if (outputCase === "uppercase") return canonicalValue.toUpperCase();
  if (outputCase === "lowercase") return canonicalValue.toLowerCase();
  return canonicalValue;
}

function readTimestamp(now: () => number): Readonly<{
  numeric: number;
  bits: bigint;
}> {
  const timestamp = now();

  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    BigInt(timestamp) > MAX_TIMESTAMP
  ) {
    throw new IdentifierError(
      "INVALID_CLOCK",
      "The clock must return a Unix timestamp in the unsigned 48-bit millisecond range.",
    );
  }

  return { numeric: timestamp, bits: BigInt(timestamp) };
}

function createUuidV4(randomBytes: RandomByteSource): string {
  const bytes = readRandomBytes(16, randomBytes).slice();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function createUuidV7(timestamp: bigint, random: bigint): string {
  const randomA = random >> 62n;
  const randomB = random & ((1n << 62n) - 1n);
  const bits =
    (timestamp << 80n) |
    (0x7n << 76n) |
    (randomA << 64n) |
    (0x2n << 62n) |
    randomB;

  return formatUuid(bigIntToBytes(bits, 16));
}

function encodeBase32(value: bigint, length: number): string {
  let encoded = "";
  let remaining = value;

  for (let index = 0; index < length; index += 1) {
    encoded = ULID_ALPHABET[Number(remaining & 31n)]! + encoded;
    remaining >>= 5n;
  }

  return encoded;
}

function createUlid(timestamp: bigint, random: bigint): string {
  return `${encodeBase32(timestamp, 10)}${encodeBase32(random, 16)}`;
}

function decodeBase32(value: string): bigint {
  let decoded = 0n;

  for (const character of value.toUpperCase()) {
    decoded = (decoded << 5n) | BigInt(ULID_ALPHABET.indexOf(character));
  }

  return decoded;
}

function assertBatchCount(count: number): void {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_IDENTIFIER_BATCH_COUNT
  ) {
    throw new IdentifierError(
      "INVALID_BATCH_COUNT",
      `Batch count must be an integer from 1 to ${MAX_IDENTIFIER_BATCH_COUNT}.`,
      { maximum: MAX_IDENTIFIER_BATCH_COUNT },
    );
  }
}

function assertSequenceCapacity(
  initial: bigint,
  count: number,
  maximum: bigint,
): void {
  if (initial + BigInt(count - 1) > maximum) {
    throw new IdentifierError(
      "RANDOM_SEQUENCE_OVERFLOW",
      "The monotonic random sequence overflowed. Generate a new batch.",
    );
  }
}

export function generateIdentifiers(
  format: IdentifierFormat,
  count: number,
  outputCase: IdentifierCase = "canonical",
  dependencies: IdentifierGenerationDependencies = {},
): GeneratedIdentifier[] {
  assertBatchCount(count);
  if (!["uuid-v4", "uuid-v7", "ulid"].includes(format))
    throw new IdentifierError("INVALID_FORMAT", "INVALID_FORMAT");
  if (!["canonical", "uppercase", "lowercase"].includes(outputCase))
    throw new IdentifierError("INVALID_CASE", "INVALID_CASE");

  const randomBytes = dependencies.randomBytes ?? secureRandomBytes;

  if (format === "uuid-v4") {
    return Array.from({ length: count }, () => {
      const canonicalValue = createUuidV4(randomBytes);
      return {
        value: applyCase(canonicalValue, outputCase),
        canonicalValue,
        format,
        timestampMs: null,
      };
    });
  }

  const timestamp = readTimestamp(dependencies.now ?? Date.now);

  if (format === "uuid-v7") {
    const initialRandom =
      bytesToBigInt(readRandomBytes(10, randomBytes)) & MAX_UUID_V7_RANDOM;
    assertSequenceCapacity(initialRandom, count, MAX_UUID_V7_RANDOM);

    return Array.from({ length: count }, (_, index) => {
      const canonicalValue = createUuidV7(
        timestamp.bits,
        initialRandom + BigInt(index),
      );
      return {
        value: applyCase(canonicalValue, outputCase),
        canonicalValue,
        format,
        timestampMs: timestamp.numeric,
      };
    });
  }

  const initialRandom = bytesToBigInt(readRandomBytes(10, randomBytes));
  assertSequenceCapacity(initialRandom, count, MAX_ULID_RANDOM);

  return Array.from({ length: count }, (_, index) => {
    const canonicalValue = createUlid(
      timestamp.bits,
      initialRandom + BigInt(index),
    );
    return {
      value: applyCase(canonicalValue, outputCase),
      canonicalValue,
      format,
      timestampMs: timestamp.numeric,
    };
  });
}

export function validateIdentifier(input: string): IdentifierValidation {
  const value = input.trim();

  if (!value) return { valid: false, code: "EMPTY_IDENTIFIER" };
  if (input.length > MAX_IDENTIFIER_INPUT_LENGTH) {
    return {
      valid: false,
      code: "IDENTIFIER_TOO_LONG",
      values: { maximum: MAX_IDENTIFIER_INPUT_LENGTH },
    };
  }

  if (value.length === 36) {
    if (!UUID_PATTERN.test(value)) {
      return { valid: false, code: "INVALID_UUID_FORMAT" };
    }

    const normalized = value.toLowerCase();
    if (normalized === UUID_NIL || normalized === UUID_MAX) {
      return {
        valid: true,
        kind: "uuid",
        normalized,
        version: null,
        variant: "special",
        special: normalized === UUID_NIL ? "nil" : "max",
        timestampMs: null,
      };
    }

    const bytes = parseUuid(normalized);
    if ((bytes[8]! & 0xc0) !== 0x80) {
      return { valid: false, code: "INVALID_UUID_VARIANT" };
    }

    const version = bytes[6]! >> 4;
    if (version < 1 || version > 8) {
      return {
        valid: false,
        code: "INVALID_UUID_VERSION",
        values: { version },
      };
    }

    return {
      valid: true,
      kind: "uuid",
      normalized,
      version,
      variant: "rfc9562",
      special: null,
      timestampMs:
        version === 7
          ? Number(BigInt(`0x${normalized.replaceAll("-", "").slice(0, 12)}`))
          : null,
    };
  }

  if (value.length === 26) {
    if (!ULID_PATTERN.test(value)) {
      return { valid: false, code: "INVALID_ULID_ALPHABET" };
    }

    const normalized = value.toUpperCase();
    if (ULID_ALPHABET.indexOf(normalized[0]!) > 7) {
      return { valid: false, code: "ULID_OVERFLOW" };
    }

    return {
      valid: true,
      kind: "ulid",
      normalized,
      version: null,
      variant: null,
      special: null,
      timestampMs: Number(decodeBase32(normalized.slice(0, 10))),
    };
  }

  return {
    valid: false,
    code: "INVALID_IDENTIFIER_LENGTH",
    values: { length: value.length },
  };
}

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function createIdentifierExports(
  identifiers: readonly GeneratedIdentifier[],
): IdentifierExports {
  const text = identifiers.map((identifier) => identifier.value).join("\n");
  const rows = identifiers.map((identifier) => [
    identifier.value,
    identifier.format,
    identifier.timestampMs === null
      ? ""
      : new Date(identifier.timestampMs).toISOString(),
  ]);
  const csv = [["value", "format", "timestamp_iso"], ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");

  const encoder = new TextEncoder();
  if (
    encoder.encode(text).byteLength > MAX_IDENTIFIER_EXPORT_BYTES ||
    encoder.encode(csv).byteLength > MAX_IDENTIFIER_EXPORT_BYTES
  ) {
    throw new IdentifierError(
      "EXPORT_TOO_LARGE",
      "Identifier export exceeds the local output limit.",
      { maximum: MAX_IDENTIFIER_EXPORT_BYTES },
    );
  }

  return { text, csv };
}
