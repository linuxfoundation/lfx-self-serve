// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_LOGO_SQUARE_PALETTE } from '@lfx-one/shared/constants';

/** Classic djb2 string hash (Daniel J. Bernstein). Returns unsigned 32-bit. */
function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

export function foundationLogoSquareClasses(foundationId: string): string {
  const index = djb2(foundationId) % FOUNDATION_LOGO_SQUARE_PALETTE.length;
  return FOUNDATION_LOGO_SQUARE_PALETTE[index];
}

/**
 * Foundation initials. First letter of each capital-led word, max 2 chars.
 * Falls back to the first 2 characters of the name uppercased if the
 * name has no capital-led words (e.g., lowercase slug fallback).
 */
export function foundationInitials(name: string): string {
  if (!name) return '?';

  const capitalWords = name.match(/[A-Z][A-Za-z0-9]*/g);
  if (capitalWords && capitalWords.length > 0) {
    const initials = capitalWords
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('');
    return initials.toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}
