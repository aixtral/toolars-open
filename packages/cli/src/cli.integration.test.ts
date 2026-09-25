import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CLI_PATH = fileURLToPath(new URL("../dist/cli.mjs", import.meta.url));

interface CliOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: readonly string[], input = ""): Promise<CliOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
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

describe("toolars CLI (integration, spawns the built bin)", () => {
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

  it("fails hash without --sha256", async () => {
    const outcome = await runCli(["hash", "abc"]);
    expect(outcome.code).toBe(2);
  });
});
