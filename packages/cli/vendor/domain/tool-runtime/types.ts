import type { ToolPrivacyContract } from "../privacy/types";

export type ToolExecutionMode = "local" | "cloud" | "hybrid";

export interface ToolExecutionContext {
  readonly signal: AbortSignal;
  readonly locale: string;
}

export type ToolExecutionResult<TOutput> =
  | Readonly<{ ok: true; output: TOutput }>
  | Readonly<{
      ok: false;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
        /** Numeric source position only; never an input excerpt or parser message. */
        position?: Readonly<{ line: number; column: number }>;
      };
    }>;

export interface ToolExecutor<TInput, TOutput> {
  readonly mode: ToolExecutionMode;
  readonly privacy: ToolPrivacyContract;
  execute(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<TOutput>>;
}

export interface ToolRuntimeLoader<TInput = unknown, TOutput = unknown> {
  load(): Promise<ToolExecutor<TInput, TOutput>>;
}
