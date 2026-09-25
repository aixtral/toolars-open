import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatJsonText, sha256Text, MAX_TEXT_BYTES } from "../src/core.mjs";
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const mcp = fileURLToPath(new URL("../src/mcp.mjs", import.meta.url));
const digest =
  "00dfd1fdb6e3ec5fa1a384778e503857d7594bdabf7ebe5365aa489a933bab98";
const runCli = (args, input, entry = cli) =>
  spawnSync(process.execPath, [entry, ...args], {
    input,
    encoding: "utf8",
    timeout: 10000,
  });
function client(entry = mcp) {
  const processChild = spawn(process.execPath, [entry], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages = [];
  const waiters = [];
  let buffer = "";
  let stderr = "";
  processChild.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  processChild.stdout.setEncoding("utf8");
  processChild.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else messages.push(message);
    }
  });
  const send = (value) =>
    processChild.stdin.write(JSON.stringify(value) + "\n");
  async function next() {
    if (messages.length) return messages.shift();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("MCP_TIMEOUT")), 5000);
      waiters.push((message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    });
  }
  return {
    send,
    next,
    raw: (data) => processChild.stdin.write(data),
    request: async (id, method, params) => {
      send({
        jsonrpc: "2.0",
        id,
        method,
        ...(params === undefined ? {} : { params }),
      });
      return next();
    },
    close: () => processChild.kill(),
    getStderr: () => stderr,
  };
}
async function initialize(c, version = "2025-11-25") {
  const response = await c.request(1, "initialize", {
    protocolVersion: version,
    capabilities: {},
    clientInfo: { name: "independent-wire-test", version: "1" },
  });
  assert.equal(response.result.protocolVersion, "2025-11-25");
  assert.deepEqual(response.result.capabilities, {
    tools: { listChanged: false },
  });
  c.send({ jsonrpc: "2.0", method: "notifications/initialized" });
}
test("JSON reuses exact-number parser, bounds, rejects unsafe and ambiguous keys", () => {
  assert.equal(
    formatJsonText('{"10":1e400,"2":9007199254740993,"x":-0}', 0),
    '{"10":1e400,"2":9007199254740993,"x":-0}',
  );
  for (const source of ['{"a":1,"a":2}', '{"secret":', '{"__proto__":1}'])
    assert.throws(() => formatJsonText(source));
  assert.throws(
    () => formatJsonText("[".repeat(42) + "0" + "]".repeat(42)),
    /MAX_DEPTH_EXCEEDED/,
  );
  assert.throws(
    () => formatJsonText(" ".repeat(MAX_TEXT_BYTES + 1)),
    /INPUT_TOO_LARGE/,
  );
  assert.throws(() => sha256Text("\ud800"), /INVALID_UNICODE_INPUT/);
  assert.equal(sha256Text("Toolars"), digest);
});
test("CLI stdin and explicit regular file; errors never disclose content or path", async () => {
  assert.equal(runCli(["sha256"], "Toolars").stdout, digest + "\n");
  assert.equal(
    runCli(["sha256"], "\ufeffToolars").stdout,
    sha256Text("\ufeffToolars") + "\n",
  );
  assert.equal(
    runCli(["json", "--indent", "0"], '{"a":1}').stdout,
    '{"a":1}\n',
  );
  const error = runCli(["json"], '{"private-marker":');
  assert.equal(error.status, 1);
  assert.equal(error.stdout, "");
  assert.equal(error.stderr, "INVALID_JSON\n");
  assert.equal(
    runCli(["sha256"], Buffer.from([0xff])).stderr,
    "INVALID_UTF8\n",
  );
  assert.equal(
    runCli(["sha256"], "x".repeat(MAX_TEXT_BYTES + 1)).stderr,
    "INPUT_TOO_LARGE\n",
  );
  const dir = await mkdtemp(join(tmpdir(), "toolars-cli-"));
  try {
    await writeFile(join(dir, "input"), "Toolars");
    assert.equal(
      runCli(["sha256", "--file", join(dir, "input")]).stdout,
      digest + "\n",
    );
    assert.equal(
      runCli(["sha256", "--file", dir]).stderr,
      "FILE_UNAVAILABLE\n",
    );
    assert.equal(
      runCli(["sha256", "--file", join(dir, "secret-path")]).stderr,
      "FILE_UNAVAILABLE\n",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("MCP lifecycle, negotiation, text calls, notifications, input and method boundaries", async () => {
  const c = client();
  try {
    assert.equal((await c.request(0, "tools/list")).error.code, -32600);
    await initialize(c, "unsupported-version");
    const list = await c.request(2, "tools/list");
    assert.equal(list.result.tools.length, 2);
    assert.equal(
      (
        await c.request(3, "tools/call", {
          name: "sha256_text",
          arguments: { text: "Toolars" },
        })
      ).result.content[0].text,
      digest,
    );
    assert.equal(
      (
        await c.request(4, "tools/call", {
          name: "json_format",
          arguments: { text: '{"n":9007199254740993}', indent: 0 },
        })
      ).result.content[0].text,
      '{"n":9007199254740993}',
    );
    assert.equal(
      (
        await c.request(5, "tools/call", {
          name: "sha256_text",
          arguments: { text: "Toolars", path: "/private/path" },
        })
      ).error.code,
      -32602,
    );
    const invalid = await c.request(6, "tools/call", {
      name: "json_format",
      arguments: { text: '{"private-marker":' },
    });
    assert.equal(invalid.result.isError, true);
    assert.equal(invalid.result.content[0].text, "INVALID_JSON");
    assert.equal(
      (
        await c.request(7, "tools/call", {
          name: "sha256_text",
          arguments: { text: "x".repeat(MAX_TEXT_BYTES + 1) },
        })
      ).result.content[0].text,
      "INPUT_TOO_LARGE",
    );
    assert.equal(
      (await c.request(8, "resources/read", { uri: "file:///private/path" }))
        .error.code,
      -32601,
    );
    c.send({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 3, reason: "done" },
    });
    c.send({ jsonrpc: "2.0", method: "unknown/notification" });
    const ping = await c.request(9, "ping");
    assert.equal(ping.id, 9);
    assert.deepEqual(ping.result, {});
    c.raw("{bad}\n");
    assert.equal((await c.next()).error.code, -32700);
    assert.equal((await c.request(10, "ping")).id, 10);
    assert.equal(c.getStderr(), "");
  } finally {
    c.close();
  }
});
test("MCP caps unterminated byte frames before parsing", async () => {
  const c = client();
  try {
    c.raw("x".repeat(1600 * 1024 + 1));
    assert.equal((await c.next()).error.message, "Frame too large");
  } finally {
    c.close();
  }
});
test("packed artifact installs offline outside checkout and provides npm import, CLI and MCP", async () => {
  const dir = await mkdtemp(join(tmpdir(), "toolars-pack-"));
  try {
    const packed = spawnSync(
      "npm",
      ["pack", "--json", "--pack-destination", dir],
      { cwd: packageRoot, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const receipt = JSON.parse(packed.stdout)[0];
    assert.ok(receipt.files.some((file) => file.path === "src/json-core.mjs"));
    await writeFile(
      join(dir, "package.json"),
      '{"private":true,"type":"module"}',
    );
    const installed = spawnSync(
      "npm",
      [
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(dir, receipt.filename),
      ],
      { cwd: dir, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(installed.status, 0, installed.stderr);
    const root = join(dir, "node_modules/@toolars/local-tools");
    assert.equal(
      runCli(["sha256"], "Toolars", join(root, "src/cli.mjs")).stdout,
      digest + "\n",
    );
    const imported = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import {sha256Text} from "@toolars/local-tools"; process.stdout.write(sha256Text("Toolars"));',
      ],
      { cwd: dir, encoding: "utf8" },
    );
    assert.equal(imported.stdout, digest);
    const c = client(join(root, "src/mcp.mjs"));
    try {
      await initialize(c);
      assert.equal(
        (
          await c.request(2, "tools/call", {
            name: "sha256_text",
            arguments: { text: "Toolars" },
          })
        ).result.content[0].text,
        digest,
      );
    } finally {
      c.close();
    }
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    assert.equal(manifest.private, true);
    assert.equal(manifest.license, "UNLICENSED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
