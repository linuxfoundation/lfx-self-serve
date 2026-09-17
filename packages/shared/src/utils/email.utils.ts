// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETING_INVITE_PRIMARY_SENTINEL } from '../constants/profile.constants';
import { EMAIL_REGEX } from '../constants/regex.constants';
import type { EmailListParseResult } from '../interfaces';

/** True when `value` is a syntactically valid email address. Trims before testing. */
export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return EMAIL_REGEX.test(value.trim());
}

/**
 * True when two email addresses refer to the same mailbox, ignoring case and
 * surrounding whitespace. Use whenever addresses from different upstreams are
 * compared — e.g. an Auth0 email list against a v1/SFDC email record, which can
 * legitimately differ in casing.
 */
export function emailsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Same shape as EMAIL_REGEX but unanchored + global, so it can find every address embedded in a
// larger string (e.g. upstream error copy) rather than testing the whole string as one address.
// Quantifiers are length-bounded (RFC 5321 local-part/label limits) so a long run of non-matching
// characters can't trigger the polynomial backtracking the unbounded version was vulnerable to.
const EMBEDDED_EMAIL_REGEX = /[^\s@]{1,64}@[^\s@.]{1,63}(?:\.[^\s@.]{1,63})+/g;

/**
 * Replace every email address embedded in `text` with `[redacted-email]`. Some upstream error
 * copy (e.g. meeting-invite validation failures) includes the mailbox in the message — this keeps
 * that text safe to pass to WARN-level logs, which persist in production.
 */
export function redactEmailAddresses(text: string | null | undefined): string {
  if (!text) {
    return text ?? '';
  }
  return text.replace(EMBEDDED_EMAIL_REGEX, '[redacted-email]');
}

/**
 * Mask an address for a structured-log field: the mailbox becomes `***`, the domain survives
 * (`ada@example.com` → `***@example.com`). Use for any `email` metadata passed to the logger —
 * neither `SENSITIVE_FIELDS` nor `server-logger`'s `redact.paths` covers email, so an unmasked
 * address is retained indefinitely by the log destination
 * (docs/reviews/knowledge-base/security.md § security/pii-in-logs-and-identifiers).
 *
 * The domain is deliberately kept: directory-lookup failures cluster by domain, which is the
 * signal these logs exist to provide, and a domain alone does not identify a person. Anything
 * without a single `@` is not an address and collapses to `[redacted-email]` rather than leaking
 * an unrecognised shape.
 */
export function maskEmailForLogs(email: string | null | undefined): string {
  const trimmed = (email ?? '').trim();

  if (!trimmed) {
    return '(none)';
  }

  const at = trimmed.lastIndexOf('@');

  if (at <= 0 || at === trimmed.length - 1 || trimmed.indexOf('@') !== at) {
    return '[redacted-email]';
  }

  return `***@${trimmed.slice(at + 1).toLowerCase()}`;
}

/**
 * Mask a directory identifier for a structured-log field. An identifier is normally a username,
 * which is not sensitive and stays readable — the whole point of logging it. It can also *be* the
 * address: the NATS sub/username equals the email for some accounts (see the note at
 * `project.service.ts` on the sub equalling the email, and manually-added users whose backend
 * identifier is their address), and then it carries exactly the PII `maskEmailForLogs` exists to
 * keep out of logs.
 *
 * Masking on the value's shape rather than the field's name is deliberate: the same identifier
 * reaches the logger under `username`, `sub`, `resolved_username`, and an error `resourceId`, so a
 * per-field rule is defeated by the next differently-named key.
 */
export function maskIdentifierForLogs(identifier: string | null | undefined): string {
  const trimmed = (identifier ?? '').trim();

  if (!trimmed) {
    return '(none)';
  }

  return trimmed.includes('@') ? maskEmailForLogs(trimmed) : trimmed;
}

/**
 * True when `value` is the meeting-service "clear the override" sentinel rather than an address.
 * The upstream match is case-insensitive, so mirror that here — callers use this to skip the
 * address-format validation that would otherwise reject the sentinel.
 */
export function isMeetingInvitePrimarySentinel(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === MEETING_INVITE_PRIMARY_SENTINEL;
}

/**
 * Parse a free-text blob of email addresses (bulk-invite input) into normalized,
 * de-duplicated buckets.
 *
 * Addresses may be separated by any mix of commas, semicolons, whitespace, or
 * newlines — the formats people paste from spreadsheets, "To:" lines, and lists.
 * Each token is trimmed and lowercased before validation and de-duplication, so
 * casing and surrounding whitespace never produce a false duplicate or a false
 * distinct address. Order is preserved (first-seen) so the preview matches input.
 */
export function parseEmailList(raw: string | null | undefined): EmailListParseResult {
  const result: EmailListParseResult = { valid: [], invalid: [], duplicates: [] };
  if (!raw) {
    return result;
  }

  const seen = new Set<string>();
  const duplicatesSeen = new Set<string>();

  for (const token of raw.split(/[\s,;]+/)) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = trimmed.toLowerCase();
    if (!EMAIL_REGEX.test(normalized)) {
      result.invalid.push(trimmed);
      continue;
    }

    if (seen.has(normalized)) {
      // Report each duplicate once. Track reported dups in a Set rather than
      // scanning result.duplicates (avoids O(n²) on large pastes).
      if (!duplicatesSeen.has(normalized)) {
        duplicatesSeen.add(normalized);
        result.duplicates.push(normalized);
      }
      continue;
    }

    seen.add(normalized);
    result.valid.push(normalized);
  }

  return result;
}
