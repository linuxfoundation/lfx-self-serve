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
  FoundationMessagePrintFactRow,
  FoundationMessagePrintNumbersPage,
  FoundationMessagePrintNumberTile,
  FoundationMessagePrintType,
  FoundationMessagePrintView,
} from '../interfaces/mktg-print.interface';
import { mktgPortraitParaHeight } from './mktg-portrait-print.utils';

const ROOM = FRAMEWORK_PORTRAIT_ROOM;
const TYPE = FRAMEWORK_PORTRAIT_TYPE;
const PAGE = MKTG_PORTRAIT_PAGE;

/** The line under a cut list: `+3 more in the framework's Sources tab in LFX One`. */
export function foundationMessagePrintCutNote(cut: number): string {
  return `+${cut} more in the framework's Sources tab in LFX One`;
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
  tight: (row: T) => number
): FoundationMessagePrintCutList<T> {
  const total = (measure: (row: T) => number): number => rows.reduce((sum, row) => sum + measure(row), 0);
  if (total(normal) <= room) return { rows: [...rows], cut: 0, tight: false };
  if (total(tight) <= room) return { rows: [...rows], cut: 0, tight: true };
  const kept: T[] = [];
  let used = frameworkPortraitCutNoteHeight();
  for (const row of rows) {
    used += tight(row);
    if (used > room) break;
    kept.push(row);
  }
  return { rows: kept, cut: rows.length - kept.length, tight: true };
}

/** The tiles for a count the tiles hold (1 to FRAMEWORK_PORTRAIT_MAX_TILES), each with its share of a row; none past that. */
export function frameworkPortraitNumberTiles(numbers: readonly FoundationMessageNumberRow[]): FoundationMessagePrintNumberTile[] {
  const shares = FRAMEWORK_PORTRAIT_TILE_SHARES[numbers.length];
  if (!shares || numbers.length > FRAMEWORK_PORTRAIT_MAX_TILES) return [];
  return numbers.map((row, index) => ({ ...row, share: shares[index], wide: shares[index] === 1 }));
}

/** The height of a key numbers table row at the fact type: the taller of its two cells, with the row's padding and hairline. */
function numbersRowHeight(row: FoundationMessageNumberRow, tight: boolean): number {
  const [figure, label] = FRAMEWORK_PORTRAIT_NUMBER_COLUMNS.map((share) => (PAGE.contentWidth * share) / 100 - ROOM.factCellPadding);
  return (
    Math.max(frameworkPortraitTextHeight(row.number, TYPE.fact, figure), frameworkPortraitTextHeight(row.label, TYPE.fact, label)) +
    (tight ? ROOM.factRowTight : ROOM.factRow)
  );
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
  const noFacts: FoundationMessagePrintCutList<FoundationMessagePrintFactRow> = { rows: [], cut: 0, tight: false };
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
      // The key numbers table: whole rows down to the footer, the rest on the next page; never cut.
      let used = cursor + ROOM.label + ROOM.tableHead;
      const kept: FoundationMessageNumberRow[] = [];
      for (const row of remaining) {
        const height = numbersRowHeight(row, false);
        if (used + height > tops.footer) break;
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
    // The facts table, in the room left on this page: at least its head and one tight row, else on a page of its own.
    const factsRoom = tops.footer - cursor - ROOM.label - ROOM.tableHead;
    const firstRow = view.facts[0] ? frameworkPortraitFactRowHeight(view.facts[0], true) : 0;
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
    page.factsTop = cursor;
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
