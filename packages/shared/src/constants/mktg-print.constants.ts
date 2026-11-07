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

/**
 * The one middle-dot separator every printed line joins its parts with (the editor's rule, 7 November 2026: one
 * spacing everywhere): a plain space, the middle dot, a plain space, as the grammar's footer sets it. The document
 * title (the saved PDF's file name) and every print join with it (mktgPrintJoin, mktg-print-text.utils.ts); the
 * framework book passes its own, FRAMEWORK_PORTRAIT_SEP, to the same join.
 */
export const MKTG_PRINT_DOT = ' · ';

/**
 * The framework book's middle dot (the editor's S-b read of 33584d0ea: in the book's Instrument Sans the dot sat tight on
 * its one space, "Goal 1·Events"): a plain space and a thin space (U+2009, about a fifth of an em) each side; the thin space
 * adds the room, the plain space beside it keeps the line breakable there. A provisional glyph for the editor's re-read.
 * Every framework join passes it to `mktgPrintJoin` (a goal's `Goal 1 · Events`, the contents, the cover's eyebrow, edition
 * and strip lines, the house's brand line, the channels, the personas, the sources' `host · N pages` and the facts'
 * "used by"); the other prints and the saved PDF's file name keep MKTG_PRINT_DOT.
 */
export const FRAMEWORK_PORTRAIT_SEP = ' \u2009·\u2009 ';

/**
 * The dash between a profile's objection and its response (`“Too early?” — Not at all.`): a no-break space binds the dash
 * to the question, so it never opens the response's line on its own (the editor's S-d read of 33584d0ea); a plain space
 * after it lets the response wrap as text does. The template and the layout measure compose the line with it.
 */
export const MKTG_PRINT_OBJECTION_DASH = '\u00a0— ';

/** The page titles of the framework's portrait book that are not the data's (a goal page is titled `Goal 1 · Events`). */
export const FRAMEWORK_PORTRAIT_TITLES = {
  framework: 'Framework',
  sayAvoid: `Say and avoid${FRAMEWORK_PORTRAIT_SEP}anchor questions`,
  icps: 'Ideal customer profiles',
  messageHouse: 'Message house',
  keyNumbers: 'Key numbers',
  sources: 'Sources & gaps',
} as const;

/**
 * The key numbers page's tiles, px: 156 high on a six-track grid (each tile's
 * share of a row is FRAMEWORK_PORTRAIT_TILE_SHARES'; 344 wide as a half), a 16
 * gap, the first row at 210; the "Figures and their sources" table 22 under
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
 * The framework page's four statement cards' shares of the row (their flex). The design's are 0.85 / 1.05 / 1.4 / 0.7; the
 * tagline's column is widened from the vision's and the positioning's so the tagline holds two words a line (the editor's
 * read, 7 Nov 2026: no one-word lines; the design's own board shows them).
 */
export const FRAMEWORK_PORTRAIT_STATEMENT_SHARES = {
  vision: 0.7,
  mission: 1,
  positioning: 1.25,
  tagline: 1.05,
} as const;

/**
 * The fixed tops of the framework's portrait pages (the design's R(x, y) values, px): the cover's title, contents and
 * strip; the framework page's matrix; a goal page's key-message bar, proof list, sound bite and "Who it's for" cards;
 * the say-and-avoid page's lists, anchors and crosscut; the Sources & gaps page's lists and approval card; the house's
 * umbrella; the ICP pages' rows and matrix; a numbers continuation's table; and where the footer begins, which no block
 * may pass. The layout utils bound every block that follows the data between its top and the next block's, or the footer.
 */
export const FRAMEWORK_PORTRAIT_TOPS = {
  /** The cover: the title block, the contents list, and the strip at the foot (the contents end above it). */
  coverTitle: 470,
  coverContents: 620,
  coverStrip: 984,
  /** The framework page's goal matrix, under the statement cards (which close 16 px above it). */
  matrix: 336,
  goalKey: 330,
  goalProofs: 450,
  goalBite: 690,
  goalServed: 810,
  /** The say-and-avoid page: the two lists, the anchor questions (never moved), the crosscut box's least top (it follows the anchors when they run longer). */
  sayLists: 200,
  anchors: 470,
  sayCrosscut: 760,
  sourcesLists: 210,
  sourcesApproval: 880,
  /** The message house's umbrella top; Why now and the audiences follow the measured pillars (the design's fixed 780 left an empty band). */
  house: 140,
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
  /** A "Who it's for" card's name and its two lines, fitted to the card together. */
  servedName: { size: 13, line: 1.3, weight: 600 },
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
  /** An anchor question (`.fwp-anchor-question`) and its number; the crosscut box's text. */
  anchorQuestion: { size: 22, line: 1.3, weight: 500 },
  anchorNumber: { size: 26, line: 1, weight: 500 },
  crosscutText: { size: 13, line: 1.6, weight: 400 },
  /** A profile card: its name, kind and goal chips line, who text and persona rows; a field's eyebrow and text (and the text's tight measure, taken when one card alone outruns its page). */
  icpName: { size: 15, line: 1.3, weight: 600 },
  icpWho: { size: 11.5, line: 1.5, weight: 400 },
  icpPersona: { size: 10.5, line: 1.5, weight: 400 },
  icpEyebrow: { size: 9.5, line: 1.2, weight: 600 },
  icpField: { size: 12.5, line: 1.5, weight: 400 },
  icpFieldTight: { size: 11.5, line: 1.45, weight: 400 },
  /** The goals × profiles matrix under a lone profile: its note, its head row and its cells. */
  matrixNote: { size: 11.5, line: 1.5, weight: 400 },
  matrixHead: { size: 9.5, line: 1.4, weight: 600 },
  matrixCellText: { size: 12, line: 1.4, weight: 400 },
  /** The message house's brand line, a pillar's title, message and proof row, the Why now text, an audience row (and its tight measure). */
  houseLine: { size: 13, line: 1.3, weight: 600 },
  pillarTitle: { size: 16, line: 1.25, weight: 600 },
  pillarMessage: { size: 12.5, line: 1.5, weight: 400 },
  pillarProof: { size: 11.5, line: 1.45, weight: 400 },
  whyNow: { size: 13, line: 1.55, weight: 400 },
  audienceRow: { size: 11.5, line: 1.45, weight: 400 },
  audienceRowTight: { size: 11, line: 1.4, weight: 400 },
  /** The audience's name, bold at the row's size (`.fwp-audience-row strong`: only its weight is read; the row's size and line are the row's). */
  audienceName: { size: 11.5, line: 1.45, weight: 600 },
  /** The say pills and the avoid rows, and their tight measures. */
  sayPill: { size: 13, line: 1.2, weight: 500 },
  sayPillTight: { size: 12, line: 1.2, weight: 500 },
  avoidRow: { size: 13, line: 1.5, weight: 400 },
  avoidRowTight: { size: 12, line: 1.4, weight: 400 },
  /** The muted caption line under a cut list: `+N more in LFX One` (MKTG_PRINT_CUT_NOTE). */
  cutNote: { size: 10.5, line: 1.4, weight: 400 },
  /** A key number tile's figure (`.fwp-number`), stepped down in whole px to one line of the tile, to a floor of half its size; when the floor does not hold a figure the numbers print as the table instead (frameworkPortraitNumberTiles). */
  tileFigure: { size: 54, line: 1, weight: 500 },
  /** A key number tile's label (`.fwp-number-label`), fitted to the room under the figure. */
  tileLabel: { size: 14, line: 1.4, weight: 400 },
  /** The cover's contents rows (`.fwp-contents-row`), and their tight measure when the plan runs long. */
  contentsRow: { size: 13, line: 1.3, weight: 400 },
  contentsRowTight: { size: 12, line: 1.3, weight: 400 },
} as const satisfies Record<string, FoundationMessagePrintType>;

/**
 * The room the framework print's stylesheet takes around a fitted block, px, which the layout utils subtract from a
 * block's box before they fit the text. Each value names the stylesheet rule it mirrors (the global partial
 * `_mktg-framework-print-pages.scss`).
 */
export const FRAMEWORK_PORTRAIT_ROOM = {
  /** A `pp-lab` eyebrow (the grammar's) and the gap under it. */
  label: 26,
  /** The cover's contents list: its margin under the eyebrow; a row's padding (8 + 8) and hairline, and the tight row's (5 + 5); the list's two columns and their gap. */
  contentsTop: 8,
  contentsRow: 17,
  contentsRowTight: 11,
  contentsColumns: 2,
  contentsColumnGap: 24,
  /** `.fwp-contents-number`'s width: the room a row's title has is its column less this. */
  contentsNumber: 30,
  /** `.fwp-card` padding, top and bottom together (14 + 14), and across (16 + 16); its hairline border above and below (1 + 1). */
  cardPadding: 28,
  cardBorder: 2,
  cardPaddingSide: 32,
  /** The "Who it's for" row: `.fwp-served-cards`' margin above and gap between cards, the name's margin to its first line and between the lines, and the narrowest card the board draws (four across 704 px): more profiles than hold at it are cut, the note under the row. */
  servedTop: 8,
  servedGap: 16,
  servedLineTop: 6,
  servedLineGap: 4,
  servedCardMin: 164,
  /** The cover's lockup: its drawn height (`.fwp-cover-logo`) and its margin under the band's padding; a plated lockup's block starts a plate padding higher, so the artwork itself keeps this place (the kit cover's rule). */
  coverLogoHeight: 40,
  coverLogoTop: 4,
  /** The cover's umbrella: its measure (`.fwp-cover-umbrella` max-width) and the room the dark band gives it under the lockup and the tagline (four lines of 32/1.18, 151, kept with air). */
  coverUmbrellaWidth: 640,
  coverUmbrellaRoom: 160,
  /** The house's umbrella bar: the room for its text, three lines of 19/1.4 (79.8), kept whole. */
  houseUmbrellaRoom: 84,
  /** A goal page: the lead's gap between the number and the value (`.fwp-goal-lead`), the number's width (`.fwp-goal-number`), the value block's top padding (`.fwp-goal-vp-block`); the key bar's padding down (24 + 24) and across (28 + 28), its gap and about how wide its "Key message" label sets (`.fwp-goal-key`, `.fwp-goal-key-label`); the proof list's margin under its eyebrow (`.fwp-proof-list`); the sound bite's margin (`.fwp-goal-bite-text`). */
  goalLeadGap: 28,
  goalNumberWidth: 150,
  goalValueTop: 12,
  goalKeyPaddingDown: 48,
  goalKeyPaddingAcross: 56,
  goalKeyGap: 22,
  goalKeyLabel: 90,
  proofListTop: 6,
  goalBiteTop: 10,
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
  /** The grammar's `.pp-chip`: its type size, its padding and border across (7 + 7 + 1 + 1) and down (3 + 3 + 1 + 1), and `.fwp-icp-chips`' gap between tags. */
  chipSize: 8.5,
  chipPadding: 16,
  chipVertical: 8,
  chipGap: 4,
  /** A profile card: its hairline and padding (1 + 20 + 28); the gap between its two columns; the chips line's margin above and its height (8.5 px type on one line, 3 + 3 padding, 2 border); the who text's and the personas' margins above; a field's gap under its eyebrow; the fields grid's row and column gaps; the proof list's margin above; the least room every card keeps above the footer rule (the harness's A4 finding: ≥ 4 px, so a 0.974 scale cannot cross it); the matrix's note margin, its table margin, its head row (6 + 6 padding, 1 rule, two lines of 9.5 type) and a cell row (9 + 9 padding, 1 hairline). */
  icpRow: 49,
  icpColumnGap: 24,
  icpChipsTop: 8,
  icpChipLine: 16.5,
  icpWhoTextTop: 10,
  icpPersonasTop: 8,
  icpFieldGap: 4,
  icpGridRowGap: 18,
  icpGridColumnGap: 20,
  icpProofsTop: 4,
  icpFooterRoom: 4,
  matrixNoteTop: 4,
  matrixTableTop: 12,
  matrixHeadRow: 13,
  matrixCellRow: 19,
  /** The lines a goal's title has in the matrix's head row (the board's two): a longer title is fitted into them, smaller first, then cut. */
  matrixGoalLines: 2,
  /** The least size a matrix head title prints at, px: under it the strip is too narrow for the titles and the matrix breaks into bands (frameworkPortraitMatrixColumns). */
  matrixTitleMin: 9,
  /** The board's column count, the bands' width when the matrix breaks, and `.fwp-matrix-band + .fwp-matrix-band`'s gap, px. */
  matrixBandColumns: 4,
  matrixBandGap: 16,
  /** The lines a value proposition and a key message clamp to in a band (the editor's W1, 7 Nov 2026): cut at a word past them, never set smaller. */
  matrixBandLines: 2,
  /** The message house: the umbrella bar's padding (24 + 24) and its padding across (28 + 28); the brand line's margins (14 + 22); the pillars' gap; a pillar's rule and padding (3 + 12), its message's margin above, its proof list's margin above, a proof row's hairline and padding (1 + 16) and its source chip's line (4 + 16.5); the gap the lower blocks keep under the pillars and the least room they keep above the footer (the pillars' proofs are cut to leave it); the Why now column and the audiences column and its left; the Why now text's margin above; the audience list's margin above and a row's hairline and padding (1 + 14; tight 1 + 10). */
  houseUmbrellaPadding: 48,
  houseUmbrellaPaddingAcross: 56,
  houseLineMargins: 36,
  pillarGap: 20,
  pillarTop: 15,
  pillarMessageTop: 8,
  pillarProofsTop: 12,
  pillarProofRow: 17,
  /** `.fwp-pillar-source`'s margin above the chip (the chip's own height is measured, frameworkPortraitChipHeight). */
  pillarProofChipTop: 4,
  houseLowerGap: 32,
  houseLowerMin: 80,
  whyNowColumn: 300,
  audiencesColumn: 360,
  audiencesLeft: 344,
  whyNowTextTop: 8,
  audienceListTop: 4,
  audienceRow: 15,
  audienceRowTight: 11,
  /** The statement cards: the gap between them, their padding across (16 + 16), the tagline's rule and its padding (3 + 10). */
  statementGap: 12,
  statementPadding: 32,
  taglineInset: 13,
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
  /** The avoid list: a row's padding (10 + 10; tight 7 + 7) and hairline, the gaps around its arrow (12 + 12) and the arrow's own width. */
  avoidRow: 21,
  avoidRowTight: 15,
  avoidArrow: 34,
  /** The anchor list: its margin above, a row's padding (16 + 16) and hairline, its number column and the gap after it. The crosscut box: its padding down (18 + 18) and across (22 + 22), its text's margin above. */
  anchorListTop: 10,
  anchorRow: 33,
  anchorNumber: 44,
  anchorGap: 22,
  crosscutPadding: 36,
  crosscutPaddingAcross: 44,
  crosscutTextTop: 8,
  /** The sources page's lists: the indent their bullets take (`.fwp-source-list`'s padding-left, the design's 16), off the rows' measured width. */
  sourceBullet: 16,
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

/**
 * The caption lines under the goal matrix's bands when a row is dropped so the matrix stays one page (the editor's W1,
 * 7 Nov 2026): the sound-bite row when the bites cannot print whole, then the value-proposition row (frameworkPortraitMatrix).
 */
export const FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES = {
  bites: 'Sound bites are on each goal page',
  values: 'Value propositions are in LFX One',
} as const;

/** A count in words for the print's sentences, up to the anchor questions' limit (FOUNDATION_MESSAGE_CONTENT_LIMITS.anchor.max); a count past it prints as digits. */
export const FOUNDATION_MESSAGE_PRINT_COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'] as const;

/** The on-screen Sources card's empty state for the gaps, printed verbatim on the Sources & gaps page. */
export const FOUNDATION_MESSAGE_PRINT_NO_GAP_MESSAGE = 'The sources left no gap.';

/** The source types a run writes before a source (`Website: https://…`); the Sources & gaps page prints the source without the type. */
export const FOUNDATION_MESSAGE_PRINT_SOURCE_TYPES = ['Website', 'Link', 'Press release'] as const;

/**
 * The one line under a cut list, everywhere a framework print cuts one (the
 * matrix's and a goal's proofs, the house's audiences, the sources, the family
 * chapter): `+3 more in LFX One`, the editor's form (7 November 2026), set at
 * the caption size (`FRAMEWORK_PORTRAIT_TYPE.cutNote`).
 */
export const MKTG_PRINT_CUT_NOTE = { prefix: '+', suffix: ' more in LFX One' } as const;

/** The Brand Kit read as a print starts: open, nothing known yet (`MktgPrintKitRead`). */
export const MKTG_PRINT_KIT_READ_PENDING = { settled: false, kit: null, failed: false } as const;
/** A print with no kit read at all (a host that passes none): settled, the LF look. */
export const MKTG_PRINT_KIT_READ_NONE = { settled: true, kit: null, failed: false } as const;
/**
 * Why Download PDF is disabled while the project's Brand Kit is being read, or
 * after the read failed: the print never prints the LF default in either case
 * (the LF look is for a project with no kit stored), so the button says why.
 */
export const MKTG_PRINT_KIT_READ_NOTES = {
  pending: 'Reading the project’s Brand Kit…',
  failed: 'The project’s Brand Kit could not be read. Reload the page to try again.',
} as const;

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
 * sheet). `brand-kit` is the legacy landscape book. `mktg-framework` is the
 * FLOWING documents' setup (the FAQ, the boilerplates and the AEO/GEO report,
 * which run from page to page through the shared sheet) in Chromium and every
 * other non-WebKit engine: no paper size, `margin: 0`, since the browser draws
 * its header and footer (date, title, URL, page numbers) only in the page
 * margin area, so no margin is the standard way to keep them off a saved PDF,
 * and the room those documents used to take from the margin (0.55in top and
 * bottom, 0.6in at the sides) is inside them, repeated per page by their
 * table head and foot groups (lfx-mktg-print-sheet). WebKit does not repeat a
 * table's head and foot on every printed page (bug 17205, open), so in Safari
 * the flowing documents print on `mktg-framework-page-margins`, exactly the
 * margins they had before, with that in-document room collapsed under
 * `MKTG_PRINT_PAGE_MARGINS_CLASS`: the browser's header and footer stay, as
 * before, and the user unticks them in Safari's print dialog; the frame
 * restates styles.scss's named `@page mktg-framework` with those margins for
 * it (no element names that page any more: it is a shared-mechanism
 * clean-up). `mktg-portrait` is the fixed-frame portrait book
 * (`MKTG_PORTRAIT_PRINT_CLASS`: the kit's pages and the framework's, every
 * document built of `lfx-mktg-portrait-page` frames): the page box is the
 * PAPER the dialog chose (`size: auto`), with no margin in BOTH engines, since
 * each frame is the whole sheet and carries its own room. The frame is drawn
 * for US Letter (816 × 1056 px) and the grammar scales it to a narrower paper
 * itself (`_mktg-portrait.scss`: A4 zooms every frame by 210 mm / 8.5 in and
 * grows its ground to the paper's height), where a fixed `size: 8.5in 11in`
 * let Chrome scale the page box onto A4 and print its headers and footers
 * into the bands that left (the margin of 0 is what keeps them off the
 * sheet). The print frame writes the setup unnamed (WebKit) and as `@page
 * mktg-portrait`, the print's one named page, and the grammar's `.pp-page`
 * names it. Keep these in step with styles.scss and `_mktg-portrait.scss`,
 * which cannot read them.
 */
export const MKTG_PRINT_PAGE_SETUPS = {
  'brand-kit': 'size: letter landscape; margin: 0;',
  'mktg-framework': 'size: portrait; margin: 0;',
  'mktg-framework-page-margins': 'size: portrait; margin: 0.55in 0.6in;',
  'mktg-portrait': 'size: auto; margin: 0;',
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
