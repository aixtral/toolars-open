import {
  TIME_TOOL_LIMITS,
  TIME_ZONE_OPTIONS,
  type AmbiguousTimePreference,
  type TimeZoneOption,
  type TimestampInput,
  type TimestampInputMode,
  type TimestampOutput,
} from "./definitions";
import { TimeToolRuntimeError } from "./errors";

const WALL_TIME_PATTERN =
  /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u;
const NUMBER_PATTERN = /^[+-]?\d+(?:\.\d+)?$/u;
const MAX_MS = 8_640_000_000_000_000n;
type WallParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}>;

function resolveTimeZone(timeZone: TimeZoneOption): string {
  if (!TIME_ZONE_OPTIONS.includes(timeZone))
    throw new TimeToolRuntimeError("INVALID_TIME_ZONE");
  const resolved =
    timeZone === "local"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: resolved }).format(0);
  } catch {
    throw new TimeToolRuntimeError("INVALID_TIME_ZONE");
  }
  return resolved;
}

// Date.UTC maps years 0–99 to 1900–1999; explicit full-year setters do not.
function wallEpoch(parts: WallParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond);
  return date.getTime();
}
function parseWallParts(source: string): WallParts {
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
    millisecond: Number((match[7] ?? "").padEnd(3, "0")),
  };
  const date = new Date(wallEpoch(parts));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() + 1 !== parts.month ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== parts.second
  )
    throw new TimeToolRuntimeError("INVALID_WALL_TIME");
  return parts;
}
function zoneFormatter(timeZone: string) {
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
    hourCycle: "h23",
  });
}
function partsInZone(
  instantMs: number,
  formatter: Intl.DateTimeFormat,
): WallParts {
  const parts = formatter.formatToParts(instantMs);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const year = value("year");
  return {
    year: parts.find((p) => p.type === "era")?.value === "BC" ? 1 - year : year,
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
    millisecond: ((instantMs % 1000) + 1000) % 1000,
  };
}
function offsetAt(instantMs: number, formatter: Intl.DateTimeFormat): number {
  return wallEpoch(partsInZone(instantMs, formatter)) - instantMs;
}
function wallTimeToInstant(
  source: string,
  timeZone: string,
  preference: AmbiguousTimePreference,
) {
  const target = parseWallParts(source),
    approximate = wallEpoch(target);
  const formatter = zoneFormatter(timeZone);
  // Sample actual offsets surrounding the requested civil date, including
  // second-level historical offsets. Every candidate must round-trip exactly.
  // This bounded resolver is covered against the exposed zones' TZif data.
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours++) {
    const sample = approximate + hours * 3_600_000;
    if (Math.abs(sample) <= Number(MAX_MS))
      offsets.add(offsetAt(sample, formatter));
  }
  const candidates = [...offsets]
    .map((offset) => approximate - offset)
    .filter(
      (candidate) =>
        Math.abs(candidate) <= Number(MAX_MS) &&
        wallEpoch(partsInZone(candidate, formatter)) === approximate,
    )
    .sort((a, b) => a - b);
  if (!candidates.length)
    throw new TimeToolRuntimeError("NONEXISTENT_WALL_TIME");
  return {
    instantMs: preference === "later" ? candidates.at(-1)! : candidates[0]!,
    candidates,
  };
}
function parseNumeric(
  source: string,
  mode: "seconds" | "milliseconds",
): number {
  if (!NUMBER_PATTERN.test(source))
    throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
  const negative = source.startsWith("-");
  const [whole, fraction = ""] = source.replace(/^[+-]/, "").split(".");
  const precision = mode === "seconds" ? 3 : 0;
  if (/[^0]/.test(fraction.slice(precision)))
    throw new TimeToolRuntimeError("TIMESTAMP_PRECISION");
  const absolute =
    BigInt(whole!) * (mode === "seconds" ? 1000n : 1n) +
    BigInt(fraction.slice(0, precision).padEnd(precision, "0") || "0");
  const ms = negative ? -absolute : absolute;
  if (ms < -MAX_MS || ms > MAX_MS)
    throw new TimeToolRuntimeError("TIMESTAMP_OUT_OF_RANGE");
  return Number(ms);
}
function parseIsoOrRfc(source: string): number {
  const iso = /^(.*[Tt ].*?)([Zz]|[+-]\d{2}:\d{2})$/u.exec(source);
  if (iso) {
    let parts: WallParts;
    try {
      parts = parseWallParts(iso[1]!.replace("t", "T"));
    } catch {
      throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
    }
    const suffix = iso[2]!;
    const hours = Number(suffix.slice(1, 3)),
      minutes = Number(suffix.slice(4, 6));
    if (
      suffix.toUpperCase() !== "Z" &&
      (hours > 23 || minutes > 59 || suffix === "-00:00")
    )
      throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
    const offset =
      suffix.toUpperCase() === "Z"
        ? 0
        : (suffix.startsWith("-") ? -1 : 1) * (hours * 60 + minutes) * 60_000;
    return wallEpoch(parts) - offset;
  }
  // Deliberately bounded RFC 2822 form: optional English weekday, four-digit
  // year, seconds and GMT/UTC or a numeric offset. No host-dependent guessing.
  const rfc =
    /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat), )?(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) (GMT|UTC|[+-]\d{4})$/u.exec(
      source,
    );
  if (!rfc) throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
  const month =
    [
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
      "Dec",
    ].indexOf(rfc[3]!) + 1;
  const wall = `${rfc[4]}-${String(month).padStart(2, "0")}-${rfc[2]}T${rfc[5]}:${rfc[6]}:${rfc[7]}`;
  let parts: WallParts;
  try {
    parts = parseWallParts(wall);
  } catch {
    throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
  }
  if (
    rfc[1] &&
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
      new Date(wallEpoch(parts)).getUTCDay()
    ] !== rfc[1]
  )
    throw new TimeToolRuntimeError("INVALID_TIMESTAMP");
  const offset = rfc[8]!;
  return parseIsoOrRfc(
    wall +
      (["GMT", "UTC"].includes(offset)
        ? "Z"
        : `${offset.slice(0, 3)}:${offset.slice(3)}`),
  );
}
function detectMode(source: string): Exclude<TimestampInputMode, "auto"> {
  if (WALL_TIME_PATTERN.test(source)) return "wall";
  if (NUMBER_PATTERN.test(source))
    return BigInt(source.replace(/^[+-]/, "").split(".")[0]!) >=
      100_000_000_000n
      ? "milliseconds"
      : "seconds";
  return "iso";
}
function formatInZone(
  instantMs: number,
  timeZone: string,
  locale?: string,
): string {
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
    hourCycle: "h23",
  }).format(instantMs);
}
function secondsText(ms: number): string {
  const negative = ms < 0,
    absolute = BigInt(Math.abs(ms));
  const fraction = String(absolute % 1000n)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / 1000n}${fraction ? "." + fraction : ""}`;
}
export function convertTimestamp(
  input: TimestampInput,
  locale?: string,
): TimestampOutput {
  if (
    new TextEncoder().encode(input.source).length >
    TIME_TOOL_LIMITS.timestampBytes
  )
    throw new TimeToolRuntimeError("TIMESTAMP_INPUT_TOO_LARGE");
  const source = input.source.trim();
  if (!source) throw new TimeToolRuntimeError("EMPTY_TIMESTAMP");
  if (
    !["auto", "seconds", "milliseconds", "iso", "wall"].includes(input.mode) ||
    !["earlier", "later"].includes(input.ambiguousPreference)
  )
    throw new TimeToolRuntimeError("INVALID_TIMESTAMP_OPTIONS");
  const sourceTimeZone = resolveTimeZone(input.sourceTimeZone),
    outputTimeZone = resolveTimeZone(input.outputTimeZone),
    localTimeZone = resolveTimeZone("local");
  const detectedMode = input.mode === "auto" ? detectMode(source) : input.mode;
  const wall =
    detectedMode === "wall"
      ? wallTimeToInstant(source, sourceTimeZone, input.ambiguousPreference)
      : null;
  const instantMs = wall
    ? wall.instantMs
    : detectedMode === "seconds" || detectedMode === "milliseconds"
      ? parseNumeric(source, detectedMode)
      : parseIsoOrRfc(source);
  if (!Number.isSafeInteger(instantMs) || Math.abs(instantMs) > Number(MAX_MS))
    throw new TimeToolRuntimeError("TIMESTAMP_OUT_OF_RANGE");
  const date = new Date(instantMs),
    discordSeconds = Math.floor(instantMs / 1000);
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
      shortDateTime: `<t:${discordSeconds}:f>`,
    },
    ambiguity:
      wall && wall.candidates.length > 1
        ? {
            count: wall.candidates.length,
            selected: input.ambiguousPreference,
            candidates: wall.candidates.map((ms) => new Date(ms).toISOString()),
          }
        : null,
  };
}
