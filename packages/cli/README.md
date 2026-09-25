# Toolars CLI — local-first developer utilities

A zero-dependency command-line interface and local [MCP](https://modelcontextprotocol.io) server exposing the Developer-tool subset of [Toolars](https://toolars.com) (Next.js 16 + React 19, local-first). Every operation reuses the website's pure runtime cores from `src/features/tool-runtime/`, so CLI, MCP server, and website produce identical results, locked in by the shared test vectors in `src/core.test.ts`.

The package is private and not published to npm.

## Privacy

- All computation runs **locally** in Node.js. No network calls, no file access (nothing is read from disk), no telemetry, no analytics.
- Text input comes from arguments or stdin only.
- MCP caveat: tool inputs and results enter the MCP client context and may be sent to the client's model provider and retained in its history. That is the client's data policy, not this server's. Review your client's data settings before use.

## Requirements

- Node `>=24.15.0 <25` (same pin as the website).
- Built from the Toolars workspace root with the workspace esbuild devDependency (same pattern as `packages/local-tools`):

```sh
node packages/cli/build.mjs
```

This produces self-contained ESM bundles in `dist/` (`cli.mjs`, `mcp.mjs`) with the site cores inlined — the installed package needs nothing else at runtime.

## CLI usage

```sh
node packages/cli/dist/cli.mjs --help

# Input from an argument or stdin (one trailing line break is stripped
# from stdin so `echo text | …` matches typing text into the website):
echo test | node packages/cli/dist/cli.mjs hash --sha256
node packages/cli/dist/cli.mjs hash --sha256 abc
node packages/cli/dist/cli.mjs base64 encode "hello world"
node packages/cli/dist/cli.mjs base64 decode --url-safe "aGVsbG8td29ybGQ"
node packages/cli/dist/cli.mjs jwt decode "$JWT"          # parse only, see warning below
node packages/cli/dist/cli.mjs uuid [--v7] [--count 5]
node packages/cli/dist/cli.mjs ulid [--count 5]
node packages/cli/dist/cli.mjs timestamp 1726848000 [--output-tz Asia/Tokyo]
node packages/cli/dist/cli.mjs cron explain "*/15 9-17 * * MON-FRI" [--count 10] [--tz UTC]
node packages/cli/dist/cli.mjs url encode "a b&c=1" [--mode component|uri]
node packages/cli/dist/cli.mjs url decode "a%20b%26c%3D1"
```

Add `--json` to any command for structured output. stdout carries only the result; failures print a stable error code to stderr and exit `1`; usage errors exit `2`.

Commands and the website tools they mirror:

| Command                 | Website tool                    | Source core reused                                   |
| ----------------------- | ------------------------------- | ---------------------------------------------------- |
| `hash --sha256`         | SHA256 Hash Checker             | `node:crypto` (site is wasm-coupled; parity-tested)  |
| `base64 encode\|decode` | Base64 Encoder/Decoder          | `src/features/tool-runtime/base64/executor.ts`       |
| `jwt decode`            | JWT Debugger                    | `src/features/tool-runtime/jwt/inspection.ts`        |
| `uuid`, `ulid`          | UUID/ULID Generator             | `src/features/tool-runtime/identifier/identifier.ts` |
| `timestamp`             | Timestamp & Time Zone Converter | `src/features/tool-runtime/time-tools/timestamp.ts`  |
| `cron explain`          | Cron Builder & Explainer        | `src/features/tool-runtime/time-tools/cron.ts`       |
| `url encode\|decode`    | URL Encoder/Decoder             | `src/features/tool-runtime/text/executor.ts`         |

### JWT decode is not verification

`jwt decode` only parses the header and payload and reports time claims (`exp`/`nbf`/`iat`). **The signature is never verified**, and the CLI prints a warning to stderr on every decode. Treat all claims as untrusted data.

## MCP server (local stdio)

The same operations are exposed as MCP tools over newline-delimited JSON-RPC 2.0 on stdio. The implementation is a minimal hand-written server (protocol `2025-11-25`): `initialize`, `ping`, `tools/list`, `tools/call`, notification handling, and spec-shaped errors — zero runtime dependencies.

Tools: `toolars_hash_sha256`, `toolars_base64_encode`, `toolars_base64_decode`, `toolars_jwt_decode`, `toolars_uuid_generate`, `toolars_ulid_generate`, `toolars_timestamp_convert`, `toolars_cron_explain`, `toolars_url_encode`, `toolars_url_decode`.

### Claude Desktop

Add to `claude_desktop_config.json` (replace the path with your checkout):

```json
{
  "mcpServers": {
    "toolars": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/toolars/packages/cli/dist/mcp.mjs"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add toolars -- node /absolute/path/to/toolars/packages/cli/dist/mcp.mjs
```

or in `.mcp.json`:

```json
{
  "mcpServers": {
    "toolars": {
      "command": "node",
      "args": ["/absolute/path/to/toolars/packages/cli/dist/mcp.mjs"]
    }
  }
}
```

`toolars mcp` (or the `toolars-mcp` bin) starts the same server. Do not expose it over HTTP; it is a stdio server.

## Tests

```sh
# from the workspace root (builds dist/, then runs unit + integration + protocol tests)
node packages/cli/build.mjs && corepack pnpm --dir packages/cli test

# or via the workspace test gate, which now includes this package
corepack pnpm test
```

- `src/core.test.ts` — unit tests with vectors copied from the website runtime test suites (parity with the live tools).
- `src/cli.integration.test.ts` — spawns the built `dist/cli.mjs` and asserts stdout/stderr/exit codes.
- `src/mcp.protocol.test.ts` — drives the MCP server over in-memory stdio pipes: handshake, `tools/list`, `tools/call` success/failure, and JSON-RPC error codes.

## License

MIT — see `LICENSE`. The package stays `private: true` and is not published to
npm; the MIT grant covers the source in this repository.
