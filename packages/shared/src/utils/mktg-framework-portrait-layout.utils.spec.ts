// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the framework portrait book's list rule and key numbers
// pages: a list is tightened before it is cut and the cut is said under it;
// the figures print as tiles by their count up to six, past that as a table
// of every one, continued on another page when a page fills. Every fixture
// is synthetic.

import { describe, expect, it } from 'vitest';

import {
  FRAMEWORK_PORTRAIT_MAX_TILES,
  FRAMEWORK_PORTRAIT_NUMBER_TILE,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
} from '../constants/mktg-print.constants';
import { FoundationMessageContent } from '../interfaces/foundation-message.interface';
import {
  foundationMessagePrintCutNote,
  frameworkPortraitCutList,
  frameworkPortraitCutNoteHeight,
  frameworkPortraitFigureSize,
  frameworkPortraitNumberTiles,
  frameworkPortraitNumbersPages,
  frameworkPortraitChipWidth,
  frameworkPortraitIcpWhoWidth,
} from './mktg-framework-portrait-layout.utils';
import { buildFoundationMessagePrintView } from './mktg-print.utils';

const pair = (a: string, b: string): [string, string] => [a, b];

const content = (numbers: number, proofs: number): FoundationMessageContent => ({
  mf: {
    vision: 'V.',
    mission: 'M.',
    positioning: 'P.',
    tagline: 'T.',
    goals: [
      {
        id: 'g1',
        n: 1,
        t: 'Goal',
        vp: 'VP.',
        key: 'Key.',
        proof: Array.from({ length: proofs }, (_, index) => pair(`A proof sentence that takes some room in the facts table, number ${index + 1}.`, 'Report')),
        bite: 'Bite',
        icps: [],
      },
    ],
    crosscut: '',
    say: [],
    avoid: [],
    anchor: [],
    notes: '',
  },
  icp: [],
  mh: { umbrella: 'U.', line: 'L.', pillars: [], found: 'F.', aud: [] },
  nums: Array.from({ length: numbers }, (_, index) => pair(`${(index + 1) * 1000}`, `figure ${index + 1}`)),
});

const view = (numbers: number, proofs = 1) => buildFoundationMessagePrintView(content(numbers, proofs), 'TestOrbit', 1, null);

describe('the framework portrait book’s cut lists', () => {
  const rows = ['a', 'b', 'c', 'd'];
  const normal = () => 30;
  const tight = () => 20;

  it('keeps every row at the normal measure when they fit', () => {
    expect(frameworkPortraitCutList(rows, 120, 'Framework', normal, tight)).toEqual({ rows, cut: 0, tight: false, note: '' });
  });

  it('tightens first: every row at the tight measure when that is what fits', () => {
    expect(frameworkPortraitCutList(rows, 100, 'Framework', normal, tight)).toEqual({ rows, cut: 0, tight: true, note: '' });
  });

  it('then cuts to the leading whole rows that fit beside the note, and counts the rest', () => {
    const note = frameworkPortraitCutNoteHeight();
    expect(note).toBeCloseTo(6 + 10.5 * 1.4);
    // Four tight rows are 80: at 79 the list is cut, and the rows that stay (three at 60) must leave the note its room too.
    const cutTo = (kept: string[], cut: number) => ({ rows: kept, cut, tight: true, note: `+${cut} more on the framework's Framework tab in LFX One` });
    expect(frameworkPortraitCutList(rows, 79, 'Framework', normal, tight)).toEqual(cutTo(['a', 'b'], 2));
    expect(frameworkPortraitCutList(rows, 40 + note, 'Framework', normal, tight)).toEqual(cutTo(['a', 'b'], 2));
    expect(frameworkPortraitCutList(rows, 39 + note, 'Framework', normal, tight)).toEqual(cutTo(['a'], 3));
    // A room too small for any row still says what was cut: the note carries the count, the rows are none.
    expect(frameworkPortraitCutList(rows, 10, 'Framework', normal, tight)).toEqual(cutTo([], 4));
    expect(frameworkPortraitCutList([], 0, 'Framework', normal, tight)).toEqual({ rows: [], cut: 0, tight: false, note: '' });
  });

  it('words the note from the count and the tab the rows live on', () => {
    expect(foundationMessagePrintCutNote(3, 'Sources')).toBe("+3 more on the framework's Sources tab in LFX One");
    expect(foundationMessagePrintCutNote(1, 'Framework')).toBe("+1 more on the framework's Framework tab in LFX One");
  });
});

describe('the framework portrait book’s profile rows', () => {
  it('sizes the name-and-tags column to hold the kind and goal tags on one line, from the board’s 190 to a cap', () => {
    // Two short tags fit the board's column; four grow it to what they measure; past the cap the column stops growing.
    expect(frameworkPortraitChipWidth('Goal 1')).toBe(Math.ceil(6 * 8.5 * 0.72) + 16);
    expect(frameworkPortraitIcpWhoWidth(['Individual', 'Goal 1'])).toBe(190);
    const four = frameworkPortraitIcpWhoWidth(['Individual', 'Goal 1', 'Goal 2', 'Goal 3']);
    expect(four).toBe(frameworkPortraitChipWidth('Individual') + 3 * frameworkPortraitChipWidth('Goal 1') + 3 * 4);
    expect(four).toBeGreaterThan(190);
    expect(four).toBeLessThan(300);
    expect(frameworkPortraitIcpWhoWidth(['Member companies and prospects', 'Goal 1', 'Goal 2', 'Goal 3', 'Goal 4'])).toBe(300);
  });
});

describe('the framework portrait book’s key numbers', () => {
  it('lays the tiles out by the count: pairs to three, 2×2, three then two, 3×2; none past six', () => {
    const shares = (count: number) => frameworkPortraitNumberTiles(view(count).numbers).map((tile) => [tile.share, tile.wide]);
    expect(shares(1)).toEqual([[1, true]]);
    expect(shares(2)).toEqual([
      [2, false],
      [2, false],
    ]);
    expect(shares(3)).toEqual([
      [2, false],
      [2, false],
      [1, true],
    ]);
    expect(shares(4)).toEqual([
      [2, false],
      [2, false],
      [2, false],
      [2, false],
    ]);
    expect(shares(5).map(([share]) => share)).toEqual([3, 3, 3, 2, 2]);
    expect(shares(6).map(([share]) => share)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(FRAMEWORK_PORTRAIT_MAX_TILES).toBe(6);
    expect(shares(7)).toEqual([]);
    expect(shares(0)).toEqual([]);
  });

  it('prints one page with the tiles and the facts under them when the count allows tiles', () => {
    const tile = FRAMEWORK_PORTRAIT_NUMBER_TILE;
    const pages = frameworkPortraitNumbersPages(view(4, 3));
    expect(pages).toHaveLength(1);
    expect(pages[0].tiles).toHaveLength(4);
    expect(pages[0].numbersTable).toEqual([]);
    expect(pages[0].intro).toContain('The figures the framework leans on');
    expect(pages[0].factsTop).toBe(tile.top + 2 * tile.height + tile.gap + tile.tableGap);
    expect(pages[0].facts).toMatchObject({ cut: 0, tight: false, note: '' });
    expect(pages[0].facts.rows).toHaveLength(3);
    // Two rows of tiles put the facts table where the mock draws it (560); five tiles take two rows too (three, then two); one tile takes one.
    expect(pages[0].factsTop).toBe(560);
    expect(frameworkPortraitNumbersPages(view(5))[0].factsTop).toBe(560);
    expect(frameworkPortraitNumbersPages(view(1))[0].factsTop).toBe(388);
    expect(frameworkPortraitNumbersPages(view(0))[0]).toMatchObject({ tiles: [], numbersTable: [], factsTop: tile.top });
  });

  it('steps the figure down to the half-size floor and fits the label to the room under it', () => {
    // A third-width tile: (704 − 2 × 16) / 3 = 224 wide, 176 of content. Six seven-digit figures with a 30-character label.
    const content = (704 - 2 * 16) / 3 - 2 * 24;
    expect(content).toBe(176);
    const label = 'members across five continents';
    expect(label.length).toBe(30);
    const row = (number: string, source = '') => ({ number, label, source });
    const tiles = frameworkPortraitNumberTiles(Array.from({ length: 6 }, (_, index) => row(`${index + 1},200,000`)));
    expect(tiles.every((tile) => tile.share === 3)).toBe(true);
    // "1,200,000" at 54/500 is 9 × 54 × 0.55 = 267 px: too wide for 176, so the size steps down to the first whole px that
    // holds nine characters (176 / (9 × 0.55) = 35.5 → 35).
    expect(frameworkPortraitFigureSize('1,200,000', content)).toBe(35);
    expect(tiles.map((tile) => tile.figureSize)).toEqual([35, 35, 35, 35, 35, 35]);
    expect(frameworkPortraitFigureSize('41', content)).toBe(FRAMEWORK_PORTRAIT_TYPE.tileFigure.size);
    // The label's room is 156 − 44 − 35 − 10 = 67: two lines of 14/1.4 (39.2) fit as written.
    expect(tiles[0].labelSize).toBe(FRAMEWORK_PORTRAIT_TYPE.tileLabel.size);
    expect(tiles[0].labelText).toBe(label);
    // Under a 54 px figure the room is 48: two lines of 14/1.4 (39.2) still fit.
    const short = frameworkPortraitNumberTiles(Array.from({ length: 6 }, () => row('41')));
    expect(short[0].figureSize).toBe(54);
    expect(short[0].labelSize).toBe(FRAMEWORK_PORTRAIT_TYPE.tileLabel.size);
    // With a source pill under the label the room loses the pill and its gap (10 + 17): 21 is left, so the two lines come down to
    // one (10.5 px holds 30 characters in 176: 14.7 ≤ 21), the label whole; a half-width tile (296) holds it at 14 on one line.
    const sourced = frameworkPortraitNumberTiles(Array.from({ length: 6 }, () => row('41', 'LFX field')));
    expect(sourced[0].source).toBe('LFX field');
    expect(sourced[0].labelSize).toBe(10.5);
    expect(sourced[0].labelText).toBe(label);
    expect(frameworkPortraitNumberTiles(Array.from({ length: 4 }, () => row('299', 'LFX field')))[0].labelSize).toBe(14);
    // A half-width tile (296 of content) holds the same figure at its full size.
    expect(frameworkPortraitNumberTiles([row('1,200,000'), row('2')])[0].figureSize).toBe(54);
    // The figure never goes under half its size: a very long figure stops there.
    expect(frameworkPortraitFigureSize('1,234,567,890,123,456', content)).toBe(27);
  });

  it('keeps at least one row on every fresh page, so a row taller than a page still moves the table on', () => {
    const tall = 'x\n'.repeat(80).trim();
    const base = view(6, 1);
    const pages = frameworkPortraitNumbersPages({
      ...base,
      numbers: [...base.numbers, { number: '9', label: tall, source: '' }, { number: '10', label: 'after', source: '' }],
    });
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.flatMap((page) => page.numbersTable.map((row) => row.number))).toEqual(['1000', '2000', '3000', '4000', '5000', '6000', '9', '10']);
    expect(pages.some((page) => page.numbersTable.length === 1 && page.numbersTable[0].label === tall)).toBe(true);
  });

  it('past six prints the table of every figure, and continues it on more pages when a page fills, the facts last', () => {
    const nine = frameworkPortraitNumbersPages(view(9, 2));
    expect(nine).toHaveLength(1);
    expect(nine[0].tiles).toEqual([]);
    expect(nine[0].numbersTable.map((row) => row.number)).toEqual(['1000', '2000', '3000', '4000', '5000', '6000', '7000', '8000', '9000']);
    expect(nine[0].numbersTop).toBe(FRAMEWORK_PORTRAIT_NUMBER_TILE.top);
    expect(nine[0].factsTop).toBeGreaterThan(nine[0].numbersTop);
    expect(nine[0].facts.rows).toHaveLength(2);
    const forty = frameworkPortraitNumbersPages(view(40, 2));
    expect(forty.length).toBeGreaterThanOrEqual(2);
    expect(forty.map((page) => page.index)).toEqual(forty.map((_, index) => index + 1));
    expect(forty.flatMap((page) => page.numbersTable.map((row) => row.label))).toEqual(Array.from({ length: 40 }, (_, index) => `figure ${index + 1}`));
    expect(forty.slice(1).every((page) => page.intro === '' && page.tiles.length === 0 && page.numbersTop === FRAMEWORK_PORTRAIT_TOPS.numbersContinued)).toBe(
      true
    );
    expect(forty.slice(0, -1).every((page) => page.factsTop === null)).toBe(true);
    expect(forty[forty.length - 1].facts.rows).toHaveLength(2);
  });

  it('puts the facts on a page of their own when the table leaves no room for a row of them', () => {
    const pages = frameworkPortraitNumbersPages(view(200, 1));
    const last = pages[pages.length - 1];
    expect(last.facts.rows).toHaveLength(1);
    expect(pages.every((page, index) => index === pages.length - 1 || page.factsTop === null)).toBe(true);
    expect(pages.flatMap((page) => page.numbersTable)).toHaveLength(200);
  });
});
