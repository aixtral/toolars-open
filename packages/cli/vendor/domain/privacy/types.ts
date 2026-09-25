export type ProcessingLocation = "browser" | "toolars-cloud" | "third-party";
export type RetentionPolicy = "none" | "request" | "temporary";

export interface ToolPrivacyContract {
  readonly processingLocation: ProcessingLocation;
  readonly inputLeavesDevice: boolean;
  readonly retention: RetentionPolicy;
  readonly retentionWindow?: string;
}
