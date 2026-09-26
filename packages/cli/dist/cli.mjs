#!/usr/bin/env node

// packages/cli/src/is-main-entry.ts
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
function isMainEntry(moduleUrl) {
  const entryPath = process.argv[1];
  if (typeof entryPath !== "string" || entryPath.length === 0) {
    return false;
  }
  if (moduleUrl === pathToFileURL(entryPath).href) {
    return true;
  }
  try {
    return moduleUrl === pathToFileURL(realpathSync(entryPath)).href;
  } catch {
    return false;
  }
}

// packages/cli/src/core.ts
import { createHash } from "node:crypto";

// src/features/tool-runtime/base64/contract.ts
var MAX_BASE64_INPUT_BYTES = 1024 * 1024;

// src/features/tool-runtime/base64/executor.ts
var BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
var BASE64_URL_PATTERN = /^[A-Za-z0-9_-]*={0,2}$/;
function normalizeLineBreaks(value, preserveLineBreaks) {
  return preserveLineBreaks ? value : value.replace(/\r\n?|\n/g, " ");
}
function bytesToBinary(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return binary;
}
function binaryToBytes(binary) {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
function encodeBase64(input) {
  const preparedInput = normalizeLineBreaks(
    input.value,
    input.options.preserveLineBreaks
  );
  let binary = "";
  if (input.options.utf8) {
    if (!preparedInput.isWellFormed()) {
      return {
        ok: false,
        code: "INVALID_UNICODE_INPUT",
        message: "Input contains an unpaired surrogate.",
        recoverable: true
      };
    }
    binary = bytesToBinary(new TextEncoder().encode(preparedInput));
  } else {
    for (let index = 0; index < preparedInput.length; index += 1) {
      const codePoint = preparedInput.charCodeAt(index);
      if (codePoint > 255) {
        return {
          ok: false,
          code: "OUTSIDE_BYTE_RANGE",
          message: "Enable UTF-8 to encode characters outside the byte range.",
          recoverable: true
        };
      }
      binary += String.fromCharCode(codePoint);
    }
  }
  try {
    const encoded = btoa(binary);
    return {
      ok: true,
      value: input.options.urlSafe ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "") : encoded
    };
  } catch {
    return {
      ok: false,
      code: "BASE64_API_UNAVAILABLE",
      message: "Base64 encoding is unavailable in this browser.",
      recoverable: true
    };
  }
}
function decodeBase64(input) {
  const compactInput = input.value.replace(/[\t\n\f\r ]/g, "");
  if (!compactInput) {
    return { ok: true, value: "" };
  }
  const pattern = input.options.urlSafe ? BASE64_URL_PATTERN : BASE64_PATTERN;
  if (!pattern.test(compactInput)) {
    return {
      ok: false,
      code: "INVALID_BASE64_CHARACTERS",
      message: input.options.urlSafe ? "Enter valid URL-safe Base64 characters." : "Enter valid Base64 characters.",
      recoverable: true
    };
  }
  const unpadded = compactInput.replace(/=+$/, "");
  const padding = compactInput.length - unpadded.length;
  const requiredPadding = (4 - unpadded.length % 4) % 4;
  if (padding > 0 && (padding !== requiredPadding || unpadded.length === 0)) {
    return {
      ok: false,
      code: "INVALID_BASE64_PADDING",
      message: "Base64 padding is malformed or non-canonical.",
      recoverable: true
    };
  }
  if (unpadded.length % 4 === 1) {
    return {
      ok: false,
      code: "INVALID_BASE64_LENGTH",
      message: "The Base64 length is not valid.",
      recoverable: true
    };
  }
  const normalized = (input.options.urlSafe ? unpadded.replace(/-/g, "+").replace(/_/g, "/") : unpadded).padEnd(unpadded.length + (4 - unpadded.length % 4) % 4, "=");
  try {
    const binary = atob(normalized);
    if (btoa(binary) !== normalized) {
      return {
        ok: false,
        code: "INVALID_BASE64_PADDING",
        message: "Base64 padding is malformed or non-canonical.",
        recoverable: true
      };
    }
    const decoded = input.options.utf8 ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      binaryToBytes(binary)
    ) : binary;
    return {
      ok: true,
      value: normalizeLineBreaks(decoded, input.options.preserveLineBreaks)
    };
  } catch {
    return {
      ok: false,
      code: input.options.utf8 ? "INVALID_UTF8_BASE64" : "INVALID_BASE64",
      message: input.options.utf8 ? "This value is not valid UTF-8 Base64." : "This value is not valid Base64.",
      recoverable: true
    };
  }
}
function transformBase64Value(input) {
  if (input.operation !== "encode" && input.operation !== "decode")
    return {
      ok: false,
      code: "INVALID_OPERATION",
      message: "INVALID_OPERATION",
      recoverable: true
    };
  if (input.value.length > MAX_BASE64_INPUT_BYTES || new TextEncoder().encode(input.value).byteLength > MAX_BASE64_INPUT_BYTES)
    return {
      ok: false,
      code: "INPUT_TOO_LARGE",
      message: "INPUT_TOO_LARGE",
      recoverable: true
    };
  return input.operation === "encode" ? encodeBase64(input) : decodeBase64(input);
}

// src/features/tool-runtime/jwt/inspection.ts
var JWT_TIME_CLAIMS = ["exp", "nbf", "iat"];
function inspectJwtTimes(payload, now) {
  const secondsNow = Math.floor(now.getTime() / 1e3);
  return {
    checkedAt: new Date(secondsNow * 1e3).toISOString(),
    clockToleranceSeconds: 0,
    claims: JWT_TIME_CLAIMS.map((claim) => {
      const value = payload[claim];
      const base = { claim, seconds: null, utc: null };
      if (!Object.hasOwn(payload, claim)) return { ...base, state: "missing" };
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 864e10)
        return { ...base, state: "invalid" };
      const state = claim === "exp" ? value <= secondsNow ? "expired" : "active" : claim === "nbf" ? value > secondsNow ? "not-yet-valid" : "active" : value > secondsNow ? "future" : "issued";
      return {
        claim,
        state,
        seconds: value,
        utc: new Date(value * 1e3).toISOString()
      };
    })
  };
}
function decimalKey(raw) {
  const [mantissa, power = "0"] = raw.toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const [whole, fraction = ""] = mantissa.replace(/^-/, "").split(".");
  let digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  let exponent = Number(power) - fraction.length;
  const significant = digits.replace(/0+$/, "");
  exponent += digits.length - significant.length;
  digits = significant;
  return `${negative ? "-" : ""}${digits}e${exponent}`;
}
function parseJwtJson(source) {
  const parsed = JSON.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("INVALID_JSON_OBJECT");
  for (const token of source.matchAll(
    /"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  )) {
    const raw = token[0];
    if (raw.startsWith('"')) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || decimalKey(raw) !== decimalKey(String(value)))
      throw new Error("JSON_NUMBER_UNSAFE");
  }
  return parsed;
}
function decodeJwtSegment(segment) {
  const bytes = Uint8Array.from(
    atob(segment.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );
  return parseJwtJson(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  );
}

// src/features/tool-runtime/identifier/definitions.ts
var MAX_IDENTIFIER_BATCH_COUNT = 100;

// src/features/tool-runtime/identifier/identifier.ts
var ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var MAX_TIMESTAMP = (1n << 48n) - 1n;
var MAX_UUID_V7_RANDOM = (1n << 74n) - 1n;
var MAX_ULID_RANDOM = (1n << 80n) - 1n;
var IdentifierError = class extends Error {
  code;
  values;
  constructor(code, message, values) {
    super(message);
    this.name = "IdentifierError";
    this.code = code;
    this.values = values;
  }
};
function secureRandomBytes(length) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new IdentifierError(
      "RANDOMNESS_UNAVAILABLE",
      "Secure browser randomness is unavailable."
    );
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
function readRandomBytes(length, source) {
  const bytes = source(length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new IdentifierError(
      "RANDOM_SOURCE_INVALID",
      `Random source must return exactly ${length} bytes.`,
      { length }
    );
  }
  return bytes;
}
function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) {
    value = value << 8n | BigInt(byte);
  }
  return value;
}
function bigIntToBytes(value, length) {
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}
function formatUuid(bytes) {
  const hex = Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function applyCase(canonicalValue, outputCase) {
  if (outputCase === "uppercase") return canonicalValue.toUpperCase();
  if (outputCase === "lowercase") return canonicalValue.toLowerCase();
  return canonicalValue;
}
function readTimestamp(now) {
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || BigInt(timestamp) > MAX_TIMESTAMP) {
    throw new IdentifierError(
      "INVALID_CLOCK",
      "The clock must return a Unix timestamp in the unsigned 48-bit millisecond range."
    );
  }
  return { numeric: timestamp, bits: BigInt(timestamp) };
}
function createUuidV4(randomBytes) {
  const bytes = readRandomBytes(16, randomBytes).slice();
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  return formatUuid(bytes);
}
function createUuidV7(timestamp, random) {
  const randomA = random >> 62n;
  const randomB = random & (1n << 62n) - 1n;
  const bits = timestamp << 80n | 0x7n << 76n | randomA << 64n | 0x2n << 62n | randomB;
  return formatUuid(bigIntToBytes(bits, 16));
}
function encodeBase32(value, length) {
  let encoded = "";
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    encoded = ULID_ALPHABET[Number(remaining & 31n)] + encoded;
    remaining >>= 5n;
  }
  return encoded;
}
function createUlid(timestamp, random) {
  return `${encodeBase32(timestamp, 10)}${encodeBase32(random, 16)}`;
}
function assertBatchCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_IDENTIFIER_BATCH_COUNT) {
    throw new IdentifierError(
      "INVALID_BATCH_COUNT",
      `Batch count must be an integer from 1 to ${MAX_IDENTIFIER_BATCH_COUNT}.`,
      { maximum: MAX_IDENTIFIER_BATCH_COUNT }
    );
  }
}
function assertSequenceCapacity(initial, count, maximum) {
  if (initial + BigInt(count - 1) > maximum) {
    throw new IdentifierError(
      "RANDOM_SEQUENCE_OVERFLOW",
      "The monotonic random sequence overflowed. Generate a new batch."
    );
  }
}
function generateIdentifiers(format, count, outputCase = "canonical", dependencies = {}) {
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
        timestampMs: null
      };
    });
  }
  const timestamp = readTimestamp(dependencies.now ?? Date.now);
  if (format === "uuid-v7") {
    const initialRandom2 = bytesToBigInt(readRandomBytes(10, randomBytes)) & MAX_UUID_V7_RANDOM;
    assertSequenceCapacity(initialRandom2, count, MAX_UUID_V7_RANDOM);
    return Array.from({ length: count }, (_, index) => {
      const canonicalValue = createUuidV7(
        timestamp.bits,
        initialRandom2 + BigInt(index)
      );
      return {
        value: applyCase(canonicalValue, outputCase),
        canonicalValue,
        format,
        timestampMs: timestamp.numeric
      };
    });
  }
  const initialRandom = bytesToBigInt(readRandomBytes(10, randomBytes));
  assertSequenceCapacity(initialRandom, count, MAX_ULID_RANDOM);
  return Array.from({ length: count }, (_, index) => {
    const canonicalValue = createUlid(
      timestamp.bits,
      initialRandom + BigInt(index)
    );
    return {
      value: applyCase(canonicalValue, outputCase),
      canonicalValue,
      format,
      timestampMs: timestamp.numeric
    };
  });
}

// src/features/tool-runtime/time-tools/definitions.ts
var TIME_ZONE_OPTIONS = [
  "UTC",
  "local",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Australia/Sydney"
];
var TIME_TOOL_LIMITS = {
  timestampBytes: 512,
  cronBytes: 512,
  cronCount: 10,
  cronMaxMinutes: 527040,
  timeoutMs: 1500
};

// src/features/tool-runtime/time-tools/errors.ts
var TimeToolRuntimeError = class extends Error {
  code;
  values;
  constructor(code, values) {
    super(code);
    this.name = "TimeToolRuntimeError";
    this.code = code;
    this.values = values;
  }
};
function isTimeToolRuntimeError(error) {
  return error instanceof TimeToolRuntimeError;
}

// src/features/tool-runtime/time-tools/cron.ts
var FIELD_RULES = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: {
    min: 1,
    max: 12,
    names: {
      JAN: 1,
      FEB: 2,
      MAR: 3,
      APR: 4,
      MAY: 5,
      JUN: 6,
      JUL: 7,
      AUG: 8,
      SEP: 9,
      OCT: 10,
      NOV: 11,
      DEC: 12
    }
  },
  weekday: {
    min: 0,
    max: 7,
    names: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }
  }
};
var FIELD_ORDER = [
  "minute",
  "hour",
  "day",
  "month",
  "weekday"
];
function parseValue(token, field) {
  const rules = FIELD_RULES[field];
  const normalized = token.toUpperCase();
  const value = rules.names?.[normalized] ?? (/^\d+$/u.test(token) ? Number(token) : NaN);
  if (!Number.isInteger(value) || value < rules.min || value > rules.max) {
    throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
      field,
      value: token
    });
  }
  return value;
}
function addRange(values, start, end, step, field) {
  if (start > end || !Number.isInteger(step) || step < 1) {
    throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
      field,
      value: `${start}-${end}/${step}`
    });
  }
  for (let value = start; value <= end; value += step) {
    values.add(field === "weekday" && value === 7 ? 0 : value);
  }
}
function parseField(source, field) {
  const rules = FIELD_RULES[field];
  const values = /* @__PURE__ */ new Set();
  const wildcard = source.startsWith("*");
  for (const listPart of source.split(",")) {
    if (!listPart) {
      throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
        field,
        value: source
      });
    }
    const [rangePart, stepPart, extra] = listPart.split("/");
    if (extra !== void 0 || !rangePart) {
      throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
        field,
        value: listPart
      });
    }
    const step = stepPart === void 0 ? 1 : /^\d+$/u.test(stepPart) ? Number(stepPart) : NaN;
    if (!Number.isSafeInteger(step) || step < 1)
      throw new TimeToolRuntimeError("INVALID_CRON_FIELD");
    if (rangePart === "*") {
      addRange(values, rules.min, rules.max, step, field);
      continue;
    }
    const range = rangePart.split("-");
    if (range.length === 1) {
      const value = parseValue(range[0], field);
      if (stepPart !== void 0) {
        addRange(values, value, rules.max, step, field);
      } else {
        values.add(field === "weekday" && value === 7 ? 0 : value);
      }
      continue;
    }
    if (range.length === 2) {
      addRange(
        values,
        parseValue(range[0], field),
        parseValue(range[1], field),
        step,
        field
      );
      continue;
    }
    throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
      field,
      value: listPart
    });
  }
  return { values, wildcard, source };
}
function resolveTimeZone(timeZone) {
  if (!TIME_ZONE_OPTIONS.includes(timeZone))
    throw new TimeToolRuntimeError("INVALID_TIME_ZONE");
  const resolved = timeZone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: resolved }).format(0);
  } catch {
    throw new TimeToolRuntimeError("INVALID_TIME_ZONE", {
      timeZone: resolved
    });
  }
  return resolved;
}
function zoneFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23"
  });
}
function datePartsInZone(instantMs, formatter) {
  const parts = formatter.formatToParts(instantMs);
  const number = (type) => Number(parts.find((part) => part.type === type)?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  return {
    minute: number("minute"),
    hour: number("hour"),
    day: number("day"),
    month: number("month"),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      weekday ?? ""
    )
  };
}
function datePartsInUtc(instantMs) {
  const date = new Date(instantMs);
  return {
    minute: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    weekday: date.getUTCDay()
  };
}
function matches(parts, fields) {
  const domMatch = fields.day.values.has(parts.day);
  const dowMatch = fields.weekday.values.has(parts.weekday);
  const dayMatches = fields.day.wildcard || fields.weekday.wildcard ? domMatch && dowMatch : domMatch || dowMatch;
  return fields.minute.values.has(parts.minute) && fields.hour.values.has(parts.hour) && fields.month.values.has(parts.month) && dayMatches;
}
function calculateCron(input) {
  if (new TextEncoder().encode(input.expression).length > TIME_TOOL_LIMITS.cronBytes)
    throw new TimeToolRuntimeError("CRON_INPUT_TOO_LARGE");
  if (!Number.isSafeInteger(input.startMs) || Math.abs(input.startMs) > 864e13 - TIME_TOOL_LIMITS.cronMaxMinutes * 6e4 || !Number.isInteger(input.count) || input.count < 1 || input.count > 25)
    throw new TimeToolRuntimeError("INVALID_CRON_OPTIONS");
  const expression = input.expression.trim().replace(/\s+/gu, " ");
  const rawFields = expression.split(" ");
  if (rawFields.length !== 5) {
    throw new TimeToolRuntimeError("INVALID_CRON_FIELD_COUNT", {
      count: rawFields.length
    });
  }
  const fields = Object.fromEntries(
    FIELD_ORDER.map((field, index) => [
      field,
      parseField(rawFields[index], field)
    ])
  );
  const timeZone = resolveTimeZone(input.timeZone);
  const count = input.count;
  const nextRuns = [];
  const first = Math.floor(input.startMs / 6e4) * 6e4 + 6e4;
  const end = first + (TIME_TOOL_LIMITS.cronMaxMinutes - 1) * 6e4;
  const formatter = timeZone === "UTC" ? null : zoneFormatter(timeZone);
  const partsAt = formatter ? (instantMs) => datePartsInZone(instantMs, formatter) : datePartsInUtc;
  const outputFormatter = new Intl.DateTimeFormat(input.locale ?? "en", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "long",
    hourCycle: "h23"
  });
  for (let candidate = first; candidate <= end && nextRuns.length < count; candidate += 6e4) {
    if (!matches(partsAt(candidate), fields)) continue;
    nextRuns.push({
      instantMs: candidate,
      iso: new Date(candidate).toISOString(),
      zoned: outputFormatter.format(candidate)
    });
  }
  if (!nextRuns.length) throw new TimeToolRuntimeError("CRON_SEARCH_LIMIT");
  return {
    normalized: expression,
    fields: FIELD_ORDER.map((field) => ({
      field,
      source: fields[field].source,
      values: [...fields[field].values].sort((a, b) => a - b)
    })),
    complete: nextRuns.length === count,
    requestedCount: count,
    startIso: new Date(input.startMs).toISOString(),
    searchEndIso: new Date(end).toISOString(),
    dayMode: fields.day.wildcard || fields.weekday.wildcard ? "and" : "or",
    nextRuns,
    timeZone,
    semantics: "dom-dow-or"
  };
}

// src/features/tool-runtime/time-tools/timestamp.ts
var WALL_TIME_PATTERN = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u;
var NUMBER_PATTERN = /^[+-]?\d+(?:\.\d+)?$/u;
var MAX_MS = 8640000000000000n;
function resolveTimeZone2(timeZone) {
  if (!TIME_ZONE_OPTIONS.includes(timeZone))
    throw new TimeToolRuntimeError("INVALID_TIME_ZONE");
  const resolved = timeZone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: resolved }).format(0);
  } catch {
    throw new TimeToolRuntimeError("INVALID_TIME_ZONE");
  }
  return resolved;
}
function wallEpoch(parts) {
  const date = /* @__PURE__ */ new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
  return date.getTime();
}
function parseWallParts(source) {
  const match = WALL_TIME_PATTERN.exec(source);
  if (!match || match[1] === "-000000")
    throw new TimeToolRuntimeError("INVALID_WALL_TIME");
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "").padEnd(3, "0"))
  };
  const date = new Date(wallEpoch(parts));
  if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() + 1 !== parts.month || date.getUTCDate() !== parts.day || date.getUTCHours() !== parts.hour || date.getUTCMinutes() !== parts.minute || date.getUTCSeconds() !== parts.second)
    throw new TimeToolRuntimeError("INVALID_WALL_TIME");
  return parts;
}
function zoneFormatter2(timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    era: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
}
function partsInZone(instantMs, formatter) {
  const parts = formatter.formatToParts(instantMs);
  const value = (type) => Number(parts.find((p) => p.type === type)?.value);
  const year = value("year");
  return {
    year: parts.find((p) => p.type === "era")?.value === "BC" ? 1 - year : year,
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
    millisecond: (instantMs % 1e3 + 1e3) % 1e3
  };
}
function offsetAt(instantMs, formatter) {
  return wallEpoch(partsInZone(instantMs, formatter)) - instantMs;
}
function wallTimeToInstant(source, timeZone, preference) {
  const target = parseWallParts(source), approximate = wallEpoch(target);
  const formatter = zoneFormatter2(timeZone);
  const offsets = /* @__PURE__ */ new Set();
  for (let hours = -48; hours <= 48; hours++) {
    const sample = approximate + hours * 36e5;
    if (Math.abs(sample) <= Number(MAX_MS))
      offsets.add(offsetAt(sample, formatter));
  }
  const candidates = [...offsets].map((offset) => approximate - offset).filter(
    (candidate) => Math.abs(candidate) <= Number(MAX_MS) && wallEpoch(partsInZone(candidate, formatter)) === approximate
  ).sort((a, b) => a - b);
  if (!candidates.length)
    throw new TimeToolRuntimeError("NONEXISTENT_WALL_TIME");
  return {
    instantMs: preference === "later" ? candidates.at(-1) : candidates[0],
    candidates
  };
}
function parseNumeric(source, mode) {
  if (!NUMBER_PATTERN.test(source))
    throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
  const negative = source.startsWith("-");
  const [whole, fraction = ""] = source.replace(/^[+-]/, "").split(".");
  const precision = mode === "seconds" ? 3 : 0;
  if (/[^0]/.test(fraction.slice(precision)))
    throw new TimeToolRuntimeError("TIMESTAMP_PRECISION");
  const absolute = BigInt(whole) * (mode === "seconds" ? 1000n : 1n) + BigInt(fraction.slice(0, precision).padEnd(precision, "0") || "0");
  const ms = negative ? -absolute : absolute;
  if (ms < -MAX_MS || ms > MAX_MS)
    throw new TimeToolRuntimeError("TIMESTAMP_OUT_OF_RANGE");
  return Number(ms);
}
function parseIsoOrRfc(source) {
  const iso = /^(.*[Tt ].*?)([Zz]|[+-]\d{2}:\d{2})$/u.exec(source);
  if (iso) {
    let parts2;
    try {
      parts2 = parseWallParts(iso[1].replace("t", "T"));
    } catch {
      throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
    }
    const suffix = iso[2];
    const hours = Number(suffix.slice(1, 3)), minutes = Number(suffix.slice(4, 6));
    if (suffix.toUpperCase() !== "Z" && (hours > 23 || minutes > 59 || suffix === "-00:00"))
      throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
    const offset2 = suffix.toUpperCase() === "Z" ? 0 : (suffix.startsWith("-") ? -1 : 1) * (hours * 60 + minutes) * 6e4;
    return wallEpoch(parts2) - offset2;
  }
  const rfc = /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat), )?(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) (GMT|UTC|[+-]\d{4})$/u.exec(
    source
  );
  if (!rfc) throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ].indexOf(rfc[3]) + 1;
  const wall = `${rfc[4]}-${String(month).padStart(2, "0")}-${rfc[2]}T${rfc[5]}:${rfc[6]}:${rfc[7]}`;
  let parts;
  try {
    parts = parseWallParts(wall);
  } catch {
    throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
  }
  if (rfc[1] && ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(wallEpoch(parts)).getUTCDay()] !== rfc[1])
    throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
  const offset = rfc[8];
  return parseIsoOrRfc(
    wall + (["GMT", "UTC"].includes(offset) ? "Z" : `${offset.slice(0, 3)}:${offset.slice(3)}`)
  );
}
function detectMode(source) {
  if (WALL_TIME_PATTERN.test(source)) return "wall";
  if (NUMBER_PATTERN.test(source))
    return BigInt(source.replace(/^[+-]/, "").split(".")[0]) >= 100000000000n ? "milliseconds" : "seconds";
  return "iso";
}
function formatInZone(instantMs, timeZone, locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    calendar: "gregory",
    era: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    timeZoneName: "longOffset",
    hourCycle: "h23"
  }).format(instantMs);
}
function secondsText(ms) {
  const negative = ms < 0, absolute = BigInt(Math.abs(ms));
  const fraction = String(absolute % 1000n).padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / 1000n}${fraction ? "." + fraction : ""}`;
}
function convertTimestamp(input, locale) {
  if (new TextEncoder().encode(input.source).length > TIME_TOOL_LIMITS.timestampBytes)
    throw new TimeToolRuntimeError("TIMESTAMP_INPUT_TOO_LARGE");
  const source = input.source.trim();
  if (!source) throw new TimeToolRuntimeError("EMPTY_TIMESTAMP");
  if (!["auto", "seconds", "milliseconds", "iso", "wall"].includes(input.mode) || !["earlier", "later"].includes(input.ambiguousPreference))
    throw new TimeToolRuntimeError("INVALID_TIMESTAMP_OPTIONS");
  const sourceTimeZone = resolveTimeZone2(input.sourceTimeZone), outputTimeZone = resolveTimeZone2(input.outputTimeZone), localTimeZone = resolveTimeZone2("local");
  const detectedMode = input.mode === "auto" ? detectMode(source) : input.mode;
  const wall = detectedMode === "wall" ? wallTimeToInstant(source, sourceTimeZone, input.ambiguousPreference) : null;
  const instantMs = wall ? wall.instantMs : detectedMode === "seconds" || detectedMode === "milliseconds" ? parseNumeric(source, detectedMode) : parseIsoOrRfc(source);
  if (!Number.isSafeInteger(instantMs) || Math.abs(instantMs) > Number(MAX_MS))
    throw new TimeToolRuntimeError("TIMESTAMP_OUT_OF_RANGE");
  const date = new Date(instantMs), discordSeconds = Math.floor(instantMs / 1e3);
  return {
    instantMs,
    unixSeconds: secondsText(instantMs),
    unixMilliseconds: instantMs,
    iso: date.toISOString(),
    utc: formatInZone(instantMs, "UTC", locale),
    local: formatInZone(instantMs, localTimeZone, locale),
    zoned: formatInZone(instantMs, outputTimeZone, locale),
    sourceTimeZone,
    localTimeZone,
    outputTimeZone,
    detectedMode,
    autoDetected: input.mode === "auto",
    discord: {
      full: `<t:${discordSeconds}:F>`,
      relative: `<t:${discordSeconds}:R>`,
      shortDateTime: `<t:${discordSeconds}:f>`
    },
    ambiguity: wall && wall.candidates.length > 1 ? {
      count: wall.candidates.length,
      selected: input.ambiguousPreference,
      candidates: wall.candidates.map((ms) => new Date(ms).toISOString())
    } : null
  };
}

// src/features/tool-runtime/text/definitions.ts
var LOCAL_TEXT_PRIVACY = {
  processingLocation: "browser",
  inputLeavesDevice: false,
  retention: "none"
};
var TEXT_TOOL_SLUGS = [
  "case-converter",
  "multiple-whitespace-remover",
  "url-slug-generator",
  "html-encoder-decoder",
  "url-encoder-decoder"
];
var caseConverter = {
  slug: "case-converter",
  name: "Case Converter",
  defaultOperation: "sentence",
  downloadFileName: "toolars-converted-text.txt",
  modes: [
    {
      value: "sentence",
      sample: "TOOLARS makes BROWSER tools. THEY stay local!"
    },
    {
      value: "title",
      sample: "ship useful browser tools faster"
    },
    {
      value: "upper",
      sample: "Toolars works with Unicode"
    },
    {
      value: "lower",
      sample: "Toolars Works With Unicode"
    },
    {
      value: "camel",
      sample: "browser first tool runtime"
    },
    {
      value: "pascal",
      sample: "browser first tool runtime"
    },
    {
      value: "snake",
      sample: "BrowserFirst tool runtime"
    },
    {
      value: "kebab",
      sample: "BrowserFirst tool runtime"
    }
  ]
};
var whitespaceRemover = {
  slug: "multiple-whitespace-remover",
  name: "Multiple Whitespace Remover",
  defaultOperation: "collapse-spaces",
  downloadFileName: "toolars-clean-text.txt",
  modes: [
    {
      value: "collapse-spaces",
      sample: "Toolars    keeps	text tidy.\nLine two   stays here."
    },
    {
      value: "collapse-all",
      sample: "Toolars    keeps\n\n text   tidy."
    },
    {
      value: "remove-blank-lines",
      sample: "First line\n\n\nSecond line\n   \nThird line"
    },
    {
      value: "trim-lines",
      sample: "  First line  \n   Second line	\nThird line   "
    }
  ]
};
var slugGenerator = {
  slug: "url-slug-generator",
  name: "URL Slug Generator",
  defaultOperation: "hyphen",
  downloadFileName: "toolars-url-slug.txt",
  modes: [
    {
      value: "hyphen",
      sample: "Cr\xE8me br\xFBl\xE9e & browser tools"
    },
    {
      value: "underscore",
      sample: "Cr\xE8me br\xFBl\xE9e & browser tools"
    }
  ]
};
var htmlEncoderDecoder = {
  slug: "html-encoder-decoder",
  name: "HTML Encoder/Decoder",
  defaultOperation: "encode",
  downloadFileName: "toolars-html-entities.txt",
  reverseOperations: { encode: "decode", decode: "encode" },
  modes: [
    {
      value: "encode",
      sample: '<section aria-label="Toolars">Fast & local</section>'
    },
    {
      value: "decode",
      sample: "&lt;strong&gt;Fast &amp; local&lt;/strong&gt; &#128640;"
    }
  ]
};
var urlEncoderDecoder = {
  slug: "url-encoder-decoder",
  name: "URL Encoder/Decoder",
  defaultOperation: "encode-component",
  downloadFileName: "toolars-url-value.txt",
  reverseOperations: {
    "encode-component": "decode-component",
    "decode-component": "encode-component",
    "encode-uri": "decode-uri",
    "decode-uri": "encode-uri"
  },
  modes: [
    {
      value: "encode-component",
      sample: "Toolars tools/\u4F60\u597D?fast=true"
    },
    {
      value: "decode-component",
      sample: "Toolars%20tools%2F%E4%BD%A0%E5%A5%BD%3Ffast%3Dtrue"
    },
    {
      value: "encode-uri",
      sample: "https://toolars.dev/tools?q=\u4F60\u597D world#result"
    },
    {
      value: "decode-uri",
      sample: "https://toolars.dev/tools?q=%E4%BD%A0%E5%A5%BD%20world#result"
    }
  ]
};
var textToolDefinitions = {
  "case-converter": caseConverter,
  "multiple-whitespace-remover": whitespaceRemover,
  "url-slug-generator": slugGenerator,
  "html-encoder-decoder": htmlEncoderDecoder,
  "url-encoder-decoder": urlEncoderDecoder
};
var textToolSlugSet = new Set(TEXT_TOOL_SLUGS);
function getTextToolDefinition(slug) {
  return textToolDefinitions[slug];
}

// src/features/tool-runtime/text/executor.ts
var WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
var TITLE_WORD_PATTERN = new RegExp("\\p{L}[\\p{L}\\p{M}\\p{N}'\u2019]*", "gu");
var SENTENCE_START_PATTERN = new RegExp("(^|[.!?\u3002\uFF01\uFF1F]\\s*)(\\p{L})", "gu");
function safeLocaleLower(value, locale) {
  try {
    return value.toLocaleLowerCase(locale);
  } catch {
    return value.toLowerCase();
  }
}
function safeLocaleUpper(value, locale) {
  try {
    return value.toLocaleUpperCase(locale);
  } catch {
    return value.toUpperCase();
  }
}
function splitWords(value) {
  const separated = value.normalize("NFKC").replace(new RegExp("([\\p{Ll}\\p{Nd}])(\\p{Lu})", "gu"), "$1 $2").replace(new RegExp("(\\p{Lu})(\\p{Lu}\\p{Ll})", "gu"), "$1 $2");
  return separated.match(WORD_PATTERN) ?? [];
}
function capitalize(value, locale) {
  const [first = "", ...rest] = Array.from(value);
  return `${safeLocaleUpper(first, locale)}${safeLocaleLower(rest.join(""), locale)}`;
}
function convertCase(value, operation, locale) {
  if (operation === "upper") {
    return safeLocaleUpper(value, locale);
  }
  if (operation === "lower") {
    return safeLocaleLower(value, locale);
  }
  if (operation === "sentence") {
    return safeLocaleLower(value, locale).replace(
      SENTENCE_START_PATTERN,
      (_match, prefix, letter) => `${prefix}${safeLocaleUpper(letter, locale)}`
    );
  }
  if (operation === "title") {
    return value.replace(
      TITLE_WORD_PATTERN,
      (word) => capitalize(word, locale)
    );
  }
  const words = splitWords(value);
  const lowered = words.map((word) => safeLocaleLower(word, locale));
  switch (operation) {
    case "camel":
      return lowered.map((word, index) => index === 0 ? word : capitalize(word, locale)).join("");
    case "pascal":
      return lowered.map((word) => capitalize(word, locale)).join("");
    case "snake":
      return lowered.join("_");
    case "kebab":
      return lowered.join("-");
  }
}
function removeWhitespace(value, operation) {
  const normalized = value.replace(/\r\n?/g, "\n");
  switch (operation) {
    case "collapse-spaces":
      return normalized.split("\n").map((line) => line.replace(/[^\S\r\n]+/g, " ").trim()).join("\n");
    case "collapse-all":
      return normalized.replace(/\s+/gu, " ").trim();
    case "remove-blank-lines":
      return normalized.split("\n").filter((line) => line.trim().length > 0).join("\n");
    case "trim-lines":
      return normalized.split("\n").map((line) => line.trim()).join("\n");
  }
}
function createSlug(value, operation, locale) {
  const separator = operation === "hyphen" ? "-" : "_";
  const separatorPattern = new RegExp(`${separator}+`, "g");
  return safeLocaleLower(
    value.normalize("NFKD").replace(new RegExp("\\p{M}+", "gu"), "").replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, separator).replace(separatorPattern, separator).replace(new RegExp(`^${separator}|${separator}$`, "g"), ""),
    locale
  );
}
function encodeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
function decodeHtml(value) {
  if (typeof document === "undefined") {
    return {
      ok: false,
      error: {
        code: "BROWSER_API_UNAVAILABLE",
        message: "HTML entity decoding requires a browser document.",
        recoverable: true
      }
    };
  }
  const decoder = document.createElement("textarea");
  const decoded = value.replace(
    /&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g,
    (reference) => {
      decoder.innerHTML = reference;
      return decoder.value;
    }
  );
  return { ok: true, value: decoded };
}
function convertHtml(value, operation) {
  return operation === "encode" ? { ok: true, value: encodeHtml(value) } : decodeHtml(value);
}
function convertUrl(value, operation) {
  try {
    switch (operation) {
      case "encode-component":
        return { ok: true, value: encodeURIComponent(value) };
      case "decode-component":
        return { ok: true, value: decodeURIComponent(value) };
      case "encode-uri":
        return { ok: true, value: encodeURI(value) };
      case "decode-uri":
        return { ok: true, value: decodeURI(value) };
    }
  } catch {
    return {
      ok: false,
      error: {
        code: "MALFORMED_URL_ENCODING",
        message: operation === "decode-component" || operation === "decode-uri" ? "The value contains an incomplete or invalid percent escape." : "The value contains a character that cannot be URL encoded.",
        recoverable: true
      }
    };
  }
}
function transformTextValue(slug, input, locale) {
  if (input.value.length > 1024 * 1024 || new TextEncoder().encode(input.value).byteLength > 1024 * 1024) {
    return {
      ok: false,
      error: {
        code: "INPUT_TOO_LARGE",
        message: "INPUT_TOO_LARGE",
        recoverable: true
      }
    };
  }
  const definition = getTextToolDefinition(slug);
  const isKnownOperation = definition.modes.some(
    (mode) => mode.value === input.operation
  );
  if (!isKnownOperation) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_OPERATION",
        message: "Choose a supported transformation mode.",
        recoverable: true
      }
    };
  }
  switch (slug) {
    case "case-converter":
      return {
        ok: true,
        value: convertCase(
          input.value,
          input.operation,
          locale
        )
      };
    case "multiple-whitespace-remover":
      return {
        ok: true,
        value: removeWhitespace(
          input.value,
          input.operation
        )
      };
    case "url-slug-generator":
      return {
        ok: true,
        value: createSlug(
          input.value,
          input.operation,
          locale
        )
      };
    case "html-encoder-decoder":
      return convertHtml(input.value, input.operation);
    case "url-encoder-decoder":
      return convertUrl(input.value, input.operation);
  }
}
function abortedResult() {
  return {
    ok: false,
    error: {
      code: "ABORTED",
      message: "The local transformation was cancelled.",
      recoverable: true
    }
  };
}
function createTextExecutor(slug) {
  return {
    mode: "local",
    privacy: LOCAL_TEXT_PRIVACY,
    async execute(input, context) {
      if (context.signal.aborted) {
        return abortedResult();
      }
      await Promise.resolve();
      if (context.signal.aborted) {
        return abortedResult();
      }
      const result = transformTextValue(slug, input, context.locale);
      if (!result.ok) {
        return result;
      }
      return {
        ok: true,
        output: {
          value: result.value,
          fileName: getTextToolDefinition(slug).downloadFileName,
          mediaType: "text/plain;charset=utf-8"
        }
      };
    }
  };
}
var textToolExecutors = {
  "case-converter": createTextExecutor("case-converter"),
  "multiple-whitespace-remover": createTextExecutor(
    "multiple-whitespace-remover"
  ),
  "url-slug-generator": createTextExecutor("url-slug-generator"),
  "html-encoder-decoder": createTextExecutor("html-encoder-decoder"),
  "url-encoder-decoder": createTextExecutor("url-encoder-decoder")
};

// packages/cli/src/core.ts
var HASH_ALGORITHMS = [
  "md5",
  "sha1",
  "sha224",
  "sha256",
  "sha384",
  "sha512"
];
function ok(data) {
  return { ok: true, data };
}
function err(code) {
  return { ok: false, code };
}
function utf8Bytes(value) {
  return new TextEncoder().encode(value);
}
function hashText(text, algorithm = "sha256") {
  if (!text.isWellFormed()) return err("INVALID_UNICODE_INPUT");
  const bytes = utf8Bytes(text);
  const digest = createHash(algorithm).update(bytes).digest("hex");
  return ok({ algorithm, digest, inputByteLength: bytes.byteLength });
}
function base64Transform(text, operation, urlSafe) {
  const result = transformBase64Value({
    value: text,
    operation,
    options: { utf8: true, urlSafe, preserveLineBreaks: false }
  });
  return result.ok ? ok({ value: result.value }) : err(result.code);
}
var JWT_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/u;
var JWT_MAX_TOKEN_BYTES = 64 * 1024;
function decodeJwtToken(token, now = /* @__PURE__ */ new Date()) {
  const compact = token.trim();
  if (!compact) return err("EMPTY_TOKEN");
  if (utf8Bytes(token).byteLength > JWT_MAX_TOKEN_BYTES) {
    return err("TOKEN_TOO_LARGE");
  }
  if (!JWT_TOKEN_PATTERN.test(compact) || compact.split(".").some((part) => part.length % 4 === 1)) {
    return err("INVALID_TOKEN");
  }
  const segments = compact.split(".");
  try {
    const header = decodeJwtSegment(segments[0]);
    const payload = decodeJwtSegment(segments[1]);
    return ok({
      header,
      payload,
      signature: segments[2] ?? "",
      times: inspectJwtTimes(payload, now),
      verified: false
    });
  } catch {
    return err("INVALID_TOKEN");
  }
}
var MAX_IDENTIFIER_BATCH_COUNT2 = 100;
function generateIdentifiersOp(format, count, dependencies) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_IDENTIFIER_BATCH_COUNT2) {
    return err("INVALID_BATCH_COUNT");
  }
  try {
    const identifiers = generateIdentifiers(
      format,
      count,
      "canonical",
      dependencies
    );
    return ok({ format, values: identifiers.map((item) => item.value) });
  } catch (error) {
    if (error instanceof IdentifierError) return err(error.code);
    return err("INTERNAL_ERROR");
  }
}
function timestampConvert(source, options) {
  try {
    return ok(
      convertTimestamp({
        source,
        mode: "auto",
        sourceTimeZone: "UTC",
        outputTimeZone: options.outputTimeZone,
        ambiguousPreference: "earlier"
      })
    );
  } catch (error) {
    if (isTimeToolRuntimeError(error)) return err(error.code);
    return err("INTERNAL_ERROR");
  }
}
function cronExplain(expression, options) {
  try {
    return ok(
      calculateCron({
        expression,
        timeZone: options.timeZone,
        startMs: options.startMs,
        count: options.count
      })
    );
  } catch (error) {
    if (isTimeToolRuntimeError(error)) return err(error.code);
    return err("INTERNAL_ERROR");
  }
}
function urlTransform(text, operation) {
  const result = transformTextValue(
    "url-encoder-decoder",
    { value: text, operation },
    "en"
  );
  return result.ok ? ok({ value: result.value }) : err(result.error.code);
}

// packages/cli/src/render.ts
function renderHash(output) {
  return output.digest;
}
function renderValue(output) {
  return output.value;
}
function renderIdentifiers(output) {
  return output.values.join("\n");
}
function renderJwt(output) {
  return JSON.stringify(
    {
      header: output.header,
      payload: output.payload,
      signature: output.signature,
      times: output.times,
      verified: output.verified
    },
    null,
    2
  );
}
function renderTimestamp(output) {
  return [
    `unix_seconds: ${output.unixSeconds}`,
    `unix_milliseconds: ${output.unixMilliseconds}`,
    `iso: ${output.iso}`,
    `utc: ${output.utc}`,
    `zoned (${output.outputTimeZone}): ${output.zoned}`,
    `detected_mode: ${output.detectedMode}${output.autoDetected ? " (auto)" : ""}`
  ].join("\n");
}
function renderCron(output) {
  const lines = [
    `expression: ${output.normalized}`,
    `time_zone: ${output.timeZone}`,
    `day_mode: ${output.dayMode} (DOM/DOW ${output.dayMode})`,
    ...output.fields.map(
      (field) => `field_${field.field}: ${field.values.join(" ")}`
    ),
    `next_runs (${output.nextRuns.length}${output.complete ? "" : ` of ${output.requestedCount} requested, search window ended ${output.searchEndIso}`}):`,
    ...output.nextRuns.map((run2) => `${run2.iso} | ${run2.zoned}`)
  ];
  return lines.join("\n");
}

// packages/cli/src/mcp.ts
var PROTOCOL = "2025-11-25";
var SERVER_NAME = "toolars-cli";
var VERSION = "0.1.0";
var MAX_FRAME_BYTES = 1600 * 1024;
var TIME_ZONE_DESCRIPTION = "One of UTC, local, America/New_York, Europe/London, Europe/Berlin, Asia/Shanghai, Asia/Tokyo, Asia/Seoul, Asia/Kolkata, Australia/Sydney.";
var LOCAL_NOTE = "Runs entirely locally; no network or filesystem access. Input and result enter the MCP client context and may be sent to its model provider.";
var textProperty = {
  type: "string",
  description: "UTF-8 text to process. Nothing is read from files or URLs."
};
var hashAlgorithmProperty = {
  type: "string",
  description: "Digest algorithm. MD5 and SHA-1 are legacy integrity-only checks and are never signatures.",
  enum: HASH_ALGORITHMS,
  default: "sha256"
};
var timeZoneProperty = {
  type: "string",
  description: TIME_ZONE_DESCRIPTION,
  enum: [
    "UTC",
    "local",
    "America/New_York",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Asia/Kolkata",
    "Australia/Sydney"
  ],
  default: "UTC"
};
function defineTools(now) {
  return [
    {
      name: "toolars_hash",
      description: `Compute the hex digest of UTF-8 text with any algorithm the Toolars hash-checker tools ship (md5, sha1, sha224, sha256, sha384, sha512). Defaults to sha256. Identical to the corresponding Toolars *-hash-checker web tools. MD5 and SHA-1 are integrity-only legacy digests, never signatures. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: { text: textProperty, algorithm: hashAlgorithmProperty },
        required: ["text"]
      },
      handler: (args) => {
        const requested = args.algorithm;
        return hashText(args.text, requested ?? "sha256");
      },
      render: (data) => renderHash(data),
      idempotent: true
    },
    {
      // Preserve existing clients when adding the multi-algorithm tool.
      name: "toolars_hash_sha256",
      description: `Compute a SHA-256 hex digest. Compatibility alias for toolars_hash with algorithm sha256. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: { text: textProperty },
        required: ["text"]
      },
      handler: (args) => hashText(args.text, "sha256"),
      render: (data) => renderHash(data),
      idempotent: true
    },
    {
      name: "toolars_base64_encode",
      description: `Encode UTF-8 text as Base64 (standard or URL-safe alphabet), identical to the Toolars base64-encoder-decoder web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          text: textProperty,
          urlSafe: {
            type: "boolean",
            description: "Use the URL-safe alphabet (- and _) and omit padding.",
            default: false
          }
        },
        required: ["text"]
      },
      handler: (args) => base64Transform(
        args.text,
        "encode",
        args.urlSafe === true
      ),
      render: (data) => renderValue(data),
      idempotent: true
    },
    {
      name: "toolars_base64_decode",
      description: `Decode Base64 text (standard or URL-safe alphabet) as UTF-8, identical to the Toolars base64-encoder-decoder web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          text: textProperty,
          urlSafe: {
            type: "boolean",
            description: "Accept the URL-safe alphabet (- and _).",
            default: false
          }
        },
        required: ["text"]
      },
      handler: (args) => base64Transform(
        args.text,
        "decode",
        args.urlSafe === true
      ),
      render: (data) => renderValue(data),
      idempotent: true
    },
    {
      name: "toolars_jwt_decode",
      description: `Parse a JWT (header, payload, time-claim report) WITHOUT verifying the signature. Never trust the claims; verification is intentionally not offered. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "The compact JWT: header.payload.signature."
          }
        },
        required: ["token"]
      },
      handler: (args) => decodeJwtToken(args.token, new Date(now())),
      render: (data) => "WARNING: signature NOT verified \u2014 decode only. Do not trust claims.\n" + renderJwt(data),
      idempotent: true
    },
    {
      name: "toolars_uuid_generate",
      description: `Generate random RFC 9562 UUIDs (version 4 or 7), identical to the Toolars uuid-ulid-generator web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          version: {
            type: "string",
            description: "UUID version to generate.",
            enum: ["v4", "v7"],
            default: "v4"
          },
          count: {
            type: "integer",
            description: "How many identifiers to generate.",
            minimum: 1,
            maximum: MAX_IDENTIFIER_BATCH_COUNT2,
            default: 1
          }
        },
        required: []
      },
      handler: (args) => generateIdentifiersOp(
        args.version === "v7" ? "uuid-v7" : "uuid-v4",
        args.count ?? 1
      ),
      render: (data) => renderIdentifiers(data),
      idempotent: false
    },
    {
      name: "toolars_ulid_generate",
      description: `Generate ULIDs (timestamp-ordered identifiers), identical to the Toolars uuid-ulid-generator web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            description: "How many identifiers to generate.",
            minimum: 1,
            maximum: MAX_IDENTIFIER_BATCH_COUNT2,
            default: 1
          }
        },
        required: []
      },
      handler: (args) => generateIdentifiersOp(
        "ulid",
        args.count ?? 1
      ),
      render: (data) => renderIdentifiers(data),
      idempotent: false
    },
    {
      name: "toolars_timestamp_convert",
      description: `Convert a Unix timestamp (seconds/milliseconds), ISO 8601, RFC 2822, or wall time into all common representations, identical to the Toolars timestamp-time-zone-converter web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: 'Timestamp to convert, e.g. "1726848000", "1726848000000", "2024-09-20T12:34:56Z", or wall time "2024-09-20 12:34" (interpreted in outputTimeZone).'
          },
          outputTimeZone: timeZoneProperty
        },
        required: ["source"]
      },
      handler: (args) => timestampConvert(args.source, {
        outputTimeZone: args.outputTimeZone ?? "UTC"
      }),
      render: (data) => renderTimestamp(data),
      idempotent: true
    },
    {
      name: "toolars_cron_explain",
      description: `Explain a 5-field cron expression and list the next scheduled runs, identical to the Toolars cron-builder-explainer web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: 'Five-field cron expression, e.g. "*/15 9-17 * * MON-FRI".'
          },
          count: {
            type: "integer",
            description: "How many upcoming runs to list (at most 25).",
            minimum: 1,
            maximum: 25,
            default: 5
          },
          timeZone: timeZoneProperty
        },
        required: ["expression"]
      },
      handler: (args) => cronExplain(args.expression, {
        count: args.count ?? 5,
        timeZone: args.timeZone ?? "UTC",
        startMs: now()
      }),
      render: (data) => renderCron(data),
      idempotent: true
    },
    {
      name: "toolars_url_encode",
      description: `Percent-encode text (encodeURIComponent or encodeURI semantics), identical to the Toolars url-encoder-decoder web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          text: textProperty,
          mode: {
            type: "string",
            description: "component encodes every reserved character (encodeURIComponent); uri leaves URI structure characters (encodeURI).",
            enum: ["component", "uri"],
            default: "component"
          }
        },
        required: ["text"]
      },
      handler: (args) => {
        const mode = args.mode === "uri" ? "encode-uri" : "encode-component";
        return urlTransform(args.text, mode);
      },
      render: (data) => renderValue(data),
      idempotent: true
    },
    {
      name: "toolars_url_decode",
      description: `Decode percent-encoded text (decodeURIComponent or decodeURI semantics), identical to the Toolars url-encoder-decoder web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          text: textProperty,
          mode: {
            type: "string",
            description: "component decodes every escape sequence; uri preserves URI structure characters.",
            enum: ["component", "uri"],
            default: "component"
          }
        },
        required: ["text"]
      },
      handler: (args) => {
        const mode = args.mode === "uri" ? "decode-uri" : "decode-component";
        return urlTransform(args.text, mode);
      },
      render: (data) => renderValue(data),
      idempotent: true
    }
  ];
}
var isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? 0, error: { code, message } });
function validateArgs(schema, args) {
  if (!isObject(args)) return "arguments must be an object";
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(schema.properties, key)) {
      return `unexpected argument: ${key}`;
    }
  }
  for (const name of schema.required) {
    if (!Object.hasOwn(args, name)) return `missing required argument: ${name}`;
  }
  for (const [name, property] of Object.entries(schema.properties)) {
    const value = args[name];
    if (value === void 0) continue;
    if (property.type === "string" && typeof value !== "string") {
      return `${name} must be a string`;
    }
    if (property.type === "boolean" && typeof value !== "boolean") {
      return `${name} must be a boolean`;
    }
    if (property.type === "integer" && !Number.isSafeInteger(value)) {
      return `${name} must be an integer`;
    }
    if (property.enum && !property.enum.includes(value)) {
      return `${name} must be one of: ${property.enum.join(", ")}`;
    }
    if (typeof value === "number" && (property.minimum !== void 0 && value < property.minimum || property.maximum !== void 0 && value > property.maximum)) {
      return `${name} must be between ${property.minimum} and ${property.maximum}`;
    }
  }
  return null;
}
async function createMcpServer(io, options = {}) {
  const now = options.now ?? Date.now;
  const tools = defineTools(now);
  let state = "new";
  const send = async (message) => {
    if (message) await io.write(JSON.stringify(message));
  };
  const dispatch = (message) => {
    if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" || "id" in message && !(typeof message.id === "string" || Number.isSafeInteger(message.id)) || "params" in message && !isObject(message.params)) {
      return rpcError(null, -32600, "Invalid Request");
    }
    if (!("id" in message)) {
      if (message.method === "notifications/initialized" && state === "initializing") {
        state = "ready";
      }
      return null;
    }
    const id = message.id;
    const method = message.method;
    const params = message.params === void 0 ? {} : message.params;
    const result = (value) => ({
      jsonrpc: "2.0",
      id,
      result: value
    });
    if (method === "ping") return result({});
    if (method === "initialize") {
      if (state !== "new") return rpcError(id, -32600, "Already initialized");
      const clientInfo = params.clientInfo;
      if (typeof params.protocolVersion !== "string" || !isObject(params.capabilities) || !isObject(clientInfo) || typeof clientInfo.name !== "string" || typeof clientInfo.version !== "string") {
        return rpcError(id, -32602, "Invalid params");
      }
      state = "initializing";
      return result({
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions: "Local stdio tools reusing the Toolars website runtimes; no network or filesystem tool capability. JWT decode never verifies signatures. Inputs and results are visible to your MCP client and may be sent to its model provider; review client data settings before use."
      });
    }
    if (state !== "ready") {
      return rpcError(id, -32600, "Initialization required");
    }
    if (method === "tools/list") {
      if (params.cursor !== void 0) {
        return rpcError(id, -32602, "Invalid cursor");
      }
      return result({
        tools: tools.map((tool2) => ({
          name: tool2.name,
          description: tool2.description,
          inputSchema: tool2.inputSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: tool2.idempotent,
            openWorldHint: false
          }
        }))
      });
    }
    if (method !== "tools/call") {
      return rpcError(id, -32601, "Method not found");
    }
    const tool = tools.find((item) => item.name === params.name);
    if (!tool) return rpcError(id, -32602, "Unknown tool");
    const args = params.arguments;
    const validationError = validateArgs(tool.inputSchema, args);
    if (validationError) return rpcError(id, -32602, validationError);
    const output = tool.handler(args);
    if (!output.ok) {
      return result({
        content: [{ type: "text", text: output.code }],
        isError: true
      });
    }
    return result({
      content: [{ type: "text", text: tool.render(output.data) }],
      isError: false
    });
  };
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of io.read()) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      let start = 0;
      while (start < buffer.length) {
        const newline = buffer.indexOf(10, start);
        const end = newline < 0 ? buffer.length : newline;
        if (pending.length + end - start > MAX_FRAME_BYTES) {
          await send(rpcError(null, -32600, "Frame too large"));
          process.exitCode = 1;
          return;
        }
        pending = Buffer.concat([pending, buffer.subarray(start, end)]);
        if (newline < 0) break;
        let message;
        try {
          message = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(pending)
          );
        } catch {
          await send(rpcError(null, -32700, "Parse error"));
          pending = Buffer.alloc(0);
          start = newline + 1;
          continue;
        }
        await send(dispatch(message));
        pending = Buffer.alloc(0);
        start = newline + 1;
      }
    }
    if (pending.length && !process.exitCode) {
      await send(rpcError(null, -32700, "Incomplete frame"));
    }
  } catch {
    process.exitCode = 1;
  }
}
if (false) {
  createMcpServer({
    read: () => process.stdin,
    write: async (line) => {
      process.stdout.write(line + "\n");
    }
  }).catch(() => {
    process.exitCode = 1;
  });
}

// packages/cli/src/cli.ts
var VERSION2 = "0.1.0";
var USAGE = `toolars ${VERSION2} \u2014 local-first developer utilities (https://toolars.com)

Usage:
  toolars hash [--md5|--sha1|--sha224|--sha256|--sha384|--sha512] [text] [--json]
  toolars base64 encode|decode [text] [--url-safe] [--json]
  toolars jwt decode <token> [--json]
  toolars uuid [--v7] [--count N] [--json]
  toolars ulid [--count N] [--json]
  toolars timestamp <value> [--output-tz ZONE] [--json]
  toolars cron explain "<expression>" [--count N] [--tz ZONE] [--json]
  toolars url encode|decode [text] [--mode component|uri] [--json]
  toolars mcp
  toolars --help | --version

Input comes from one quoted argument when given, otherwise from stdin. One
trailing line break is stripped from stdin; pipe without a trailing newline
to retain exact bytes. Use -- before text that begins with a dash.

All computation runs locally. No network calls, no telemetry. Output goes to
stdout; stable error codes go to stderr with exit code 1; usage errors exit 2.
hash defaults to --sha256; --md5 and --sha1 are integrity-only legacy digests
and are never signatures. jwt decode parses only \u2014 the signature is NEVER
verified.`;
var UsageError = class extends Error {
};
var VALUE_FLAGS = /* @__PURE__ */ new Set(["count", "mode", "tz", "output-tz"]);
function parseArgs(argv) {
  const positionals = [];
  const flags = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-") || /^-\d/u.test(arg)) {
      positionals.push(arg);
      continue;
    }
    const inline = /^--?([^=]+)=(.*)$/u.exec(arg);
    if (inline) {
      if (flags.has(inline[1]))
        throw new UsageError(`duplicate option: --${inline[1]}`);
      flags.set(inline[1], inline[2]);
      continue;
    }
    const name = arg.replace(/^--?/, "");
    if (flags.has(name)) throw new UsageError(`duplicate option: --${name}`);
    const next = argv[index + 1];
    if (VALUE_FLAGS.has(name)) {
      if (next === void 0 || next.startsWith("-") && !/^-\d/u.test(next)) {
        throw new UsageError(`--${name} requires a value`);
      }
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positionals, flags };
}
var COMMAND_OPTIONS = {
  hash: { flags: [...HASH_ALGORITHMS, "json"], maxPositionals: 2 },
  base64: { flags: ["url-safe", "json"], maxPositionals: 3 },
  jwt: { flags: ["json"], maxPositionals: 3 },
  uuid: { flags: ["v7", "count", "json"], maxPositionals: 1 },
  ulid: { flags: ["count", "json"], maxPositionals: 1 },
  timestamp: { flags: ["output-tz", "json"], maxPositionals: 2 },
  cron: { flags: ["count", "tz", "json"], maxPositionals: 3 },
  url: { flags: ["mode", "json"], maxPositionals: 3 },
  mcp: { flags: [], maxPositionals: 1 },
  help: { flags: [], maxPositionals: 1 }
};
function validateArgs2(positionals, flags) {
  const command = positionals[0] ?? "help";
  const contract = Object.hasOwn(COMMAND_OPTIONS, command) ? COMMAND_OPTIONS[command] : void 0;
  if (!contract) throw new UsageError(`unknown command: ${command}`);
  if (positionals.length > contract.maxPositionals) {
    throw new UsageError(
      `too many arguments for ${command}; quote text containing spaces`
    );
  }
  const allowed = /* @__PURE__ */ new Set([...contract.flags, "help", "version"]);
  for (const [name, value] of flags) {
    if (!allowed.has(name) || (VALUE_FLAGS.has(name) ? typeof value !== "string" || !value : value !== true)) {
      throw new UsageError(`unsupported ${command} option: --${name}`);
    }
  }
}
function getStringFlag(flags, name) {
  const value = flags.get(name);
  return typeof value === "string" ? value : void 0;
}
function getBooleanFlag(flags, name) {
  return flags.get(name) === true;
}
function getCountFlag(flags, name, fallback) {
  const raw = getStringFlag(flags, name);
  if (raw === void 0) return fallback;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) {
    throw new UsageError(`--${name} must be a positive integer`);
  }
  return count;
}
function getTimeZoneFlag(flags, name, fallback) {
  const raw = getStringFlag(flags, name);
  if (raw === void 0) return fallback;
  const allowed = [
    "UTC",
    "local",
    "America/New_York",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Asia/Kolkata",
    "Australia/Sydney"
  ];
  if (!allowed.includes(raw)) {
    throw new UsageError(`--${name} must be one of: ${allowed.join(", ")}`);
  }
  return raw;
}
async function readTextInput(positional, stream) {
  if (positional !== void 0) return positional;
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  let text = new TextDecoder("utf-8", { fatal: false }).decode(
    concatBytes(chunks)
  );
  if (text.endsWith("\n")) {
    text = text.slice(0, -1);
    if (text.endsWith("\r")) text = text.slice(0, -1);
  }
  return text;
}
function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
function emit(result, jsonMode, render) {
  if (!result.ok) {
    process.stderr.write(
      (jsonMode ? JSON.stringify({ error: result.code }) : result.code) + "\n"
    );
    return 1;
  }
  process.stdout.write(
    (jsonMode ? JSON.stringify(result.data, null, 2) : render(result.data)) + "\n"
  );
  return 0;
}
async function run(argv, stdin) {
  const { positionals, flags } = parseArgs(argv);
  validateArgs2(positionals, flags);
  const jsonMode = getBooleanFlag(flags, "json");
  const command = positionals[0];
  const subcommand = positionals[1];
  const operand = positionals[2];
  if (getBooleanFlag(flags, "version")) {
    process.stdout.write(VERSION2 + "\n");
    return 0;
  }
  if (command === void 0 || command === "help" || getBooleanFlag(flags, "help")) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  switch (command) {
    case "hash": {
      const requested = HASH_ALGORITHMS.filter(
        (algorithm) => getBooleanFlag(flags, algorithm)
      );
      if (requested.length > 1) {
        throw new UsageError(
          `choose at most one algorithm (got ${requested.map((algorithm) => `--${algorithm}`).join(", ")})`
        );
      }
      const input = await readTextInput(subcommand, stdin);
      return emit(
        hashText(input, requested[0] ?? "sha256"),
        jsonMode,
        renderHash
      );
    }
    case "base64": {
      if (subcommand !== "encode" && subcommand !== "decode") {
        throw new UsageError("usage: toolars base64 encode|decode [text]");
      }
      const input = await readTextInput(operand, stdin);
      const urlSafe = getBooleanFlag(flags, "url-safe");
      return emit(
        base64Transform(input, subcommand, urlSafe),
        jsonMode,
        renderValue
      );
    }
    case "jwt": {
      if (subcommand !== "decode") {
        throw new UsageError("usage: toolars jwt decode <token>");
      }
      const token = operand ?? await readTextInput(void 0, stdin);
      const result = decodeJwtToken(token);
      if (!result.ok) return emit(result, jsonMode, renderJwt);
      process.stderr.write(
        "WARNING: signature NOT verified \u2014 decode only. Do not trust claims.\n"
      );
      return emit(result, jsonMode, renderJwt);
    }
    case "uuid": {
      const format = getBooleanFlag(flags, "v7") ? "uuid-v7" : "uuid-v4";
      const count = getCountFlag(flags, "count", 1);
      if (count > MAX_IDENTIFIER_BATCH_COUNT2) {
        throw new UsageError(
          `--count must be at most ${MAX_IDENTIFIER_BATCH_COUNT2}`
        );
      }
      return emit(
        generateIdentifiersOp(format, count),
        jsonMode,
        renderIdentifiers
      );
    }
    case "ulid": {
      const count = getCountFlag(flags, "count", 1);
      if (count > MAX_IDENTIFIER_BATCH_COUNT2) {
        throw new UsageError(
          `--count must be at most ${MAX_IDENTIFIER_BATCH_COUNT2}`
        );
      }
      return emit(
        generateIdentifiersOp("ulid", count),
        jsonMode,
        renderIdentifiers
      );
    }
    case "timestamp": {
      const source = subcommand ?? await readTextInput(void 0, stdin);
      const outputTimeZone = getTimeZoneFlag(flags, "output-tz", "UTC");
      return emit(
        timestampConvert(source, { outputTimeZone }),
        jsonMode,
        renderTimestamp
      );
    }
    case "cron": {
      if (subcommand !== "explain") {
        throw new UsageError('usage: toolars cron explain "<expression>"');
      }
      const expression = operand ?? await readTextInput(void 0, stdin);
      const count = getCountFlag(flags, "count", 5);
      if (count > 25) throw new UsageError("--count must be at most 25");
      const timeZone = getTimeZoneFlag(flags, "tz", "UTC");
      return emit(
        cronExplain(expression, { count, timeZone, startMs: Date.now() }),
        jsonMode,
        renderCron
      );
    }
    case "url": {
      if (subcommand !== "encode" && subcommand !== "decode") {
        throw new UsageError("usage: toolars url encode|decode [text]");
      }
      const mode = getStringFlag(flags, "mode") ?? "component";
      if (mode !== "component" && mode !== "uri") {
        throw new UsageError("--mode must be component or uri");
      }
      const operation = subcommand === "encode" ? mode === "uri" ? "encode-uri" : "encode-component" : mode === "uri" ? "decode-uri" : "decode-component";
      const input = await readTextInput(operand, stdin);
      return emit(urlTransform(input, operation), jsonMode, renderValue);
    }
    case "mcp": {
      await createMcpServer({
        read: () => process.stdin,
        write: async (line) => {
          process.stdout.write(line + "\n");
        }
      });
      return 0;
    }
    default:
      throw new UsageError(`unknown command: ${command}`);
  }
}
if (isMainEntry(import.meta.url)) {
  run(process.argv.slice(2), process.stdin).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`USAGE_ERROR: ${error.message}

${USAGE}
`);
      process.exitCode = 2;
    } else {
      process.stderr.write("INTERNAL_ERROR\n");
      process.exitCode = 1;
    }
  });
}
export {
  USAGE,
  run
};
