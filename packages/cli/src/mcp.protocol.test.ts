import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { HASH_ALGORITHMS } from "./core";
import { createMcpServer } from "./mcp";

/**
 * Protocol-level tests driving the MCP server over in-memory stdio pipes,
 * following the acceptance shape used for the packages/local-tools MCP
 * experiment: handshake, capability list, success/failure calls, and
 * JSON-RPC error handling.
 */

interface CapturedServer {
  send: (message: unknown) => void;
  sendRaw: (line: string) => void;
  finish: () => Promise<{ responses: RpcResponse[] }>;
}

interface RpcResponse {
  jsonrpc: string;
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

function startServer(now?: () => number): CapturedServer {
  const input = new PassThrough();
  const responses: RpcResponse[] = [];
  const server = createMcpServer(
    {
      read: () => input,
      write: async (line) => {
        responses.push(JSON.parse(line) as RpcResponse);
      },
    },
    now ? { now } : {},
  );
  return {
    send: (message) => {
      input.write(JSON.stringify(message) + "\n");
    },
    sendRaw: (line) => {
      input.write(line + "\n");
    },
    finish: async () => {
      input.end();
      await server;
      return { responses };
    },
  };
}

const FIXED_NOW = () => Date.parse("2024-01-01T00:00:00.000Z");

let servers: CapturedServer[] = [];

function server(now?: () => number): CapturedServer {
  const instance = startServer(now);
  servers.push(instance);
  return instance;
}

afterEach(async () => {
  const pending = servers;
  servers = [];
  for (const instance of pending) {
    await instance.finish();
  }
});

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "vitest", version: "0.0.0" },
  },
} as const;

describe("MCP stdio server", () => {
  it("keeps the original SHA-256 tool callable by existing clients", async () => {
    const client = server();
    client.send(INITIALIZE);
    client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "toolars_hash_sha256", arguments: { text: "abc" } },
    });
    const { responses } = await client.finish();
    expect(responses[1]).toMatchObject({
      result: {
        isError: false,
        content: [
          {
            type: "text",
            text: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          },
        ],
      },
    });
  });

  it("completes the handshake and lists all developer tools", async () => {
    const client = server();
    client.send(INITIALIZE);
    client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    client.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const { responses } = await client.finish();

    expect(responses).toHaveLength(2);
    const [init, list] = responses;
    expect(init).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "toolars-cli" },
      },
    });
    const tools = (list!.result as { tools: Record<string, unknown>[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      "toolars_hash",
      "toolars_hash_sha256",
      "toolars_base64_encode",
      "toolars_base64_decode",
      "toolars_jwt_decode",
      "toolars_uuid_generate",
      "toolars_ulid_generate",
      "toolars_timestamp_convert",
      "toolars_cron_explain",
      "toolars_url_encode",
      "toolars_url_decode",
    ]);
    for (const tool of tools) {
      expect(tool.description).toEqual(expect.any(String));
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("requires initialization before tools/list", async () => {
    const client = server();
    client.send({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} });
    const { responses } = await client.finish();
    expect(responses[0]).toMatchObject({
      id: 9,
      error: { code: -32600, message: "Initialization required" },
    });
  });

  it("runs tools/call with the same vectors as the site runtimes", async () => {
    const client = server(FIXED_NOW);
    client.send(INITIALIZE);
    client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "toolars_hash",
        arguments: { text: "abc" },
      },
    });
    // Same tool, non-default algorithm: the enum is validated against the
    // schema and the digest must equal the site's md5-hash-checker vector.
    client.send({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "toolars_hash",
        arguments: { text: "abc", algorithm: "md5" },
      },
    });
    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "toolars_base64_encode",
        arguments: { text: "foo", urlSafe: true },
      },
    });
    client.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "toolars_cron_explain",
        arguments: { expression: "*/15 * * * *", count: 2 },
      },
    });
    const { responses } = await client.finish();
    const [, hash, hashMd5, base64, cron] = responses;

    expect(hash!.result).toMatchObject({
      isError: false,
      content: [
        {
          type: "text",
          text: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        },
      ],
    });
    expect(hashMd5!.result).toMatchObject({
      isError: false,
      content: [{ type: "text", text: "900150983cd24fb0d6963f7d28e17f72" }],
    });
    expect(base64!.result).toMatchObject({
      content: [{ type: "text", text: "Zm9v" }],
    });
    const cronText = (cron!.result as { content: { text: string }[] })
      .content[0]!.text;
    expect(cronText).toContain("field_minute: 0 15 30 45");
    expect(cronText).toContain("2024-01-01T00:15:00.000Z");
  });

  it("marks tool failures as isError with the stable error code", async () => {
    const client = server();
    client.send(INITIALIZE);
    client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "toolars_base64_decode",
        arguments: { text: "AB==" },
      },
    });
    const { responses } = await client.finish();
    expect(responses[1]).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text", text: "INVALID_BASE64_PADDING" }],
      },
    });
  });

  it("rejects unknown tools and invalid arguments with JSON-RPC errors", async () => {
    const client = server();
    client.send(INITIALIZE);
    client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "toolars_nope", arguments: {} },
    });
    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "toolars_hash", arguments: { text: 42 } },
    });
    client.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "toolars_hash",
        arguments: { text: "x", surprise: true },
      },
    });
    client.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "toolars_hash",
        arguments: { wrong: "field" },
      },
    });
    client.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "toolars_hash", arguments: {} },
    });
    client.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "toolars_hash",
        arguments: { text: "x", algorithm: "sha3-256" },
      },
    });
    const { responses } = await client.finish();
    const errorMessage = (index: number): string =>
      responses[index]!.error!.message;
    expect(responses[1]).toMatchObject({
      id: 2,
      error: { code: -32602, message: "Unknown tool" },
    });
    expect(responses[2]).toMatchObject({ id: 3, error: { code: -32602 } });
    expect(errorMessage(2)).toContain("text must be a string");
    expect(responses[3]).toMatchObject({ id: 4, error: { code: -32602 } });
    expect(errorMessage(3)).toContain("unexpected argument");
    expect(responses[4]).toMatchObject({ id: 5, error: { code: -32602 } });
    expect(errorMessage(4)).toContain("unexpected argument");
    expect(responses[5]).toMatchObject({ id: 6, error: { code: -32602 } });
    expect(errorMessage(5)).toContain("missing required argument");
    expect(responses[6]).toMatchObject({ id: 7, error: { code: -32602 } });
    // The enum is derived from the site's algorithm list, so the error names
    // every supported digest instead of echoing the rejected input.
    expect(errorMessage(6)).toContain("algorithm must be one of");
    for (const algorithm of HASH_ALGORITHMS) {
      expect(errorMessage(6)).toContain(algorithm);
    }
    expect(errorMessage(6)).not.toContain("sha3-256");
  });

  it("answers ping and rejects unknown methods", async () => {
    const client = server();
    client.send(INITIALIZE);
    client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    client.send({ jsonrpc: "2.0", id: 2, method: "ping" });
    client.send({ jsonrpc: "2.0", id: 3, method: "resources/list" });
    const { responses } = await client.finish();
    expect(responses[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    expect(responses[2]).toMatchObject({
      id: 3,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("returns parse errors for invalid JSON and ignores notifications", async () => {
    const client = server();
    client.sendRaw("{not json");
    client.send({ jsonrpc: "2.0", method: "notifications/anything" });
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0.0.0" },
      },
    });
    const { responses } = await client.finish();
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({
      id: 0,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("rejects structurally invalid requests", async () => {
    const client = server();
    client.send({ id: 1, method: "initialize" });
    client.send({ jsonrpc: "2.0", id: "abc", method: 42 });
    const { responses } = await client.finish();
    expect(responses[0]).toMatchObject({
      error: { code: -32600, message: "Invalid Request" },
    });
    expect(responses[1]).toMatchObject({
      id: 0,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  it("rejects a second initialize", async () => {
    const client = server();
    client.send(INITIALIZE);
    client.send({ ...INITIALIZE, id: 2 });
    const { responses } = await client.finish();
    expect(responses[1]).toMatchObject({
      id: 2,
      error: { code: -32600, message: "Already initialized" },
    });
  });

  it("deterministically explains cron with an injected clock", async () => {
    const client = server(FIXED_NOW);
    client.send(INITIALIZE);
    client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "toolars_cron_explain",
        arguments: { expression: "0 9 * * *", count: 1 },
      },
    });
    const { responses } = await client.finish();
    const text = (responses[1]!.result as { content: { text: string }[] })
      .content[0]!.text;
    expect(text).toContain("2024-01-01T09:00:00.000Z");
  });
});
