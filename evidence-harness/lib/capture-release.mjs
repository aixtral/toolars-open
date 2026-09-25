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
