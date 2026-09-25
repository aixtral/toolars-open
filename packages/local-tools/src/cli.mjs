#!/usr/bin/env node
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import {
  formatJsonText,
  sha256Text,
  MAX_TEXT_BYTES,
  safeError,
} from "./core.mjs";
const MAX_FILE_BYTES = 256 * 1024 * 1024;
async function stdinText() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_TEXT_BYTES) throw new Error("INPUT_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw new Error("INVALID_UTF8");
  }
}
async function hashFile(path) {
  let handle;
  try {
    // O_NONBLOCK prevents a FIFO from blocking before the regular-file check.
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("FILE_UNAVAILABLE");
    if (stat.size > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } catch (error) {
    if (error?.message === "FILE_TOO_LARGE") throw error;
    throw new Error("FILE_UNAVAILABLE");
  } finally {
    await handle?.close();
  }
}
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" && !args.length) {
    process.stdout.write(
      "toolars-local json [--indent 0|2|4] < input.json\ntoolars-local sha256 < input.txt\ntoolars-local sha256 --file /explicit/path\nText: UTF-8, maximum 256 KiB. Files: 256 MiB. Output goes to stdout.\n",
    );
  } else if (
    command === "json" &&
    (!args.length ||
      (args.length === 2 &&
        args[0] === "--indent" &&
        ["0", "2", "4"].includes(args[1])))
  ) {
    process.stdout.write(
      formatJsonText(await stdinText(), args.length ? Number(args[1]) : 2) +
        "\n",
    );
  } else if (command === "sha256" && !args.length) {
    process.stdout.write(sha256Text(await stdinText()) + "\n");
  } else if (
    command === "sha256" &&
    args.length === 2 &&
    args[0] === "--file" &&
    args[1]
  ) {
    process.stdout.write((await hashFile(args[1])) + "\n");
  } else throw new Error("INVALID_ARGUMENTS");
} catch (error) {
  process.stderr.write(safeError(error) + "\n");
  process.exitCode = 1;
}
