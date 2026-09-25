import type { ToolPrivacyContract } from "@/domain/privacy/types";

export const IDENTIFIER_TOOL_SLUGS = ["uuid-ulid-generator"] as const;

export type IdentifierToolSlug = (typeof IDENTIFIER_TOOL_SLUGS)[number];

export const MAX_IDENTIFIER_BATCH_COUNT = 100;
export const MAX_IDENTIFIER_INPUT_LENGTH = 128;
export const MAX_IDENTIFIER_EXPORT_BYTES = 16_384;

export const LOCAL_IDENTIFIER_PRIVACY = {
  processingLocation: "browser",
  inputLeavesDevice: false,
  retention: "none",
} as const satisfies ToolPrivacyContract;

export type IdentifierFormat = "uuid-v4" | "uuid-v7" | "ulid";
export type IdentifierCase = "canonical" | "uppercase" | "lowercase";
