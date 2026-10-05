// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH } from '../constants';
import { ServiceValidationError } from '../errors';

/** Lenient request-value reader for the mentorship controllers: a non-string or blank value reads as absent. */
export const parseTrimmedString = (val: unknown): string | undefined => {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Resolves a `:programId` route value the way the mentorship routes accept it: by `id` first, then by `slug`. */
export const findByIdOrSlug = <T extends { id: string; slug: string }>(items: readonly T[], idOrSlug: string): T | undefined =>
  items.find((item) => item.id === idOrSlug) ?? items.find((item) => item.slug === idOrSlug);

const MAX_PAGE_LIMIT = 50;

/** Slices an in-memory list for the mock lookups, clamping `offset` to 0 or more and `limit` to 1–50. `total` is the unsliced length. */
export const paginateOffsetLimit = <T>(items: readonly T[], offset: number, limit: number): { data: T[]; total: number } => {
  const start = Math.max(0, offset);
  const size = Math.min(MAX_PAGE_LIMIT, Math.max(1, limit));
  return { data: items.slice(start, start + size), total: items.length };
};

/** Reads a query value as an integer; a missing, blank or non-numeric value reads as absent. */
export const parseIntQuery = (val: unknown): number | undefined => {
  const raw = parseTrimmedString(val);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Reads an admin search box for an upstream `search=` filter: trimmed, cut to `MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH`
 * characters, then escaped so every character is literal. Blank or non-string input reads as absent.
 */
export const escapeMentorshipSearch = (raw: unknown): string | undefined => {
  const trimmed = parseTrimmedString(raw);
  if (trimmed === undefined) return undefined;
  // Upstream wraps the value in `ILIKE '%…%'`; escaping `\`, `%` and `_` makes the search literal.
  return trimmed.slice(0, MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH).replace(/[\\%_]/g, (match) => `\\${match}`);
};

const readStrictInteger = (raw: unknown, field: 'offset' | 'limit', operation: string): number | undefined => {
  const text = parseTrimmedString(raw);
  if (text === undefined) return undefined;
  if (!/^\d+$/.test(text)) {
    throw ServiceValidationError.forField(field, `${field} must be a whole number.`, { operation });
  }
  return Number.parseInt(text, 10);
};

/**
 * Reads `offset` and `limit` from an admin list query. `offset` is a whole number from 0 and defaults to 0;
 * `limit` is a whole number from 1 to `maxLimit` and defaults to `defaultLimit`. Anything else is a 400.
 */
export const parseMentorshipAdminPaging = (
  query: Record<string, unknown>,
  options: { defaultLimit: number; maxLimit: number; operation?: string }
): { offset: number; limit: number } => {
  const operation = options.operation ?? 'parse_mentorship_admin_paging';
  const offset = readStrictInteger(query['offset'], 'offset', operation) ?? 0;
  const limit = readStrictInteger(query['limit'], 'limit', operation) ?? options.defaultLimit;
  if (limit < 1 || limit > options.maxLimit) {
    throw ServiceValidationError.forField('limit', `limit must be from 1 to ${options.maxLimit}.`, { operation });
  }
  return { offset, limit };
};
