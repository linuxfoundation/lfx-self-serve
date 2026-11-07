// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The portrait print grammar of the Marketing OS documents (the Brand Kit's
// book first; the Messaging Framework's and the family's pages reuse it):
// one fixed US Letter frame per page, placed by absolute measurements, so
// Chromium and WebKit paginate one frame per sheet and nothing flows across
// a page edge. The measurements are the design's, ported 1:1; the
// components' stylesheet (`_mktg-portrait.scss`, classes `pp-*`) repeats the
// ones it cannot read from here, so keep the two in step.

import { lfxColors } from './colors.constants';
import { MKTG_PRINT_PAGE_SETUPS } from './mktg-print.constants';

/**
 * The page's geometry in CSS px at 96 dpi: US Letter portrait (8.5×11 in),
 * 56 px margins all round, a 704 px content column (x 56–760); covers and
 * openers inset 72 px. The vertical rhythm: running head top 36, page title
 * top 84, intro body top 136, footer 28 from the bottom, and the chapter
 * band (4 px, on a chapter's first page) at top 24.
 */
export const MKTG_PORTRAIT_PAGE = {
  width: 816,
  height: 1056,
  margin: 56,
  contentWidth: 704,
  coverInset: 72,
  headTop: 36,
  titleTop: 84,
  bodyTop: 136,
  footerBottom: 28,
  bandTop: 24,
  bandHeight: 4,
} as const;

/**
 * The columns of the 704 px content column: halves 340 + 24 + 340, thirds
 * 224 + 16 + 224 + 16 + 224, quarters 164 + 16 … (the icon tiles).
 */
export const MKTG_PORTRAIT_COLUMNS = {
  half: 340,
  halfGap: 24,
  third: 224,
  thirdGap: 16,
  quarter: 164,
  quarterGap: 16,
} as const;

/**
 * The neutral inks of every portrait page: the body ink, the muted labels
 * and captions, the hairline and the mist ground. They are the print
 * design's own values (the reference
 * book's), not the app's gray scale, whose slate tint reads differently on
 * paper beside a kit's colours; the kit's dark, accent and spark come from
 * the kit itself (`MktgPortraitLook`).
 */
export const MKTG_PORTRAIT_INKS = {
  ink: '#1F2937',
  muted: '#6B7280',
  hairline: '#E5E7EB',
  mist: '#F3F4F6',
  white: lfxColors.white,
} as const;

/**
 * The named page of the portrait frames. A fixed frame names its OWN page
 * (`page: mktg-portrait` on the frame), because in Chromium a print body's
 * inherited named page (`page: mktg-framework`) outranks the unnamed `@page`
 * rule, and the print frame writes BOTH `@page { … }` (WebKit ignores page
 * names) and `@page mktg-portrait { … }` (Chromium).
 */
export const MKTG_PORTRAIT_PAGE_NAME = 'mktg-portrait';

/**
 * The portrait frames' page setup, as `MKTG_PRINT_PAGE_SETUPS` carries it
 * and the stylesheet mirrors it: US Letter, no margin. No margin keeps the
 * browser's header and footer off the saved PDF (it draws them only in the
 * margin area) and makes the 816×1056 frame the whole sheet; the page's
 * room is inside the frame (`MKTG_PORTRAIT_PAGE.margin`).
 */
export const MKTG_PORTRAIT_PAGE_SETUP = MKTG_PRINT_PAGE_SETUPS['mktg-portrait'];

/**
 * The class of a print root made of portrait frames (the kit's book, and the
 * framework's and the family's pages once they are frames too), as against
 * the flowing portrait documents on the `mktg-framework` page: the print
 * frame picks the `mktg-portrait` setup by it, and the stylesheet lifts the
 * flowing documents' side padding from it, so the frames sit at the page's
 * edge. The template and the stylesheet carry the literal.
 */
export const MKTG_PORTRAIT_PRINT_CLASS = 'lfx-mktg-portrait';

/** The class of every portrait frame (`lfx-mktg-portrait-page`'s host), which the print styles paginate. */
export const MKTG_PORTRAIT_FRAME_CLASS = 'pp-page';

/** The footer's page number: two digits (`03`). */
export const MKTG_PORTRAIT_PAGE_NUMBER_DIGITS = 2;

/**
 * The accent's share of a chapter opener's grid ground, as two hex digits
 * of alpha appended to the kit's accent: the radial glow at 33 % and the
 * 32 px grid lines at 13 %.
 */
export const MKTG_PORTRAIT_GRID_GROUND = {
  glowAlpha: '55',
  gridAlpha: '22',
  gridSize: 32,
} as const;

/** A six-digit CSS hex colour, either case: the only form the grid ground can append an alpha to. */
export const MKTG_PORTRAIT_HEX_REGEX = /^#[0-9a-f]{6}$/i;

/**
 * The fit model of a text that must stay in its frame (ported from the
 * Google Slides exporter's, in px): a sans face averages about half an em a
 * character (more for bold and for capitals), a block is set smaller down to
 * `minScale` of its preferred size in steps of `scaleStep`, and one that
 * still does not fit is cut at a sentence.
 */
export const MKTG_PORTRAIT_FIT = {
  charEm: 0.55,
  charEmBold: 0.6,
  charEmCaps: 0.72,
  minScale: 0.72,
  scaleStep: 0.04,
  /** A paragraph shorter than this is never cut. */
  minCutLength: 12,
  /** Each cut takes a paragraph to this share of its length. */
  cutShare: 0.85,
  /** A guard on the cut loop. */
  maxCuts: 120,
} as const;
