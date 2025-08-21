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
