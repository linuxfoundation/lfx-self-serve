// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Default query parameters for API requests to microservices
 * @description These parameters are automatically included in API requests and cannot be overridden by callers
 * @readonly
 * @example
 * // Automatically included in all API requests
 * const params = { ...DEFAULT_QUERY_PARAMS, customParam: 'value' };
 */
export const DEFAULT_QUERY_PARAMS: Record<string, string> = {
  /** API version parameter */
  v: '1',
};

/**
 * Request header carrying a meeting passcode to public endpoints.
 * @description Keeps the passcode out of GET query strings, where it would land in
 * access logs and caches (CodeQL js/sensitive-get-query). Lowercase to match
 * Express's normalized req.headers keys.
 */
export const MEETING_PASSWORD_HEADER = 'x-meeting-password';

/**
 * Maximum number of `filters_or` clauses per query-service request.
 * @description URL-length guard for batched lookups on `/query/resources`. When the caller has
 * more than this many IDs/values to OR together, split into chunks of this size to keep each
 * request URL under OpenSearch/query-service limits.
 */
export const QUERY_SERVICE_FILTERS_OR_BATCH_SIZE = 100;

/**
 * Upstream ceiling for `page_size` on query-service `/query/resources` requests.
 * @description The query-service rejects `page_size` above 1000 (`InvalidRangeError`). Passing
 * this on every paginated walk (registrant rosters, RSVP lists) fetches the fewest possible pages
 * per walk instead of relying on the service's smaller unstated default.
 */
export const QUERY_SERVICE_MAX_PAGE_SIZE = 1000;

/**
 * Maximum number of access-check tuples per POST request to the access-check service.
 * @description Bounds OpenFGA payload size and latency. When the caller has more than this many
 * tuples to check, split into chunks of this size and fan out with Promise.allSettled.
 */
export const ACCESS_CHECK_BATCH_SIZE = 100;

/**
 * NATS configuration constants
 * @description Configuration for NATS messaging system used for inter-service communication
 * @readonly
 * @example
 * // Using NATS config in service
 * const connection = await connect({
 *   servers: [process.env['NATS_URL'] || NATS_CONFIG.DEFAULT_SERVER_URL],
 *   timeout: NATS_CONFIG.CONNECTION_TIMEOUT,
 * });
 */
export const NATS_CONFIG = {
  /**
   * Default NATS server URL for Kubernetes cluster
   */
  DEFAULT_SERVER_URL: 'nats://lfx-platform-nats.lfx.svc.cluster.local:4222',

  /**
   * Connection timeout in milliseconds
   */
  CONNECTION_TIMEOUT: 5000,

  /**
   * Request timeout in milliseconds
   */
  REQUEST_TIMEOUT: 5000,

  /**
   * Max concurrent request/reply round trips when resolving a batch of IDs (e.g.
   * resolveCommitteeV2UidsToV1Ids) — a caller with a large N (LF staff visible on hundreds of
   * committees) shouldn't fire hundreds of concurrent NATS requests at once.
   */
  LOOKUP_BATCH_CONCURRENCY: 10,

  /**
   * Wall-clock budget (ms) for a whole batched lookup (e.g. resolveCommitteeV2UidsToV1Ids), not
   * any single request. Batching trades an unbounded concurrent burst for a worst case of
   * `ceil(N / LOOKUP_BATCH_CONCURRENCY)` sequential timeouts if the responder is down — for a
   * large N that's minutes, not seconds. This caps the total wait: once exceeded, the caller stops
   * issuing further batches and returns whatever resolved so far, letting the caller's own
   * incomplete-result degrade path (e.g. treating an unresolved id as "not covered") handle the rest
   * honestly instead of hanging the request.
   */
  LOOKUP_BATCH_BUDGET_MS: 15000,
} as const;

/**
 * Changelog (lfx-changelog) configuration constants
 * @description Configuration for the LFX Changelog API used for unread tracking against
 * the self-serve product changelog feed.
 */
export const CHANGELOG_CONFIG = {
  DEFAULT_API_URL: 'https://changelog.lfx.dev',
  ENDPOINTS: {
    UNSEEN: '/api/changelogs/views/unseen',
    MARK_VIEWED: '/api/changelogs/views/mark-viewed',
  },
} as const;

/**
 * CDP (Community Data Platform) configuration constants
 * @description Configuration for CDP API used for identity and work history data
 */
export const CDP_CONFIG = {
  DEFAULT_STAGING_URL: 'https://lf-staging.crowd.dev/api',
  DEFAULT_PRODUCTION_URL: 'https://cm.lfx.dev/api',
  /** Hard cap enforced by the CDP packages list endpoint (400 above this). */
  MAX_PAGE_SIZE: 100,
  ENDPOINTS: {
    RESOLVE_MEMBER: '/v1/members/resolve',
    CREATE_MEMBER: '/v1/members',
    MEMBER_IDENTITIES: (memberId: string) => `/v1/members/${memberId}/identities`,
    MEMBER_WORK_EXPERIENCES: (memberId: string) => `/v1/members/${memberId}/work-experiences`,
    MEMBER_PROJECT_AFFILIATIONS: (memberId: string) => `/v1/members/${memberId}/project-affiliations`,
    MEMBER_PROJECT_AFFILIATION: (memberId: string, projectId: string) => `/v1/members/${memberId}/project-affiliations/${projectId}`,
    ORGANIZATIONS: '/v1/organizations',
    PACKAGES_LIST: '/v1/akrites/packages',
    PACKAGES_SCATTER: '/v1/akrites/packages/scatter',
    PACKAGES_METRICS: '/v1/akrites/metrics',
    PACKAGE_DETAIL: '/v1/akrites/packages/detail',
    PACKAGE_ADVISORIES: '/v1/akrites/packages/advisories',
    ACTIVITY: '/v1/akrites/activity',
    STEWARDSHIPS_OPEN: '/v1/akrites/stewardships/open',
    STEWARDSHIP_ASSIGN: (id: number) => `/v1/akrites/stewardships/${id}/assign`,
    STEWARDSHIP_ESCALATE: (id: number) => `/v1/akrites/stewardships/${id}/escalate`,
    STEWARDSHIP_STATUS: (id: number) => `/v1/akrites/stewardships/${id}/status`,
  },
} as const;
