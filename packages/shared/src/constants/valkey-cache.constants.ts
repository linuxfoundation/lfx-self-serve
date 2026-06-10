// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Configuration for the shared Valkey cache (cross-instance, TTL read-through; fail-soft, fail-closed on missing identity). */
export const VALKEY_CACHE = {
  /** App-level key prefix so entries never collide with other consumers of the shared backend. */
  APP_PREFIX: 'lfx-ui',

  /** Domain + schema-version segment for the org membership resolver cache. Bump `v1`→`v2` to invalidate. */
  ORG_MEMBERSHIP_NAMESPACE: 'org-membership:v1',

  /** Domain + schema-version segment for the org access / role-grants cache. */
  ORG_ACCESS_NAMESPACE: 'org-access:v1',

  /** Default freshness window for membership entries (carried over from the prior 30_000 ms memo). */
  ORG_MEMBERSHIP_TTL_SECONDS: 30,

  /** Per-op cap; a slower cache resolves to a miss so the request fetches directly (well below the ~30s upstream timeout). */
  OP_TIMEOUT_MS: 250,

  /** Connection timeout for the lazy client. */
  CONNECT_TIMEOUT_MS: 1000,

  /** Skip caching values larger than this (bytes of the serialized JSON) to protect the single-node cache. */
  MAX_VALUE_BYTES: 1_048_576,
} as const;
