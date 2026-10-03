// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Walk state for the server's log scrubber (`helpers/error-serializer.ts`). */
export interface LogScrubState {
  /** Objects on the current path — a revisit is a cycle. */
  ancestors: WeakSet<object>;
  /** Objects visited so far across the whole walk, capped at `LOG_SCRUB_LIMITS.MAX_NODES`. */
  visited: number;
}
