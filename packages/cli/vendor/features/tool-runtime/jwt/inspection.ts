export const JWT_TIME_CLAIMS = ["exp", "nbf", "iat"] as const;
export type JwtTimeClaim = (typeof JWT_TIME_CLAIMS)[number];
export type JwtTimeState =
  | "missing"
  | "invalid"
  | "expired"
  | "not-yet-valid"
  | "active"
  | "future"
  | "issued";
export type JwtTimeReport = Readonly<{
  checkedAt: string;
  clockToleranceSeconds: 0;
  claims: readonly Readonly<{
    claim: JwtTimeClaim;
    state: JwtTimeState;
    seconds: number | null;
    utc: string | null;
  }>[];
}>;

export function inspectJwtTimes(
  payload: Record<string, unknown>,
  now: Date,
): JwtTimeReport {
  const secondsNow = Math.floor(now.getTime() / 1000);
  return {
    checkedAt: new Date(secondsNow * 1000).toISOString(),
    clockToleranceSeconds: 0,
    claims: JWT_TIME_CLAIMS.map((claim) => {
      const value = payload[claim];
      const base = { claim, seconds: null, utc: null };
      if (!Object.hasOwn(payload, claim)) return { ...base, state: "missing" };
      // A bounded diagnostic date range; this is not a JWT lifetime policy.
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 8.64e12
      )
        return { ...base, state: "invalid" };
      const state =
        claim === "exp"
          ? value <= secondsNow
            ? "expired"
            : "active"
          : claim === "nbf"
            ? value > secondsNow
              ? "not-yet-valid"
              : "active"
            : value > secondsNow
              ? "future"
              : "issued";
      return {
        claim,
        state,
        seconds: value,
        utc: new Date(value * 1000).toISOString(),
      };
    }),
  };
}

function decimalKey(raw: string): string {
  const [mantissa, power = "0"] = raw.toLowerCase().split("e");
  const negative = mantissa!.startsWith("-");
  const [whole, fraction = ""] = mantissa!.replace(/^-/, "").split(".");
  let digits = (whole! + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  let exponent = Number(power) - fraction.length;
  const significant = digits.replace(/0+$/, "");
  exponent += digits.length - significant.length;
  digits = significant;
  return `${negative ? "-" : ""}${digits}e${exponent}`;
}

/** Refuse JSON numeric values that would silently change on JSON serialization. */
export function parseJwtJson(source: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("INVALID_JSON_OBJECT");
  for (const token of source.matchAll(
    /"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  )) {
    const raw = token[0];
    if (raw.startsWith('"')) continue;
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      decimalKey(raw) !== decimalKey(String(value))
    )
      throw new Error("JSON_NUMBER_UNSAFE");
  }
  return parsed as Record<string, unknown>;
}

export function decodeJwtSegment(segment: string): Record<string, unknown> {
  const bytes = Uint8Array.from(
    atob(segment.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  return parseJwtJson(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
  );
}
