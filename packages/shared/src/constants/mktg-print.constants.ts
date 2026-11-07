// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Download PDF for the Marketing OS asset views: each asset prints as a
// document through the browser's print dialog ("Save as PDF"), in the
// project's brand when the project has a Brand Kit (its colors, typeface and
// logo) and in the LF look otherwise. The Brand Kit's own book keeps its
// constants in brand-kit.constants.ts; these are the Messaging Framework's
// print and what every print shares.

import type { FoundationMessagePrintType } from '../interfaces/mktg-print.interface';

import { lfxColors } from './colors.constants';

/** The body class set while the Messaging Framework prints, so the page shows its print document alone (see styles.scss). */
export const FOUNDATION_MESSAGE_PRINT_BODY_CLASS = 'lfx-print-framework';

/** The class of the framework print document's wrapper: never shown on screen, shown only while the framework prints (see styles.scss). */
export const FOUNDATION_MESSAGE_PRINT_ONLY_CLASS = 'lfx-framework-print-only';

/**
 * The framework view's tabs that print, in order: the framework and the key
 * numbers. The run's sources and gaps (and the
 * reviewer's note) stay on screen: they are for the reviewer, not the reader.
 */
export const FOUNDATION_MESSAGE_PRINT_TAB_IDS = ['framework', 'numbers'] as const;

/** Printed marker for an unanswered FAQ; independent of the screen's tab labels. */
export const MKTG_FAQ_PRINT_UNANSWERED = 'Needs an answer';

/** The document's title on the cover and in the running heads. */
export const FOUNDATION_MESSAGE_PRINT_TITLE = 'Messaging Framework';

/**
 * The framework's portrait book: how many ideal customer profiles one page
 * holds (two full profile rows at reading size), so the page count follows
 * the data and no profile flows across a page edge.
 */
export const FOUNDATION_MESSAGE_PRINT_ICPS_PER_PAGE = 2;

/** The plan ids of the framework's portrait pages that are not numbered from the data (`goal-1`, `icps-2` are). */
export const FRAMEWORK_PORTRAIT_PAGE_IDS = {
  cover: 'cover',
  framework: 'framework',
  sayAvoid: 'say-avoid',
  messageHouse: 'message-house',
  keyNumbers: 'key-numbers',
  sources: 'sources',
} as const;

/** The running head's section labels of the framework's portrait chapters, in order. */
export const FRAMEWORK_PORTRAIT_SECTIONS = {
  framework: '01 Framework',
  icps: '02 ICPs',
  messageHouse: '03 Message house',
  keyNumbers: '04 Key numbers',
  sources: '05 Sources',
} as const;

/** The page titles of the framework's portrait book that are not the data's (a goal page is titled `Goal 1 · Events`). */
export const FRAMEWORK_PORTRAIT_TITLES = {
  framework: 'Framework',
  sayAvoid: 'Say and avoid · anchor questions',
  icps: 'Ideal customer profiles',
  messageHouse: 'Message house',
  keyNumbers: 'Key numbers',
  sources: 'Sources & gaps',
} as const;

/**
 * The key numbers page's tiles, px: 140 high on a six-track grid (each tile's
 * share of a row is FRAMEWORK_PORTRAIT_TILE_SHARES'; 344 wide as a half), a 16
 * gap, the first row at 210; the "Figures and their sources" table 28 under
 * the last row. The table of every figure (past six) starts at the same top.
 */
export const FRAMEWORK_PORTRAIT_NUMBER_TILE = {
  width: 344,
  /** The mock's tile as drawn: 22 + the 54 figure + 10 + a 14/1.4 label line (20) + 10 + the 17 source pill + 22. */
  height: 156,
  gap: 16,
  top: 210,
  /** Under two rows of tiles the facts table starts where the mock draws it: 210 + 2 × 156 + 16 + 22 = 560. */
  tableGap: 22,
  /** `.fwp-number-tile` padding: 22 above and below, 24 at the sides (the figure and the label fit the width inside). */
  paddingTop: 22,
  paddingSide: 24,
  /** `.fwp-number-label` and `.fwp-number-source` margin-top. */
  labelGap: 10,
  /** The grammar's `.pp-chip` as the tile's source pill: 8.5 px type on one line, 3 px padding and a 1 px border above and below (16.5, kept whole). */
  sourceHeight: 17,
} as const;

/**
 * The fixed tops of the framework's portrait pages whose blocks the fit
 * model bounds (the design's R(x, y) values, px): a goal page's key-message
 * bar, proof list, sound bite and "Who it's for" cards; the Sources & gaps
 * page's lists and approval card; and where the footer begins, which no
 * block may pass.
 */
export const FRAMEWORK_PORTRAIT_TOPS = {
  /** The framework page's goal matrix, under the statement cards (which close 16 px above it). */
  matrix: 336,
  goalKey: 330,
  goalProofs: 450,
  goalBite: 690,
  goalServed: 810,
  sourcesLists: 210,
  sourcesApproval: 880,
  /** The first ICP page's rows start under the long intro; the later pages' under the short one. */
  icpRowsFirst: 214,
  icpRows: 190,
  icpMatrix: 560,
  /** A key numbers continuation page's table top (no intro). */
  numbersContinued: 136,
  /** The top of the footer's room: the last pixel any block may reach. */
  footer: 1000,
} as const;

/**
 * The type of the framework print's fitted blocks (size px, line height as a multiple, weight): what the fit model
 * measures and what the component binds on the frame as `--fwp-<name>-size` / `--fwp-<name>-line`, which the
 * stylesheet reads, so the measured type and the printed type are one value.
 */
export const FRAMEWORK_PORTRAIT_TYPE = {
  statement: { size: 11.5, line: 1.45, weight: 400 },
  tagline: { size: 18, line: 1.3, weight: 500 },
  coverUmbrella: { size: 32, line: 1.18, weight: 500 },
  houseUmbrella: { size: 19, line: 1.4, weight: 500 },
  goalValue: { size: 22, line: 1.35, weight: 500 },
  goalKey: { size: 19, line: 1.4, weight: 500 },
  goalProof: { size: 15, line: 1.45, weight: 400 },
  /** A goal's proof rows when they must be tightened before a cut (the design reader's rule). */
  goalProofTight: { size: 14, line: 1.45, weight: 400 },
  goalBite: { size: 34, line: 1.2, weight: 500 },
  servedLine: { size: 11.5, line: 1.5, weight: 400 },
  fact: { size: 11, line: 1.3, weight: 400 },
  source: { size: 12, line: 1.6, weight: 400 },
  /** A sources list when it must be tightened before a cut. */
  sourceTight: { size: 11.5, line: 1.5, weight: 400 },
  /** The framework page's goal matrix: a goal's title in the head row, a cell's text, the key message's, a proof row (and its tight measure), the sound bite's, the crosscut's. */
  matrixGoal: { size: 15, line: 1.2, weight: 600 },
  matrixCell: { size: 11, line: 1.4, weight: 400 },
  matrixKey: { size: 11, line: 1.4, weight: 600 },
  matrixProof: { size: 11, line: 1.4, weight: 400 },
  matrixProofTight: { size: 10.5, line: 1.35, weight: 400 },
  matrixBite: { size: 12.5, line: 1.3, weight: 500 },
  matrixCrosscut: { size: 11, line: 1.5, weight: 400 },
  /** A page's title in the grammar's type (`.pp-title`, 34/1.1/500), fitted to one line on the goal pages. */
  pageTitle: { size: 34, line: 1.1, weight: 500 },
  /** The say pills and the avoid rows, and their tight measures. */
  sayPill: { size: 13, line: 1.2, weight: 500 },
  sayPillTight: { size: 12, line: 1.2, weight: 500 },
  avoidRow: { size: 13, line: 1.5, weight: 400 },
  avoidRowTight: { size: 12, line: 1.4, weight: 400 },
  /** A profile row's name, its who line, its personas, a field's eyebrow and text (`.fwp-icp-*`). */
  icpName: { size: 15, line: 1.3, weight: 600 },
  icpWho: { size: 11.5, line: 1.5, weight: 400 },
  icpPersona: { size: 10.5, line: 1.5, weight: 400 },
  icpEyebrow: { size: 9.5, line: 1.2, weight: 600 },
  icpField: { size: 12.5, line: 1.5, weight: 400 },
  /** The muted line under a cut list: `+N more on the framework's Framework tab in LFX One` (the Sources tab for the Sources & gaps lists). */
  cutNote: { size: 10.5, line: 1.4, weight: 400 },
  /** A key number tile's figure (`.fwp-number`), stepped down in whole px to one line of the tile, to a floor of half its size; a longer figure overflows the tile (follow-up). */
  tileFigure: { size: 54, line: 1, weight: 500 },
  /** A key number tile's label (`.fwp-number-label`), fitted to the room under the figure. */
  tileLabel: { size: 14, line: 1.4, weight: 400 },
} as const satisfies Record<string, FoundationMessagePrintType>;

/**
 * The room the framework print's stylesheet takes around a fitted block, px, which the component subtracts from a
 * block's box before it fits the text. Each value names the stylesheet rule it mirrors (mktg-framework-print.component.scss).
 */
export const FRAMEWORK_PORTRAIT_ROOM = {
  /** A `pp-lab` eyebrow (the grammar's) and the gap under it. */
  label: 26,
  /** `.fwp-card` padding, top and bottom together (14 + 14). */
  cardPadding: 28,
  /** `.fwp-proof-row` padding (13 + 13) and its hairline. */
  proofRow: 27,
  /** `.fwp-proof-list-tight .fwp-proof-row` padding (9 + 9) and its hairline. */
  proofRowTight: 19,
  /** `.fwp-proof-row` gap between the fact and its chip. */
  proofGap: 16,
  /** `.fwp-facts-table td` padding (4 + 4) and its hairline. */
  factRow: 9,
  /** `.fwp-facts-table-tight td` padding (3 + 3) and its hairline. */
  factRowTight: 7,
  /** `.fwp-cut-note`: the gap above the line under a cut list. */
  cutNoteGap: 6,
  /** A grid table's head row: `.fwp-grid-th` 9.5 px × 1.4 + padding 6 + 6 + its hairline, and the table's 8 px margin under the eyebrow. */
  tableHead: 34,
  /** The facts table's cell padding on the right (`.fwp-facts-table td` 12), off each column's width. */
  factCellPadding: 12,
  /** `.fwp-block-after`: the gap between the Read and the Could-not-be-read blocks. */
  blockAfter: 18,
  /** The gap between the last block of a page and the one under it. */
  gap: 16,
  /** `.fwp-chip-wrap` max-width: a proof chip's cap, px, so a fact's measuring width is the row less the chip. */
  chip: 140,
  /** `.fwp-icp-who`: the profile's name-and-tags column, px (the board's), and the most it grows so a row of tags never wraps. */
  icpWho: 190,
  icpWhoMax: 300,
  /** The grammar's `.pp-chip`: its type size, its padding and border across (7 + 7 + 1 + 1), and `.fwp-icp-chips`' gap between tags. */
  chipSize: 8.5,
  chipPadding: 16,
  chipGap: 4,
  /** The goal matrix (`.fwp-matrix-row`): a row's padding (10 + 10) and hairline; its side padding (12 + 12); the label column; the column gap; a proof row's margin under it; the sound bite's rule and padding (2 + 10); the crosscut's margin above. */
  matrixRow: 21,
  matrixPadding: 24,
  matrixLabelColumn: 96,
  matrixGap: 16,
  matrixProofGap: 5,
  matrixBiteInset: 12,
  matrixCrosscutGap: 8,
  /** The say list: its margin above, a pill's padding and border around (8 + 8 + 1 + 1 down, 14 + 14 + 1 + 1 across; tight 6 + 6 / 10 + 10), the gap between pills; the say column's and the avoid column's widths and the avoid column's left. */
  sayListTop: 10,
  sayPillPadding: 18,
  sayPillPaddingAcross: 30,
  sayPillPaddingTight: 14,
  sayPillPaddingAcrossTight: 22,
  sayPillGap: 8,
  sayColumn: 320,
  avoidColumn: 360,
  avoidLeft: 344,
  /** The avoid list: its margin above, a row's padding (10 + 10; tight 7 + 7) and hairline, the gaps around its arrow (12 + 12) and the arrow's own width. */
  avoidListTop: 6,
  avoidRow: 21,
  avoidRowTight: 15,
  avoidArrow: 34,
  /** A profile row (`.fwp-icp-row`): its padding (20 + 28) and hairline; the gap between its two columns; a field's eyebrow-to-text gap and the grid's gaps (18 down, 20 across); the tags' line (the chip and its margin above). */
  icpRow: 49,
  icpColumnGap: 24,
  icpFieldGap: 4,
  icpGridRowGap: 18,
  icpGridColumnGap: 20,
  icpTagsLine: 30,
  icpWhoTextTop: 10,
  icpPersonasTop: 8,
} as const;

/** The key numbers facts table's `<colgroup>` widths, %: the fact, its source, the goal that uses it (`table-layout: fixed` reads them). */
export const FRAMEWORK_PORTRAIT_FACT_COLUMNS = [50, 25, 25] as const;

/** The key numbers table's `<colgroup>` widths, % (more figures than the tiles hold): the figure, what it counts. */
export const FRAMEWORK_PORTRAIT_NUMBER_COLUMNS = [25, 75] as const;

/**
 * The key numbers' tile layout by count (the maintainer's ruling, 7 Nov 2026, through the design reader): each entry is
 * one tile's share of a row (1 = the row, 2 = a half, 3 = a third), in order: 4 → 2×2, 5 → a row of three then a row of
 * two, 6 → 3×2. One to three figures keep the earlier rule (pairs, an odd last tile across the row). More figures than
 * the tiles hold print no tiles: the key numbers table lists every one.
 */
export const FRAMEWORK_PORTRAIT_TILE_SHARES = {
  1: [1],
  2: [2, 2],
  3: [2, 2, 1],
  4: [2, 2, 2, 2],
  5: [3, 3, 3, 2, 2],
  6: [3, 3, 3, 3, 3, 3],
} as const satisfies Record<number, readonly number[]>;

/** The most figures the key numbers page prints as tiles; past it, the table lists them all. */
export const FRAMEWORK_PORTRAIT_MAX_TILES = 6;

/** A count in words for the print's sentences, up to the anchor questions' limit (FOUNDATION_MESSAGE_CONTENT_LIMITS.anchor.max); a count past it prints as digits. */
export const FOUNDATION_MESSAGE_PRINT_COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'] as const;

/** The on-screen Sources card's empty state for the gaps, printed verbatim on the Sources & gaps page. */
export const FOUNDATION_MESSAGE_PRINT_NO_GAP_MESSAGE = 'The sources left no gap.';

/** The source types a run writes before a source (`Website: https://…`); the Sources & gaps page prints the source without the type. */
export const FOUNDATION_MESSAGE_PRINT_SOURCE_TYPES = ['Website', 'Link', 'Press release'] as const;

/** The fixed three-letter month names the prints date with (UTC), the same in every engine and locale. */
export const MKTG_PRINT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * The LF look: what a print uses when the project has no Brand Kit yet. The
 * LF navy as the dark, the LF blue as the accent, Inter (which the app
 * already loads), and the Linux Foundation logo from the app's own images.
 */
export const MKTG_PRINT_LF_LOOK = {
  dark: lfxColors.blue[900],
  accent: lfxColors.blue[500],
  tint: lfxColors.blue[50],
  onDark: lfxColors.white,
  fontStack: "'Inter', sans-serif",
  logoOnDark: '/images/logo_lf_white.svg',
  logoOnLight: '/images/logo_lf_horizontal_color.png',
  logoAlt: 'The Linux Foundation',
} as const;

/** The ink on a kit's dark ground when that "dark" is in fact light: the app's darkest gray. */
export const MKTG_PRINT_INK_ON_LIGHT = lfxColors.gray[900];

/** White ink on a dark ground. */
export const MKTG_PRINT_INK_ON_DARK = lfxColors.white;

/** The contrast a kit's dark must reach on white to set the white pages' body text: WCAG AA for normal text. Below it the body takes MKTG_PRINT_INK_ON_LIGHT. */
export const MKTG_PRINT_BODY_INK_MIN_CONTRAST = 4.5;

/** The CSS filter that draws a full-color lockup reversed (white), when the kit supplies no reversed artwork. */
export const MKTG_PRINT_REVERSED_FILTER = 'brightness(0) invert(1)';

/** How long Download PDF waits for the brand's typeface before it opens the print dialog anyway (ms). */
export const MKTG_PRINT_FONT_WAIT_MS = 3000;

/**
 * How long the hidden print frame stays after its print dialog opened when no
 * `afterprint` arrives (ms): iOS Safari builds its preview asynchronously and
 * may never fire the event, so the frame is kept well past any preview, then
 * reclaimed. The next print, or the view's `clear`, removes it at once.
 */
export const MKTG_PRINT_FRAME_LINGER_MS = 5 * 60 * 1000;

/**
 * The hidden print frame's viewport in CSS inches: US Letter's width and a
 * hair under its height. WebKit lays a subframe out at the frame's own size
 * and resolves its viewport units there (Chromium paginates against the page
 * box whatever the frame measures), so a 1px frame collapsed every `100vh`
 * cover and shifted the page breaks. Letter is the SHORTER common paper (11in
 * against A4's 11.69in; it is the wider one, 8.5in against 8.27in), so a cover
 * sized from `vh` fills a Letter page and never spills a blank sheet on A4;
 * never size print rules from `vw`. Where the pages print with no `@page`
 * margin (`MKTG_PRINT_PAGE_SETUPS`), a page is `100vh` tall and holds its
 * 1.1in of head and foot room (0.55in each, repeated on every page by the
 * sheet tables) plus a cover of `calc(100vh - 1.2in)`: 0.1in of slack in the
 * cover itself, and the frame's own 0.1in under 11in behind it, so a fraction
 * of rounding never pushes an empty remainder onto a blank sheet. Where they
 * print on the page margins instead, the cover is `calc(100vh - 1.1in)`, the
 * page area under those margins.
 */
export const MKTG_PRINT_FRAME_PAPER_IN = { width: 8.5, height: 10.9 } as const;

/**
 * The page setups the print frame writes as the ONE unnamed `@page` rule of
 * its document (WebKit's support for named pages is doubtful, and on the
 * browser's default margins a cover sized to the page area spills a blank
 * sheet). `brand-kit` is the legacy landscape book; `mktg-framework` every
 * portrait document (the brand kit's own portrait print included) in
 * Chromium and every other non-WebKit engine, mirrored by the named
 * `@page mktg-framework` in styles.scss, which a matched named rule outranks
 * in Chrome with the same values. Both print with `margin: 0`: the browser
 * draws its header and footer (date, title, URL, page numbers) only in the
 * page margin area, so no margin is the standard way to keep them off a saved
 * PDF, and the room the portrait pages used to take from the margin (0.55in
 * top and bottom, 0.6in at the sides) is inside the documents, repeated per
 * page by their table head and foot groups (lfx-mktg-print-sheet, the kit's
 * chapters). WebKit does not repeat a table's head and foot on every printed
 * page (bug 17205, open), so in Safari the portrait documents print on
 * `mktg-framework-page-margins`, exactly the margins they had before, with
 * that in-document room collapsed under `MKTG_PRINT_PAGE_MARGINS_CLASS`: the
 * browser's header and footer stay, as before, and the user unticks them in
 * Safari's print dialog. `mktg-portrait` is the fixed-frame portrait book
 * (`MKTG_PORTRAIT_PRINT_CLASS`: the kit's 17 pages, and every document built
 * of `lfx-mktg-portrait-page` frames): US Letter with no margin in BOTH
 * engines, since each frame is the whole sheet and carries its own room;
 * the print frame writes it unnamed (WebKit) and as `@page mktg-portrait`
 * (Chromium, where the body's inherited named page would otherwise win).
 * Keep these in step with styles.scss and `_mktg-portrait.scss`, which
 * cannot read them.
 */
export const MKTG_PRINT_PAGE_SETUPS = {
  'brand-kit': 'size: letter landscape; margin: 0;',
  'mktg-framework': 'size: portrait; margin: 0;',
  'mktg-framework-page-margins': 'size: portrait; margin: 0.55in 0.6in;',
  'mktg-portrait': 'size: 8.5in 11in; margin: 0;',
} as const;

/**
 * The class the print frame sets on its body when the page prints on its
 * margins (`mktg-framework-page-margins`: WebKit), under which the documents'
 * own room collapses to nothing: the sheets' head and foot rows, the kit
 * chapters' head padding and foot, the print roots' side padding, the covers
 * sized back to the page area. Each room rule carries its collapse beside it.
 */
export const MKTG_PRINT_PAGE_MARGINS_CLASS = 'lfx-print-page-margins';

/**
 * The weights the framework print sets the brand's typeface in, loaded before
 * the print dialog opens: the body (400), the headings, tagline and key
 * numbers (`font-medium`, 500) and the labels (`font-semibold`, 600).
 */
export const MKTG_PRINT_FONT_WEIGHTS = [400, 500, 600] as const;

/**
 * The id prefix of a typeface's Google Fonts stylesheet link in the page's
 * head, followed by the stylesheet's encoded URL: one link per typeface,
 * whichever print (the framework's or the Brand Kit's book) loaded it first.
 */
export const MKTG_PRINT_FONT_LINK_ID_PREFIX = 'brand-kit-font-';
