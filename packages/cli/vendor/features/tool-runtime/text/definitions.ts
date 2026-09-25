import type { ToolPrivacyContract } from "@/domain/privacy/types";

export const LOCAL_TEXT_PRIVACY = {
  processingLocation: "browser",
  inputLeavesDevice: false,
  retention: "none",
} as const satisfies ToolPrivacyContract;

export const TEXT_TOOL_SLUGS = [
  "case-converter",
  "multiple-whitespace-remover",
  "url-slug-generator",
  "html-encoder-decoder",
  "url-encoder-decoder",
] as const;

export type TextToolSlug = (typeof TEXT_TOOL_SLUGS)[number];

export type CaseOperation =
  | "sentence"
  | "title"
  | "upper"
  | "lower"
  | "camel"
  | "pascal"
  | "snake"
  | "kebab";

export type WhitespaceOperation =
  "collapse-spaces" | "collapse-all" | "remove-blank-lines" | "trim-lines";

export type SlugOperation = "hyphen" | "underscore";
export type HtmlOperation = "encode" | "decode";
export type UrlOperation =
  "encode-component" | "decode-component" | "encode-uri" | "decode-uri";

export interface TextOperationBySlug {
  readonly "case-converter": CaseOperation;
  readonly "multiple-whitespace-remover": WhitespaceOperation;
  readonly "url-slug-generator": SlugOperation;
  readonly "html-encoder-decoder": HtmlOperation;
  readonly "url-encoder-decoder": UrlOperation;
}

export type TextOperation = TextOperationBySlug[TextToolSlug];

export type TextRuntimeInput<S extends TextToolSlug = TextToolSlug> = Readonly<{
  value: string;
  operation: TextOperationBySlug[S];
}>;

export type TextRuntimeOutput = Readonly<{
  value: string;
  fileName: string;
  mediaType: "text/plain;charset=utf-8";
}>;

/**
 * Display copy (labels, descriptions) lives in ./messages.ts under
 * ToolRuntime.text.tools.<slug>; definitions keep structural data only.
 * `name` is the tool's product name and stays untranslated; `sample` is demo
 * content tuned for each transformation and is intentionally not localized.
 */
export type TextMode<S extends TextToolSlug = TextToolSlug> = Readonly<{
  value: TextOperationBySlug[S];
  sample: string;
}>;

export type TextToolDefinition<S extends TextToolSlug = TextToolSlug> =
  Readonly<{
    slug: S;
    name: string;
    defaultOperation: TextOperationBySlug[S];
    modes: readonly TextMode<S>[];
    reverseOperations?: Readonly<
      Partial<Record<TextOperationBySlug[S], TextOperationBySlug[S]>>
    >;
    downloadFileName: string;
  }>;

const caseConverter = {
  slug: "case-converter",
  name: "Case Converter",
  defaultOperation: "sentence",
  downloadFileName: "toolars-converted-text.txt",
  modes: [
    {
      value: "sentence",
      sample: "TOOLARS makes BROWSER tools. THEY stay local!",
    },
    {
      value: "title",
      sample: "ship useful browser tools faster",
    },
    {
      value: "upper",
      sample: "Toolars works with Unicode",
    },
    {
      value: "lower",
      sample: "Toolars Works With Unicode",
    },
    {
      value: "camel",
      sample: "browser first tool runtime",
    },
    {
      value: "pascal",
      sample: "browser first tool runtime",
    },
    {
      value: "snake",
      sample: "BrowserFirst tool runtime",
    },
    {
      value: "kebab",
      sample: "BrowserFirst tool runtime",
    },
  ],
} as const satisfies TextToolDefinition<"case-converter">;

const whitespaceRemover = {
  slug: "multiple-whitespace-remover",
  name: "Multiple Whitespace Remover",
  defaultOperation: "collapse-spaces",
  downloadFileName: "toolars-clean-text.txt",
  modes: [
    {
      value: "collapse-spaces",
      sample: "Toolars    keeps\ttext tidy.\nLine two   stays here.",
    },
    {
      value: "collapse-all",
      sample: "Toolars    keeps\n\n text   tidy.",
    },
    {
      value: "remove-blank-lines",
      sample: "First line\n\n\nSecond line\n   \nThird line",
    },
    {
      value: "trim-lines",
      sample: "  First line  \n   Second line\t\nThird line   ",
    },
  ],
} as const satisfies TextToolDefinition<"multiple-whitespace-remover">;

const slugGenerator = {
  slug: "url-slug-generator",
  name: "URL Slug Generator",
  defaultOperation: "hyphen",
  downloadFileName: "toolars-url-slug.txt",
  modes: [
    {
      value: "hyphen",
      sample: "Crème brûlée & browser tools",
    },
    {
      value: "underscore",
      sample: "Crème brûlée & browser tools",
    },
  ],
} as const satisfies TextToolDefinition<"url-slug-generator">;

const htmlEncoderDecoder = {
  slug: "html-encoder-decoder",
  name: "HTML Encoder/Decoder",
  defaultOperation: "encode",
  downloadFileName: "toolars-html-entities.txt",
  reverseOperations: { encode: "decode", decode: "encode" },
  modes: [
    {
      value: "encode",
      sample: '<section aria-label="Toolars">Fast & local</section>',
    },
    {
      value: "decode",
      sample: "&lt;strong&gt;Fast &amp; local&lt;/strong&gt; &#128640;",
    },
  ],
} as const satisfies TextToolDefinition<"html-encoder-decoder">;

const urlEncoderDecoder = {
  slug: "url-encoder-decoder",
  name: "URL Encoder/Decoder",
  defaultOperation: "encode-component",
  downloadFileName: "toolars-url-value.txt",
  reverseOperations: {
    "encode-component": "decode-component",
    "decode-component": "encode-component",
    "encode-uri": "decode-uri",
    "decode-uri": "encode-uri",
  },
  modes: [
    {
      value: "encode-component",
      sample: "Toolars tools/你好?fast=true",
    },
    {
      value: "decode-component",
      sample: "Toolars%20tools%2F%E4%BD%A0%E5%A5%BD%3Ffast%3Dtrue",
    },
    {
      value: "encode-uri",
      sample: "https://toolars.dev/tools?q=你好 world#result",
    },
    {
      value: "decode-uri",
      sample: "https://toolars.dev/tools?q=%E4%BD%A0%E5%A5%BD%20world#result",
    },
  ],
} as const satisfies TextToolDefinition<"url-encoder-decoder">;

export const textToolDefinitions = {
  "case-converter": caseConverter,
  "multiple-whitespace-remover": whitespaceRemover,
  "url-slug-generator": slugGenerator,
  "html-encoder-decoder": htmlEncoderDecoder,
  "url-encoder-decoder": urlEncoderDecoder,
} as const satisfies {
  readonly [S in TextToolSlug]: TextToolDefinition<S>;
};

const textToolSlugSet = new Set<string>(TEXT_TOOL_SLUGS);

export function isTextToolSlug(value: string): value is TextToolSlug {
  return textToolSlugSet.has(value);
}

export function getTextToolDefinition<S extends TextToolSlug>(
  slug: S,
): (typeof textToolDefinitions)[S] {
  return textToolDefinitions[slug];
}
