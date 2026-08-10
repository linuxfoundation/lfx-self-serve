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

  /** Domain + schema-version segment for the per-committee Snowflake-backed engagement cache (shared across callers). `v2`: the cached row shape changed from an email-keyed, single-window row to a uid-keyed row carrying all three windows — bumped so no entry written under the old shape can be read back as the new one. */
  COMMITTEE_ENGAGEMENT_NAMESPACE: 'committee-engagement-sf:v2',

  /** Domain + schema-version segment for the per-user org seats cache. */
  ORG_SEATS_NAMESPACE: 'org-seats:v1',

  /** Domain + schema-version segment for the per-user org People key-contacts cache. */
  ORG_PEOPLE_KC_NAMESPACE: 'org-people-kc:v1',

  /** Domain + schema-version segment for the per-user org access-list cache. */
  ORG_ACCESS_LIST_NAMESPACE: 'org-access-list:v1',

  /** Domain + schema-version segment for the per-user org People directory cache. */
  ORG_PEOPLE_DIRECTORY_NAMESPACE: 'org-people-dir:v1',

  /** Domain + schema-version segment for the express-openid-connect session store (server-side session data keyed by opaque session id). */
  SESSION_NAMESPACE: 'session:v1',

  /** Domain + schema-version segment for the per-user Groups dashboard engagement-stats cache (org-independent — mine semantics only). */
  GROUPS_ENGAGEMENT_NAMESPACE: 'groups-engagement:v1',

  /**
   * Domain + schema-version segment for the per-committee-member v1-id-mapping bridge cache
   * (LFXV2-1705). TODO(LFXV2-2973): remove this namespace once the model carries v2 keys directly
   * (LFXV2-2968) and the bridge is deleted.
   */
  MEMBER_V1_MAPPING_NAMESPACE: 'member-v1-mapping:v1',

  /**
   * Domain + schema-version segment for the per-caller weekly-brief rating cache (LFXV2-3042).
   * This is the live dedup/upsert store only (current vote per brief_uid+revision+username) —
   * not a system of record. The durable analytics signal is the structured `rating_recorded`/
   * `rating_cleared` log events `weekly-brief.service.ts` emits alongside every write, which
   * flow through the existing Pino → CloudWatch pipeline.
   */
  WEEKLY_BRIEF_RATING_NAMESPACE: 'weekly-brief-rating:v1',

  /** Default freshness window for membership entries (carried over from the prior 30_000 ms memo). */
  ORG_MEMBERSHIP_TTL_SECONDS: 30,

  /** Freshness window for the per-org Snowflake-backed Org Lens cache (1 hour). */
  ORG_LENS_SNOWFLAKE_TTL_SECONDS: 3600,

  /** Freshness window for the per-committee Snowflake-backed engagement cache (1 hour, matching the Org Lens TTL). */
  COMMITTEE_ENGAGEMENT_TTL_SECONDS: 3600,

  /** Short TTL for a genuinely empty (data_available: false) engagement-rows result — a committee the model doesn't cover yet. Much shorter than `COMMITTEE_ENGAGEMENT_TTL_SECONDS` so "no data yet" can't outlive the committee's dbt sync by up to an hour, while still absorbing repeated page loads in the interim. */
  COMMITTEE_ENGAGEMENT_DEGRADE_TTL_SECONDS: 120,

  /** Freshness window for the per-user Org Lens caches (seats, key-contacts, access-list, people directory). */
  ORG_LENS_PERUSER_TTL_SECONDS: 30,

  /** Freshness window for the Groups dashboard engagement-stats cache — absorbs repeated dashboard refreshes. */
  GROUPS_ENGAGEMENT_TTL_SECONDS: 60,

  /** Freshness window for a successfully-resolved member v1-id mapping (7 days) — these mappings are stable (a person's legacy identity doesn't change), so a long TTL avoids re-hitting NATS for every request. TODO(LFXV2-2973): remove once the bridge is deleted. */
  MEMBER_V1_MAPPING_TTL_SECONDS: 7 * 24 * 60 * 60,

  /** Short negative-cache TTL (1 hour) for a member confirmed to have no v1 mapping — long enough that a large roster of genuinely-unmapped members doesn't hammer NATS on every request, short enough that a mapping added later (e.g. after a backfill) shows up within the hour. Only ever written for a *confirmed* "no mapping" NATS response, never for an indeterminate one (a timed-out or budget-cut-off lookup) — see `v1-mapping-batch.helper.ts`'s `confirmedUnresolved` distinction. TODO(LFXV2-2973): remove once the bridge is deleted. */
  MEMBER_V1_MAPPING_DEGRADE_TTL_SECONDS: 3600,

  /** Fallback session TTL when express-openid-connect doesn't supply a per-session expiry (matches its `session.absoluteDuration` default of 7 days). Normally the store derives the actual TTL from the session's own `cookie.maxAge` instead. */
  SESSION_FALLBACK_TTL_SECONDS: 7 * 24 * 60 * 60,

  /** Freshness window for a caller's weekly-brief rating (90 days) — long enough to outlive a brief revision's realistic on-screen lifetime; not indefinite, since Valkey here is a dedup cache, not the durable analytics record (see `WEEKLY_BRIEF_RATING_NAMESPACE`). */
  WEEKLY_BRIEF_RATING_TTL_SECONDS: 90 * 24 * 60 * 60,

  /** TTL for a session whose `cookie.maxAge` is present but already non-positive (already past absolute expiry) — expires it out of Valkey immediately instead of handing it the multi-day fallback above. */
  SESSION_EXPIRED_TTL_SECONDS: 1,

  /** Per-op cap; a slower cache resolves to a miss so the request fetches directly (well below the ~30s upstream timeout). */
  OP_TIMEOUT_MS: 250,

  /** Per-op cap for the session store (reads, writes, and deletes). Session ops are fail-closed — a timeout forces re-login rather than falling back to a direct fetch — so this is deliberately much larger than the cache's OP_TIMEOUT_MS to absorb the lazy client's cold-connect (TLS handshake) cost on the first op after a pod start, instead of racing that handshake against a cache-tuned budget. */
  SESSION_OP_TIMEOUT_MS: 3000,

  /** Connection timeout for the lazy client (ioredis's own `connectTimeout`) — this is the real ceiling on a cold `.connect()` handshake, independent of any outer per-op `withTimeout()` race. Matches `SESSION_OP_TIMEOUT_MS` so the session store's larger op budget can actually be spent on the handshake instead of being truncated by a shorter internal connect cap. */
  CONNECT_TIMEOUT_MS: 3000,

  /** Skip caching values larger than this (bytes of the serialized JSON) to avoid storing oversized entries. */
  MAX_VALUE_BYTES: 1_048_576,
} as const;
