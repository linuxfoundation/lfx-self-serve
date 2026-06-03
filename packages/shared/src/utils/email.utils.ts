// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
      if (!result.duplicates.includes(normalized)) {
        result.duplicates.push(normalized);
      }
      continue;
    }

    seen.add(normalized);
    result.valid.push(normalized);
  }

  return result;
}
