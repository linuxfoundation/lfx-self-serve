// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface ApiClientConfig {
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface MicroserviceUrls {
  LFX_V2_SERVICE: string;
}

export interface ApiError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  service?: string;
  path?: string;
  originalMessage?: string;
  cause?: { code?: string };
  response?: ApiResponse<any>;
}

export interface ApiErrorOptions {
  message: string;
  status?: number;
  statusCode?: number;
  code?: string;
  service?: string;
  path?: string;
  originalMessage?: string;
  originalError?: Error;
  response?: ApiResponse<any>;
}

export interface QueryServiceItem<T = unknown> {
  type: string;
  id: string;
  data: T;
}

export interface QueryServiceResponse<T = unknown> {
  resources: QueryServiceItem<T>[];
}

export interface ETagResult<T> {
  data: T;
  etag: string;
  headers: Record<string, string>;
}

export interface ETagError {
  code: 'NOT_FOUND' | 'ETAG_MISSING' | 'NETWORK_ERROR' | 'PRECONDITION_FAILED';
  message: string;
  statusCode: number;
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

/**
 * Type guard to check if error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  if (!(error instanceof Error)) return false;

  return (
    ('status' in error && typeof error.status === 'number') ||
    ('statusCode' in error && typeof error.statusCode === 'number') ||
    ('code' in error && typeof error.code === 'string')
  );
}

/**
 * Type guard to check if error is a ValidationApiError
 */
export function isValidationApiError(error: unknown): error is ValidationApiError {
  if (!isApiError(error) || error.code !== 'VALIDATION_ERROR') return false;

  return 'validationErrors' in error && Array.isArray(error.validationErrors);
}

/**
 * Utility to safely extract error properties with proper typing
 */
export function extractErrorDetails(error: unknown): {
  message: string;
  statusCode: number;
  code: string;
  service?: string;
  path?: string;
} {
  if (isApiError(error)) {
    return {
      message: error.message,
      statusCode: error.statusCode || error.status || 500,
      code: error.code || 'UNKNOWN_ERROR',
      service: error.service,
      path: error.path,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    };
  }

  return {
    message: String(error),
    statusCode: 500,
    code: 'UNKNOWN_ERROR',
  };
}
