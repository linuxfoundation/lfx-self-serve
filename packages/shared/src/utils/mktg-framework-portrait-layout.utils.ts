// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Messaging Framework's portrait book: the lists its pages cut and the
// key numbers' pages, pure over the print view and the portrait fit model,
// so the plan (`frameworkPortraitPlan`) can count the pages the data needs
// and the component can print the same rows. The rules are the design
// reader's (7 Nov 2026): a list that will not fit its room is tightened
// first (its tight type and padding), then cut to whole rows, and a muted
// line under it says how many more there are, never a silent cut; the key
// numbers print as tiles up to FRAMEWORK_PORTRAIT_MAX_TILES by the count's
// layout, and as a table of every figure past that, continued on another
// page when a page is full, never cut.

import {
  FOUNDATION_MESSAGE_PRINT_ICPS_PER_PAGE,
  FRAMEWORK_PORTRAIT_FACT_COLUMNS,
  FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES,
  FRAMEWORK_PORTRAIT_MAX_TILES,
  FRAMEWORK_PORTRAIT_NUMBER_COLUMNS,
  FRAMEWORK_PORTRAIT_NUMBER_TILE,
  FRAMEWORK_PORTRAIT_PAGE_IDS,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_STATEMENT_SHARES,
  FRAMEWORK_PORTRAIT_TILE_SHARES,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
  MKTG_PRINT_CUT_NOTE,
  MKTG_PRINT_OBJECTION_DASH,
} from '../constants/mktg-print.constants';
import { MKTG_PORTRAIT_PAGE } from '../constants/mktg-portrait-print.constants';
import type { FoundationMessageNumberRow } from '../interfaces/foundation-message.interface';
import type {
  FoundationMessageAudienceRow,
  FoundationMessageAvoidRow,
  FoundationMessagePillarView,
  FoundationMessageProofView,
} from '../interfaces/foundation-message.interface';
import type {
  FoundationMessagePrintAnchorRow,
  FoundationMessagePrintCutList,
  FoundationMessagePrintFittedText,
  FoundationMessagePrintFittedTitle,
  FoundationMessagePrintGoal,
  FoundationMessagePrintGoalProof,
  FoundationMessagePrintHousePage,
  FoundationMessagePrintIcp,
  FoundationMessagePrintIcpPageRows,
  FoundationMessagePrintContents,
  FoundationMessagePrintContentsEntry,
  FoundationMessagePrintMatrix,
  FoundationMessagePrintMatrixBand,
  FoundationMessagePrintMatrixCell,
  FoundationMessagePrintMatrixRows,
  FoundationMessagePrintNumber,
  FoundationMessagePrintFactRow,
  FoundationMessagePrintNumbersPage,
  FoundationMessagePrintNumberTile,
  FoundationMessagePrintType,
  FoundationMessagePrintView,
} from '../interfaces/mktg-print.interface';
import type { MktgPortraitPlanPage } from '../interfaces/mktg-portrait-print.interface';
import { MKTG_PORTRAIT_FIT } from '../constants/mktg-portrait-print.constants';
import {
  mktgPortraitCharEm,
  mktgPortraitCharsPerLine,
  mktgPortraitCutText,
  mktgPortraitFitBlock,
  mktgPortraitPageNumber,
  mktgPortraitParaHeight,
  mktgPortraitTrimStopWords,
  mktgPortraitTrimTail,
  mktgPortraitWrapLines,
} from './mktg-portrait-print.utils';

const ROOM = FRAMEWORK_PORTRAIT_ROOM;
const TYPE = FRAMEWORK_PORTRAIT_TYPE;
const TOPS = FRAMEWORK_PORTRAIT_TOPS;
const PAGE = MKTG_PORTRAIT_PAGE;
const FIT = MKTG_PORTRAIT_FIT;

/**
 * The one line under a cut list, wherever the framework cuts one (the matrix's proofs, a goal's proofs, the house's
 * audiences, the sources, the family chapter): `+3 more in LFX One` (the editor's form, 7 Nov 2026, `MKTG_PRINT_CUT_NOTE`),
 * at the caption size (`TYPE.cutNote`); the grammar's `mktgPortraitMoreLine` names a noun this line does not.
 */
export function foundationMessagePrintCutNote(cut: number): string {
  return `${MKTG_PRINT_CUT_NOTE.prefix}${cut}${MKTG_PRINT_CUT_NOTE.suffix}`;
}

/** The height a wrapping source chip takes (`.pp-chip.fwp-chip-wrap`): its capitals at the chip's size on the lines its box holds, with its padding and border above and below. */
export function frameworkPortraitChipHeight(text: string, width: number): number {
  return mktgPortraitParaHeight({ text, size: ROOM.chipSize, line: 1, caps: true }, Math.min(width, ROOM.chip) - ROOM.chipPadding) + ROOM.chipVertical;
}

/** The height a text takes at a type in a column, px. */
export function frameworkPortraitTextHeight(text: string, type: FoundationMessagePrintType, width: number): number {
  return mktgPortraitParaHeight({ text, size: type.size, line: type.line, weight: type.weight }, width);
}

/** The room the muted line under a cut list takes: its gap above and one line. */
export function frameworkPortraitCutNoteHeight(): number {
  return ROOM.cutNoteGap + TYPE.cutNote.size * TYPE.cutNote.line;
}

/**
 * A list fitted to its room by the design reader's rule: every row at the normal measure when they all fit; else every
 * row at the tight measure when they all fit; else the leading whole rows that fit at the tight measure with the cut
 * note under them. Nothing is added in a cut row's place; the note's count is the rows left off.
 */
export function frameworkPortraitCutList<T>(
  rows: readonly T[],
  room: number,
  normal: (row: T) => number,
  tight: (row: T) => number,
  noteHeight = frameworkPortraitCutNoteHeight()
): FoundationMessagePrintCutList<T> {
  const total = (measure: (row: T) => number): number => rows.reduce((sum, row) => sum + measure(row), 0);
  if (total(normal) <= room) return { rows: [...rows], cut: 0, tight: false, note: '' };
  if (total(tight) <= room) return { rows: [...rows], cut: 0, tight: true, note: '' };
  const kept: T[] = [];
  let used = noteHeight;
  for (const row of rows) {
    used += tight(row);
    if (used > room) break;
    kept.push(row);
  }
  const cut = rows.length - kept.length;
  return { rows: kept, cut, tight: true, note: foundationMessagePrintCutNote(cut) };
}

/** The size at which a figure sits on one line of `width` px, stepped down from the tile figure's size in whole px, never under half of it; null when the floor does not hold it (the numbers then print as the table). */
export function frameworkPortraitFigureSize(figure: string, width: number): number | null {
  const type = TYPE.tileFigure;
  const fits = (size: number): boolean => mktgPortraitCharsPerLine(width, size, { weight: type.weight }) >= figure.length;
  let size = type.size;
  while (size > type.size / 2 && !fits(size)) size -= 1;
  return fits(size) ? size : null;
}

/**
 * The tiles for a count the tiles hold (1 to FRAMEWORK_PORTRAIT_MAX_TILES), each with its share of a row and its text fitted to the
 * tile: the figure on one line, the label in the room under it less the source pill's when the figure has a source; none past that
 * count, and none when a figure does not sit on one line at the figure's floor (the numbers then print as the table, whole).
 */
export function frameworkPortraitNumberTiles(numbers: readonly FoundationMessagePrintNumber[]): FoundationMessagePrintNumberTile[] {
  const shares: readonly number[] | undefined = FRAMEWORK_PORTRAIT_TILE_SHARES[numbers.length as keyof typeof FRAMEWORK_PORTRAIT_TILE_SHARES];
  if (!shares || numbers.length > FRAMEWORK_PORTRAIT_MAX_TILES) return [];
  const tile = FRAMEWORK_PORTRAIT_NUMBER_TILE;
  // A tile's content width: its share of the row less the gaps between tiles, less the side padding.
  const widthOf = (share: number): number => (PAGE.contentWidth - (share - 1) * tile.gap) / share - 2 * tile.paddingSide;
  const sizes = numbers.map((row, index) => frameworkPortraitFigureSize(row.number, widthOf(shares[index])));
  if (sizes.some((size) => size === null)) return [];
  return numbers.map((row, index) => {
    const share = shares[index];
    const width = widthOf(share);
    const figureSize = sizes[index] ?? TYPE.tileFigure.size;
    const pillRoom = row.source ? tile.labelGap + tile.sourceHeight : 0;
    const labelRoom = tile.height - 2 * tile.paddingTop - figureSize * TYPE.tileFigure.line - tile.labelGap - pillRoom;
    const label = mktgPortraitFitBlock({ paras: [{ text: row.label, ...TYPE.tileLabel }] }, width, labelRoom).block.paras[0];
    return { ...row, share, wide: share === 1, figureSize, labelText: label?.text ?? row.label, labelSize: label?.size ?? TYPE.tileLabel.size };
  });
}

/** The key numbers table's two cell widths at the `<colgroup>` shares, less the cells' padding. */
function numbersCellWidths(): [number, number] {
  const [figure, label] = FRAMEWORK_PORTRAIT_NUMBER_COLUMNS.map((share) => (PAGE.contentWidth * share) / 100 - ROOM.factCellPadding);
  return [figure, label];
}

/** The height of a key numbers table row at the fact type: the taller of its two cells, with the row's padding and hairline. */
function numbersRowHeight(row: FoundationMessageNumberRow, tight: boolean): number {
  const [figure, label] = numbersCellWidths();
  return (
    Math.max(frameworkPortraitTextHeight(row.number, TYPE.fact, figure), frameworkPortraitTextHeight(row.label, TYPE.fact, label)) +
    (tight ? ROOM.factRowTight : ROOM.factRow)
  );
}

/**
 * A key numbers table row that is taller than a whole page's room, cut at a sentence (then a word) in each cell until the row
 * ends inside it, at the fact type (never set smaller): the row stays one row on its page instead of running under the footer.
 * The row keeps its type and every other field it carries (a print row's source): only the two cells change.
 */
export function frameworkPortraitNumbersRowIn<T extends FoundationMessageNumberRow>(row: T, room: number): T {
  if (numbersRowHeight(row, false) <= room) return row;
  const [figure, label] = numbersCellWidths();
  // Each cell cut at a sentence (then a word) in the fit model's steps until it ends in the room the row's chrome leaves.
  const cell = (text: string, width: number): string => {
    let current = text;
    for (let guard = 0; guard < FIT.maxCuts && frameworkPortraitTextHeight(current, TYPE.fact, width) > room - ROOM.factRow; guard++) {
      const next = mktgPortraitCutText(current, Math.floor(current.length * FIT.cutShare));
      if (next === current || next.length >= current.length) break;
      current = next;
    }
    return current;
  };
  return { ...row, number: cell(row.number, figure), label: cell(row.label, label) };
}

/** The room the muted line under a cut list takes in a column `width` px wide: its gap above and its wrapped lines. */
export function frameworkPortraitCutNoteHeightIn(cut: number, width: number): number {
  return ROOM.cutNoteGap + frameworkPortraitTextHeight(foundationMessagePrintCutNote(cut), TYPE.cutNote, width);
}

/**
 * A page's title in the grammar's title room: one line at the grammar's 34 px where it fits, smaller in whole px to the fit
 * model's floor where that holds it on one line, and at the floor over the lines it needs past that, never cut; the lines
 * say how much room the page's first block must leave it. The goal pages' `Goal 2 · <title>` is the one that can run long.
 */
export function frameworkPortraitTitle(title: string): FoundationMessagePrintFittedTitle {
  const type = TYPE.pageTitle;
  const width = PAGE.contentWidth;
  const floor = Math.ceil(type.size * FIT.minScale);
  for (let size = type.size; size >= floor; size -= 1) {
    if (mktgPortraitCharsPerLine(width, size, { weight: type.weight }) >= title.length) return { text: title, size, lines: 1 };
  }
  return { text: title, size: floor, lines: mktgPortraitWrapLines(title, mktgPortraitCharsPerLine(width, floor, { weight: type.weight })) };
}

/**
 * The goal pages' titles at ONE size (the editor's rule: a reader sees one book, not a page set smaller than the last):
 * the smallest size `frameworkPortraitTitle` gives any of them, every title then set at it, with the lines it takes there.
 * One page, or none, is the plain fit.
 */
export function frameworkPortraitTitlesAtOneSize(titles: readonly string[]): FoundationMessagePrintFittedTitle[] {
  const fits = titles.map((title) => frameworkPortraitTitle(title));
  const size = Math.min(TYPE.pageTitle.size, ...fits.map((fit) => fit.size));
  const perLine = mktgPortraitCharsPerLine(PAGE.contentWidth, size, { weight: TYPE.pageTitle.weight });
  return fits.map((fit) => (fit.size === size ? fit : { text: fit.text, size, lines: mktgPortraitWrapLines(fit.text, perLine) }));
}

/** The top of a page's first block under its title: the design's body top, lower by the lines a title takes past its first. */
export function frameworkPortraitBodyTop(title: FoundationMessagePrintFittedTitle): number {
  return PAGE.bodyTop + (title.lines - 1) * title.size * TYPE.pageTitle.line;
}

/** A statement card's text width, px: the card's share of the row less the gaps, less its padding (and the tagline's rule and inset). */
export function frameworkPortraitStatementWidth(share: number, tagline = false): number {
  const shares = FRAMEWORK_PORTRAIT_STATEMENT_SHARES;
  const total = shares.vision + shares.mission + shares.positioning + shares.tagline;
  const row = PAGE.contentWidth - 3 * ROOM.statementGap;
  return (row * share) / total - ROOM.statementPadding - (tagline ? ROOM.taglineInset : 0);
}

/**
 * The tagline's size in its card: the design's 18 px where a line holds two words, else smaller in whole px, to the fit
 * model's floor, until the longest pair of neighboring words fits one line (no one-word lines, the editor's rule). A
 * tagline of one word keeps the design's size.
 */
export function frameworkPortraitTaglineSize(tagline: string, width: number): number {
  const words = tagline.split(/\s+/).filter((word) => word !== '');
  const pairs = words.slice(1).map((word, index) => words[index].length + 1 + word.length);
  const longest = pairs.length ? Math.max(...pairs) : 0;
  const type = TYPE.tagline;
  const floor = Math.ceil(type.size * FIT.minScale);
  for (let size = type.size; size > floor; size -= 1) {
    if (mktgPortraitCharsPerLine(width, size, { weight: type.weight }) >= longest) return size;
  }
  return floor;
}

/** A goal matrix column's width, px: the content width less the row's padding, the label column and the gaps, shared by the goals. */
export function frameworkPortraitMatrixColumn(goals: number): number {
  return (PAGE.contentWidth - ROOM.matrixPadding - ROOM.matrixLabelColumn - goals * ROOM.matrixGap) / Math.max(1, goals);
}

/** A text fitted into a `width` × `height` box at `type` by the portrait fit model: smaller first (to its floor), then cut at a sentence. */
function fitText(text: string, type: FoundationMessagePrintType, width: number, height: number): FoundationMessagePrintFittedText {
  const para = mktgPortraitFitBlock({ paras: [{ text, ...type }] }, width, Math.max(0, height)).block.paras[0];
  return { text: para?.text ?? text, size: para?.size ?? type.size };
}

/**
 * The one size the goal matrix's head titles print at, px: the grammar's `TYPE.matrixGoal.size`, brought down in half-px
 * steps until every title's LONGEST WORD fits the column (a word never breaks inside the head, so the fit model's
 * character measure is applied to the word, not the line), the same size for every title (the editor's rule: one size
 * across the row). It can fall under `ROOM.matrixTitleMin`: then the strip is too narrow for these titles and the
 * matrix breaks into bands (`frameworkPortraitMatrixColumns`).
 */
export function frameworkPortraitMatrixTitleSize(titles: readonly string[], column: number): number {
  const em = mktgPortraitCharEm({ weight: TYPE.matrixGoal.weight });
  const longest = titles.reduce((max, title) => Math.max(max, ...title.split(/\s+/).map((word) => word.length)), 1);
  let size = TYPE.matrixGoal.size;
  while (size > 0 && longest * size * em > column) size -= 0.5;
  return Math.max(0, size);
}

/**
 * How many columns the goal matrix's strip holds: every goal in one strip where the head titles stay readable there (at
 * `ROOM.matrixTitleMin` or above, `frameworkPortraitMatrixTitleSize`), else the board's four (`ROOM.matrixBandColumns`),
 * the goals in bands of four under each other (the editor's second shape, when wrapping cannot fit the titles). At the
 * board's count or fewer the strip IS the widest shape (a band of four would be narrower than a strip of three), so it
 * stays one strip whatever the titles.
 */
export function frameworkPortraitMatrixColumns(goals: readonly Pick<FoundationMessagePrintGoal, 't'>[]): number {
  if (goals.length <= ROOM.matrixBandColumns) return Math.max(1, goals.length);
  const titles = goals.map((goal) => goal.t);
  if (frameworkPortraitMatrixTitleSize(titles, frameworkPortraitMatrixColumn(goals.length)) >= ROOM.matrixTitleMin) return goals.length;
  return ROOM.matrixBandColumns;
}

/**
 * The framework page's goal matrix, bounded in its `room`: the goals in one strip, or in bands of the board's four
 * columns where the strip's columns cannot hold the titles (`frameworkPortraitMatrixColumns`); every head title at ONE
 * size, the largest whose longest word fits the column (`frameworkPortraitMatrixTitleSize`), floored at
 * `ROOM.matrixTitleMin`: below that floor the bands take over (at more goals than the board's four), or, at four or
 * fewer, the title prints at the floor and is cut at a word, wrapped to the board's
 * two lines (`ROOM.matrixGoalLines`) and cut at a word past them; the crosscut measured once at its type under the
 * last band. In a strip: the value, key message and sound bite rows at their type where the three leave the proofs
 * row at least its note (the muted line at the count every proof would make), else each cell fitted by the portrait
 * fit model (smaller first, then cut at a sentence) into the rows' share of the room that stays. In bands (the
 * editor's W1, 7 Nov 2026: a one-line cut loses its meaning): the value proposition and the key message at their type,
 * clamped to `ROOM.matrixBandLines` lines and cut at a word past them; the sound bites WHOLE, or, where the bands then
 * cannot hold the proofs at the tight type (every goal's first proof whole at `TYPE.matrixProofTight` beside its
 * note: a band never sets its proofs under the tight type to keep a row), the sound-bite row dropped from every band,
 * then the value-proposition row, each drop said in one caption line under the bands
 * (`FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES`), so the matrix stays one page; the key message and the proofs always print. Then each goal's proof cell a cut list in the room the
 * fitted rows leave (tightened first, then whole rows with the muted line). A proof cell never holds only the note
 * (the editor's rule): the proofs row is floored at every goal's first proof (at the fit model's floor) with the note
 * counting the rest, and a cell whose rows would all be cut keeps its first proof, set smaller in the fit model's
 * steps to the room above its note, then cut at a sentence, carrying its own size. The bands share the room equally,
 * less the crosscut, the notes and the gaps between them. `cells` and `proofs` are in the goals' order across the
 * bands; `bands` says where each starts and how many columns it is laid in; `rows` and `notes` say what was dropped.
 */
export function frameworkPortraitMatrix(goals: readonly FoundationMessagePrintGoal[], crosscut: string, room: number): FoundationMessagePrintMatrix {
  const columns = frameworkPortraitMatrixColumns(goals);
  const column = frameworkPortraitMatrixColumn(columns);
  const titleSize = Math.max(
    ROOM.matrixTitleMin,
    frameworkPortraitMatrixTitleSize(
      goals.map((goal) => goal.t),
      column
    )
  );
  const titleType: FoundationMessagePrintType = { ...TYPE.matrixGoal, size: titleSize };
  const perLine = mktgPortraitCharsPerLine(column, titleSize, { weight: titleType.weight });
  const titles: FoundationMessagePrintFittedText[] = goals.map((goal) => ({
    text: frameworkPortraitLinesCut(goal.t, perLine, ROOM.matrixGoalLines),
    size: titleSize,
  }));
  const note = crosscut ? ROOM.matrixCrosscutGap + frameworkPortraitTextHeight(crosscut, TYPE.matrixCrosscut, PAGE.contentWidth - ROOM.matrixPadding) : 0;
  const bands: FoundationMessagePrintMatrixBand[] = [];
  for (let offset = 0; offset < goals.length; offset += columns) bands.push({ offset, columns, count: Math.min(columns, goals.length - offset) });
  const banded = bands.length > 1;
  const frames = bands.map((band) =>
    frameworkPortraitMatrixBandFrame(goals.slice(band.offset, band.offset + band.count), titles.slice(band.offset, band.offset + band.count), column, banded)
  );
  // The rows the bands print (the editor's W1): every row where the bites print whole beside the proofs at the tight type; else the
  // sound-bite row dropped, then the value row too, each drop one caption line under the bands; a strip prints every row.
  const noteLine = frameworkPortraitCutNoteHeight();
  const levels: Pick<FoundationMessagePrintMatrix, 'rows' | 'notes'>[] = banded
    ? [
        { rows: { value: true, bite: true }, notes: [] },
        { rows: { value: true, bite: false }, notes: [FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.bites] },
        { rows: { value: false, bite: false }, notes: [FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.bites, FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.values] },
      ]
    : [{ rows: { value: true, bite: true }, notes: [] }];
  const roomAt = (level: Pick<FoundationMessagePrintMatrix, 'notes'>): number =>
    (room - note - level.notes.length * noteLine - (bands.length - 1) * ROOM.matrixBandGap) / Math.max(1, bands.length);
  const level = levels.find((entry) => frames.every((frame) => frame.least(entry.rows) <= roomAt(entry))) ?? levels[levels.length - 1];
  const bandRoom = roomAt(level);
  const cells: FoundationMessagePrintMatrixCell[] = [];
  const proofs: FoundationMessagePrintCutList<FoundationMessagePrintGoalProof>[] = [];
  let height = note + level.notes.length * noteLine + (bands.length - 1) * ROOM.matrixBandGap;
  for (const frame of frames) {
    const laid = frameworkPortraitMatrixBand(frame, bandRoom, level.rows);
    cells.push(...laid.cells);
    proofs.push(...laid.proofs);
    height += laid.height;
  }
  return { cells, proofs, bands, height, rows: level.rows, notes: level.notes };
}

/**
 * A text cut at a word to `lines` lines of `perLine` characters, with an ellipsis whenever a word is dropped (the words wrap as the
 * fit model wraps them, so a cut title's line count is the one the head row measures); a text that fits is returned as it is. A
 * word longer than a line (the head never breaks a word, so it would overflow its column) is cut inside itself to the line with
 * the ellipsis first.
 */
function frameworkPortraitLinesCut(text: string, perLine: number, lines: number): string {
  const whole = text
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => (word.length > perLine ? `${word.slice(0, Math.max(1, perLine - 1))}…` : word))
    .join(' ');
  if (mktgPortraitWrapLines(whole, perLine) <= lines) return whole;
  const words = whole.split(' ');
  for (let keep = words.length - 1; keep > 0; keep -= 1) {
    const cut = `${mktgPortraitTrimTail(mktgPortraitTrimStopWords(words.slice(0, keep)).join(' '))}…`;
    if (mktgPortraitWrapLines(cut, perLine) <= lines) return cut;
  }
  return `${words[0]?.slice(0, Math.max(1, perLine - 1)) ?? ''}…`;
}

/** The tallest of some heights, 0 when there are none. */
function tallest(heights: readonly number[]): number {
  return heights.reduce((max, height) => Math.max(max, height), 0);
}

/** The heights of a band's three text rows, px, each the row's chrome and its tallest cell (0 for a row the band does not print). */
interface FrameworkPortraitMatrixRowHeights {
  value: number;
  key: number;
  bite: number;
}

/**
 * One band of the goal matrix before its room is known (`frameworkPortraitMatrix`): its goals, its measures, its head row's
 * height, the proofs row's least (every goal's first proof at the fit model's floor beside its note, never only the note),
 * its text cells as the shape sets them (in bands clamped to `ROOM.matrixBandLines` lines at their type, the bites whole; in a
 * strip at their type, to be fitted into the room that stays), and what the band needs to print a set of rows with its proofs
 * at the tight type (every goal's first proof whole at `TYPE.matrixProofTight` beside its note).
 */
interface FrameworkPortraitMatrixBandFrame {
  goals: readonly FoundationMessagePrintGoal[];
  titles: readonly FoundationMessagePrintFittedText[];
  column: number;
  banded: boolean;
  head: number;
  proofsLeast: number;
  cells: FoundationMessagePrintMatrixCell[];
  measure: (cells: readonly FoundationMessagePrintMatrixCell[], printed: FoundationMessagePrintMatrixRows) => FrameworkPortraitMatrixRowHeights;
  proofRow: (proof: FoundationMessagePrintGoalProof, type: FoundationMessagePrintType) => number;
  noteIn: (cut: number) => number;
  /** The height the band takes printing `printed` rows with its proofs at the tight type: its head, those rows as set, and the proofs row at every goal's first proof whole at `TYPE.matrixProofTight` beside its note (the editor's W1 d: a band drops a row before it sets its proofs smaller). */
  least: (printed: FoundationMessagePrintMatrixRows) => number;
}

/** A band's frame (`FrameworkPortraitMatrixBandFrame`): its measures and its text cells as the shape sets them, before the room is shared. */
function frameworkPortraitMatrixBandFrame(
  goals: readonly FoundationMessagePrintGoal[],
  titles: readonly FoundationMessagePrintFittedText[],
  column: number,
  banded: boolean
): FrameworkPortraitMatrixBandFrame {
  const biteWidth = column - ROOM.matrixBiteInset;
  const head =
    ROOM.matrixRow +
    TYPE.cutNote.size * TYPE.cutNote.line +
    3 +
    tallest(titles.map((title) => frameworkPortraitTextHeight(title.text, { ...TYPE.matrixGoal, size: title.size }, column)));
  const proofRow = (proof: FoundationMessagePrintGoalProof, type: FoundationMessagePrintType): number =>
    frameworkPortraitTextHeight(`${proof.fact} ${proof.source}`, { ...type, size: proof.size ?? type.size }, column) + ROOM.matrixProofGap;
  const noteIn = (cut: number): number => (cut > 0 ? frameworkPortraitCutNoteHeightIn(cut, column) : 0);
  // The proofs row keeps at least its chrome, every goal's first proof at the fit model's floor and the note counting the rest
  // (never only the note, the editor's rule): never less, whatever the text rows run to.
  const floorType: FoundationMessagePrintType = { ...TYPE.matrixProofTight, size: TYPE.matrixProofTight.size * FIT.minScale };
  const proofsLeast =
    ROOM.matrixRow + tallest(goals.map((goal) => (goal.proofRows.length ? proofRow(goal.proofRows[0], floorType) + noteIn(goal.proofRows.length - 1) : 0)));
  const quoted = (bite: string): string => `“${bite}”`;
  const measure = (cells: readonly FoundationMessagePrintMatrixCell[], printed: FoundationMessagePrintMatrixRows): FrameworkPortraitMatrixRowHeights => ({
    value: printed.value
      ? ROOM.matrixRow + tallest(cells.map((cell) => frameworkPortraitTextHeight(cell.vp.text, { ...TYPE.matrixCell, size: cell.vp.size }, column)))
      : 0,
    key: ROOM.matrixRow + tallest(cells.map((cell) => frameworkPortraitTextHeight(cell.key.text, { ...TYPE.matrixKey, size: cell.key.size }, column))),
    bite: printed.bite
      ? ROOM.matrixRow +
        tallest(
          cells.map((cell) => (cell.bite ? frameworkPortraitTextHeight(quoted(cell.bite.text), { ...TYPE.matrixBite, size: cell.bite.size }, biteWidth) : 0))
        )
      : 0,
  });
  // In bands the value and the key message clamp to the band's lines at their type, cut at a word past them (the editor's W1); in a strip
  // they are set at their type here and fitted later where the rows would crowd the proofs out.
  const clamp = (text: string, type: FoundationMessagePrintType): FoundationMessagePrintFittedText => ({
    text: banded ? frameworkPortraitLinesCut(text, mktgPortraitCharsPerLine(column, type.size, { weight: type.weight }), ROOM.matrixBandLines) : text,
    size: type.size,
  });
  const cells: FoundationMessagePrintMatrixCell[] = goals.map((goal, index) => ({
    title: titles[index],
    vp: clamp(goal.vp, TYPE.matrixCell),
    key: clamp(goal.key, TYPE.matrixKey),
    bite: goal.bite ? { text: goal.bite, size: TYPE.matrixBite.size } : null,
  }));
  // A band holds a set of rows when its proofs stay at the tight type beside them: the first proof whole, its note under it.
  const proofsTight =
    ROOM.matrixRow +
    tallest(goals.map((goal) => (goal.proofRows.length ? proofRow(goal.proofRows[0], TYPE.matrixProofTight) + noteIn(goal.proofRows.length - 1) : 0)));
  const least = (printed: FoundationMessagePrintMatrixRows): number => {
    const rows = measure(cells, printed);
    return head + rows.value + rows.key + rows.bite + proofsTight;
  };
  return { goals, titles, column, banded, head, proofsLeast, cells, measure, proofRow, noteIn, least };
}

/** One band of the goal matrix (`frameworkPortraitMatrix`): its frame's text rows (those `printed`) and proof cells fitted into `room`. */
function frameworkPortraitMatrixBand(
  frame: FrameworkPortraitMatrixBandFrame,
  room: number,
  printed: FoundationMessagePrintMatrixRows
): { cells: FoundationMessagePrintMatrixCell[]; proofs: FoundationMessagePrintCutList<FoundationMessagePrintGoalProof>[]; height: number } {
  const { goals, titles, column, head, proofsLeast, measure, proofRow, noteIn } = frame;
  const biteWidth = column - ROOM.matrixBiteInset;
  let cells = frame.cells;
  let rows = measure(cells, printed);
  const textRoom = room - head - proofsLeast;
  const natural = rows.value + rows.key + rows.bite;
  if (!frame.banded && natural > textRoom) {
    // A strip: each row's text gets its share of the room that stays, by its natural height; the cells are fitted into it.
    const chrome = 3 * ROOM.matrixRow;
    const share = (height: number): number => ((textRoom - chrome) * (height - ROOM.matrixRow)) / Math.max(1, natural - chrome);
    const valueRoom = share(rows.value);
    const keyRoom = share(rows.key);
    const biteRoom = share(rows.bite);
    cells = goals.map((goal, index) => ({
      title: titles[index],
      vp: fitText(goal.vp, TYPE.matrixCell, column, valueRoom),
      key: fitText(goal.key, TYPE.matrixKey, column, keyRoom),
      bite: goal.bite
        ? fitText(goal.bite, TYPE.matrixBite, biteWidth - 2 * TYPE.matrixBite.size * mktgPortraitCharEm({ weight: TYPE.matrixBite.weight }), biteRoom)
        : null,
    }));
    rows = measure(cells, printed);
  }
  const proofsRoom = Math.max(proofsLeast - ROOM.matrixRow, room - head - ROOM.matrixRow - rows.value - rows.key - rows.bite);
  const proofs = goals.map((goal): FoundationMessagePrintCutList<FoundationMessagePrintGoalProof> => {
    const list = frameworkPortraitCutList(
      goal.proofRows,
      proofsRoom,
      (proof) => proofRow(proof, TYPE.matrixProof),
      (proof) => proofRow(proof, TYPE.matrixProofTight),
      frameworkPortraitCutNoteHeightIn(1, column)
    );
    if (list.rows.length > 0 || goal.proofRows.length === 0) return list;
    // Every row would be cut: the first proof stays, set smaller in the fit model's steps to the room above the note, then cut at a sentence.
    const [first] = goal.proofRows;
    const cut = goal.proofRows.length - 1;
    const firstRoom = proofsRoom - noteIn(cut);
    const fits = (proof: FoundationMessagePrintGoalProof): boolean => proofRow(proof, TYPE.matrixProofTight) <= firstRoom;
    let kept: FoundationMessagePrintGoalProof = { ...first, size: TYPE.matrixProofTight.size };
    for (let step = 1; !fits(kept); step += 1) {
      const scale = Math.round((1 - step * FIT.scaleStep) * 100) / 100;
      if (scale < FIT.minScale - 1e-9) break;
      kept = { ...first, size: TYPE.matrixProofTight.size * scale };
    }
    for (let guard = 0; guard < FIT.maxCuts && !fits(kept); guard++) {
      const fact = mktgPortraitCutText(kept.fact, Math.floor(kept.fact.length * FIT.cutShare));
      if (fact === kept.fact || fact.length >= kept.fact.length) break;
      kept = { ...kept, fact };
    }
    return { rows: [kept], cut, tight: true, note: foundationMessagePrintCutNote(cut) };
  });
  // One size across the proof row (the editor's W4, as the titles): the smallest any cell needed, every cell then re-cut at it, so
  // no cell prints smaller than its neighbors; a cell re-cut smaller keeps at least the rows it had.
  const rowSize = frameworkPortraitMatrixProofRowSize(proofs);
  const unified =
    rowSize === TYPE.matrixProof.size
      ? proofs
      : goals.map((goal) => frameworkPortraitMatrixProofsAt(goal.proofRows, rowSize, proofsRoom, column, proofRow, noteIn));
  const proofsHeight =
    ROOM.matrixRow +
    tallest(
      unified.map(
        (cell) =>
          cell.rows.reduce((sum, proof) => sum + proofRow(proof, cell.tight ? TYPE.matrixProofTight : TYPE.matrixProof), 0) +
          (cell.cut > 0 ? frameworkPortraitCutNoteHeightIn(cell.cut, column) : 0)
      )
    );
  return { cells, proofs: unified, height: head + rows.value + rows.key + rows.bite + proofsHeight };
}

/**
 * The one size a goal matrix's proof row prints at (the editor's W4, 7 Nov 2026: one size per row, as the titles): the type's where
 * every cell printed at it, else the tight type's, else the smallest a kept first proof fell to (editor F3); a cell with no proofs
 * says nothing.
 */
export function frameworkPortraitMatrixProofRowSize(cells: readonly FoundationMessagePrintCutList<FoundationMessagePrintGoalProof>[]): number {
  return cells.reduce((size: number, cell) => {
    if (cell.rows.length === 0) return size;
    const own = cell.tight ? Math.min(...cell.rows.map((row) => row.size ?? TYPE.matrixProofTight.size)) : TYPE.matrixProof.size;
    return Math.min(size, own);
  }, TYPE.matrixProof.size);
}

/**
 * A goal's proof cell re-cut at the row's one `size` (under the type's): the whole rows that fit the room beside the note, every row
 * carrying the size where it is under the tight type's (the tight type's is the cell's class); a cell none of whose rows fit keeps
 * its first proof at that size, cut at a sentence to the room above its note (editor F3), never only the note.
 */
function frameworkPortraitMatrixProofsAt(
  rows: readonly FoundationMessagePrintGoalProof[],
  size: number,
  room: number,
  column: number,
  proofRow: (proof: FoundationMessagePrintGoalProof, type: FoundationMessagePrintType) => number,
  noteIn: (cut: number) => number
): FoundationMessagePrintCutList<FoundationMessagePrintGoalProof> {
  if (rows.length === 0) return { rows: [], cut: 0, tight: false, note: '' };
  const type: FoundationMessagePrintType = { ...TYPE.matrixProofTight, size };
  const at = (proof: FoundationMessagePrintGoalProof): FoundationMessagePrintGoalProof => (size < TYPE.matrixProofTight.size ? { ...proof, size } : proof);
  const measure = (proof: FoundationMessagePrintGoalProof): number => proofRow(proof, type);
  const list = frameworkPortraitCutList(rows.map(at), room, measure, measure, frameworkPortraitCutNoteHeightIn(1, column));
  if (list.rows.length > 0) return { ...list, tight: true };
  const cut = rows.length - 1;
  const firstRoom = room - noteIn(cut);
  let kept = at(rows[0]);
  for (let guard = 0; guard < FIT.maxCuts && measure(kept) > firstRoom; guard++) {
    const fact = mktgPortraitCutText(kept.fact, Math.floor(kept.fact.length * FIT.cutShare));
    if (fact === kept.fact || fact.length >= kept.fact.length) break;
    kept = { ...kept, fact };
  }
  return { rows: [kept], cut, tight: true, note: foundationMessagePrintCutNote(cut) };
}

/** The room the cover's contents list has, px: from its eyebrow's top to the cover strip, less the eyebrow and the list's margin. */
export function frameworkPortraitContentsRoom(): number {
  return TOPS.coverStrip - TOPS.coverContents - ROOM.label - ROOM.contentsTop;
}

/** The width a contents row's title has, px: a column of the list (the content width less the gap, halved) less the page number's. */
export function frameworkPortraitContentsTitleWidth(): number {
  return (PAGE.contentWidth - ROOM.contentsColumnGap * (ROOM.contentsColumns - 1)) / ROOM.contentsColumns - ROOM.contentsNumber;
}

/** The height a contents list of `count` rows takes in its columns at the normal or the tight measure: one line a row (the titles are set one line, `frameworkPortraitContents`), the rows split across the columns. */
export function frameworkPortraitContentsHeight(count: number, tight: boolean): number {
  const type = tight ? TYPE.contentsRowTight : TYPE.contentsRow;
  const row = type.size * type.line + (tight ? ROOM.contentsRowTight : ROOM.contentsRow);
  return Math.ceil(count / ROOM.contentsColumns) * row;
}

/** The run a planned page belongs to (`goal`, `icps`, `key-numbers`) when its id is one of a numbered series, else null. */
function contentsRunOf(id: string): string | null {
  const match = /^(goal|icps|key-numbers)-\d+$/.exec(id);
  if (match) return match[1];
  return id === FRAMEWORK_PORTRAIT_PAGE_IDS.keyNumbers ? 'key-numbers' : null;
}

/**
 * A text cut to one line `width` px wide at `size` px, at a word, always ending in an ellipsis when it drops anything
 * (never a sentence cut: a contents title is a name, and its reader must see that it goes on). The kept words lose
 * the function word they would end on and the punctuation before the mark (the grammar's rules). Unchanged when it fits.
 */
export function frameworkPortraitWordCut(text: string, width: number, size: number, weight?: number): string {
  const max = mktgPortraitCharsPerLine(width, size, { weight });
  if (text.length <= max) return text;
  const words: string[] = [];
  let length = 0;
  for (const word of text.split(/\s+/)) {
    const next = length === 0 ? word.length : length + 1 + word.length;
    if (next + 1 > max) break;
    words.push(word);
    length = next;
  }
  const kept = mktgPortraitTrimStopWords(words).join(' ');
  return `${mktgPortraitTrimTail(kept || text.slice(0, Math.max(1, max - 1)))}…`;
}

/**
 * The cover's contents, bounded in the room above the cover strip (the design reader's list rule): every page after the
 * cover, one row each, its title set on one line (the board's row; a title longer than the row's measure is cut at a
 * word with an ellipsis, `frameworkPortraitWordCut`) at the design's measure where the rows fit; tightened where they do not;
 * and where the tight rows still run past the strip, each run of repeated pages (the goals, the profiles, a continued
 * key-numbers table) collapsed to ONE row with its page range (`Goals 1–8 · 03–10`), so every page stays listed and
 * nothing is dropped. A provisional call: the design's board shows the short book only.
 */
export function frameworkPortraitContents(plan: readonly MktgPortraitPlanPage[], firstPage: number): FoundationMessagePrintContents {
  const entries = plan
    .map((page, index) => ({ id: page.id, title: page.title, number: firstPage + index, numberLabel: mktgPortraitPageNumber(firstPage + index) }))
    .filter((entry) => entry.id !== FRAMEWORK_PORTRAIT_PAGE_IDS.cover);
  const room = frameworkPortraitContentsRoom();
  const width = frameworkPortraitContentsTitleWidth();
  const oneLine = (list: readonly FoundationMessagePrintContentsEntry[], tight: boolean): FoundationMessagePrintContentsEntry[] => {
    const type = tight ? TYPE.contentsRowTight : TYPE.contentsRow;
    return list.map((entry) => ({ ...entry, title: frameworkPortraitWordCut(entry.title, width, type.size, type.weight) }));
  };
  if (frameworkPortraitContentsHeight(entries.length, false) <= room) return { rows: oneLine(entries, false), tight: false, collapsed: false };
  if (frameworkPortraitContentsHeight(entries.length, true) <= room) return { rows: oneLine(entries, true), tight: true, collapsed: false };
  const rows: FoundationMessagePrintContentsEntry[] = [];
  for (const entry of entries) {
    const run = contentsRunOf(entry.id);
    const last = rows[rows.length - 1];
    if (run && last && contentsRunOf(last.id) === run) {
      const first = last.number;
      const title = run === 'goal' ? `Goals 1–${entry.number - first + 1}` : last.title.replace(/ \(\d+\)$/, '');
      rows[rows.length - 1] = { ...last, title, numberLabel: `${mktgPortraitPageNumber(first)}–${entry.numberLabel}` };
    } else {
      rows.push(entry);
    }
  }
  const tight = frameworkPortraitContentsHeight(rows.length, false) > room;
  return { rows: oneLine(rows, tight), tight, collapsed: true };
}

/** The width a say pill takes, px: its text at the pill's type plus its padding and border, at the normal or the tight measure. */
export function frameworkPortraitPillWidth(text: string, tight: boolean): number {
  const type = tight ? TYPE.sayPillTight : TYPE.sayPill;
  return (
    Math.ceil(text.length * type.size * mktgPortraitCharEm({ weight: type.weight })) + (tight ? ROOM.sayPillPaddingAcrossTight : ROOM.sayPillPaddingAcross)
  );
}

/** The height a row of pills wraps to in a column `width` px wide: the pills packed greedily, a line's height each row, the gap between rows. */
export function frameworkPortraitPillsHeight(pills: readonly string[], width: number, tight: boolean): number {
  if (pills.length === 0) return 0;
  const type = tight ? TYPE.sayPillTight : TYPE.sayPill;
  const line = type.size * type.line + (tight ? ROOM.sayPillPaddingTight : ROOM.sayPillPadding);
  let rows = 1;
  let used = 0;
  for (const pill of pills) {
    const pillWidth = Math.min(width, frameworkPortraitPillWidth(pill, tight));
    if (used > 0 && used + ROOM.sayPillGap + pillWidth > width) {
      rows += 1;
      used = pillWidth;
    } else {
      used += (used > 0 ? ROOM.sayPillGap : 0) + pillWidth;
    }
  }
  return rows * line + (rows - 1) * ROOM.sayPillGap;
}

/**
 * The say pills fitted to their column by the design reader's rule: every pill at the normal measure when the rows fit; else
 * every pill at the tight measure; else the leading pills that fit at the tight measure with the muted line under them.
 */
export function frameworkPortraitPillList(pills: readonly string[], width: number, room: number): FoundationMessagePrintCutList<string> {
  if (frameworkPortraitPillsHeight(pills, width, false) <= room) return { rows: [...pills], cut: 0, tight: false, note: '' };
  if (frameworkPortraitPillsHeight(pills, width, true) <= room) return { rows: [...pills], cut: 0, tight: true, note: '' };
  let kept = pills.length - 1;
  while (kept > 0 && frameworkPortraitPillsHeight(pills.slice(0, kept), width, true) + frameworkPortraitCutNoteHeightIn(pills.length - kept, width) > room)
    kept -= 1;
  const cut = pills.length - kept;
  return { rows: pills.slice(0, kept), cut, tight: true, note: foundationMessagePrintCutNote(cut) };
}

/** The height an avoid row takes: the taller of its two cells (each half the column less the arrow), the row's padding and hairline. */
export function frameworkPortraitAvoidRowHeight(row: FoundationMessageAvoidRow, width: number, tight: boolean): number {
  const type = tight ? TYPE.avoidRowTight : TYPE.avoidRow;
  const cell = (width - ROOM.avoidArrow) / 2;
  return (
    Math.max(frameworkPortraitTextHeight(row.avoid, type, cell), frameworkPortraitTextHeight(row.instead, type, cell)) +
    (tight ? ROOM.avoidRowTight : ROOM.avoidRow)
  );
}

/** The avoid rows fitted to their column: tightened first, then cut to whole rows with the muted line (the design reader's rule). */
export function frameworkPortraitAvoidList(
  rows: readonly FoundationMessageAvoidRow[],
  width: number,
  room: number
): FoundationMessagePrintCutList<FoundationMessageAvoidRow> {
  return frameworkPortraitCutList(
    rows,
    room,
    (row) => frameworkPortraitAvoidRowHeight(row, width, false),
    (row) => frameworkPortraitAvoidRowHeight(row, width, true),
    frameworkPortraitCutNoteHeightIn(1, width)
  );
}

/** The room the say and avoid lists share: from their top to the anchors' top, less the label, the list's margin and a gap. */
export function frameworkPortraitSayRoom(): number {
  return TOPS.anchors - TOPS.sayLists - ROOM.label - ROOM.sayListTop - ROOM.gap;
}

/** The height an anchor row takes at a question size: the taller of the number and the question's lines, the row's padding and hairline. */
function anchorRowHeight(question: string, size: number): number {
  const width = PAGE.contentWidth - ROOM.anchorNumber - ROOM.anchorGap;
  const questionHeight = frameworkPortraitTextHeight(question, { ...TYPE.anchorQuestion, size }, width);
  return Math.max(TYPE.anchorNumber.size * TYPE.anchorNumber.line, questionHeight) + ROOM.anchorRow;
}

/** The height of the crosscut box: its padding, the label, the text's margin and its lines. */
function crosscutHeight(crosscut: string): number {
  return (
    ROOM.crosscutPadding +
    ROOM.label +
    ROOM.crosscutTextTop +
    frameworkPortraitTextHeight(crosscut, TYPE.crosscutText, PAGE.contentWidth - ROOM.crosscutPaddingAcross)
  );
}

/**
 * The anchor questions and the crosscut box on the say-and-avoid page: the anchors never move (their top is the design's);
 * their questions are set smaller, in the fit model's steps to its floor, then cut, until the block and the crosscut box
 * under it end above the footer; the crosscut box sits at the design's top, or under the anchors when they run longer.
 */
export function frameworkPortraitAnchors(questions: readonly string[], crosscut: string): { anchors: FoundationMessagePrintAnchorRow[]; crosscutTop: number } {
  const footer = TOPS.footer;
  const listTop = TOPS.anchors + ROOM.label + ROOM.anchorListTop;
  const boxHeight = crosscut ? crosscutHeight(crosscut) + ROOM.gap : 0;
  const room = footer - listTop - boxHeight;
  const rows = (texts: readonly string[], size: number): FoundationMessagePrintAnchorRow[] =>
    texts.map((question, rank) => ({ numberLabel: mktgPortraitPageNumber(rank + 1), question, size }));
  const finish = (anchors: FoundationMessagePrintAnchorRow[]): { anchors: FoundationMessagePrintAnchorRow[]; crosscutTop: number } => {
    const bottom = listTop + anchors.reduce((sum, anchor) => sum + anchorRowHeight(anchor.question, anchor.size), 0);
    return { anchors, crosscutTop: Math.max(TOPS.sayCrosscut, bottom + ROOM.gap) };
  };
  const size = TYPE.anchorQuestion.size;
  for (let scale = 1; scale >= FIT.minScale - 1e-9; scale -= FIT.scaleStep) {
    const stepped = Math.round(size * scale * 10) / 10;
    if (questions.reduce((sum, question) => sum + anchorRowHeight(question, stepped), 0) <= room) return finish(rows(questions, stepped));
  }
  // Past the floor: the fit model takes the questions to its floor and cuts them at a sentence, in the room less the rows' own chrome.
  const chrome = questions.length * ROOM.anchorRow;
  const width = PAGE.contentWidth - ROOM.anchorNumber - ROOM.anchorGap;
  const fitted = mktgPortraitFitBlock(
    { paras: questions.map((question) => ({ text: question, size, line: TYPE.anchorQuestion.line, weight: TYPE.anchorQuestion.weight })) },
    width,
    Math.max(0, room - chrome)
  );
  return finish(fitted.block.paras.map((para, rank) => ({ numberLabel: mktgPortraitPageNumber(rank + 1), question: para.text, size: para.size })));
}

/** The height a pillar's fixed part takes in a column `width` px wide: its rule and padding, title and message. */
export function frameworkPortraitPillarHeadHeight(pillar: FoundationMessagePillarView, width: number): number {
  const message = pillar.m ? ROOM.pillarMessageTop + frameworkPortraitTextHeight(pillar.m, TYPE.pillarMessage, width) : 0;
  return ROOM.pillarTop + frameworkPortraitTextHeight(pillar.t, TYPE.pillarTitle, width) + message;
}

/** The height a pillar's proof row takes: its hairline and padding, the fact's lines, and the source chip on its own line (its margin and its measured height). */
export function frameworkPortraitPillarProofHeight(proof: FoundationMessageProofView, width: number): number {
  return (
    ROOM.pillarProofRow +
    frameworkPortraitTextHeight(proof.fact, TYPE.pillarProof, width) +
    ROOM.pillarProofChipTop +
    frameworkPortraitChipHeight(proof.source, width)
  );
}

/** The height a pillar takes with the proof rows it prints: its head, then the list's margin and the rows (and the cut's line). */
function pillarHeight(pillar: FoundationMessagePillarView, proofs: FoundationMessagePrintCutList<FoundationMessageProofView>, width: number): number {
  const rows = proofs.rows.reduce((sum, proof) => sum + frameworkPortraitPillarProofHeight(proof, width), 0);
  const note = proofs.cut > 0 ? frameworkPortraitCutNoteHeightIn(proofs.cut, width) : 0;
  return frameworkPortraitPillarHeadHeight(pillar, width) + (pillar.proofRows.length ? ROOM.pillarProofsTop + rows + note : 0);
}

/** The height an audience row takes at a measure: its name and lead as one text in the column, and the row's chrome. */
function audienceRowHeight(audience: FoundationMessageAudienceRow, type: FoundationMessagePrintType, chrome: number): number {
  return frameworkPortraitTextHeight(`${audience.name}. ${audience.lead}`, type, ROOM.audiencesColumn) + chrome;
}

/**
 * The audiences cut to the room: the list rule, and, when it would keep no row, the first audience at least (the editor's
 * read, 7 Nov 2026: a list that prints only its note leaves the block empty), set tight, its lead cut at a sentence (then
 * at a word) to the room above the note, down to its name alone.
 */
function frameworkPortraitAudiences(
  audiences: readonly FoundationMessageAudienceRow[],
  room: number
): FoundationMessagePrintCutList<FoundationMessageAudienceRow> {
  const list = frameworkPortraitCutList(
    audiences,
    room,
    (audience) => audienceRowHeight(audience, TYPE.audienceRow, ROOM.audienceRow),
    (audience) => audienceRowHeight(audience, TYPE.audienceRowTight, ROOM.audienceRowTight),
    frameworkPortraitCutNoteHeightIn(1, ROOM.audiencesColumn)
  );
  if (list.rows.length > 0 || audiences.length === 0) return list;
  const [first] = audiences;
  const cut = audiences.length - 1;
  const firstRoom = room - frameworkPortraitCutNoteHeightIn(cut, ROOM.audiencesColumn);
  const fits = (audience: FoundationMessageAudienceRow): boolean => audienceRowHeight(audience, TYPE.audienceRowTight, ROOM.audienceRowTight) <= firstRoom;
  let kept = first;
  for (let guard = 0; guard < FIT.maxCuts && kept.lead !== '' && !fits(kept); guard++) {
    const lead = kept.lead.length < FIT.minCutLength ? '' : mktgPortraitCutText(kept.lead, Math.floor(kept.lead.length * FIT.cutShare));
    kept = { ...kept, lead: lead.length < kept.lead.length ? lead : '' };
  }
  return { rows: [kept], cut, tight: true, note: foundationMessagePrintCutNote(cut) };
}

/**
 * The message house page, bounded: each pillar's proofs cut to whole rows in the room that leaves the lower blocks their
 * least (the design reader's rule; a pillar's proofs have no tight measure, so the cut is to whole rows and the muted
 * line); then Why now and the audiences a gap under the tallest pillar, where the umbrella, the brand line and the pillars
 * end (the editor's read, 7 Nov 2026: no empty band at the design's fixed 780), the Why now text at its body size, cut at
 * a sentence when the room is short (never set smaller: the editor's read of the overfull record), and the audiences cut
 * to the whole rows that end above the footer, the first kept at least.
 */
export function frameworkPortraitHouse(view: FoundationMessagePrintView, umbrella: FoundationMessagePrintFittedText): FoundationMessagePrintHousePage {
  const width = PAGE.contentWidth;
  const umbrellaHeight = umbrella.text
    ? ROOM.houseUmbrellaPadding +
      frameworkPortraitTextHeight(umbrella.text, { ...TYPE.houseUmbrella, size: umbrella.size }, width - ROOM.houseUmbrellaPaddingAcross)
    : 0;
  const line = view.mh.line ? ROOM.houseLineMargins + TYPE.houseLine.size * TYPE.houseLine.line : 0;
  const count = Math.max(1, view.pillars.length);
  const column = (width - (count - 1) * ROOM.pillarGap) / count;
  const pillarsTop = TOPS.house + umbrellaHeight + line;
  const pillarsRoom = TOPS.footer - ROOM.houseLowerMin - ROOM.houseLowerGap - pillarsTop;
  const pillars = view.pillars.map((pillar) => {
    const measure = (proof: FoundationMessageProofView): number => frameworkPortraitPillarProofHeight(proof, column);
    const room = pillarsRoom - frameworkPortraitPillarHeadHeight(pillar, column) - ROOM.pillarProofsTop;
    return frameworkPortraitCutList(pillar.proofRows, room, measure, measure, frameworkPortraitCutNoteHeightIn(1, column));
  });
  const tallest = view.pillars.reduce((max, pillar, index) => Math.max(max, pillarHeight(pillar, pillars[index], column)), 0);
  const top = pillarsTop + tallest + ROOM.houseLowerGap;
  const room = TOPS.footer - top - ROOM.label;
  const whyNow = view.mh.found
    ? mktgPortraitFitBlock({ paras: [{ text: view.mh.found, ...TYPE.whyNow }] }, ROOM.whyNowColumn, room - ROOM.whyNowTextTop, 1).block.paras[0]
    : null;
  return {
    pillars,
    lowerTop: top,
    whyNow: whyNow ? { text: whyNow.text, size: whyNow.size } : null,
    audiences: frameworkPortraitAudiences(view.audiences, room - ROOM.audienceListTop),
  };
}

/**
 * The height a profile card takes across the page, px: its hairline and padding, then the taller of its two columns, the
 * name-and-tags column (the name, the chips line, the who text, the persona rows, at the card's own who width) and the
 * fields grid (the fields the profile has, three a row, each its eyebrow and text, the channels field holding the proof
 * rows), at the fields' normal or tight measure.
 */
export function frameworkPortraitIcpHeight(icp: FoundationMessagePrintIcp, tight = false): number {
  const field = tight ? TYPE.icpFieldTight : TYPE.icpField;
  const who = icp.whoWidth;
  const whoColumn =
    frameworkPortraitTextHeight(icp.name, TYPE.icpName, who) +
    ROOM.icpChipsTop +
    ROOM.icpChipLine +
    (icp.who ? ROOM.icpWhoTextTop + frameworkPortraitTextHeight(icp.who, TYPE.icpWho, who) : 0) +
    (icp.personaLines.length
      ? ROOM.icpPersonasTop + icp.personaLines.reduce((sum, line) => sum + frameworkPortraitTextHeight(line, TYPE.icpPersona, who), 0)
      : 0);
  const column = (PAGE.contentWidth - who - ROOM.icpColumnGap - 2 * ROOM.icpGridColumnGap) / 3;
  const texts: string[] = [];
  if (icp.need) texts.push(icp.need);
  if (icp.value) texts.push(icp.value);
  if (icp.lead) texts.push(icp.lead);
  if (icp.cta) texts.push(icp.cta);
  if (icp.objectionText)
    texts.push(icp.objectionResponse ? `“${icp.objectionText}”${MKTG_PRINT_OBJECTION_DASH}${icp.objectionResponse}` : `“${icp.objectionText}”`);
  const fields = texts.map((text) => frameworkPortraitTextHeight(text, field, column));
  if (icp.channelsLabel || icp.proofRows.length > 0) {
    const proofs = icp.proofRows.reduce((sum, proof) => sum + frameworkPortraitTextHeight(`${proof.fact} ${proof.source}`, field, column), 0);
    fields.push(
      (icp.channelsLabel ? frameworkPortraitTextHeight(icp.channelsLabel, field, column) : 0) + (icp.proofRows.length ? ROOM.icpProofsTop + proofs : 0)
    );
  }
  const eyebrow = TYPE.icpEyebrow.size * TYPE.icpEyebrow.line + ROOM.icpFieldGap;
  let grid = 0;
  for (let row = 0; row < fields.length; row += 3) {
    grid += (row > 0 ? ROOM.icpGridRowGap : 0) + eyebrow + Math.max(...fields.slice(row, row + 3));
  }
  return ROOM.icpRow + Math.max(whoColumn, grid);
}

/** The room an ICP page's cards have: from the rows' top (under the long intro on the first page) to the footer rule, less the card's least room above it. */
export function frameworkPortraitIcpRoom(pageIndex: number): number {
  return TOPS.footer - ROOM.icpFooterRoom - (pageIndex === 1 ? TOPS.icpRowsFirst : TOPS.icpRows);
}

/** The texts of a profile card that may be cut when a lone card outruns its page at the tight measure, longest first. */
const ICP_CUT_FIELDS = ['who', 'need', 'value', 'lead', 'cta', 'objectionResponse'] as const;

/**
 * A lone profile that still outruns its page at the tight measure: its longest text cut at a sentence (then a word) in the
 * fit model's steps, again and again, until the card ends in the room. No stored record reaches this (the longest live card
 * is 533 px against 782 of room), but the bound holds for any.
 */
export function frameworkPortraitIcpIn(icp: FoundationMessagePrintIcp, room: number): FoundationMessagePrintIcp {
  let current = icp;
  for (let guard = 0; guard < FIT.maxCuts && frameworkPortraitIcpHeight(current, true) > room; guard++) {
    const field = ICP_CUT_FIELDS.filter((name) => current[name].length >= FIT.minCutLength).sort((a, b) => current[b].length - current[a].length)[0];
    if (!field) break;
    const text = mktgPortraitCutText(current[field], Math.floor(current[field].length * FIT.cutShare));
    if (text === current[field] || text.length >= current[field].length) break;
    current = { ...current, [field]: text };
  }
  return current;
}

/**
 * The profiles with ONE name-and-tags column width (the editor's rule, 7 Nov 2026: the fields' columns start at one x on
 * every profile page, a lone card included): the widest column any profile's tags grew to (`frameworkPortraitIcpWhoWidth`,
 * carried on each card as `whoWidth`) is set on every card, so the fields grid's left edge is the same on every row. A
 * card already at it is the same object.
 */
export function frameworkPortraitIcpsAligned(icps: readonly FoundationMessagePrintIcp[]): FoundationMessagePrintIcp[] {
  const width = Math.max(ROOM.icpWho, ...icps.map((icp) => icp.whoWidth));
  return icps.map((icp) => (icp.whoWidth === width ? icp : { ...icp, whoWidth: width }));
}

/**
 * The profiles paged in data order, two a page at most (the design), fewer where two measured cards would end past the
 * footer: a card never crosses the footer rule, so a profile that would moves whole to the next page (the harness's A4
 * finding: the last line crossed it). A card alone that outruns its page sets its fields at the tight measure, and past
 * that has its longest texts cut until it ends in the room (frameworkPortraitIcpIn). Every card takes the book's one
 * name-and-tags column width first (frameworkPortraitIcpsAligned), so the cards are measured as they print.
 */
export function frameworkPortraitIcpPages(icps: readonly FoundationMessagePrintIcp[]): FoundationMessagePrintIcpPageRows[] {
  const pages: FoundationMessagePrintIcpPageRows[] = [];
  for (const icp of frameworkPortraitIcpsAligned(icps)) {
    const height = frameworkPortraitIcpHeight(icp);
    const last = pages[pages.length - 1];
    if (last && !last.tight && last.icps.length < FOUNDATION_MESSAGE_PRINT_ICPS_PER_PAGE && last.height + height <= frameworkPortraitIcpRoom(pages.length)) {
      last.icps.push(icp);
      last.height += height;
      continue;
    }
    const room = frameworkPortraitIcpRoom(pages.length + 1);
    const tight = height > room;
    const fitted = tight ? frameworkPortraitIcpIn(icp, room) : icp;
    pages.push({ icps: [fitted], tight, cut: fitted !== icp, height: tight ? frameworkPortraitIcpHeight(fitted, true) : height });
  }
  return pages;
}

/** How many "Who it's for" cards a goal page's row holds at the board's narrowest card (ROOM.servedCardMin) with the row's gaps: four across the page. */
export function frameworkPortraitServedCount(width: number = PAGE.contentWidth): number {
  return Math.max(1, Math.floor((width + ROOM.servedGap) / (ROOM.servedCardMin + ROOM.servedGap)));
}

/** The height the goals × profiles matrix takes under a lone card: its label, note, head row and one cell row per profile. */
export function frameworkPortraitIcpMatrixHeight(rows: number): number {
  return (
    ROOM.label +
    ROOM.matrixNoteTop +
    TYPE.matrixNote.size * TYPE.matrixNote.line +
    ROOM.matrixTableTop +
    ROOM.matrixHeadRow +
    2 * TYPE.matrixHead.size * TYPE.matrixHead.line +
    rows * (ROOM.matrixCellRow + TYPE.matrixCellText.size * TYPE.matrixCellText.line)
  );
}

/** The width a chip takes, px: its text in the grammar's capitals at `.pp-chip`'s size, plus its padding and border. */
export function frameworkPortraitChipWidth(text: string): number {
  return Math.ceil(text.trim().length * ROOM.chipSize * mktgPortraitCharEm({ caps: true })) + ROOM.chipPadding;
}

/**
 * The width of a profile's name-and-tags column, px: the board's 190, grown to hold the kind and goal tags on one line (they never
 * wrap, the editor's rule), to a cap that leaves the fields their three columns.
 */
export function frameworkPortraitIcpWhoWidth(chips: readonly string[]): number {
  const tags = chips.reduce((width, chip) => width + frameworkPortraitChipWidth(chip), 0) + Math.max(0, chips.length - 1) * ROOM.chipGap;
  return Math.min(ROOM.icpWhoMax, Math.max(ROOM.icpWho, tags));
}

/** The height of a facts table row: the tallest of its three cells at the `<colgroup>` widths (the source as the wrapping chip it prints as), with the row's padding and hairline. */
export function frameworkPortraitFactRowHeight(fact: FoundationMessagePrintFactRow, tight: boolean): number {
  const [factWidth, sourceWidth, usedWidth] = FRAMEWORK_PORTRAIT_FACT_COLUMNS.map((share) => (PAGE.contentWidth * share) / 100 - ROOM.factCellPadding);
  return (
    Math.max(
      frameworkPortraitTextHeight(fact.fact, TYPE.fact, factWidth),
      frameworkPortraitChipHeight(fact.source, sourceWidth),
      frameworkPortraitTextHeight(fact.usedBy, TYPE.fact, usedWidth)
    ) + (tight ? ROOM.factRowTight : ROOM.factRow)
  );
}

/** Whether a printed source label is LFX's (the project record, LFX Insights), whose figures the "as of" date dates. */
export function frameworkPortraitLfxSourced(source: string): boolean {
  return /\bLFX\b/.test(source);
}

/** The rows of tiles a count takes (each FRAMEWORK_PORTRAIT_NUMBER_TILE.height high). */
function tileRows(tiles: readonly FoundationMessagePrintNumberTile[]): number {
  return Math.ceil(tiles.reduce((sum, tile) => sum + 1 / tile.share, 0) - 1e-9);
}

/**
 * The key numbers pages the data needs, laid out: page 1 with the intro and the tiles (when the count allows them) or
 * the start of the key numbers table; more pages while table rows remain; the facts table on the last page in the room
 * left (on a page of its own when none is left), cut by the rule. At least one page, even with no figure.
 */
export function frameworkPortraitNumbersPages(view: FoundationMessagePrintView): FoundationMessagePrintNumbersPage[] {
  const tile = FRAMEWORK_PORTRAIT_NUMBER_TILE;
  const tops = FRAMEWORK_PORTRAIT_TOPS;
  const date = view.dateReadLabel;
  // The "as of" sentence is the LFX figures': it prints only when a figure on these pages (a key number, a fact) is LFX-sourced (editor S-c).
  const lfxFigures = [...view.numbers, ...view.facts].some((row) => frameworkPortraitLfxSourced(row.source));
  const intro = `The figures the framework leans on, with where each came from.${date && lfxFigures ? ` LFX figures are as of ${date}.` : ''}`;
  const tiles = frameworkPortraitNumberTiles(view.numbers);
  const tableRows = tiles.length ? [] : [...view.numbers];
  const noFacts: FoundationMessagePrintCutList<FoundationMessagePrintFactRow> = { rows: [], cut: 0, tight: false, note: '' };
  const pages: FoundationMessagePrintNumbersPage[] = [];
  // Page 1's content starts at the tiles' top; the tiles, when any, leave the facts their gap under the rows.
  let cursor: number = tile.top;
  if (tiles.length) {
    const rows = tileRows(tiles);
    cursor = tile.top + rows * tile.height + Math.max(0, rows - 1) * tile.gap + tile.tableGap;
  }
  let remaining = tableRows;
  for (;;) {
    const index = pages.length + 1;
    const numbersTop = index === 1 ? tile.top : tops.numbersContinued;
    if (index > 1) cursor = numbersTop;
    const page: FoundationMessagePrintNumbersPage = {
      index,
      intro: index === 1 ? intro : '',
      tiles: index === 1 ? tiles : [],
      numbersTable: [],
      numbersTop,
      factsTop: null,
      facts: noFacts,
    };
    if (remaining.length) {
      // The key numbers table: whole rows down to the footer, the rest on the next page; never cut, save a row taller than a
      // whole page, cut inside it. A fresh page always keeps at least one row (K's paginate rule), so the loop moves on.
      let used = cursor + ROOM.label + ROOM.tableHead;
      const kept: FoundationMessageNumberRow[] = [];
      for (const row of remaining) {
        const height = numbersRowHeight(row, false);
        if (kept.length > 0 && used + height > tops.footer) break;
        // A first row taller than the page's whole room is cut in its cells to end inside it (frameworkPortraitNumbersRowIn).
        const fitted = frameworkPortraitNumbersRowIn(row, tops.footer - used);
        used += numbersRowHeight(fitted, false);
        kept.push(fitted);
      }
      page.numbersTable = kept;
      remaining = remaining.slice(kept.length);
      cursor = used + tile.tableGap;
      if (remaining.length) {
        pages.push(page);
        continue;
      }
    }
    // The facts table, in the room left on this page: at least its head, one tight row and the cut note's room, else on a page of its own.
    const factsRoom = tops.footer - cursor - ROOM.label - ROOM.tableHead;
    const firstRow = view.facts[0] ? frameworkPortraitFactRowHeight(view.facts[0], true) + frameworkPortraitCutNoteHeight() : 0;
    if (view.facts.length && factsRoom < firstRow && (page.numbersTable.length || page.tiles.length)) {
      pages.push(page);
      cursor = tops.numbersContinued;
      pages.push({
        index: index + 1,
        intro: '',
        tiles: [],
        numbersTable: [],
        numbersTop: tops.numbersContinued,
        factsTop: tops.numbersContinued,
        facts: frameworkPortraitCutList(
          view.facts,
          tops.footer - tops.numbersContinued - ROOM.label - ROOM.tableHead,
          (fact) => frameworkPortraitFactRowHeight(fact, false),
          (fact) => frameworkPortraitFactRowHeight(fact, true)
        ),
      });
      return pages;
    }
    // No fact (a record whose goals state no proof): no "Figures and their sources" heading over an empty table.
    page.factsTop = view.facts.length ? cursor : null;
    page.facts = frameworkPortraitCutList(
      view.facts,
      factsRoom,
      (fact) => frameworkPortraitFactRowHeight(fact, false),
      (fact) => frameworkPortraitFactRowHeight(fact, true)
    );
    pages.push(page);
    return pages;
  }
}
