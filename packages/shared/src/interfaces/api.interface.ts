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
 * Extended error interface for API-specific errors
 * @description Comprehensive error information for debugging and handling
 */
export interface ApiError extends Error {
  /** HTTP status code (legacy field) */
  status?: number;
  /** HTTP status code */
  statusCode?: number;
  /** Error code for programmatic handling */
  code?: string;
  /** Service that generated the error */
  service?: string;
  /** API path that caused the error */
  path?: string;
  /** Original error message before transformation */
  originalMessage?: string;
  /** Error cause information */
  cause?: { code?: string };
  /** Full API response object */
  response?: ApiResponse<any>;
}

/**
 * Options for creating API error instances
 * @description Constructor parameters for ApiError creation
 */
export interface ApiErrorOptions {
  /** Error message */
  message: string;
  /** HTTP status code (legacy field) */
  status?: number;
  /** HTTP status code */
  statusCode?: number;
  /** Error code for programmatic handling */
  code?: string;
  /** Service that generated the error */
  service?: string;
  /** API path that caused the error */
  path?: string;
  /** Original error message before transformation */
  originalMessage?: string;
  /** Original error that caused this error */
  originalError?: Error;
  /** Full API response object */
  response?: ApiResponse<any>;
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

/**
 * Standard API error response interface
 */
export interface ApiErrorResponse {
  error: string;
  code?: string;
  errors?: ValidationError[];
  details?: Record<string, any>;
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

/**
 * Enhanced validation error interface with proper status code
 */
export interface ValidationApiError extends ApiError {
  statusCode: 400;
  code: 'VALIDATION_ERROR';
  validationErrors: ValidationError[];
}
