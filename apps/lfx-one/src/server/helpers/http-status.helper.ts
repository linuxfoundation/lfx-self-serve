// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * HTTP status code utilities for consistent error handling
 * Centralizes status code to error code mappings and user-friendly messages
 */

/**
 * Get default user-friendly message for HTTP status code
 */
export function getDefaultMessageForStatus(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Invalid request. Please check your input and try again.';
    case 401:
      return 'Authentication required. Please log in and try again.';
    case 403:
      return 'Access denied. You do not have permission to access this resource.';
    case 404:
      return 'The requested resource was not found.';
    case 409:
      return 'Conflict. The resource you are trying to create already exists.';
    case 422:
      return 'Validation error. Please check your input and try again.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
      return 'Internal server error. Please try again later.';
    case 502:
    case 503:
    case 504:
      return 'Service temporarily unavailable. Please try again later.';
    default:
      return 'An unexpected error occurred. Please try again later.';
  }
}

/**
 * Get error code for HTTP status code
 */
export function getCodeForStatus(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    case 500:
      return 'INTERNAL_ERROR';
    case 502:
      return 'BAD_GATEWAY';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    case 504:
      return 'GATEWAY_TIMEOUT';
    default:
      return statusCode >= 500 ? 'SERVER_ERROR' : 'CLIENT_ERROR';
  }
}

/**
 * Get error code for HTTP status code (alternative implementation for API client)
 * Handles client/server error categorization
 */
export function getHttpErrorCode(status: number): string {
  if (status >= 400 && status < 500) {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'VALIDATION_ERROR';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'CLIENT_ERROR';
    }
  }

  if (status >= 500 && status < 600) {
    switch (status) {
      case 500:
        return 'INTERNAL_ERROR';
      case 502:
        return 'BAD_GATEWAY';
      case 503:
        return 'SERVICE_UNAVAILABLE';
      case 504:
        return 'GATEWAY_TIMEOUT';
      default:
        return 'SERVER_ERROR';
    }
  }

  return 'HTTP_ERROR';
}
