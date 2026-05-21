// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Foundation-logo letter-square fallback palette.
 *
 * Deterministic `djb2(foundation_id) % 5` map into the chromatic LFX
 * families [blue, emerald, amber, red, violet]. Excludes `gray` so the
 * letter square never blends into the Outside-LF umbrella row's gray
 * pill. Same `foundation_id` always maps to the same colour across
 * renders / sort changes / org switches — stable identity cue, not a
 * row-position cue.
 *
 * Each family renders as `bg-{family}-600 text-white` for high-contrast
 * initials. Class strings are full literals so Tailwind JIT picks them
 * up from source.
 */

const SQUARE_PALETTE = ['bg-blue-600 text-white', 'bg-emerald-600 text-white', 'bg-amber-600 text-white', 'bg-red-600 text-white', 'bg-violet-600 text-white'];

/** Classic djb2 string hash (Daniel J. Bernstein). Returns unsigned 32-bit. */
function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    // hash * 33 ^ char
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

export function foundationLogoSquareClasses(foundationId: string): string {
  const index = djb2(foundationId) % SQUARE_PALETTE.length;
  return SQUARE_PALETTE[index];
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
