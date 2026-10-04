// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
