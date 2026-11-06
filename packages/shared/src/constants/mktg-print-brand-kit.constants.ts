// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's landscape print pages: the kit-only constants of the deck's
// kit book (marketing-os-agents agents/slides-export src/kit-book.ts at
// 7839d985), ported value for value. The page grammar they are laid out in is
// mktg-print-page.constants.ts; the kit's own content constants (the pages,
// the chapters, the type specimen, the back-cover notice) are
// brand-kit.constants.ts, which the builder reads directly (the typography
// page's weights and their names come through the view, from the kit's
// BRAND_KIT_WEIGHT_NAMES and BRAND_KIT_DEFAULT_WEIGHTS).

import type { BrandKitContrastGrade } from '../interfaces/brand-kit.interface';
import { BRAND_KIT_FOUND_IN_KINDS } from './brand-kit.constants';

/** The swatch's source line under a palette card, in the BrandKit board's words (kit-book.ts SOURCE_LINES); null draws none. */
export const MKTG_PRINT_BRAND_KIT_SOURCE_LINES: Record<(typeof BRAND_KIT_FOUND_IN_KINDS)[number], string | null> = {
  logo: 'from the logo artwork',
  site_css: 'from the site',
  brand_page: 'from the site',
  page: null,
  unsourced: null,
};

/** A typeface the retyped-wordmark watchout is set in: plainly not the brand's (kit-book.ts RETYPED_FONT). */
export const MKTG_PRINT_BRAND_KIT_RETYPED_FONT = 'Georgia';

/** Contrast rows per page: 24 pt each in the 265 pt body (kit-book.ts CONTRAST_ROWS_PER_SLIDE). */
export const MKTG_PRINT_BRAND_KIT_CONTRAST_ROWS_PER_PAGE = 11;

/** The Social card's URL pill: its height at the caption size, and its inset from the card's edge (kit-book.ts PILL). */
export const MKTG_PRINT_BRAND_KIT_PILL = { h: 25, inset: 12 } as const;

/**
 * The contrast page's verdict pills, the prototype's colours by grade (book.js: emerald for AAA and AA, amber for
 * large text only, red for a fail), each the pill's ground and its text; `w` the pill's width (pt): the grade's
 * text at the pill's size and weight (9 pt, 600: 0.6 em a character) plus the prototype's 6 pt a side. The pill
 * is MKTG_PRINT_BRAND_KIT_CONTRAST_PILL_H tall, in its 24 pt row.
 */
export const MKTG_PRINT_BRAND_KIT_CONTRAST_PILLS: Readonly<Record<BrandKitContrastGrade, { fill: string; ink: string; w: number }>> = {
  AAA: { fill: '#ECFDF5', ink: '#047857', w: 30 },
  AA: { fill: '#ECFDF5', ink: '#047857', w: 24 },
  'Large text only': { fill: '#FFFBEB', ink: '#B45309', w: 94 },
  Fails: { fill: '#FEF2F2', ink: '#DC2626', w: 40 },
};
export const MKTG_PRINT_BRAND_KIT_CONTRAST_PILL_H = 16;

/** The grids the voice attributes are tried in under the voice, best first; when none fits they continue on a page of their own (kit-book.ts ATTRIBUTE_GRIDS). */
export const MKTG_PRINT_BRAND_KIT_ATTRIBUTE_GRIDS: readonly { cols: number; size: number }[] = [
  { cols: 2, size: 9.5 },
  { cols: 2, size: 9 },
  { cols: 4, size: 9 },
  { cols: 2, size: 8.5 },
  { cols: 4, size: 8.5 },
];

/**
 * The Iconography page's geometry (pt), the upstream renderer's 1000-wide
 * frame scaled to the visual column as the other pages are (624 px → RIGHT.w
 * 449 pt, ≈ 0.72): 4 × 2 tiles with an 8 pt gap, the strip 10 pt below the
 * tiles, the recommended-set line under it. Scaled literally the stack overran
 * the 265 pt column by about 25 pt; the tiles and the strip give (110 px → 70
 * and 66 pt instead of 79), the gaps and the icon sizes keep their scale
 * (32 px → 24, 30 px → 22; the strip's 30 px padding → 22, its 26 px gap → 19)
 * (kit-book.ts ICON_GRID).
 */
export const MKTG_PRINT_BRAND_KIT_ICON_GRID = {
  cols: 4,
  gap: 8,
  tileH: 70,
  icon: 24,
  labelH: 26,
  stripGap: 10,
  stripH: 66,
  stripIcon: 22,
  stripPad: 22,
  stripStep: 41,
  captionGap: 3,
} as const;

/** The slot name of one icon on the Iconography page (`{ t: 'slot', slot, context: { index, color } }`): the print draws the shared icon sample there. */
export const MKTG_PRINT_BRAND_KIT_ICON_SLOT = 'brand-kit-icon';
