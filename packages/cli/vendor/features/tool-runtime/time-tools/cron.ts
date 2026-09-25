import {
  TIME_TOOL_LIMITS,
  TIME_ZONE_OPTIONS,
  type CronInput,
  type CronOutput,
} from "./definitions";
import { TimeToolRuntimeError } from "./errors";

type FieldName = "minute" | "hour" | "day" | "month" | "weekday";
type ParsedField = Readonly<{
  values: ReadonlySet<number>;
  wildcard: boolean;
  source: string;
}>;

const FIELD_RULES: Readonly<
  Record<
    FieldName,
    Readonly<{
      min: number;
      max: number;
      names?: Readonly<Record<string, number>>;
    }>
  >
> = {
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
      DEC: 12,
    },
  },
  weekday: {
    min: 0,
    max: 7,
    names: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 },
  },
};

const FIELD_ORDER: readonly FieldName[] = [
  "minute",
  "hour",
  "day",
  "month",
  "weekday",
];

function parseValue(token: string, field: FieldName): number {
  const rules = FIELD_RULES[field];
  const normalized = token.toUpperCase();
  const value =
    rules.names?.[normalized] ?? (/^\d+$/u.test(token) ? Number(token) : NaN);
  if (!Number.isInteger(value) || value < rules.min || value > rules.max) {
    throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
      field,
      value: token,
    });
  }
  return value;
}

function addRange(
  values: Set<number>,
  start: number,
  end: number,
  step: number,
  field: FieldName,
): void {
  if (start > end || !Number.isInteger(step) || step < 1) {
    throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
      field,
      value: `${start}-${end}/${step}`,
    });
  }
  for (let value = start; value <= end; value += step) {
    values.add(field === "weekday" && value === 7 ? 0 : value);
  }
}

function parseField(source: string, field: FieldName): ParsedField {
  const rules = FIELD_RULES[field];
  const values = new Set<number>();
  const wildcard = source.startsWith("*");

  for (const listPart of source.split(",")) {
    if (!listPart) {
      throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
        field,
        value: source,
      });
    }
    const [rangePart, stepPart, extra] = listPart.split("/");
    if (extra !== undefined || !rangePart) {
      throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
        field,
        value: listPart,
      });
    }
    const step =
      stepPart === undefined
        ? 1
        : /^\d+$/u.test(stepPart)
          ? Number(stepPart)
          : NaN;
    if (!Number.isSafeInteger(step) || step < 1)
      throw new TimeToolRuntimeError("INVALID_CRON_FIELD");
    if (rangePart === "*") {
      addRange(values, rules.min, rules.max, step, field);
      continue;
    }
    const range = rangePart.split("-");
    if (range.length === 1) {
      const value = parseValue(range[0]!, field);
      if (stepPart !== undefined) {
        addRange(values, value, rules.max, step, field);
      } else {
        values.add(field === "weekday" && value === 7 ? 0 : value);
      }
      continue;
    }
    if (range.length === 2) {
      addRange(
        values,
        parseValue(range[0]!, field),
        parseValue(range[1]!, field),
        step,
        field,
      );
      continue;
    }
    throw new TimeToolRuntimeError("INVALID_CRON_FIELD", {
      field,
      value: listPart,
    });
  }
  return { values, wildcard, source };
}

function resolveTimeZone(timeZone: CronInput["timeZone"]): string {
  if (!TIME_ZONE_OPTIONS.includes(timeZone))
    throw new TimeToolRuntimeError("INVALID_TIME_ZONE");
  const resolved =
    timeZone === "local"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      : timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: resolved }).format(0);
  } catch {
    throw new TimeToolRuntimeError("INVALID_TIME_ZONE", {
      timeZone: resolved,
    });
  }
  return resolved;
}

function zoneFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  });
}
function datePartsInZone(instantMs: number, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(instantMs);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  return {
    minute: number("minute"),
    hour: number("hour"),
    day: number("day"),
    month: number("month"),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      weekday ?? "",
    ),
  };
}

function datePartsInUtc(instantMs: number): ReturnType<typeof datePartsInZone> {
  const date = new Date(instantMs);
  return {
    minute: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    weekday: date.getUTCDay(),
  };
}

function matches(
  parts: ReturnType<typeof datePartsInZone>,
  fields: Readonly<Record<FieldName, ParsedField>>,
): boolean {
  const domMatch = fields.day.values.has(parts.day);
  const dowMatch = fields.weekday.values.has(parts.weekday);
  const dayMatches =
    fields.day.wildcard || fields.weekday.wildcard
      ? domMatch && dowMatch
      : domMatch || dowMatch;

  return (
    fields.minute.values.has(parts.minute) &&
    fields.hour.values.has(parts.hour) &&
    fields.month.values.has(parts.month) &&
    dayMatches
  );
}

export function calculateCron(input: CronInput): CronOutput {
  if (
    new TextEncoder().encode(input.expression).length >
    TIME_TOOL_LIMITS.cronBytes
  )
    throw new TimeToolRuntimeError("CRON_INPUT_TOO_LARGE");
  if (
    !Number.isSafeInteger(input.startMs) ||
    Math.abs(input.startMs) >
      8_640_000_000_000_000 - TIME_TOOL_LIMITS.cronMaxMinutes * 60_000 ||
    !Number.isInteger(input.count) ||
    input.count < 1 ||
    input.count > 25
  )
    throw new TimeToolRuntimeError("INVALID_CRON_OPTIONS");
  const expression = input.expression.trim().replace(/\s+/gu, " ");
  const rawFields = expression.split(" ");
  if (rawFields.length !== 5) {
    throw new TimeToolRuntimeError("INVALID_CRON_FIELD_COUNT", {
      count: rawFields.length,
    });
  }
  const fields = Object.fromEntries(
    FIELD_ORDER.map((field, index) => [
      field,
      parseField(rawFields[index]!, field),
    ]),
  ) as Record<FieldName, ParsedField>;
  const timeZone = resolveTimeZone(input.timeZone);
  const count = input.count;
  const nextRuns: CronOutput["nextRuns"][number][] = [];
  const first = Math.floor(input.startMs / 60_000) * 60_000 + 60_000;
  const end = first + (TIME_TOOL_LIMITS.cronMaxMinutes - 1) * 60_000;
  // UTC has no civil-offset lookup. Keep all other zones on Intl so historical
  // offset seconds, DST gaps and repeated minutes still use the zone database.
  const formatter = timeZone === "UTC" ? null : zoneFormatter(timeZone);
  const partsAt = formatter
    ? (instantMs: number) => datePartsInZone(instantMs, formatter)
    : datePartsInUtc;
  const outputFormatter = new Intl.DateTimeFormat(input.locale ?? "en", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "long",
    hourCycle: "h23",
  });
  // Examine every UTC minute strictly after the start. Reusing formatters avoids
  // costly per-minute construction and makes no assumptions about DST offsets.
  for (
    let candidate = first;
    candidate <= end && nextRuns.length < count;
    candidate += 60_000
  ) {
    if (!matches(partsAt(candidate), fields)) continue;
    nextRuns.push({
      instantMs: candidate,
      iso: new Date(candidate).toISOString(),
      zoned: outputFormatter.format(candidate),
    });
  }
  if (!nextRuns.length) throw new TimeToolRuntimeError("CRON_SEARCH_LIMIT");
  return {
    normalized: expression,
    fields: FIELD_ORDER.map((field) => ({
      field,
      source: fields[field].source,
      values: [...fields[field].values].sort((a, b) => a - b),
    })),
    complete: nextRuns.length === count,
    requestedCount: count,
    startIso: new Date(input.startMs).toISOString(),
    searchEndIso: new Date(end).toISOString(),
    dayMode: fields.day.wildcard || fields.weekday.wildcard ? "and" : "or",
    nextRuns,
    timeZone,
    semantics: "dom-dow-or",
  };
}
