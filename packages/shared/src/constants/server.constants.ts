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
 * Key names whose values are credentials and must never reach a log line, at any nesting depth.
 * Matched by the server's log scrubber (`scrubLogField` in `helpers/error-serializer.ts`) after
 * normalising the key — lowercased with every non-alphanumeric character stripped — so
 * `set-cookie`, `Set-Cookie` and `setCookie` all match `setcookie`. Any normalised key ending in
 * one of `LOG_CREDENTIAL_KEY_SUFFIXES` is treated as a credential too, which covers `access_token`,
 * `refresh_token`, `id_token`, `impersonationToken`, `tokens`, `client_secret`, `current_password`,
 * `confirmPassword` and the like (and, as a deliberate over-redaction, pagination cursors such as
 * `next_page_token`).
 *
 * Deliberately exact-match (unlike `SENSITIVE_FIELDS`' substring match): this runs on every log
 * line, so a broad substring like `key` would mask harmless fields such as `cache_key`.
 */
export const LOG_CREDENTIAL_KEYS = [
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'bearer',
  'apikey',
  'xapikey',
  'jwt',
  'sid',
  'credentials',
  'privatekey',
] as const;

/** Normalised-key suffixes that mark a value as a credential for the server's log scrubber. See `LOG_CREDENTIAL_KEYS`. */
export const LOG_CREDENTIAL_KEY_SUFFIXES = ['token', 'tokens', 'secret', 'password', 'passwd'] as const;

/**
 * Bounds for the server's log scrubber walk, so a huge or deeply nested object handed to the logger
 * cannot make each log call unboundedly expensive. `MAX_NODES` is charged per array element and
 * object property; once it is spent the rest of the container is replaced by a single `[Truncated]`
 * (array entry or object key), and anything nested deeper than `MAX_DEPTH` is logged as
 * `[Truncated]` — never passed through unscrubbed. So a very large logged array loses its tail; log
 * a count or a sample instead of a whole result set.
 */
export const LOG_SCRUB_LIMITS = {
  MAX_DEPTH: 20,
  MAX_NODES: 10_000,
} as const;

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
  /**
   * A 5xx this server minted whose message was written for the person reading it rather than for a
   * log. `getCodeForStatus` never produces it, so a pass-through of an upstream 5xx cannot carry it —
   * which is what lets the frontend's `readErrorBodyMessage` show the message instead of discarding
   * the body. Set it only where the copy is retry guidance or an explanation a user can act on.
   */
  SERVICE_ADVISORY: 'SERVICE_ADVISORY',
} as const;

/**
 * The `code` values a 5xx carries when nothing chose them — the server's own unhandled-error envelope
 * and every code `getCodeForStatus` derives from a 5xx status alone.
 *
 * This is the inverse of `ERROR_CODES.SERVICE_ADVISORY` and exists for the same reader: a body whose
 * code is in here was labelled by the status, so its `message`/`error` is a log line
 * ("Internal server error") or an upstream service's own wording, not copy anyone wrote for the person
 * looking at the screen. A hand-written 5xx is recognisable by the absence of one of these — either it
 * carries no code at all (a controller's `res.status(502).json({ error: '…' })`) or it carries a
 * semantic one the author picked. `readErrorBodyMessage` refuses this set so those two keep showing
 * their message while the generic envelope falls back to the caller's action-named copy.
 *
 * Keep in step with `getCodeForStatus` in `apps/lfx-one/src/server/helpers/http-status.helper.ts`:
 * every 5xx branch there belongs here. `SERVER_ERROR` is its `>= 500` default and has no
 * `ERROR_CODES` entry, so it is spelled out.
 */
export const STATUS_DERIVED_SERVER_ERROR_CODES = [ERROR_CODES.INTERNAL_ERROR, 'BAD_GATEWAY', 'SERVICE_UNAVAILABLE', 'GATEWAY_TIMEOUT', 'SERVER_ERROR'] as const;
