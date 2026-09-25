import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));
const MCP_PATH = fileURLToPath(new URL("../dist/mcp.mjs", import.meta.url));

interface CliOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

function runEntry(
  entry: string,
  args: readonly string[],
  input = "",
): Promise<CliOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

function runCli(args: readonly string[], input = ""): Promise<CliOutcome> {
  return runEntry(CLI_PATH, args, input);
}

describe("toolars CLI (integration, spawns the built bin)", () => {
  it.each(["--sha25", "--md5=true", "--algorithm=md5", "--json=false"])(
    "rejects unsupported hash option %s instead of computing a different digest",
    async (flag) => {
      const outcome = await runCli(["hash", flag, "abc"]);
      expect(outcome.code).toBe(2);
      expect(outcome.stdout).toBe("");
      expect(outcome.stderr).toContain("unsupported hash option");
    },
  );

  it("prints the version", async () => {
    const outcome = await runCli(["--version"]);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("hashes stdin like the site sha256-hash-checker (strips one trailing newline)", async () => {
    const outcome = await runCli(["hash", "--sha256"], "test\n");
    expect(outcome.code).toBe(0);
    // sha256("test"), identical to typing "test" into the website tool.
    expect(outcome.stdout.trim()).toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
  });

  it("hashes a positional argument", async () => {
    const outcome = await runCli(["hash", "--sha256", "abc"]);
    expect(outcome.stdout.trim()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("supports --json output for hash", async () => {
    const outcome = await runCli(["hash", "--sha256", "abc", "--json"]);
    expect(JSON.parse(outcome.stdout)).toEqual({
      algorithm: "sha256",
      digest:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      inputByteLength: 3,
    });
  });

  it("base64-encodes and decodes via stdin", async () => {
    const encoded = await runCli(["base64", "encode"], "foo");
    expect(encoded.stdout).toBe("Zm9v\n");
    const decoded = await runCli(["base64", "decode"], "Zm9v\n");
    expect(decoded.stdout).toBe("foo\n");
  });

  it("url-encodes with component semantics by default", async () => {
    const outcome = await runCli(["url", "encode", "a b&c=1"]);
    expect(outcome.stdout).toBe("a%20b%26c%3D1\n");
    const decoded = await runCli(["url", "decode", "a%20b%26c%3D1"]);
    expect(decoded.stdout).toBe("a b&c=1\n");
  });

  it("generates UUIDs and ULIDs in site-valid formats", async () => {
    const uuid = await runCli(["uuid"]);
    expect(uuid.stdout.trim()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    const ulid = await runCli(["ulid"]);
    expect(ulid.stdout.trim()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    const batch = await runCli(["uuid", "--count", "3", "--json"]);
    const parsed = JSON.parse(batch.stdout) as { values: string[] };
    expect(parsed.values).toHaveLength(3);
    expect(new Set(parsed.values).size).toBe(3);
  });

  it("converts timestamps", async () => {
    const outcome = await runCli(["timestamp", "0"]);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain("iso: 1970-01-01T00:00:00.000Z");
    expect(outcome.stdout).toContain("unix_seconds: 0");
  });

  it("explains cron expressions", async () => {
    const outcome = await runCli(["cron", "explain", "*/15 * * * *"]);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain("field_minute: 0 15 30 45");
  });

  it("decodes JWTs with a clear not-verified warning on stderr", async () => {
    const header = Buffer.from('{"alg":"none"}', "utf8").toString("base64url");
    const payload = Buffer.from('{"sub":"u1"}', "utf8").toString("base64url");
    const outcome = await runCli(["jwt", "decode", `${header}.${payload}.`]);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain('"sub": "u1"');
    expect(outcome.stdout).toContain('"verified": false');
    expect(outcome.stderr).toContain("signature NOT verified");
  });

  it("returns stable error codes with exit 1 for tool failures", async () => {
    const outcome = await runCli(["base64", "decode", "AB=="]);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr.trim()).toBe("INVALID_BASE64_PADDING");
    expect(outcome.stdout).toBe("");
  });

  it("returns exit 2 for usage errors", async () => {
    const outcome = await runCli(["frobnicate"]);
    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toContain("USAGE_ERROR");
  });

  it("defaults hash to sha256 and accepts every algorithm flag", async () => {
    const allAlgorithms = [
      ["--md5", "900150983cd24fb0d6963f7d28e17f72"],
      ["--sha1", "a9993e364706816aba3e25717850c26c9cd0d89d"],
      ["--sha224", "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7"],
      [
        "--sha256",
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      ],
      [
        "--sha384",
        "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
      ],
      [
        "--sha512",
        "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
      ],
    ] as const;

    for (const [flag, digest] of allAlgorithms) {
      const outcome = await runCli(["hash", flag, "abc"]);
      expect(outcome.code, flag).toBe(0);
      expect(outcome.stdout.trim(), flag).toBe(digest);
    }

    // No algorithm flag means sha256, identical to the explicit flag.
    const implicit = await runCli(["hash", "abc"]);
    expect(implicit.code).toBe(0);
    expect(implicit.stdout.trim()).toBe(allAlgorithms[3]![1]);
  });

  it("rejects more than one hash algorithm flag", async () => {
    const outcome = await runCli(["hash", "--md5", "--sha1", "abc"]);
    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toContain("choose at most one algorithm");
  });

  // `node_modules/.bin/*`, `npx` and a global install all invoke the entry
  // through a symlink. Node resolves the main module, so a guard comparing
  // `import.meta.url` against the raw `process.argv[1]` is false there and the
  // process exits 0 with no output — indistinguishable from success.
  it("executes when invoked through a symlink, as package managers do", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolars-cli-bin-"));
    try {
      const cliLink = join(dir, "toolars");
      await symlink(CLI_PATH, cliLink);

      const version = await runEntry(cliLink, ["--version"]);
      expect(version.code).toBe(0);
      expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/u);

      const hash = await runEntry(cliLink, ["hash", "--md5", "abc"]);
      expect(hash.code).toBe(0);
      expect(hash.stdout.trim()).toBe("900150983cd24fb0d6963f7d28e17f72");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("answers an MCP handshake when invoked through a symlink", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolars-mcp-bin-"));
    try {
      const mcpLink = join(dir, "toolars-mcp");
      await symlink(MCP_PATH, mcpLink);

      const outcome = await runEntry(
        mcpLink,
        [],
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test", version: "1" },
          },
        })}\n`,
      );

      expect(outcome.code).toBe(0);
      const response = JSON.parse(outcome.stdout.trim()) as {
        result?: { serverInfo?: { name?: string } };
      };
      expect(response.result?.serverInfo?.name).toBe("toolars-cli");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
