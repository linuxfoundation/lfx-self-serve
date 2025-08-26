// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Sensitive field names for data sanitization in logging
 * These fields will be redacted when logging request/response data
 */
export const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'key',
  'authorization',
  'cookie',
  'jwt',
  'bearer',
  'auth',
  'credentials',
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'email',
  'passcode',
  'organizers',
] as const;

/**
 * Standard HTTP header names with correct casing
 */
export const HTTP_HEADERS = {
  ETAG: 'ETag',
  IF_MATCH: 'If-Match',
  CONTENT_TYPE: 'Content-Type',
  AUTHORIZATION: 'Authorization',
  USER_AGENT: 'User-Agent',
  ACCEPT: 'Accept',
  CACHE_CONTROL: 'Cache-Control',
} as const;

/**
 * Common error codes used across the application
 */
export const ERROR_CODES = {
  NOT_FOUND: 'NOT_FOUND',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  ETAG_MISSING: 'ETAG_MISSING',
  NETWORK_ERROR: 'NETWORK_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
