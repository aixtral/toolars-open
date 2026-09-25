import { createMcpServer } from "./mcp";
import { isMainEntry } from "./is-main-entry";
import {
  HASH_ALGORITHMS,
  MAX_IDENTIFIER_BATCH_COUNT,
  base64Transform,
  cronExplain,
  decodeJwtToken,
  generateIdentifiersOp,
  hashText,
  timestampConvert,
  urlTransform,
  type CoreResult,
} from "./core";
import {
  renderCron,
  renderHash,
  renderIdentifiers,
  renderJwt,
  renderTimestamp,
  renderValue,
} from "./render";
import type { TimeZoneOption } from "@/features/tool-runtime/time-tools/definitions";

declare const __TOOLARS_CLI_VERSION__: string;
declare const __TOOLARS_CLI_ENTRY__: string;

const VERSION: string = __TOOLARS_CLI_VERSION__;

const USAGE = `toolars ${VERSION} — local-first developer utilities (https://toolars.com)

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
and are never signatures. jwt decode parses only — the signature is NEVER
verified.`;

class UsageError extends Error {}

// Flags that take a separate value token; every other `--flag` is boolean.
const VALUE_FLAGS = new Set(["count", "mode", "tz", "output-tz"]);

function parseArgs(argv: readonly string[]): {
  positionals: string[];
  flags: Map<string, string | boolean>;
} {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
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
      if (flags.has(inline[1]!))
        throw new UsageError(`duplicate option: --${inline[1]}`);
      flags.set(inline[1]!, inline[2]!);
      continue;
    }
    const name = arg.replace(/^--?/, "");
    if (flags.has(name)) throw new UsageError(`duplicate option: --${name}`);
    const next = argv[index + 1];
    if (VALUE_FLAGS.has(name)) {
      if (next === undefined || (next.startsWith("-") && !/^-\d/u.test(next))) {
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

const COMMAND_OPTIONS: Readonly<
  Record<string, { flags: readonly string[]; maxPositionals: number }>
> = {
  hash: { flags: [...HASH_ALGORITHMS, "json"], maxPositionals: 2 },
  base64: { flags: ["url-safe", "json"], maxPositionals: 3 },
  jwt: { flags: ["json"], maxPositionals: 3 },
  uuid: { flags: ["v7", "count", "json"], maxPositionals: 1 },
  ulid: { flags: ["count", "json"], maxPositionals: 1 },
  timestamp: { flags: ["output-tz", "json"], maxPositionals: 2 },
  cron: { flags: ["count", "tz", "json"], maxPositionals: 3 },
  url: { flags: ["mode", "json"], maxPositionals: 3 },
  mcp: { flags: [], maxPositionals: 1 },
  help: { flags: [], maxPositionals: 1 },
};

function validateArgs(
  positionals: readonly string[],
  flags: Map<string, string | boolean>,
) {
  const command = positionals[0] ?? "help";
  const contract = Object.hasOwn(COMMAND_OPTIONS, command)
    ? COMMAND_OPTIONS[command]
    : undefined;
  if (!contract) throw new UsageError(`unknown command: ${command}`);
  if (positionals.length > contract.maxPositionals) {
    throw new UsageError(
      `too many arguments for ${command}; quote text containing spaces`,
    );
  }
  const allowed = new Set([...contract.flags, "help", "version"]);
  for (const [name, value] of flags) {
    if (
      !allowed.has(name) ||
      (VALUE_FLAGS.has(name)
        ? typeof value !== "string" || !value
        : value !== true)
    ) {
      throw new UsageError(`unsupported ${command} option: --${name}`);
    }
  }
}

function getStringFlag(
  flags: Map<string, string | boolean>,
  name: string,
): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function getBooleanFlag(
  flags: Map<string, string | boolean>,
  name: string,
): boolean {
  return flags.get(name) === true;
}

function getCountFlag(
  flags: Map<string, string | boolean>,
  name: string,
  fallback: number,
): number {
  const raw = getStringFlag(flags, name);
  if (raw === undefined) return fallback;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) {
    throw new UsageError(`--${name} must be a positive integer`);
  }
  return count;
}

function getTimeZoneFlag(
  flags: Map<string, string | boolean>,
  name: string,
  fallback: TimeZoneOption,
): TimeZoneOption {
  const raw = getStringFlag(flags, name);
  if (raw === undefined) return fallback;
  const allowed: readonly string[] = [
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
  ];
  if (!allowed.includes(raw)) {
    throw new UsageError(`--${name} must be one of: ${allowed.join(", ")}`);
  }
  return raw as TimeZoneOption;
}

/**
 * Read text input: the positional argument wins; otherwise consume stdin and
 * strip exactly one trailing LF (and a preceding CR) so `echo text | toolars …`
 * hashes the visible line, matching what the website tool receives.
 */
async function readTextInput(
  positional: string | undefined,
  stream: AsyncIterable<unknown>,
): Promise<string> {
  if (positional !== undefined) return positional;
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Uint8Array);
  }
  let text = new TextDecoder("utf-8", { fatal: false }).decode(
    concatBytes(chunks),
  );
  if (text.endsWith("\n")) {
    text = text.slice(0, -1);
    if (text.endsWith("\r")) text = text.slice(0, -1);
  }
  return text;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function emit<TData>(
  result: CoreResult<TData>,
  jsonMode: boolean,
  render: (data: TData) => string,
): number {
  if (!result.ok) {
    process.stderr.write(
      (jsonMode ? JSON.stringify({ error: result.code }) : result.code) + "\n",
    );
    return 1;
  }
  process.stdout.write(
    (jsonMode ? JSON.stringify(result.data, null, 2) : render(result.data)) +
      "\n",
  );
  return 0;
}

async function run(
  argv: readonly string[],
  stdin: AsyncIterable<unknown>,
): Promise<number> {
  const { positionals, flags } = parseArgs(argv);
  validateArgs(positionals, flags);
  const jsonMode = getBooleanFlag(flags, "json");
  const command = positionals[0];
  // Commands with a subcommand (base64/url/jwt/cron) take their operand at
  // index 2; plain commands (hash/timestamp) take it at index 1.
  const subcommand = positionals[1];
  const operand = positionals[2];

  if (getBooleanFlag(flags, "version")) {
    process.stdout.write(VERSION + "\n");
    return 0;
  }
  if (
    command === undefined ||
    command === "help" ||
    getBooleanFlag(flags, "help")
  ) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }

  switch (command) {
    case "hash": {
      const requested = HASH_ALGORITHMS.filter((algorithm) =>
        getBooleanFlag(flags, algorithm),
      );
      if (requested.length > 1) {
        throw new UsageError(
          `choose at most one algorithm (got ${requested
            .map((algorithm) => `--${algorithm}`)
            .join(", ")})`,
        );
      }
      const input = await readTextInput(subcommand, stdin);
      return emit(
        hashText(input, requested[0] ?? "sha256"),
        jsonMode,
        renderHash,
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
        renderValue,
      );
    }

    case "jwt": {
      if (subcommand !== "decode") {
        throw new UsageError("usage: toolars jwt decode <token>");
      }
      const token = operand ?? (await readTextInput(undefined, stdin));
      const result = decodeJwtToken(token);
      if (!result.ok) return emit(result, jsonMode, renderJwt);
      process.stderr.write(
        "WARNING: signature NOT verified — decode only. Do not trust claims.\n",
      );
      return emit(result, jsonMode, renderJwt);
    }

    case "uuid": {
      const format = getBooleanFlag(flags, "v7") ? "uuid-v7" : "uuid-v4";
      const count = getCountFlag(flags, "count", 1);
      if (count > MAX_IDENTIFIER_BATCH_COUNT) {
        throw new UsageError(
          `--count must be at most ${MAX_IDENTIFIER_BATCH_COUNT}`,
        );
      }
      return emit(
        generateIdentifiersOp(format, count),
        jsonMode,
        renderIdentifiers,
      );
    }

    case "ulid": {
      const count = getCountFlag(flags, "count", 1);
      if (count > MAX_IDENTIFIER_BATCH_COUNT) {
        throw new UsageError(
          `--count must be at most ${MAX_IDENTIFIER_BATCH_COUNT}`,
        );
      }
      return emit(
        generateIdentifiersOp("ulid", count),
        jsonMode,
        renderIdentifiers,
      );
    }

    case "timestamp": {
      const source = subcommand ?? (await readTextInput(undefined, stdin));
      const outputTimeZone = getTimeZoneFlag(flags, "output-tz", "UTC");
      return emit(
        timestampConvert(source, { outputTimeZone }),
        jsonMode,
        renderTimestamp,
      );
    }

    case "cron": {
      if (subcommand !== "explain") {
        throw new UsageError('usage: toolars cron explain "<expression>"');
      }
      const expression = operand ?? (await readTextInput(undefined, stdin));
      const count = getCountFlag(flags, "count", 5);
      if (count > 25) throw new UsageError("--count must be at most 25");
      const timeZone = getTimeZoneFlag(flags, "tz", "UTC");
      return emit(
        cronExplain(expression, { count, timeZone, startMs: Date.now() }),
        jsonMode,
        renderCron,
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
      const operation =
        subcommand === "encode"
          ? mode === "uri"
            ? "encode-uri"
            : "encode-component"
          : mode === "uri"
            ? "decode-uri"
            : "decode-component";
      const input = await readTextInput(operand, stdin);
      return emit(urlTransform(input, operation), jsonMode, renderValue);
    }

    case "mcp": {
      await createMcpServer({
        read: () => process.stdin,
        write: async (line) => {
          process.stdout.write(line + "\n");
        },
      });
      return 0;
    }

    default:
      throw new UsageError(`unknown command: ${command}`);
  }
}

if (__TOOLARS_CLI_ENTRY__ === "cli" && isMainEntry(import.meta.url)) {
  run(process.argv.slice(2), process.stdin)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof UsageError) {
        process.stderr.write(`USAGE_ERROR: ${error.message}\n\n${USAGE}\n`);
        process.exitCode = 2;
      } else {
        process.stderr.write("INTERNAL_ERROR\n");
        process.exitCode = 1;
      }
    });
}

export { USAGE, run };
