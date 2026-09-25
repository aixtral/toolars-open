import type {
  ToolExecutionResult,
  ToolExecutor,
} from "@/domain/tool-runtime/types";

import { BASE64_PRIVACY, MAX_BASE64_INPUT_BYTES } from "./contract";

export type Base64Operation = "encode" | "decode";

export type Base64ExecutorInput = Readonly<{
  value: string;
  operation: Base64Operation;
  options: Readonly<{
    utf8: boolean;
    urlSafe: boolean;
    preserveLineBreaks: boolean;
  }>;
}>;

export type Base64ExecutorOutput = Readonly<{
  value: string;
  fileName: string;
  mediaType: "text/plain;charset=utf-8";
}>;

export type Base64ValueResult =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{
      ok: false;
      code: string;
      message: string;
      recoverable: boolean;
    }>;

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]*={0,2}$/;

function normalizeLineBreaks(value: string, preserveLineBreaks: boolean) {
  return preserveLineBreaks ? value : value.replace(/\r\n?|\n/g, " ");
}

function bytesToBinary(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return binary;
}

function binaryToBytes(binary: string) {
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function encodeBase64(input: Base64ExecutorInput): Base64ValueResult {
  const preparedInput = normalizeLineBreaks(
    input.value,
    input.options.preserveLineBreaks,
  );
  let binary = "";

  if (input.options.utf8) {
    if (!preparedInput.isWellFormed()) {
      return {
        ok: false,
        code: "INVALID_UNICODE_INPUT",
        message: "Input contains an unpaired surrogate.",
        recoverable: true,
      };
    }
    binary = bytesToBinary(new TextEncoder().encode(preparedInput));
  } else {
    for (let index = 0; index < preparedInput.length; index += 1) {
      const codePoint = preparedInput.charCodeAt(index);

      if (codePoint > 255) {
        return {
          ok: false,
          code: "OUTSIDE_BYTE_RANGE",
          message: "Enable UTF-8 to encode characters outside the byte range.",
          recoverable: true,
        };
      }

      binary += String.fromCharCode(codePoint);
    }
  }

  try {
    const encoded = btoa(binary);

    return {
      ok: true,
      value: input.options.urlSafe
        ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
        : encoded,
    };
  } catch {
    return {
      ok: false,
      code: "BASE64_API_UNAVAILABLE",
      message: "Base64 encoding is unavailable in this browser.",
      recoverable: true,
    };
  }
}

function decodeBase64(input: Base64ExecutorInput): Base64ValueResult {
  const compactInput = input.value.replace(/[\t\n\f\r ]/g, "");

  if (!compactInput) {
    return { ok: true, value: "" };
  }

  const pattern = input.options.urlSafe ? BASE64_URL_PATTERN : BASE64_PATTERN;

  if (!pattern.test(compactInput)) {
    return {
      ok: false,
      code: "INVALID_BASE64_CHARACTERS",
      message: input.options.urlSafe
        ? "Enter valid URL-safe Base64 characters."
        : "Enter valid Base64 characters.",
      recoverable: true,
    };
  }

  const unpadded = compactInput.replace(/=+$/, "");
  const padding = compactInput.length - unpadded.length;
  const requiredPadding = (4 - (unpadded.length % 4)) % 4;
  if (padding > 0 && (padding !== requiredPadding || unpadded.length === 0)) {
    return {
      ok: false,
      code: "INVALID_BASE64_PADDING",
      message: "Base64 padding is malformed or non-canonical.",
      recoverable: true,
    };
  }

  if (unpadded.length % 4 === 1) {
    return {
      ok: false,
      code: "INVALID_BASE64_LENGTH",
      message: "The Base64 length is not valid.",
      recoverable: true,
    };
  }

  const normalized = (
    input.options.urlSafe
      ? unpadded.replace(/-/g, "+").replace(/_/g, "/")
      : unpadded
  ).padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), "=");

  try {
    const binary = atob(normalized);
    if (btoa(binary) !== normalized) {
      return {
        ok: false,
        code: "INVALID_BASE64_PADDING",
        message: "Base64 padding is malformed or non-canonical.",
        recoverable: true,
      };
    }
    const decoded = input.options.utf8
      ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          binaryToBytes(binary),
        )
      : binary;

    return {
      ok: true,
      value: normalizeLineBreaks(decoded, input.options.preserveLineBreaks),
    };
  } catch {
    return {
      ok: false,
      code: input.options.utf8 ? "INVALID_UTF8_BASE64" : "INVALID_BASE64",
      message: input.options.utf8
        ? "This value is not valid UTF-8 Base64."
        : "This value is not valid Base64.",
      recoverable: true,
    };
  }
}

export function transformBase64Value(
  input: Base64ExecutorInput,
): Base64ValueResult {
  if (input.operation !== "encode" && input.operation !== "decode")
    return {
      ok: false,
      code: "INVALID_OPERATION",
      message: "INVALID_OPERATION",
      recoverable: true,
    };
  if (
    input.value.length > MAX_BASE64_INPUT_BYTES ||
    new TextEncoder().encode(input.value).byteLength > MAX_BASE64_INPUT_BYTES
  )
    return {
      ok: false,
      code: "INPUT_TOO_LARGE",
      message: "INPUT_TOO_LARGE",
      recoverable: true,
    };
  return input.operation === "encode"
    ? encodeBase64(input)
    : decodeBase64(input);
}

function abortedResult(): ToolExecutionResult<Base64ExecutorOutput> {
  return {
    ok: false,
    error: {
      code: "ABORTED",
      message: "The local transformation was cancelled.",
      recoverable: true,
    },
  };
}

export const base64Executor = {
  mode: "local",
  privacy: BASE64_PRIVACY,
  async execute(input, context) {
    if (context.signal.aborted) {
      return abortedResult();
    }

    await Promise.resolve();

    if (context.signal.aborted) {
      return abortedResult();
    }

    const result = transformBase64Value(input);

    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: result.code,
          message: result.message,
          recoverable: result.recoverable,
        },
      };
    }

    return {
      ok: true,
      output: {
        value: result.value,
        fileName:
          input.operation === "encode"
            ? "toolars-base64.txt"
            : "toolars-decoded.txt",
        mediaType: "text/plain;charset=utf-8",
      },
    };
  },
} satisfies ToolExecutor<Base64ExecutorInput, Base64ExecutorOutput>;
