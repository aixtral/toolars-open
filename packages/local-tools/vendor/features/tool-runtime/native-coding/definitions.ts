import type { JsonNumber } from "./json-tree";

export const NATIVE_CODING_TOOL_SLUGS = [
  "react-native-shadow-generator",
  "json-tree-viewer",
] as const;

export type NativeCodingToolSlug = (typeof NATIVE_CODING_TOOL_SLUGS)[number];

export type NativeCodingWorkspaceProps = Readonly<{
  toolSlug: NativeCodingToolSlug;
}>;

export type ShadowPlatform = "ios" | "android" | "both";

export type ShadowSettings = Readonly<{
  color: `#${string}`;
  offsetX: number;
  offsetY: number;
  opacity: number;
  radius: number;
  elevation: number;
  platform: ShadowPlatform;
}>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonNumber
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

export type JsonValueType =
  "array" | "boolean" | "null" | "number" | "object" | "string";

export type JsonParseErrorCode =
  | "EMPTY_INPUT"
  | "INPUT_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_JSON_NUMBER"
  | "INVALID_JSON_VALUE"
  | "MAX_DEPTH_EXCEEDED"
  | "MAX_NODES_EXCEEDED"
  | "UNSAFE_PROPERTY";

export type JsonParseHintCode =
  | "ADD_COLON"
  | "ADD_COMMA_OR_CLOSE"
  | "CHECK_JSON_SYNTAX"
  | "CLOSE_STRUCTURE"
  | "COMPLETE_STRING"
  | "QUOTE_PROPERTY"
  | "REMOVE_TRAILING_COMMA";

export type JsonParseErrorLocation = Readonly<{
  offset: number;
  line: number;
  column: number;
  excerpt: string;
  excerptColumn: number;
}>;

export type JsonParseLimits = Readonly<{
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
}>;

export type JsonParseResult =
  | Readonly<{
      ok: true;
      value: JsonValue;
      nodeCount: number;
      maxDepth: number;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: JsonParseErrorCode;
        hintCode?: JsonParseHintCode;
        location?: JsonParseErrorLocation;
        message: string;
        values?: Readonly<Record<string, number | string>>;
      }>;
    }>;
