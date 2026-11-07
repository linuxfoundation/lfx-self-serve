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

/** The Typography page's H1 sample size in the mock (48 px); it shrinks until the brand line fits the column whole. */
export const BRAND_KIT_PORTRAIT_TYPE_SAMPLE_PX = 48;

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

/** The smallest size a one-line sample is set at: the page's caption size, still readable in print (the H1 keeps one line and clips past it; open). */
export const BRAND_KIT_PORTRAIT_FIT_MIN_PX = 9;

/**
 * The Typography page's scale and the two blocks under it, as the fit model
 * measures them: the scale's label (10/1.2) at y 436 with the rows 6 px under
 * it, each row a 1 px rule, 8 px of padding above and below, its label line
 * (10.5 px at the frame's 1.6) and its sample at the step's own line height;
 * the display step's sample 4 px under its label line with 10 px below. The
 * "Where to get the font" and "Rules" blocks sit at the mock's y 830 when the
 * scale ends above it, else 16 px under the scale (the mock's gap), both
 * 340 px wide, and never end past y 990. The body step keeps its 18/30
 * unless the stack would not fit: then it is set smaller in the grammar's
 * steps, to 14 px at the least, and only then cut at a sentence.
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
  bodyMinPx: 14,
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
 * The Voice page's attributes grid (the design reader's answer): two columns
 * of 344 px from y 540, each attribute under a 3 px rule with 14 px of
 * padding, its name 20 px semibold and its line 15/1.6 set 8 px under, rows
 * 28 px apart, the grid ending by y 990 (28 px above the footer). More
 * attributes than the room holds set the grid smaller, in the grammar's steps.
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
