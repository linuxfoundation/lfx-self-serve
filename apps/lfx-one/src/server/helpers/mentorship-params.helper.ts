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
