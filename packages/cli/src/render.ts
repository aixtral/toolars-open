import type {
  CronOutput,
  TimestampOutput,
} from "@/features/tool-runtime/time-tools/definitions";

import type {
  Base64Output,
  HashOutput,
  IdentifiersOutput,
  JwtDecodeOutput,
} from "./core";

/**
 * Plain-text renderers shared by the CLI (default output) and the MCP server
 * (tool result content). Each returns the full text without a trailing
 * newline; callers add framing.
 */

export function renderHash(output: HashOutput): string {
  return output.digest;
}

export function renderValue(output: Base64Output): string {
  return output.value;
}

export function renderIdentifiers(output: IdentifiersOutput): string {
  return output.values.join("\n");
}

export function renderJwt(output: JwtDecodeOutput): string {
  return JSON.stringify(
    {
      header: output.header,
      payload: output.payload,
      signature: output.signature,
      times: output.times,
      verified: output.verified,
    },
    null,
    2,
  );
}

export function renderTimestamp(output: TimestampOutput): string {
  return [
    `unix_seconds: ${output.unixSeconds}`,
    `unix_milliseconds: ${output.unixMilliseconds}`,
    `iso: ${output.iso}`,
    `utc: ${output.utc}`,
    `zoned (${output.outputTimeZone}): ${output.zoned}`,
    `detected_mode: ${output.detectedMode}${output.autoDetected ? " (auto)" : ""}`,
  ].join("\n");
}

export function renderCron(output: CronOutput): string {
  const lines = [
    `expression: ${output.normalized}`,
    `time_zone: ${output.timeZone}`,
    `day_mode: ${output.dayMode} (DOM/DOW ${output.dayMode})`,
    ...output.fields.map(
      (field) => `field_${field.field}: ${field.values.join(" ")}`,
    ),
    `next_runs (${output.nextRuns.length}${output.complete ? "" : ` of ${output.requestedCount} requested, search window ended ${output.searchEndIso}`}):`,
    ...output.nextRuns.map((run) => `${run.iso} | ${run.zoned}`),
  ];
  return lines.join("\n");
}
