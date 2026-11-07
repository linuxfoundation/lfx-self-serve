// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Brand Kit's portrait book (Download PDF): the fixed copy of its pages,
// set on the portrait print grammar (`mktg-portrait-print.constants.ts`).
// Everything else on the pages is the kit's live data; a fact the store does
// not hold is left out, never written here. The document's name and footer
// are `mktgPortraitDocumentName` / `mktgPortraitFootLeft` (shared utils).

import type { BrandKitContrastGrade, BrandKitUsageView } from '../interfaces/brand-kit.interface';
import { lfxColors } from './colors.constants';

/** The cover's title. */
export const BRAND_KIT_PORTRAIT_COVER_TITLE = 'Brand Kit';

/** The cover's one sentence of purpose, after the kit's brand line. */
export const BRAND_KIT_PORTRAIT_COVER_PURPOSE = 'Logos, color, type and usage on one reference, for members, partners and the press.';

/**
 * The contents page's geometry (the design reader's answer of 7 Nov 2026): the
 * list from y 148 in rows of 34 px (type 15/1.3, 7 px of padding, a hairline;
 * never smaller), the two lower blocks 270 px tall at y 690 and 24 px under the
 * list's end at the least, ending by y 990 (28 px above the footer). Rows the
 * one column cannot hold within that go to two columns, never smaller type.
 */
export const BRAND_KIT_PORTRAIT_CONTENTS = { listTop: 148, rowHeight: 34, gap: 24, blocksTop: 690, blocksHeight: 270, blocksBottom: 990 } as const;

/** The Typography page's H1 sample size in the mock (48 px), always: the brand line is shortened to the words that fit the column. */
export const BRAND_KIT_PORTRAIT_TYPE_SAMPLE_PX = 48;
/** The specimen's letter-spacing in the mock (-0.015em), the measure's tracking for it; `.kp-type-h1` sets the same. */
export const BRAND_KIT_PORTRAIT_TYPE_SAMPLE_TRACKING_EM = -0.015;

/** The scale rows' label and spec columns (96 px each) and their two 16 px gaps, left of a row's sample. */
export const BRAND_KIT_PORTRAIT_SCALE_META_PX = 96 + 96 + 16 + 16;

/**
 * The CSS filter the portrait book's "don't recolor" watchout draws the lockup
 * with, in place of the on-screen tile's hue rotation: a lilac whatever the
 * mark's own colour (black and dark marks included, which a hue rotation
 * alone leaves black), so the printed tile looks wrong on every kit. The
 * on-screen kit view keeps its own draw.
 */
export const BRAND_KIT_PORTRAIT_RECOLOR_FILTER = 'invert(55%) sepia(1) saturate(2.5) hue-rotate(220deg)';

/**
 * The Typography page's scale and the two blocks under it, as the fit model
 * measures them: the scale's label (10/1.2) at y 436 with the rows 6 px under
 * it, each row a 1 px rule, 8 px of padding above and below, its label line
 * (10.5 px at the frame's 1.6) and its sample at the step's own line height;
 * the display step's sample 4 px under its label line with 10 px below. The
 * "Where to get the font" and "Rules" blocks sit at the mock's y 830 when the
 * scale ends above it, else 16 px under the scale (the mock's gap), both
 * 340 px wide, and never end past y 990. Every step prints at the kit's
 * own size (the editor's rule: shorten the sample, never shrink it): the
 * body step's sample is the umbrella message shortened to at most
 * `bodyMaxLines` lines of its column at 18/30, and fewer when the stack
 * would otherwise cross y 990.
 */
export const BRAND_KIT_PORTRAIT_TYPE_PAGE = {
  scaleTop: 436,
  labelHeight: 12,
  scaleAbove: 6,
  rule: 1,
  rowPadding: 8,
  metaLine: 17,
  displaySampleAbove: 4,
  displayBottom: 10,
  lowerTop: 830,
  lowerGap: 16,
  lowerWidth: 340,
  bottom: 990,
  bodyMaxLines: 3,
  text: { size: 12, line: 1.6, above: 8 },
  list: { size: 12.5, line: 1.6, above: 8, indent: 16 },
} as const;

/**
 * The Imagery page's umbrella-message card: 224 × 220 px with 20 px padding
 * (the mock's element card), its label and the 12 px under it taking 26 px,
 * so the message's box is 184 × 154 px; the message is set 19/1.25 medium.
 */
export const BRAND_KIT_PORTRAIT_MESSAGE_CARD = { width: 184, height: 154, size: 19, line: 1.25, weight: 500 } as const;

/**
 * The Sources page's two columns (the mock's): 340 px wide from y 220, lists
 * indented 16 px, blocks 26 px apart, a label 10/1.2 over a list 12.5/1.6 set
 * 8 px under it; the columns end 24 px above the accepted box at y 880, or at
 * y 990 (28 px above the footer) without one. The fit model sets a column
 * that would overrun smaller, in the grammar's steps, both columns alike.
 */
export const BRAND_KIT_PORTRAIT_SOURCES = {
  top: 220,
  width: 340,
  indent: 16,
  blockGap: 26,
  label: { size: 10, line: 1.2, weight: 600, caps: true },
  item: { size: 12.5, line: 1.6 },
  listAbove: 8,
  acceptedTop: 880,
  bottom: 990,
  gap: 24,
} as const;

/**
 * A chapter page's intro paragraph (`pp-body--wide`: 600 px, 12.5/1.6) from
 * y 136, over the first block at y 212 or lower: three lines at most. A
 * longer summary keeps its whole sentences that fit, or its first sentence
 * shortened at a word with an ellipsis.
 */
export const BRAND_KIT_PORTRAIT_INTRO = { width: 600, size: 12.5, maxLines: 3 } as const;

/**
 * The usage cards' lines (the brand line on the keynote slide and the social
 * card, 308 px of text inside the 344 px card): shortened at a word to the
 * lines the card holds under its lockup or note, never set smaller.
 */
export const BRAND_KIT_PORTRAIT_USAGE_LINES = {
  width: 308,
  keynote: { size: 20, weight: 500, maxLines: 4 },
  social: { size: 22, weight: 500, maxLines: 3 },
} as const;

/**
 * The Voice page's messages block (y 212 to the attributes at y 540, less
 * the 24 px gap): the umbrella message (30/1.3) and the brand line (24/1.2),
 * each under its label; set smaller together in the grammar's steps when
 * the two do not fit, and cut at a sentence when no step holds them.
 */
export const BRAND_KIT_PORTRAIT_VOICE_MESSAGES = {
  top: 212,
  bottom: 516,
  width: 704,
  label: { size: 10, line: 1.2, weight: 600, caps: true },
  umbrella: { size: 30, line: 1.3, weight: 500, above: 10 },
  lineLabelAbove: 26,
  line: { size: 24, line: 1.2, weight: 500, above: 8 },
} as const;

/**
 * The rule lists under the chapters' pictures, each fitted to the room
 * between its placed top and the footer line (y 990), or the block under it:
 * the Partnership page's five numbered rules (two columns of 340, 12/1.5,
 * each over a hairline: 18 px above), the Iconography page's four rules (one
 * column of 420 less the list indent, 12.5/1.7, above the Sizes block at
 * y 870 and its 16 px gap), the Imagery page's three avoid items (two
 * columns, 12.5/1.7) and the Typography page's three rules (the lower block,
 * 340 less the indent, 12.5/1.6, from the mock's y 830). Each list keeps
 * the label's height (`label`) and, when it had to give up its last rules,
 * the `+N more` line's (`more`).
 */
export const BRAND_KIT_PORTRAIT_RULE_LISTS = {
  bottom: 990,
  label: { size: 10, line: 1.2, weight: 600, caps: true },
  more: { size: 12.5, line: 1.6, above: 6 },
  partnership: { top: 806, bottom: 990, columns: 2, width: 340, size: 12, line: 1.5, above: 18, listAbove: 10 },
  iconography: { top: 680, bottom: 854, columns: 1, width: 404, size: 12.5, line: 1.7, above: 0, listAbove: 10 },
  imageryAvoid: { top: 900, bottom: 990, columns: 2, width: 324, size: 12.5, line: 1.7, above: 0, listAbove: 10 },
  typeRules: { top: 830, bottom: 990, columns: 1, width: 324, size: 12.5, line: 1.6, above: 0, listAbove: 8 },
} as const;

/**
 * The Color contrast page: the matrix from y 220 (a header row, then a
 * 78 px cell row per palette colour, 86 with the cell padding), the kit's
 * pairs at the mock's y 610 while the matrix ends above it (a palette of
 * four) and in flow under a bigger matrix otherwise; the pairs list (a
 * label, then 51 px a pair) ends by y 990, the pairs the room does not hold
 * counted in a `+N more pairs, in LFX One` line.
 */
export const BRAND_KIT_PORTRAIT_CONTRAST = {
  matrixTop: 220,
  pairsTop: 610,
  bottom: 990,
  header: 18,
  row: 86,
  pairsLabel: 20,
  pair: 51,
  more: 20,
} as const;

/**
 * The Voice page's attributes grid (the design reader's answer): two columns
 * of 344 px from y 540, each attribute under a 3 px rule with 14 px of
 * padding, its name 20 px semibold and its line 15/1.6 set 8 px under, rows
 * 28 px apart, the grid ending by y 990 (28 px above the footer). More
 * attributes than the room holds set the grid smaller, in the grammar's
 * steps; at the smallest step each line is cut to `lineMaxLines`, and the
 * rows that still do not fit are left to the Voice tab, which the `more`
 * line under the grid says (`+N more on the Voice tab in LFX One`).
 */
export const BRAND_KIT_PORTRAIT_ATTRIBUTES = {
  top: 540,
  bottom: 990,
  columns: 2,
  columnWidth: 344,
  rule: 3,
  padding: 14,
  name: { size: 20, line: 1.6, weight: 600 },
  line: { size: 15, line: 1.6 },
  lineAbove: 8,
  rowGap: 28,
  lineMaxLines: 3,
  more: { size: 12.5, line: 1.6, above: 16 },
} as const;

/** The Iconography page's sizes row: the one icon at 16, 24, 32 and 48 px (the mock's). */
export const BRAND_KIT_PORTRAIT_ICON_SIZES_PX = [16, 24, 32, 48] as const;

/** The one-colour black rendering of a full-colour file. */
export const BRAND_KIT_PORTRAIT_MONO_FILTER = 'brightness(0)';

/** The common names of the type weights, for `Regular 400`. */
export const BRAND_KIT_PORTRAIT_WEIGHT_NAMES: Readonly<Record<number, string>> = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' };

/** The usage table's accent-moment column, fixed text per layout (the mock's). */
export const BRAND_KIT_PORTRAIT_USAGE_ACCENT_MOMENTS: Readonly<Record<BrandKitUsageView['layout'], string>> = {
  keynote: 'none (grid ground)',
  social: 'the card itself',
  report: 'none',
  announcement: 'the top rule',
};

/**
 * The contrast pills' inks per grade: the app's semantic scales (pass in
 * emerald, large-text-only in amber, a fail in red), the mock's Tailwind
 * defaults mapped to `lfxColors`.
 */
export const BRAND_KIT_PORTRAIT_GRADE_INKS: Readonly<Record<BrandKitContrastGrade, { background: string; color: string }>> = {
  AAA: { background: lfxColors.emerald[50], color: lfxColors.emerald[700] },
  AA: { background: lfxColors.emerald[50], color: lfxColors.emerald[700] },
  'Large text only': { background: lfxColors.amber[50], color: lfxColors.amber[700] },
  Fails: { background: lfxColors.red[50], color: lfxColors.red[600] },
};

/** The short month names of the approval dates (`6 Nov 2026`), fixed so no engine's ICU prints `Sept`. */
export const BRAND_KIT_PORTRAIT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
