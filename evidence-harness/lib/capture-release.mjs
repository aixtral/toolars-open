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
  const required = [
    "image-tool-convert",
    "image-tool-heic-convert",
    "ocr-language-pack",
    "pdf-tool-rotate",
    "csv-excel-relay",
    "custom-text-chain",
  ];
  if (
    capture.outcome !== "verified" ||
    capture.release?.stable !== true ||
    capture.environment?.baseUrl !== "https://toolars.com" ||
    (capture.violations?.length ?? 0) !== 0 ||
    (capture.unavailable?.length ?? 0) !== 0 ||
    required.some((id) => !capture.scenarios?.some((s) => s.id === id))
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
