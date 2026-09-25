import { createHash } from "node:crypto";
import { parseJsonInput, formatJson } from "./json-core.mjs";
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export function textBytes(text) {
  if (typeof text !== "string") throw new Error("INVALID_ARGUMENTS");
  if (!text.isWellFormed()) throw new Error("INVALID_UNICODE_INPUT");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_TEXT_BYTES) throw new Error("INPUT_TOO_LARGE");
  return bytes;
}
export function formatJsonText(text, indent = 2) {
  textBytes(text);
  if (![0, 2, 4].includes(indent)) throw new Error("INVALID_ARGUMENTS");
  const parsed = parseJsonInput(text);
  // Parser locations may contain an excerpt: return only stable codes across this boundary.
  if (!parsed.ok) throw new Error(parsed.error.code);
  const result = formatJson(parsed.value, indent);
  if (Buffer.byteLength(result) > MAX_OUTPUT_BYTES)
    throw new Error("OUTPUT_TOO_LARGE");
  return result;
}
export function sha256Text(text) {
  textBytes(text);
  return createHash("sha256").update(text, "utf8").digest("hex");
}
export const ERROR_CODES = new Set([
  "INVALID_ARGUMENTS",
  "INVALID_UNICODE_INPUT",
  "INPUT_TOO_LARGE",
  "OUTPUT_TOO_LARGE",
  "EMPTY_INPUT",
  "INVALID_JSON",
  "MAX_NODES_EXCEEDED",
  "MAX_DEPTH_EXCEEDED",
  "UNSAFE_PROPERTY",
  "FILE_UNAVAILABLE",
  "FILE_TOO_LARGE",
  "INVALID_UTF8",
]);
export function safeError(error) {
  return ERROR_CODES.has(error?.message) ? error.message : "RUNTIME_ERROR";
}
