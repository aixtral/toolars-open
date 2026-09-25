import { pathToFileURL } from "node:url";

import type { TimeZoneOption } from "@/features/tool-runtime/time-tools/definitions";

import {
  MAX_IDENTIFIER_BATCH_COUNT,
  base64Transform,
  cronExplain,
  decodeJwtToken,
  generateIdentifiersOp,
  hashSha256,
  timestampConvert,
  urlTransform,
  type CoreResult,
  type UrlOperation,
} from "./core";
import {
  renderCron,
  renderHash,
  renderIdentifiers,
  renderJwt,
  renderTimestamp,
  renderValue,
} from "./render";

declare const __TOOLARS_CLI_VERSION__: string;
declare const __TOOLARS_CLI_ENTRY__: string;

const PROTOCOL = "2025-11-25";
const SERVER_NAME = "toolars-cli";
const VERSION: string = __TOOLARS_CLI_VERSION__;
// Up to six wire bytes per UTF-8 input byte when encoded as JSON escapes, plus framing.
const MAX_FRAME_BYTES = 1600 * 1024;

const TIME_ZONE_DESCRIPTION =
  "One of UTC, local, America/New_York, Europe/London, Europe/Berlin, Asia/Shanghai, Asia/Tokyo, Asia/Seoul, Asia/Kolkata, Australia/Sydney.";

const LOCAL_NOTE =
  "Runs entirely locally; no network or filesystem access. Input and result enter the MCP client context and may be sent to its model provider.";

type PropertySchema = Readonly<{
  type: "string" | "integer" | "boolean";
  description: string;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  default?: string | number | boolean;
}>;

type ToolInputSchema = Readonly<{
  type: "object";
  properties: Readonly<Record<string, PropertySchema>>;
  required: readonly string[];
}>;

type ToolDefinition = Readonly<{
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: (args: Record<string, unknown>) => CoreResult<unknown>;
  render: (data: unknown) => string;
  idempotent: boolean;
}>;

const textProperty: PropertySchema = {
  type: "string",
  description: "UTF-8 text to process. Nothing is read from files or URLs.",
};

const timeZoneProperty: PropertySchema = {
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
    "Australia/Sydney",
  ],
  default: "UTC",
};

function defineTools(now: () => number): readonly ToolDefinition[] {
  return [
    {
      name: "toolars_hash_sha256",
      description: `Compute the SHA-256 hex digest of UTF-8 text, identical to the Toolars sha256-hash-checker web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: { text: textProperty },
        required: ["text"],
      },
      handler: (args) => hashSha256(args.text as string),
      render: (data) => renderHash(data as never),
      idempotent: true,
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
            description:
              "Use the URL-safe alphabet (- and _) and omit padding.",
            default: false,
          },
        },
        required: ["text"],
      },
      handler: (args) =>
        base64Transform(
          args.text as string,
          "encode",
          args.urlSafe === true,
        ) as CoreResult<unknown>,
      render: (data) => renderValue(data as never),
      idempotent: true,
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
            default: false,
          },
        },
        required: ["text"],
      },
      handler: (args) =>
        base64Transform(
          args.text as string,
          "decode",
          args.urlSafe === true,
        ) as CoreResult<unknown>,
      render: (data) => renderValue(data as never),
      idempotent: true,
    },
    {
      name: "toolars_jwt_decode",
      description: `Parse a JWT (header, payload, time-claim report) WITHOUT verifying the signature. Never trust the claims; verification is intentionally not offered. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "The compact JWT: header.payload.signature.",
          },
        },
        required: ["token"],
      },
      handler: (args) => decodeJwtToken(args.token as string, new Date(now())),
      render: (data) =>
        "WARNING: signature NOT verified — decode only. Do not trust claims.\n" +
        renderJwt(data as never),
      idempotent: true,
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
            default: "v4",
          },
          count: {
            type: "integer",
            description: "How many identifiers to generate.",
            minimum: 1,
            maximum: MAX_IDENTIFIER_BATCH_COUNT,
            default: 1,
          },
        },
        required: [],
      },
      handler: (args) =>
        generateIdentifiersOp(
          args.version === "v7" ? "uuid-v7" : "uuid-v4",
          (args.count as number | undefined) ?? 1,
        ) as CoreResult<unknown>,
      render: (data) => renderIdentifiers(data as never),
      idempotent: false,
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
            maximum: MAX_IDENTIFIER_BATCH_COUNT,
            default: 1,
          },
        },
        required: [],
      },
      handler: (args) =>
        generateIdentifiersOp(
          "ulid",
          (args.count as number | undefined) ?? 1,
        ) as CoreResult<unknown>,
      render: (data) => renderIdentifiers(data as never),
      idempotent: false,
    },
    {
      name: "toolars_timestamp_convert",
      description: `Convert a Unix timestamp (seconds/milliseconds), ISO 8601, RFC 2822, or wall time into all common representations, identical to the Toolars timestamp-time-zone-converter web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description:
              'Timestamp to convert, e.g. "1726848000", "1726848000000", "2024-09-20T12:34:56Z", or wall time "2024-09-20 12:34" (interpreted in outputTimeZone).',
          },
          outputTimeZone: timeZoneProperty,
        },
        required: ["source"],
      },
      handler: (args) =>
        timestampConvert(args.source as string, {
          outputTimeZone:
            (args.outputTimeZone as TimeZoneOption | undefined) ?? "UTC",
        }) as CoreResult<unknown>,
      render: (data) => renderTimestamp(data as never),
      idempotent: true,
    },
    {
      name: "toolars_cron_explain",
      description: `Explain a 5-field cron expression and list the next scheduled runs, identical to the Toolars cron-builder-explainer web tool. ${LOCAL_NOTE}`,
      inputSchema: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description:
              'Five-field cron expression, e.g. "*/15 9-17 * * MON-FRI".',
          },
          count: {
            type: "integer",
            description: "How many upcoming runs to list (at most 25).",
            minimum: 1,
            maximum: 25,
            default: 5,
          },
          timeZone: timeZoneProperty,
        },
        required: ["expression"],
      },
      handler: (args) =>
        cronExplain(args.expression as string, {
          count: (args.count as number | undefined) ?? 5,
          timeZone: (args.timeZone as TimeZoneOption | undefined) ?? "UTC",
          startMs: now(),
        }) as CoreResult<unknown>,
      render: (data) => renderCron(data as never),
      idempotent: true,
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
            description:
              "component encodes every reserved character (encodeURIComponent); uri leaves URI structure characters (encodeURI).",
            enum: ["component", "uri"],
            default: "component",
          },
        },
        required: ["text"],
      },
      handler: (args) => {
        const mode = args.mode === "uri" ? "encode-uri" : "encode-component";
        return urlTransform(args.text as string, mode as UrlOperation);
      },
      render: (data) => renderValue(data as never),
      idempotent: true,
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
            description:
              "component decodes every escape sequence; uri preserves URI structure characters.",
            enum: ["component", "uri"],
            default: "component",
          },
        },
        required: ["text"],
      },
      handler: (args) => {
        const mode = args.mode === "uri" ? "decode-uri" : "decode-component";
        return urlTransform(args.text as string, mode as UrlOperation);
      },
      render: (data) => renderValue(data as never),
      idempotent: true,
    },
  ];
}

type RpcMessage = Readonly<{
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const rpcError = (
  id: string | number | null,
  code: number,
  message: string,
): RpcMessage => ({ jsonrpc: "2.0", id: id ?? 0, error: { code, message } });

function validateArgs(schema: ToolInputSchema, args: unknown): string | null {
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
    if (value === undefined) continue;
    if (property.type === "string" && typeof value !== "string") {
      return `${name} must be a string`;
    }
    if (property.type === "boolean" && typeof value !== "boolean") {
      return `${name} must be a boolean`;
    }
    if (property.type === "integer" && !Number.isSafeInteger(value)) {
      return `${name} must be an integer`;
    }
    if (property.enum && !property.enum.includes(value as string | number)) {
      return `${name} must be one of: ${property.enum.join(", ")}`;
    }
    if (
      typeof value === "number" &&
      ((property.minimum !== undefined && value < property.minimum) ||
        (property.maximum !== undefined && value > property.maximum))
    ) {
      return `${name} must be between ${property.minimum} and ${property.maximum}`;
    }
  }
  return null;
}

export interface McpIo {
  read(): AsyncIterable<Uint8Array | string>;
  write(line: string): Promise<void>;
}

export interface McpServerOptions {
  now?: () => number;
}

/**
 * Run a minimal MCP stdio server (JSON-RPC 2.0, newline-delimited frames).
 * Resolves when the input stream ends. Modeled on the protocol handling of
 * packages/local-tools/src/mcp.mjs, extended to the full developer-tool
 * subset and a schema-driven argument validator.
 */
export async function createMcpServer(
  io: McpIo,
  options: McpServerOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const tools = defineTools(now);
  let state: "new" | "initializing" | "ready" = "new";

  const send = async (message: RpcMessage | null): Promise<void> => {
    if (message) await io.write(JSON.stringify(message));
  };

  const dispatch = (message: unknown): RpcMessage | null => {
    if (
      !isObject(message) ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" ||
      ("id" in message &&
        !(
          typeof message.id === "string" || Number.isSafeInteger(message.id)
        )) ||
      ("params" in message && !isObject(message.params))
    ) {
      return rpcError(null, -32600, "Invalid Request");
    }

    if (!("id" in message)) {
      if (
        message.method === "notifications/initialized" &&
        state === "initializing"
      ) {
        state = "ready";
      }
      return null;
    }

    const id = message.id as string | number;
    const method = message.method;
    const params = (
      message.params === undefined ? {} : message.params
    ) as Record<string, unknown>;
    const result = (value: unknown): RpcMessage => ({
      jsonrpc: "2.0",
      id,
      result: value,
    });

    if (method === "ping") return result({});
    if (method === "initialize") {
      if (state !== "new") return rpcError(id, -32600, "Already initialized");
      const clientInfo = params.clientInfo;
      if (
        typeof params.protocolVersion !== "string" ||
        !isObject(params.capabilities) ||
        !isObject(clientInfo) ||
        typeof clientInfo.name !== "string" ||
        typeof clientInfo.version !== "string"
      ) {
        return rpcError(id, -32602, "Invalid params");
      }
      state = "initializing";
      return result({
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions:
          "Local stdio tools reusing the Toolars website runtimes; no network or filesystem tool capability. JWT decode never verifies signatures. Inputs and results are visible to your MCP client and may be sent to its model provider; review client data settings before use.",
      });
    }
    if (state !== "ready") {
      return rpcError(id, -32600, "Initialization required");
    }
    if (method === "tools/list") {
      if (params.cursor !== undefined) {
        return rpcError(id, -32602, "Invalid cursor");
      }
      return result({
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: tool.idempotent,
            openWorldHint: false,
          },
        })),
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

    const output = tool.handler(args as Record<string, unknown>);
    if (!output.ok) {
      return result({
        content: [{ type: "text", text: output.code }],
        isError: true,
      });
    }
    return result({
      content: [{ type: "text", text: tool.render(output.data) }],
      isError: false,
    });
  };

  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of io.read()) {
      const buffer =
        typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
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
        let message: unknown;
        try {
          message = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(pending),
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

if (
  __TOOLARS_CLI_ENTRY__ === "mcp" &&
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  createMcpServer({
    read: () => process.stdin,
    write: async (line) => {
      process.stdout.write(line + "\n");
    },
  }).catch(() => {
    process.exitCode = 1;
  });
}
