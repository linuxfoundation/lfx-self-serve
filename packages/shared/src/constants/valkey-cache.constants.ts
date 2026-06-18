// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Configuration for the shared Valkey cache (cross-instance, TTL read-through; fail-soft, fail-closed on missing identity). */
export const VALKEY_CACHE = {
  /** App-level key prefix so entries never collide with other consumers of the shared backend. */
  APP_PREFIX: 'lfx-ui',

  /** Domain + schema-version segment for the org membership resolver cache. Bump `v1`→`v2` on a breaking shape change so reads/writes move to a fresh namespace and stale entries age out via TTL. */
  ORG_MEMBERSHIP_NAMESPACE: 'org-membership:v1',

  /** Domain + schema-version segment for the org access / role-grants cache. */
  ORG_ACCESS_NAMESPACE: 'org-access:v1',

  /** Domain + schema-version segment for the per-org Snowflake-backed Org Lens cache (shared across callers). */
  ORG_LENS_SNOWFLAKE_NAMESPACE: 'org-lens-sf:v1',

  /** Domain + schema-version segment for the per-user org seats cache. */
  ORG_SEATS_NAMESPACE: 'org-seats:v1',

  /** Domain + schema-version segment for the per-user org People key-contacts cache. */
  ORG_PEOPLE_KC_NAMESPACE: 'org-people-kc:v1',

  /** Domain + schema-version segment for the per-user org access-list cache. */
  ORG_ACCESS_LIST_NAMESPACE: 'org-access-list:v1',

  /** Domain + schema-version segment for the per-user org People directory cache. */
  ORG_PEOPLE_DIRECTORY_NAMESPACE: 'org-people-dir:v1',

  /** Default freshness window for membership entries (carried over from the prior 30_000 ms memo). */
  ORG_MEMBERSHIP_TTL_SECONDS: 30,

  /** Freshness window for the per-org Snowflake-backed Org Lens cache (1 hour). */
  ORG_LENS_SNOWFLAKE_TTL_SECONDS: 3600,

  /** Freshness window for the per-user Org Lens caches (seats, key-contacts, access-list, people directory). */
  ORG_LENS_PERUSER_TTL_SECONDS: 30,

  /** Per-op cap; a slower cache resolves to a miss so the request fetches directly (well below the ~30s upstream timeout). */
  OP_TIMEOUT_MS: 250,

  /** Connection timeout for the lazy client. */
  CONNECT_TIMEOUT_MS: 1000,

  /** Skip caching values larger than this (bytes of the serialized JSON) to avoid storing oversized entries. */
  MAX_VALUE_BYTES: 1_048_576,
} as const;
