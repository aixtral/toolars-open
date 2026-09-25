import type { TimeToolErrorCode } from "./definitions";

export class TimeToolRuntimeError extends Error {
  readonly code: TimeToolErrorCode;
  readonly values: Readonly<Record<string, number | string>> | undefined;

  constructor(
    code: TimeToolErrorCode,
    values?: Readonly<Record<string, number | string>>,
  ) {
    super(code);
    this.name = "TimeToolRuntimeError";
    this.code = code;
    this.values = values;
  }
}

export function isTimeToolRuntimeError(
  error: unknown,
): error is TimeToolRuntimeError {
  return error instanceof TimeToolRuntimeError;
}
