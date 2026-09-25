import type { AppLocale } from "@/i18n/routing";

export const TIME_TOOL_SLUGS = [
  "timestamp-time-zone-converter",
  "cron-builder-explainer",
] as const;

export type TimeToolSlug = (typeof TIME_TOOL_SLUGS)[number];

export const TIME_TOOLS_WORKER_PATH = "/generated/time-tools-worker.js";

export const TIME_ZONE_OPTIONS = [
  "UTC",
  "local",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Australia/Sydney",
] as const;

export type TimeZoneOption = (typeof TIME_ZONE_OPTIONS)[number];
export type TimestampInputMode =
  "auto" | "seconds" | "milliseconds" | "iso" | "wall";
export type AmbiguousTimePreference = "earlier" | "later";

export type TimestampInput = Readonly<{
  source: string;
  mode: TimestampInputMode;
  sourceTimeZone: TimeZoneOption;
  outputTimeZone: TimeZoneOption;
  ambiguousPreference: AmbiguousTimePreference;
}>;

export type TimestampOutput = Readonly<{
  instantMs: number;
  unixSeconds: string;
  unixMilliseconds: number;
  iso: string;
  utc: string;
  local: string;
  zoned: string;
  sourceTimeZone: string;
  localTimeZone: string;
  autoDetected: boolean;
  outputTimeZone: string;
  detectedMode: Exclude<TimestampInputMode, "auto">;
  discord: Readonly<{
    full: string;
    relative: string;
    shortDateTime: string;
  }>;
  ambiguity: Readonly<{
    count: number;
    candidates: readonly string[];
    selected: AmbiguousTimePreference;
  }> | null;
}>;

export type TimeToolErrorCode =
  | "TIMESTAMP_PRECISION"
  | "TIMESTAMP_INPUT_TOO_LARGE"
  | "INVALID_TIMESTAMP_OPTIONS"
  | "EMPTY_TIMESTAMP"
  | "INVALID_TIMESTAMP"
  | "TIMESTAMP_OUT_OF_RANGE"
  | "INVALID_WALL_TIME"
  | "NONEXISTENT_WALL_TIME"
  | "INVALID_TIME_ZONE"
  | "CRON_INPUT_TOO_LARGE"
  | "INVALID_CRON_OPTIONS"
  | "INVALID_CRON_FIELD_COUNT"
  | "INVALID_CRON_FIELD"
  | "CRON_SEARCH_LIMIT"
  | "TIME_WORKER_ABORTED"
  | "TIME_WORKER_TIMEOUT"
  | "TIME_WORKER_FAILED"
  | "TIME_WORKER_UNAVAILABLE"
  | "UNKNOWN";

export type CronInput = Readonly<{
  expression: string;
  locale?: AppLocale;
  timeZone: TimeZoneOption;
  startMs: number;
  count: number;
}>;

export type CronOutput = Readonly<{
  normalized: string;
  fields: readonly Readonly<{
    field: "minute" | "hour" | "day" | "month" | "weekday";
    source: string;
    values: readonly number[];
  }>[];
  complete: boolean;
  requestedCount: number;
  startIso: string;
  searchEndIso: string;
  dayMode: "and" | "or";
  nextRuns: readonly Readonly<{
    instantMs: number;
    iso: string;
    zoned: string;
  }>[];
  timeZone: string;
  semantics: "dom-dow-or";
}>;

export const TIME_TOOL_LIMITS = {
  timestampBytes: 512,
  cronBytes: 512,
  cronCount: 10,
  cronMaxMinutes: 527_040,
  timeoutMs: 1_500,
} as const;
