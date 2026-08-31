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
const EMBEDDED_EMAIL_REGEX = /[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+/g;

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
