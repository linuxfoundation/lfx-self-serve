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
} as const;

/**
 * CDP (Community Data Platform) configuration constants
 * @description Configuration for CDP API used for identity and work history data
 */
export const CDP_CONFIG = {
  DEFAULT_STAGING_URL: 'https://lf-staging.crowd.dev/api',
  DEFAULT_PRODUCTION_URL: 'https://cm.lfx.dev/api',
  ENDPOINTS: {
    RESOLVE_MEMBER: '/v1/members/resolve',
    MEMBER_IDENTITIES: (memberId: string) => `/v1/members/${memberId}/identities`,
    MEMBER_WORK_EXPERIENCES: (memberId: string) => `/v1/members/${memberId}/work-experiences`,
    MEMBER_PROJECT_AFFILIATIONS: (memberId: string) => `/v1/members/${memberId}/project-affiliations`,
    MEMBER_PROJECT_AFFILIATION: (memberId: string, projectId: string) => `/v1/members/${memberId}/project-affiliations/${projectId}`,
    ORGANIZATIONS: '/v1/organizations',
  },
} as const;
