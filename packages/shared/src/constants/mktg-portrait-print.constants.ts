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
 * The white plate under artwork a dark ground cannot reverse (no reversed
 * file, more than one ink): its padding is this fraction of the lockup's
 * drawn height, and its corner radius this fraction of its shorter side
 * (Google Slides' rounded rectangle; the editor's rule, book and deck alike).
 */
export const MKTG_PORTRAIT_PLATE = {
  paddingOfHeight: 0.5,
  radiusOfShortSide: 1 / 6,
  /** A rounded square's clear inset on each side, as a fraction of its side (the padding demo's dashed box: 40 of 200). */
  shapeInsetOfSide: 0.2,
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
 * and captions, the hairline, the mist ground, white, and the one semantic
 * red (the watch-out cross). These are the print design's own values
 * (`principles.md` §2 of the portrait mock, the spec of record for this
 * book), the ONE place they are written: the page frame sets them as
 * `--pp-*` custom properties and the print stylesheets read only those.
 * The four grays are not in `lfxColors` (its gray scale is slate-tinted,
 * which reads differently on paper beside a kit's colours), so they stay
 * as named constants here, the recorded exception in
 * `docs/architecture/frontend/styling-system.md`; white and the red are
 * the app's scale. The kit's dark, accent and spark are the kit's own data
 * (`MktgPortraitLook`), never constants.
 */
export const MKTG_PORTRAIT_INKS = {
  ink: '#1F2937',
  muted: '#6B7280',
  hairline: '#E5E7EB',
  mist: '#F3F4F6',
  white: lfxColors.white,
  fail: lfxColors.red[600],
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
 * The cover's bottom strip: two halves on one 10 px line (caps, 0.1 em
 * tracking) 24 px apart in the frame's 672 px, at y 984. A half that does
 * not fit loses words from its first segment (the project name, the host)
 * with an ellipsis; when even that cannot hold both, the strip wraps at
 * 1.4 leading and moves up by the extra line, so it ends where the one
 * line did (above the 750 pt line).
 */
export const MKTG_PORTRAIT_COVER_STRIP = {
  top: 984,
  size: 10,
  tracking: 0.1,
  gap: 24,
  lineHeight: 1.4,
  /** The halves' segments are joined by this. */
  separator: ' · ',
} as const;

/**
 * The portrait frames' page setup, as `MKTG_PRINT_PAGE_SETUPS` carries it
 * and the stylesheet mirrors it: US Letter, no margin. No margin keeps the
 * browser's header and footer off the saved PDF (it draws them only in the
 * margin area) and makes the 816×1056 frame the whole sheet; the page's
 * room is inside the frame (`MKTG_PORTRAIT_PAGE.margin`).
 */
export const MKTG_PORTRAIT_PAGE_SETUP = MKTG_PRINT_PAGE_SETUPS['mktg-portrait'];

/**
 * The papers a portrait book prints on, in CSS px (96 per inch). The frame is
 * drawn for US Letter; on A4 the grammar zooms every frame by `a4.width /
 * letter.width` (210 mm over 8.5 in, ≈ 0.9727) and grows its ground to the
 * paper's height (`_mktg-portrait.scss`, which computes the same numbers), so
 * the dialog's paper is the page box and nothing is left for the browser's
 * headers and footers to print into. The e2e Chrome proof reads these.
 */
export const MKTG_PORTRAIT_PAPERS = {
  letter: { width: 816, height: 1056 },
  a4: { width: 793.7007874, height: 1122.519685 },
} as const;

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
 * The accent's share of a grid ground (the covers, the openers and the
 * imagery hero), as two hex digits of alpha appended to the kit's accent:
 * the radial glow at 33 % on screen and 53 % in print (on paper the screen's
 * glow is almost invisible: the editor's p13), and the 32 px grid lines at
 * 13 %.
 */
export const MKTG_PORTRAIT_GRID_GROUND = {
  glowAlpha: '55',
  glowPrintAlpha: '88',
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
/**
 * The `+N more <noun>, in LFX One` line a bounded list prints for the items
 * its room does not hold: the nouns, singular at one.
 */
export const MKTG_PORTRAIT_MORE_LINE = {
  /** After the noun: where the rest is read. */
  suffix: ', in LFX One',
  nouns: {
    rule: { one: 'rule', many: 'rules' },
    avoid: { one: 'item to avoid', many: 'items to avoid' },
    pair: { one: 'pair', many: 'pairs' },
    sourceRead: { one: 'source read', many: 'sources read' },
    gap: { one: 'gap', many: 'gaps' },
    colorConflict: { one: 'color conflict', many: 'color conflicts' },
    weight: { one: 'weight', many: 'weights' },
  },
} as const;

/**
 * The function words a cut never ends on ("… goes first and", "… so"): after
 * a cut at a word the trailing ones are dropped, at least one word kept.
 */
export const MKTG_PORTRAIT_CUT_STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'so', 'for', 'of', 'to', 'in', 'on', 'with', 'at', 'by']);

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

/**
 * A sans face's advance width per character, in thousandths of an em (the
 * Helvetica metrics, the sans standard every humanist sans sits near), for
 * measuring one line that must fit its measure at its real size: a flat
 * average (above) wraps a paragraph safely but shrinks a line that fits.
 * A character not here takes `MKTG_PORTRAIT_GLYPH_WIDTH_DEFAULT`.
 */
export const MKTG_PORTRAIT_GLYPH_WIDTHS: Readonly<Record<string, number>> = {
  ' ': 278,
  '!': 278,
  '"': 355,
  '#': 556,
  $: 556,
  '%': 889,
  '&': 667,
  "'": 191,
  '(': 333,
  ')': 333,
  '*': 389,
  '+': 584,
  ',': 278,
  '-': 333,
  '.': 278,
  '/': 278,
  '0': 556,
  '1': 556,
  '2': 556,
  '3': 556,
  '4': 556,
  '5': 556,
  '6': 556,
  '7': 556,
  '8': 556,
  '9': 556,
  ':': 278,
  ';': 278,
  '<': 584,
  '=': 584,
  '>': 584,
  '?': 556,
  '@': 1015,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  '[': 278,
  '\\': 278,
  ']': 278,
  '^': 469,
  _: 556,
  '`': 333,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  '{': 334,
  '|': 260,
  '}': 334,
  '~': 584,
  '·': 278,
  '’': 222,
  '‘': 222,
  '“': 333,
  '”': 333,
  '–': 556,
  '—': 1000,
  '…': 1000,
};

/** The width of a character the table does not name (an accented letter, say): a lowercase letter's. */
export const MKTG_PORTRAIT_GLYPH_WIDTH_DEFAULT = 556;

/**
 * How much wider than the table a face sets a line, by family (lowercase):
 * Montserrat and Poppins are wide geometric faces, Source Sans narrow; a
 * family not here takes `MKTG_PORTRAIT_FAMILY_WIDTH_DEFAULT`, a little wide
 * so an unknown face still fits. Weight widens too: `MKTG_PORTRAIT_WEIGHT_WIDTH`.
 * Instrument Sans is read from the served AAIF book (QA round 1, p11): its
 * display line at 64/500 measures ≈649 px, its H2 line at 32/500 wraps a
 * 480 px column, its tracked specimen at 48/500 fits 704 — 1.02 holds all
 * three.
 */
export const MKTG_PORTRAIT_FAMILY_WIDTH: Readonly<Record<string, number>> = {
  'instrument sans': 1.02,
  inter: 1.05,
  montserrat: 1.14,
  poppins: 1.12,
  roboto: 0.99,
  'open sans': 1.05,
  lato: 0.98,
  'source sans 3': 0.93,
  'source sans pro': 0.93,
  'ibm plex sans': 1.03,
  'work sans': 1.07,
  'dm sans': 1.02,
  manrope: 1.05,
  'nunito sans': 1.02,
  /** The Watch-outs page's retyped sample (a bold italic serif). */
  georgia: 1.1,
};

export const MKTG_PORTRAIT_FAMILY_WIDTH_DEFAULT = 1.08;

/** A heavier weight's width against the regular, by the hundred (400 → 1, 500 → 1.03, 600 → 1.07, 700 and up → 1.1). */
export const MKTG_PORTRAIT_WEIGHT_WIDTH: Readonly<Record<number, number>> = { 400: 1, 500: 1.03, 600: 1.07, 700: 1.1 };

/** The eyebrow's tracking, in em per character, when a line is set in capitals (a `tracking` of its own wins). */
export const MKTG_PORTRAIT_CAPS_TRACKING_EM = 0.12;
