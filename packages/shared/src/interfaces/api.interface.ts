// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Configuration options for API client initialization
 * @description Settings for HTTP client behavior and retry logic
 */
export interface ApiClientConfig {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retry attempts for failed requests */
  retryAttempts?: number;
  /** Delay between retry attempts in milliseconds */
  retryDelay?: number;
}

/**
 * Standardized API response wrapper
 * @description Generic response structure for all API endpoints
 */
export interface ApiResponse<T = unknown> {
  /** Response payload data */
  data: T;
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Response headers as key-value pairs */
  headers: Record<string, string>;
}

/**
 * Microservice URL configuration
 * @description Service endpoint URLs for different environments
 */
export interface MicroserviceUrls {
  /** LFX V2 service base URL */
  LFX_V2_SERVICE: string;
}

/**
 * Individual item in query service responses
 * @description Standardized structure for resource items
 */
export interface QueryServiceItem<T = unknown> {
  /** Resource type identifier */
  type: string;
  /** Unique resource identifier */
  id: string;
  /** Resource data payload */
  data: T;
}

/**
 * Query service response wrapper
 * @description Container for multiple resource items
 */
export interface QueryServiceResponse<T = unknown> {
  /** Array of resource items */
  resources: QueryServiceItem<T>[];
  /** Page token for pagination */
  page_token: string;
}

/**
 * Query service count endpoint response wrapper
 * @description Container for query service count endpoint response
 */
export interface QueryServiceCountResponse {
  /** The count of resources */
  count: number;
  /** Whether there are more resources to fetch - if set to true, the
   * query scope needs to be narrowed down */
  has_more: boolean;
}

/**
 * ETag-enabled API response
 * @description Response with cache control information
 */
export interface ETagResult<T> {
  /** Response data */
  data: T;
  /** ETag header value for caching */
  etag: string;
  /** All response headers */
  headers: Record<string, string>;
}

/**
 * ETag-specific error information
 * @description Errors related to cache control and optimistic concurrency
 */
export interface ETagError {
  /** Specific error code for ETag operations */
  code: 'NOT_FOUND' | 'ETAG_MISSING' | 'NETWORK_ERROR' | 'PRECONDITION_FAILED';
  /** Human-readable error message */
  message: string;
  /** HTTP status code */
  statusCode: number;
  /** Optional response headers */
  headers?: Record<string, string>;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
