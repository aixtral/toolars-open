import type {
  JsonParseErrorCode,
  JsonParseErrorLocation,
  JsonParseHintCode,
  JsonParseLimits,
  JsonParseResult,
  JsonValue,
  JsonValueType,
} from "./definitions";

export const JSON_PARSE_LIMITS = {
  maxBytes: 256 * 1024,
  maxDepth: 40,
  maxNodes: 10_000,
} as const satisfies JsonParseLimits;

const UNSAFE_PROPERTY_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function errorResult(
  code: JsonParseErrorCode,
  message: string,
  values?: Readonly<Record<string, number | string>>,
  details?: Readonly<{
    hintCode?: JsonParseHintCode;
    location?: JsonParseErrorLocation;
  }>,
): JsonParseResult {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(values ? { values } : {}),
      ...(details?.hintCode ? { hintCode: details.hintCode } : {}),
      ...(details?.location ? { location: details.location } : {}),
    },
  };
}

function getErrorLocation(
  source: string,
  offset: number,
): JsonParseErrorLocation {
  const safeOffset = Math.min(Math.max(0, offset), source.length);
  const before = source.slice(0, safeOffset);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = source.indexOf("\n", safeOffset);
  const completeLine = source.slice(
    lineStart,
    lineEnd === -1 ? source.length : lineEnd,
  );
  const column = safeOffset - lineStart + 1;
  const excerptStart = Math.max(
    0,
    Math.min(column - 1 - 48, completeLine.length),
  );
  const excerpt = completeLine.slice(excerptStart, excerptStart + 120);

  return {
    offset: safeOffset,
    line,
    column,
    excerpt,
    excerptColumn: column - excerptStart,
  };
}

// Number lexemes and object entry order are retained independently of JavaScript's
// IEEE-754 conversion and integer-key enumeration rules. They never leave this tab.
export class JsonNumber {
  constructor(readonly raw: string) {}
}

/** Exact decimal value, without rounding through IEEE-754 or expanding exponents.
 * JSON numeric equality ignores notation and the sign of zero; formatJson keeps
 * the original spelling for display and export.
 */
export function jsonNumberKey(value: number | JsonNumber): string {
  const raw = value instanceof JsonNumber ? value.raw : String(value);
  const [mantissa = "", exponent = "0"] = raw.toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [integer, fraction = ""] = unsigned.split(".");
  const digits = `${integer}${fraction}`.replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  const power =
    BigInt(exponent) -
    BigInt(fraction.length) +
    BigInt(digits.length - significant.length);
  return `${negative ? "-" : ""}${significant}e${power}`;
}
const orderedEntries = new WeakMap<
  object,
  readonly (readonly [string, JsonValue])[]
>();

export function getJsonEntries(
  value: JsonValue,
): readonly (readonly [string, JsonValue])[] {
  if (
    value === null ||
    typeof value !== "object" ||
    value instanceof JsonNumber
  )
    return [];
  return orderedEntries.get(value) ?? Object.entries(value);
}

export function getJsonValueType(value: JsonValue): JsonValueType {
  if (value instanceof JsonNumber) return "number";
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value as Exclude<JsonValueType, "array" | "null">;
}

export function getJsonSizeLabel(value: JsonValue): string | null {
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }

  if (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof JsonNumber)
  ) {
    const size = Object.keys(value).length;
    return `${size} ${size === 1 ? "key" : "keys"}`;
  }

  if (typeof value === "string") {
    return `${Array.from(value).length} chars`;
  }

  return null;
}

export function formatJsonPrimitive(value: JsonValue): string {
  if (value instanceof JsonNumber) return value.raw;
  if (typeof value === "string") {
    const characters = Array.from(value);
    return JSON.stringify(
      characters.length > 160 ? `${characters.slice(0, 160).join("")}…` : value,
    );
  }
  return String(value);
}

export function formatJson(
  value: JsonValue,
  indent: 0 | 2 | 4,
  depth = 0,
): string {
  if (value instanceof JsonNumber) return value.raw;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const array = Array.isArray(value);
  const entries = getJsonEntries(value);
  const parts = entries.map(
    ([key, child]) =>
      `${array ? "" : `${JSON.stringify(key)}:${indent ? " " : ""}`}${formatJson(child, indent, depth + 1)}`,
  );
  const [open, close] = array ? ["[", "]"] : ["{", "}"];
  if (!parts.length) return `${open}${close}`;
  if (!indent) return `${open}${parts.join(",")}${close}`;
  const padding = " ".repeat((depth + 1) * indent);
  return `${open}\n${padding}${parts.join(`,\n${padding}`)}\n${" ".repeat(depth * indent)}${close}`;
}

export function parseJsonInput(
  source: string,
  limits: JsonParseLimits = JSON_PARSE_LIMITS,
): JsonParseResult {
  if (!source.trim())
    return errorResult("EMPTY_INPUT", "Enter JSON before parsing.");
  if (new TextEncoder().encode(source).byteLength > limits.maxBytes) {
    return errorResult(
      "INPUT_TOO_LARGE",
      "JSON input exceeds the byte limit.",
      { max: limits.maxBytes },
    );
  }
  let offset = 0;
  let nodeCount = 0;
  let maxDepth = 0;
  const whitespace = () => {
    while (/[ \t\r\n]/.test(source[offset] ?? "x")) offset++;
  };
  // Throw only our own result objects; syntax locations do not depend on browser messages.
  const fail = (hintCode: JsonParseHintCode = "CHECK_JSON_SYNTAX"): never => {
    throw errorResult(
      "INVALID_JSON",
      "JSON could not be parsed. Check commas, quotes, and closing brackets.",
      undefined,
      { hintCode, location: getErrorLocation(source, offset) },
    );
  };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      const c = source[offset++];
      if (c === '"') return JSON.parse(source.slice(start, offset)) as string;
      if (c === "\\") {
        const escape = source[offset++];
        if (escape === "u") {
          for (let i = 0; i < 4; i++) {
            if (!/[0-9a-f]/i.test(source[offset] ?? "z")) fail();
            offset++;
          }
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) {
          offset--;
          fail();
        }
      } else if (c && c.charCodeAt(0) < 32) {
        offset--;
        fail("COMPLETE_STRING");
      }
    }
    return fail("COMPLETE_STRING");
  };
  const value = (depth: number): JsonValue => {
    whitespace();
    if (++nodeCount > limits.maxNodes)
      throw errorResult("MAX_NODES_EXCEEDED", "JSON exceeds the node limit.", {
        max: limits.maxNodes,
      });
    if (depth > limits.maxDepth)
      throw errorResult(
        "MAX_DEPTH_EXCEEDED",
        "JSON exceeds the nesting limit.",
        { max: limits.maxDepth },
      );
    maxDepth = Math.max(maxDepth, depth);
    const c = source[offset];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      offset++;
      const array = c === "[";
      const close = array ? "]" : "}";
      const result: JsonValue[] | Record<string, JsonValue> = array ? [] : {};
      const entries: [string, JsonValue][] = [];
      const keys = new Set<string>();
      whitespace();
      if (source[offset] === close) {
        offset++;
        return result;
      }
      while (offset < source.length) {
        whitespace();
        let key = String(entries.length);
        if (!array) {
          if (source[offset] !== '"') fail("QUOTE_PROPERTY");
          key = string();
          if (UNSAFE_PROPERTY_NAMES.has(key))
            throw errorResult("UNSAFE_PROPERTY", "Reserved property name.", {
              key: JSON.stringify(key),
            });
          // Duplicate members are ambiguous; never silently discard an earlier value.
          if (keys.has(key)) fail();
          keys.add(key);
          whitespace();
          if (source[offset] !== ":") fail("ADD_COLON");
          offset++;
        }
        const child = value(depth + 1);
        if (Array.isArray(result)) result.push(child);
        else result[key] = child;
        entries.push([key, child]);
        whitespace();
        if (source[offset] === close) {
          offset++;
          orderedEntries.set(result, entries);
          return result;
        }
        if (offset === source.length) fail("CLOSE_STRUCTURE");
        if (source[offset] !== ",") fail("ADD_COMMA_OR_CLOSE");
        offset++;
        whitespace();
        if (source[offset] === close) fail("REMOVE_TRAILING_COMMA");
      }
      return fail("CLOSE_STRUCTURE");
    }
    for (const [token, primitive] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (source.startsWith(token, offset)) {
        offset += token.length;
        return primitive;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      source.slice(offset),
    );
    if (number) {
      const raw = number[0];
      offset += raw.length;
      const numeric = Number(raw);
      return String(numeric) === raw ? numeric : new JsonNumber(raw);
    }
    return fail(
      offset === source.length ? "CLOSE_STRUCTURE" : "CHECK_JSON_SYNTAX",
    );
  };
  try {
    const parsed = value(0);
    whitespace();
    if (offset !== source.length) fail();
    return { ok: true, value: parsed, nodeCount, maxDepth };
  } catch (error) {
    // All grammar paths validate string escapes before using the native string decoder.
    if (error && typeof error === "object" && "ok" in error)
      return error as JsonParseResult;
    return errorResult("INVALID_JSON", "JSON could not be parsed.");
  }
}
