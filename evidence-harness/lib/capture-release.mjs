/**
 * Scenario ids a complete privacy-proof capture must record, in execution
 * order. Single source shared by the capture harness loop, the deployment
 * proof check below, and the tests that keep the committed capture file and
 * the receipt aligned with the harness — never hardcode the list elsewhere.
 */
export const PRIVACY_PROOF_SCENARIO_IDS = [
  "image-tool-convert",
  "image-tool-heic-convert",
  "ocr-language-pack",
  "pdf-tool-rotate",
  "csv-excel-relay",
  "custom-text-chain",
];

/** Describe the actual target without presenting a live run as a local build. */
export function describeCaptureEnvironment(baseUrl) {
  const target = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  const location =
    target.origin === "https://toolars.com"
      ? "the live production origin"
      : local
        ? "a local origin"
        : "the configured remote origin";
  return (
    `Headless Chromium against ${location}, recording requests including dedicated Web Worker fetches. ` +
    "Service workers are blocked; warmed resources may use the browser HTTP cache. " +
    "Counts cover the scenario windows only, not every site request. " +
    (target.origin === "https://toolars.com"
      ? "Disclosed shell analytics traffic may be observed separately from tool processing."
      : "Toolars analytics is disabled outside the production origin; this run does not verify production analytics isolation.")
  );
}

/** Validate identity from the server actually measured, never the local tree. */
export function captureReleaseObservation({ url, status, revision }, origin) {
  const target = new URL(url);
  if (
    target.origin !== origin ||
    status !== 200 ||
    !/^[a-f0-9]{16}$/.test(revision ?? "")
  ) {
    throw new Error(
      "Capture requires HTTP 200 on the target origin with a valid X-Toolars-Release header",
    );
  }
  return { path: target.pathname, revision };
}

export function summarizeCaptureRelease(observations) {
  const revisions = new Set(observations.map(({ revision }) => revision));
  const stable = observations.length >= 2 && revisions.size === 1;
  return {
    revision: stable ? observations[0].revision : null,
    stable,
    observations,
  };
}

/** Bind a completed capture to the deployment still served after the run. */
export function verifyDeploymentProof(
  capture,
  live,
  headerRevision,
  expectedCommit,
) {
  if (
    capture.outcome !== "verified" ||
    capture.release?.stable !== true ||
    capture.environment?.baseUrl !== "https://toolars.com" ||
    (capture.violations?.length ?? 0) !== 0 ||
    (capture.unavailable?.length ?? 0) !== 0 ||
    PRIVACY_PROOF_SCENARIO_IDS.some(
      (id) => !capture.scenarios?.some((s) => s.id === id),
    )
  ) {
    throw new Error(
      "No complete verified production capture for the required six scenarios",
    );
  }
  if (
    !/^[a-f0-9]{16}$/u.test(headerRevision ?? "") ||
    capture.release.revision !== headerRevision ||
    live.release?.revision !== headerRevision
  ) {
    throw new Error(
      "Deployment changed or release identity is missing; capture again",
    );
  }
  const commit = live.source?.commit;
  if (
    !/^[a-f0-9]{40}$/u.test(commit ?? "") ||
    (expectedCommit !== undefined &&
      (!/^[a-f0-9]{40}$/u.test(expectedCommit) || commit !== expectedCommit))
  ) {
    throw new Error(
      "Served source commit does not match the expected deployment",
    );
  }
  return {
    revision: headerRevision,
    sourceCommit: commit,
    capturedAt: capture.capturedAt,
  };
}
