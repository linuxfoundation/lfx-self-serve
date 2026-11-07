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
  FRAMEWORK_PORTRAIT_FACT_COLUMNS,
  FRAMEWORK_PORTRAIT_MAX_TILES,
  FRAMEWORK_PORTRAIT_NUMBER_COLUMNS,
  FRAMEWORK_PORTRAIT_NUMBER_TILE,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_TILE_SHARES,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
} from '../constants/mktg-print.constants';
import { MKTG_PORTRAIT_PAGE } from '../constants/mktg-portrait-print.constants';
import type { FoundationMessageNumberRow } from '../interfaces/foundation-message.interface';
import type {
  FoundationMessagePrintCutList,
  FoundationMessagePrintCutTab,
  FoundationMessagePrintNumber,
  FoundationMessagePrintFactRow,
  FoundationMessagePrintNumbersPage,
  FoundationMessagePrintNumberTile,
  FoundationMessagePrintType,
  FoundationMessagePrintView,
} from '../interfaces/mktg-print.interface';
import { mktgPortraitCharEm, mktgPortraitCharsPerLine, mktgPortraitFitBlock, mktgPortraitParaHeight } from './mktg-portrait-print.utils';

const ROOM = FRAMEWORK_PORTRAIT_ROOM;
const TYPE = FRAMEWORK_PORTRAIT_TYPE;
const PAGE = MKTG_PORTRAIT_PAGE;

/** The line under a cut list: `+3 more on the framework's Sources tab in LFX One` (the design reader's form, 7 Nov 2026). */
export function foundationMessagePrintCutNote(cut: number, tab: FoundationMessagePrintCutTab): string {
  return `+${cut} more on the framework's ${tab} tab in LFX One`;
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
  tab: FoundationMessagePrintCutTab,
  normal: (row: T) => number,
  tight: (row: T) => number
): FoundationMessagePrintCutList<T> {
  const total = (measure: (row: T) => number): number => rows.reduce((sum, row) => sum + measure(row), 0);
  if (total(normal) <= room) return { rows: [...rows], cut: 0, tight: false, note: '' };
  if (total(tight) <= room) return { rows: [...rows], cut: 0, tight: true, note: '' };
  const kept: T[] = [];
  let used = frameworkPortraitCutNoteHeight();
  for (const row of rows) {
    used += tight(row);
    if (used > room) break;
    kept.push(row);
  }
  const cut = rows.length - kept.length;
  return { rows: kept, cut, tight: true, note: foundationMessagePrintCutNote(cut, tab) };
}

/** The size at which a figure sits on one line of `width` px, stepped down from the tile figure's size in whole px, never under half of it. */
export function frameworkPortraitFigureSize(figure: string, width: number): number {
  const type = TYPE.tileFigure;
  let size = type.size;
  while (size > type.size / 2 && mktgPortraitCharsPerLine(width, size, { weight: type.weight }) < figure.length) size -= 1;
  return size;
}

/**
 * The tiles for a count the tiles hold (1 to FRAMEWORK_PORTRAIT_MAX_TILES), each with its share of a row and its text fitted to the
 * tile: the figure on one line, the label in the room under it less the source pill's when the figure has a source; none past that.
 */
export function frameworkPortraitNumberTiles(numbers: readonly FoundationMessagePrintNumber[]): FoundationMessagePrintNumberTile[] {
  const shares: readonly number[] | undefined = FRAMEWORK_PORTRAIT_TILE_SHARES[numbers.length as keyof typeof FRAMEWORK_PORTRAIT_TILE_SHARES];
  if (!shares || numbers.length > FRAMEWORK_PORTRAIT_MAX_TILES) return [];
  const tile = FRAMEWORK_PORTRAIT_NUMBER_TILE;
  return numbers.map((row, index) => {
    const share = shares[index];
    // A tile's content width: its share of the row less the gaps between tiles, less the side padding.
    const width = (PAGE.contentWidth - (share - 1) * tile.gap) / share - 2 * tile.paddingSide;
    const figureSize = frameworkPortraitFigureSize(row.number, width);
    const pillRoom = row.source ? tile.labelGap + tile.sourceHeight : 0;
    const labelRoom = tile.height - 2 * tile.paddingTop - figureSize * TYPE.tileFigure.line - tile.labelGap - pillRoom;
    const label = mktgPortraitFitBlock({ paras: [{ text: row.label, ...TYPE.tileLabel }] }, width, labelRoom).block.paras[0];
    return { ...row, share, wide: share === 1, figureSize, labelText: label?.text ?? row.label, labelSize: label?.size ?? TYPE.tileLabel.size };
  });
}

/** The height of a key numbers table row at the fact type: the taller of its two cells, with the row's padding and hairline. */
function numbersRowHeight(row: FoundationMessageNumberRow, tight: boolean): number {
  const [figure, label] = FRAMEWORK_PORTRAIT_NUMBER_COLUMNS.map((share) => (PAGE.contentWidth * share) / 100 - ROOM.factCellPadding);
  return (
    Math.max(frameworkPortraitTextHeight(row.number, TYPE.fact, figure), frameworkPortraitTextHeight(row.label, TYPE.fact, label)) +
    (tight ? ROOM.factRowTight : ROOM.factRow)
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

/** The height of a facts table row: the tallest of its three cells at the `<colgroup>` widths, with the row's padding and hairline. */
export function frameworkPortraitFactRowHeight(fact: FoundationMessagePrintFactRow, tight: boolean): number {
  const [factWidth, sourceWidth, usedWidth] = FRAMEWORK_PORTRAIT_FACT_COLUMNS.map((share) => (PAGE.contentWidth * share) / 100 - ROOM.factCellPadding);
  return (
    Math.max(
      frameworkPortraitTextHeight(fact.fact, TYPE.fact, factWidth),
      frameworkPortraitTextHeight(fact.source, TYPE.fact, Math.min(sourceWidth, ROOM.chip)),
      frameworkPortraitTextHeight(fact.usedBy, TYPE.fact, usedWidth)
    ) + (tight ? ROOM.factRowTight : ROOM.factRow)
  );
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
  const intro = `The figures the framework leans on, with where each came from.${date ? ` LFX figures are as of ${date}.` : ''}`;
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
      // The key numbers table: whole rows down to the footer, the rest on the next page; never cut. A fresh page always
      // keeps at least one row (K's paginate rule), so a row taller than the page still moves the loop on.
      let used = cursor + ROOM.label + ROOM.tableHead;
      const kept: FoundationMessageNumberRow[] = [];
      for (const row of remaining) {
        const height = numbersRowHeight(row, false);
        if (kept.length > 0 && used + height > tops.footer) break;
        used += height;
        kept.push(row);
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
          'Framework',
          (fact) => frameworkPortraitFactRowHeight(fact, false),
          (fact) => frameworkPortraitFactRowHeight(fact, true)
        ),
      });
      return pages;
    }
    page.factsTop = cursor;
    page.facts = frameworkPortraitCutList(
      view.facts,
      factsRoom,
      'Framework',
      (fact) => frameworkPortraitFactRowHeight(fact, false),
      (fact) => frameworkPortraitFactRowHeight(fact, true)
    );
    pages.push(page);
    return pages;
  }
}
