// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Plausible configuration from environment.
 *
 * Only `enabled` varies per environment — the script URL and registered
 * domain are environment-invariant constants in `@lfx-one/shared/constants`
 * (`PLAUSIBLE_SRC`, `PLAUSIBLE_DOMAIN`).
 */
export interface PlausibleConfig {
  /** Whether analytics is enabled for this environment */
  enabled: boolean;
}

/**
 * One queued Plausible call captured by the upstream snippet's queue stub
 * before the real script loads. Each entry is the full argument tuple the
 * caller invoked `window.plausible(...)` with.
 */
export type PlausibleCall = [eventName: string, options?: { u?: string; props?: Record<string, unknown> }];

/**
 * Plausible browser API
 *
 * The runtime function is created either by the official upstream snippet (a
 * queue stub that buffers calls until the real script loads) or by the loaded
 * `pa-*.js` script itself once it replaces the stub. Both shapes share this
 * type — the queue/init/options properties are populated by the stub and read
 * by the real script during initialization. `q` is an array of argument
 * tuples (one per buffered call), not a flat array of arguments.
 */
export type PlausibleFunction = ((...args: PlausibleCall) => void) & {
  q?: PlausibleCall[];
  init?: (options?: Record<string, unknown>) => void;
  o?: Record<string, unknown>;
};
