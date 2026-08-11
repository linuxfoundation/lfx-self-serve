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
  // Matches chat_webhook_url (LFXV2-3080) — a Slack Incoming Webhook URL is itself a bearer
  // credential (anyone holding it can post to the channel); logger.sanitize's key.includes()
  // match catches it via this substring without needing a field-specific entry.
  //
  // Scope, precisely: logger.sanitize() checks only an object's own top-level keys (no
  // recursion) and is opt-in — the logger service never calls it automatically, each call site
  // must invoke it explicitly (as committee.controller.ts's update_data: logger.sanitize(req.body)
  // does). It does NOT cover MicroserviceError#getLogContext()'s errorBody, which is logged
  // unsanitized by the central error handler — today that's inert (chat_webhook_url doesn't
  // exist upstream, so no upstream error can echo it), but once LFXV2-3094 lands, an upstream
  // validation error on this field could put the credential in errorBody unredacted. Revisit
  // this when LFXV2-3094 lands.
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
