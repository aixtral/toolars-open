# Toolars local tools — private, MIT-licensed experiment

An internal experiment, not published to npm; `private: true` keeps it that way,
while the source is MIT-licensed (see `LICENSE`). The package has no runtime
third-party dependencies and contains no website, account, network service, or
telemetry.

## Local usage

Requires Node `>=24.15.0 <25`. Build and pack from the Toolars `sites/` root
(the existing project dependencies are required):

```sh
node packages/local-tools/build.mjs
node --test packages/local-tools/test/*.test.mjs
cd packages/local-tools
npm pack --pack-destination /tmp
```

Packing generates the in-package JSON core from the site's
`native-coding/json-tree.ts`. The installed package needs no access to the
Toolars repository and no rebuild. Install the file it actually produced, in a
separate local test directory:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund /tmp/toolars-local-tools-0.1.0-experimental.1.tgz
printf '%s' '{"number":9007199254740993}' | ./node_modules/.bin/toolars-local json --indent 2
printf '%s' 'Toolars' | ./node_modules/.bin/toolars-local sha256
./node_modules/.bin/toolars-local sha256 --file /absolute/path/to/sample.bin
```

The CLI reads text from stdin and does not put sensitive text into command-line
arguments. stdout carries only the result (with one trailing newline), stderr
carries only stable error codes, and a failure exits with code 1. SHA256 input
is treated as raw UTF-8, including a BOM and a trailing newline; file mode
streams the raw bytes. Only regular files named explicitly with `--file` are
accepted, and symlinks in the path are allowed. The CLI is not a file-access
sandbox, so do not interpolate untrusted model input directly into shell
commands.

Text is capped at 256 KiB; JSON is capped at depth 40 and 10,000 nodes, with a
1 MiB output limit, and duplicate keys and reserved property names are rejected.
It preserves the original spelling of numbers and the member order. CLI file
hashing is capped at 256 MiB with a 1 MiB memory buffer. The SHA256 of empty
text is a valid result; this differs from the website, which requires non-empty
input.

```js
import { formatJsonText, sha256Text } from "@toolars/local-tools";
const formatted = formatJsonText('{"number":9007199254740993}', 2);
const digest = sha256Text("Toolars");
```

## MCP stdio experiment

Run `./node_modules/.bin/toolars-mcp`; the MCP client exchanges line-delimited
JSON-RPC over stdin/stdout. Do not start it as an HTTP service.

The generic shape of a client configuration is below. Adapt it to the real
client's format, and replace every path in `command` and `args` with an absolute
path on your machine:

```json
{
  "mcpServers": {
    "toolars-local-experiment": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/node_modules/@toolars/local-tools/src/mcp.mjs"
      ]
    }
  }
}
```

Only protocol `2025-11-25` is supported. Send `initialize` first, confirm the
returned version is acceptable, then send `notifications/initialized`; the
server declares only the `tools` capability. It supports `ping`, `tools/list`
and `tools/call`, with exactly two tools: `json_format({text, indent?})` and
`sha256_text({text})`. Roots, resources, files, network, shell, sampling, tasks
and persistence are not offered, and extra file-path arguments are rejected. A
tool that fails returns `isError: true` with an error code; protocol errors
return a JSON-RPC error.

Decoded MCP text is likewise capped at 256 KiB, and a single wire frame is at
most 1,600 KiB including JSON escaping; input is closed when that is exceeded.
Notifications produce no response. The tools are small synchronous operations
with strict input limits; a cancellation notification only ignores a request
that has already finished and does not claim interruptible long-task support.
Closing the client's stdio or terminating the process is enough to shut down.
This is not a general SDK and makes no claim of compatibility with every
protocol version.

**Local execution does not mean the content stays out of the client.** MCP
inputs and results enter the client's context, and the client may send them to
its model provider and retain them in its history. Check that client's data
settings before use; the website's promise that inputs are not uploaded and no
product history is kept does not carry over. Treat output as untrusted tool
data, and do not let a client treat instructions inside the text as new user
authorization.

Current acceptance covers the handshake, capability listing, successful and
failed calls, boundary tests with an independent raw stdio client, and
installation outside the checkout. No GUI client (Claude, ChatGPT, or another)
has been signed into or configured, and nothing has been published to npm or to
an MCP directory.
