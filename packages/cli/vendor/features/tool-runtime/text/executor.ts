import type {
  ToolExecutionResult,
  ToolExecutor,
} from "@/domain/tool-runtime/types";

import {
  getTextToolDefinition,
  LOCAL_TEXT_PRIVACY,
  type CaseOperation,
  type HtmlOperation,
  type SlugOperation,
  type TextRuntimeInput,
  type TextRuntimeOutput,
  type TextToolSlug,
  type UrlOperation,
  type WhitespaceOperation,
} from "./definitions";

type ValueResult =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{
      ok: false;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
      };
    }>;

const WORD_PATTERN =
  /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
const TITLE_WORD_PATTERN = /\p{L}[\p{L}\p{M}\p{N}'’]*/gu;
const SENTENCE_START_PATTERN = /(^|[.!?。！？]\s*)(\p{L})/gu;

function safeLocaleLower(value: string, locale: string): string {
  try {
    return value.toLocaleLowerCase(locale);
  } catch {
    return value.toLowerCase();
  }
}

function safeLocaleUpper(value: string, locale: string): string {
  try {
    return value.toLocaleUpperCase(locale);
  } catch {
    return value.toUpperCase();
  }
}

function splitWords(value: string): readonly string[] {
  const separated = value
    .normalize("NFKC")
    .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2");

  return separated.match(WORD_PATTERN) ?? [];
}

function capitalize(value: string, locale: string): string {
  const [first = "", ...rest] = Array.from(value);
  return `${safeLocaleUpper(first, locale)}${safeLocaleLower(rest.join(""), locale)}`;
}

function convertCase(
  value: string,
  operation: CaseOperation,
  locale: string,
): string {
  if (operation === "upper") {
    return safeLocaleUpper(value, locale);
  }

  if (operation === "lower") {
    return safeLocaleLower(value, locale);
  }

  if (operation === "sentence") {
    return safeLocaleLower(value, locale).replace(
      SENTENCE_START_PATTERN,
      (_match, prefix: string, letter: string) =>
        `${prefix}${safeLocaleUpper(letter, locale)}`,
    );
  }

  if (operation === "title") {
    return value.replace(TITLE_WORD_PATTERN, (word) =>
      capitalize(word, locale),
    );
  }

  const words = splitWords(value);
  const lowered = words.map((word) => safeLocaleLower(word, locale));

  switch (operation) {
    case "camel":
      return lowered
        .map((word, index) => (index === 0 ? word : capitalize(word, locale)))
        .join("");
    case "pascal":
      return lowered.map((word) => capitalize(word, locale)).join("");
    case "snake":
      return lowered.join("_");
    case "kebab":
      return lowered.join("-");
  }
}

function removeWhitespace(
  value: string,
  operation: WhitespaceOperation,
): string {
  const normalized = value.replace(/\r\n?/g, "\n");

  switch (operation) {
    case "collapse-spaces":
      return normalized
        .split("\n")
        .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim())
        .join("\n");
    case "collapse-all":
      return normalized.replace(/\s+/gu, " ").trim();
    case "remove-blank-lines":
      return normalized
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .join("\n");
    case "trim-lines":
      return normalized
        .split("\n")
        .map((line) => line.trim())
        .join("\n");
  }
}

function createSlug(
  value: string,
  operation: SlugOperation,
  locale: string,
): string {
  const separator = operation === "hyphen" ? "-" : "_";
  const separatorPattern = new RegExp(`${separator}+`, "g");

  return safeLocaleLower(
    value
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .replace(/&/g, " and ")
      .replace(/['’]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, separator)
      .replace(separatorPattern, separator)
      .replace(new RegExp(`^${separator}|${separator}$`, "g"), ""),
    locale,
  );
}

function encodeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function decodeHtml(value: string): ValueResult {
  if (typeof document === "undefined") {
    return {
      ok: false,
      error: {
        code: "BROWSER_API_UNAVAILABLE",
        message: "HTML entity decoding requires a browser document.",
        recoverable: true,
      },
    };
  }

  const decoder = document.createElement("textarea");
  // Decode references only: parsing the entire input normalizes CR/LF and
  // treats raw markup as HTML. Keep all other input code units unchanged.
  const decoded = value.replace(
    /&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g,
    (reference) => {
      decoder.innerHTML = reference;
      return decoder.value;
    },
  );
  return { ok: true, value: decoded };
}

function convertHtml(value: string, operation: HtmlOperation): ValueResult {
  return operation === "encode"
    ? { ok: true, value: encodeHtml(value) }
    : decodeHtml(value);
}

function convertUrl(value: string, operation: UrlOperation): ValueResult {
  try {
    switch (operation) {
      case "encode-component":
        return { ok: true, value: encodeURIComponent(value) };
      case "decode-component":
        return { ok: true, value: decodeURIComponent(value) };
      case "encode-uri":
        return { ok: true, value: encodeURI(value) };
      case "decode-uri":
        return { ok: true, value: decodeURI(value) };
    }
  } catch {
    return {
      ok: false,
      error: {
        code: "MALFORMED_URL_ENCODING",
        message:
          operation === "decode-component" || operation === "decode-uri"
            ? "The value contains an incomplete or invalid percent escape."
            : "The value contains a character that cannot be URL encoded.",
        recoverable: true,
      },
    };
  }
}

export function transformTextValue<S extends TextToolSlug>(
  slug: S,
  input: TextRuntimeInput<S>,
  locale: string,
): ValueResult {
  if (
    input.value.length > 1024 * 1024 ||
    new TextEncoder().encode(input.value).byteLength > 1024 * 1024
  ) {
    return {
      ok: false,
      error: {
        code: "INPUT_TOO_LARGE",
        message: "INPUT_TOO_LARGE",
        recoverable: true,
      },
    };
  }
  const definition = getTextToolDefinition(slug);
  const isKnownOperation = definition.modes.some(
    (mode) => mode.value === input.operation,
  );

  if (!isKnownOperation) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_OPERATION",
        message: "Choose a supported transformation mode.",
        recoverable: true,
      },
    };
  }

  switch (slug) {
    case "case-converter":
      return {
        ok: true,
        value: convertCase(
          input.value,
          input.operation as CaseOperation,
          locale,
        ),
      };
    case "multiple-whitespace-remover":
      return {
        ok: true,
        value: removeWhitespace(
          input.value,
          input.operation as WhitespaceOperation,
        ),
      };
    case "url-slug-generator":
      return {
        ok: true,
        value: createSlug(
          input.value,
          input.operation as SlugOperation,
          locale,
        ),
      };
    case "html-encoder-decoder":
      return convertHtml(input.value, input.operation as HtmlOperation);
    case "url-encoder-decoder":
      return convertUrl(input.value, input.operation as UrlOperation);
  }
}

function abortedResult<TOutput>(): ToolExecutionResult<TOutput> {
  return {
    ok: false,
    error: {
      code: "ABORTED",
      message: "The local transformation was cancelled.",
      recoverable: true,
    },
  };
}

function createTextExecutor<S extends TextToolSlug>(
  slug: S,
): ToolExecutor<TextRuntimeInput<S>, TextRuntimeOutput> {
  return {
    mode: "local",
    privacy: LOCAL_TEXT_PRIVACY,
    async execute(input, context) {
      if (context.signal.aborted) {
        return abortedResult();
      }

      await Promise.resolve();

      if (context.signal.aborted) {
        return abortedResult();
      }

      const result = transformTextValue(slug, input, context.locale);

      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        output: {
          value: result.value,
          fileName: getTextToolDefinition(slug).downloadFileName,
          mediaType: "text/plain;charset=utf-8",
        },
      };
    },
  };
}

type TextExecutorRegistry = {
  readonly [S in TextToolSlug]: ToolExecutor<
    TextRuntimeInput<S>,
    TextRuntimeOutput
  >;
};

export const textToolExecutors = {
  "case-converter": createTextExecutor("case-converter"),
  "multiple-whitespace-remover": createTextExecutor(
    "multiple-whitespace-remover",
  ),
  "url-slug-generator": createTextExecutor("url-slug-generator"),
  "html-encoder-decoder": createTextExecutor("html-encoder-decoder"),
  "url-encoder-decoder": createTextExecutor("url-encoder-decoder"),
} as const satisfies TextExecutorRegistry;

export function getTextToolExecutor<S extends TextToolSlug>(
  slug: S,
): TextExecutorRegistry[S] {
  return textToolExecutors[slug];
}

export function getTextToolExecutorForWorkspace(
  slug: TextToolSlug,
): ToolExecutor<TextRuntimeInput, TextRuntimeOutput> {
  return textToolExecutors[slug] as ToolExecutor<
    TextRuntimeInput,
    TextRuntimeOutput
  >;
}
