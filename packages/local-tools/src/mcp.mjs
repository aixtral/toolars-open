#!/usr/bin/env node
import { once } from "node:events";
import { formatJsonText, sha256Text, safeError } from "./core.mjs";
const PROTOCOL = "2025-11-25";
// Up to six wire bytes per UTF-8 input byte when encoded as JSON escapes, plus framing.
const MAX_FRAME_BYTES = 1600 * 1024;
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const textSchema = {
  type: "string",
  description:
    "UTF-8 text, at most 256 KiB after JSON decoding. No file paths or URLs are read.",
};
const tools = [
  {
    name: "json_format",
    description:
      "Validate and format JSON locally, preserving numeric spelling and member order. Maximum depth 40 and 10000 nodes. Results enter the MCP client context.",
    inputSchema: {
      type: "object",
      properties: {
        text: textSchema,
        indent: { type: "integer", enum: [0, 2, 4], default: 2 },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "sha256_text",
    description:
      "SHA-256 of exact UTF-8 text locally. Does not read files. Results enter the MCP client context.",
    inputSchema: {
      type: "object",
      properties: { text: textSchema },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
let state = "new";
const rpcError = (id, code, message) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
function dispatch(message) {
  if (
    !isObject(message) ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string" ||
    ("id" in message &&
      !(typeof message.id === "string" || Number.isSafeInteger(message.id))) ||
    ("params" in message && !isObject(message.params))
  )
    return rpcError(null, -32600, "Invalid Request");
  if (!("id" in message)) {
    if (
      message.method === "notifications/initialized" &&
      state === "initializing"
    )
      state = "ready";
    return null;
  }
  const { id, method, params = {} } = message;
  const result = (value) => ({ jsonrpc: "2.0", id, result: value });
  if (method === "ping") return result({});
  if (method === "initialize") {
    if (state !== "new") return rpcError(id, -32600, "Already initialized");
    if (
      typeof params.protocolVersion !== "string" ||
      !isObject(params.capabilities) ||
      !isObject(params.clientInfo) ||
      typeof params.clientInfo.name !== "string" ||
      typeof params.clientInfo.version !== "string"
    )
      return rpcError(id, -32602, "Invalid params");
    state = "initializing";
    return result({
      protocolVersion: PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: "toolars-local-experiment",
        version: "0.1.0-experimental.1",
      },
      instructions:
        "Local stdio tools; no network or filesystem tool capability. Inputs and results are visible to your MCP client and may be sent to its model provider. Review client data settings before use.",
    });
  }
  if (state !== "ready") return rpcError(id, -32600, "Initialization required");
  if (method === "tools/list") {
    if (params.cursor !== undefined)
      return rpcError(id, -32602, "Invalid cursor");
    return result({ tools });
  }
  if (method !== "tools/call") return rpcError(id, -32601, "Method not found");
  const tool = tools.find((item) => item.name === params.name);
  if (!tool) return rpcError(id, -32602, "Unknown tool");
  const args = params.arguments;
  if (
    !isObject(args) ||
    typeof args.text !== "string" ||
    Object.keys(args).some(
      (key) => !Object.hasOwn(tool.inputSchema.properties, key),
    ) ||
    (args.indent !== undefined && ![0, 2, 4].includes(args.indent))
  )
    return rpcError(id, -32602, "Invalid arguments");
  try {
    const output =
      tool.name === "json_format"
        ? formatJsonText(args.text, args.indent ?? 2)
        : sha256Text(args.text);
    return result({
      content: [{ type: "text", text: output }],
      isError: false,
    });
  } catch (error) {
    return result({
      content: [{ type: "text", text: safeError(error) }],
      isError: true,
    });
  }
}
async function send(message) {
  if (message && !process.stdout.write(JSON.stringify(message) + "\n"))
    await once(process.stdout, "drain");
}
// Read byte frames with a hard cap before parsing; no readline unbounded line buffer.
let pending = Buffer.alloc(0);
try {
  for await (const chunk of process.stdin) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      if (pending.length + end - start > MAX_FRAME_BYTES) {
        await send(rpcError(null, -32600, "Frame too large"));
        process.exitCode = 1;
        process.stdin.destroy();
        break;
      }
      pending = Buffer.concat([pending, chunk.subarray(start, end)]);
      if (newline < 0) break;
      let message;
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
  if (pending.length && !process.exitCode)
    await send(rpcError(null, -32700, "Incomplete frame"));
} catch {
  process.exitCode = 1;
}
