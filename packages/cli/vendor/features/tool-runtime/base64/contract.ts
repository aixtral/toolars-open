import type { ToolPrivacyContract } from "@/domain/privacy/types";

export const BASE64_PRIVACY = {
  processingLocation: "browser",
  inputLeavesDevice: false,
  retention: "none",
} as const satisfies ToolPrivacyContract;

export const MAX_BASE64_INPUT_BYTES = 1024 * 1024;
