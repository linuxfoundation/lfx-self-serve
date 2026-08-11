// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Sensitive field names for data sanitization in logging. Matched by `logger.sanitize()`
 * (`key.toLowerCase().includes(field)`) against an object's own top-level keys only — no
 * recursion, so a payload wrapped in an extra object literal (e.g. `sanitize({ updateData })`)
 * won't match anything here even if `updateData` itself has a sensitive key. Redaction is also
 * opt-in: the logger service never calls `sanitize()` automatically, each call site must invoke
 * it explicitly.
 *
 * Known gap this does NOT cover: `MicroserviceError#getLogContext()`'s `errorBody` is logged
 * unsanitized by the central error handler. Inert today for `chat_webhook_url` (LFXV2-3080) —
 * it doesn't exist upstream yet, so no upstream validation error can echo it back — but revisit
 * once LFXV2-3094 lands, since an upstream validation error on that field could then put the
 * credential in `errorBody` unredacted.
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
  // Matches chat_webhook_url (LFXV2-3080) — a Slack Incoming Webhook URL is itself a bearer
  // credential (anyone holding it can post to the channel).
  'webhook',
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
